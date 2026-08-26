// R19.6 — THE DEPLOY HOOK MUST NOT SHIP. Not to the browser, not in out/, not ever.
//
//   node --test tests/ci/deploy-hook-secrecy.test.mjs      (npm run test:ci)
//
// A Cloudflare Pages deploy hook is an UNAUTHENTICATED TRIGGER. POST to the URL and a build
// starts — no token, no signature, no origin check, no expiry. Possession IS authorisation.
// So the leak this file guards is not "an attacker learns a URL", it is "anyone who reads the
// page source can spend the account's build minutes at will, indefinitely, and there is no way
// to stop them except rotating the hook".
//
// ⚠ NEXT WILL INLINE IT IF YOU LET IT. `process.env.X` inside a client component is not a
// runtime read in a static export — Next SUBSTITUTES any variable defined at build time, and
// the value lands in the JS chunk as a string literal. (app/lib/firebase.js's header documents
// the mirror-image case: an UNDEFINED variable is left as a live property read, which is why
// that file's emulator switch needed a second fence. Both facts are measured.) So the rule is
// not "be careful with it" — it is "app/ must never name it at all".
//
// ⚠⚠ THIS FILE FOUND A LIVE LEAK ON THE DAY IT WAS WRITTEN. READ THIS BEFORE THE CODE. ⚠⚠
//
// 26 Aug 2026, first run against a built out/: TWO Cloudflare deploy-hook URLs are ALREADY
// hardcoded in client components and ALREADY shipped in the production JavaScript bundle.
//
//   df2479ae-06a5-4ff3-a319-29b7b94dd106   app/admin/page.js:1042        (story publish)
//                                          app/admin/voices/page.js:12   (voices mutations)
//   6667c809-d3bf-4c93-bab0-065323c09d76   app/admin/forum/page.jsx:34   (Open Pages approve)
//
// All three files carry 'use client', so all three UUIDs are in out/_next/static/chunks/ and
// have been served to every visitor of the site for as long as they have existed. A fourth
// occurrence — functions/api/open-pages/moderate.js:51 — is a Pages Function and is FINE; it
// runs on the server and is not bundled for a browser.
//
// WHAT THAT MEANS, PLAINLY: anyone who has ever loaded the site can POST to those URLs and
// start a build, as often as they like, forever. There is no token to revoke. The only
// remedy is to DELETE BOTH HOOKS IN THE CLOUDFLARE DASHBOARD and issue new ones — which is a
// manual step, and is listed for Ikenna alongside creating DEPLOY_HOOK_URL.
//
// R19.6 DID NOT FIX THOSE THREE SITES, deliberately. Rewiring them through the new endpoint
// before the replacement hooks exist would leave the story, voices and Open Pages publish
// paths answering 503 in the interim, and it would not un-publish a single UUID that is
// already in a bundle in someone's browser cache and in this repo's git history. The code
// change is worth nothing until the rotation happens, and the rotation is worth everything
// on its own.
//
// ── SO THIS IS A RATCHET, NOT A CLEAN ASSERTION ─────────────────────────────────────────
//
// The two known hook ids are listed below as DATED EXCEPTIONS. Any OTHER hook URL, in any
// source file or anywhere in out/, fails immediately — so the leak cannot grow. When the
// hooks are rotated and those three call sites move behind /api/bookstore/rebuild, empty the
// list and this file becomes the absolute it was written to be.
//
// ── WHY IT MATTERS FOR R19.6's OWN HOOK ─────────────────────────────────────────────────
//
// Next SUBSTITUTES any env var defined at build time into the client bundle — `process.env.X`
// in a client component is not a runtime read in a static export, it is a string literal in a
// chunk. (app/lib/firebase.js's header documents the mirror-image case: an UNDEFINED variable
// is left as a live property read, which is why that file's emulator switch needed a second
// fence. Both facts are measured.) So the rule for the new hook is not "be careful with it" —
// it is "app/ must never name it at all", and that is what the second test asserts.
//
// THREE ASSERTIONS, and the last one needs a build:
//
//   SOURCES  — always runs. `DEPLOY_HOOK_URL` appears under functions/ and nowhere under app/,
//              and no hook URL outside the dated exceptions is written down anywhere.
//   OUT/     — runs when out/ exists. Scans every emitted byte for the variable name, for any
//              unlisted Cloudflare deploy-hook URL, and for the live value if one is in the
//              environment. reader-tests.yml runs this AFTER `npx next build`, which is the
//              run that matters; a bare `npm run test:ci` on a clean checkout reports the skip
//              loudly rather than passing silently on an assertion it never made.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VAR = 'DEPLOY_HOOK_URL';

// A READ of the variable, in any of the three forms that would make Next inline it:
// `env.DEPLOY_HOOK_URL`, `process.env.DEPLOY_HOOK_URL`, `env['DEPLOY_HOOK_URL']`.
//
// Matching the READ rather than the NAME is deliberate. A bare substring scan would forbid
// app/lib/bookstore/rebuild.js from having the comment that explains why it must never touch
// the variable — and a rule that punishes its own documentation is a rule people delete the
// documentation to satisfy. Nothing is inlined by a mention in a comment; only a read is.
const READS_VAR = new RegExp(
  `(?:process\\s*\\.\\s*)?env\\s*(?:\\.\\s*${VAR}\\b|\\[\\s*['"\`]${VAR}['"\`]\\s*\\])`,
);

// The shape of a Cloudflare Pages deploy hook, so a HARDCODED one is caught even if somebody
// renames the variable on the way in. Captures the id, because the ratchet is per-hook.
const HOOK_SHAPE = /pages\/webhooks\/deploy_hooks\/([0-9a-f-]{8,})/g;

// THE DATED EXCEPTIONS — 26 Aug 2026. See this file's header. These two are already public;
// listing them here is not a disclosure, it is a record. Delete an entry the moment its hook
// is rotated in Cloudflare, and delete the list when both are.
const KNOWN_LEAKED_HOOK_IDS = new Set([
  'df2479ae-06a5-4ff3-a319-29b7b94dd106', // app/admin/page.js, app/admin/voices/page.js
  '6667c809-d3bf-4c93-bab0-065323c09d76', // app/admin/forum/page.jsx (+ a legitimate server use)
]);

/** Every deploy-hook id in `src` that is NOT one of the two already-public ones. */
function unlistedHookIds(src) {
  const out = new Set();
  for (const m of src.matchAll(HOOK_SHAPE)) {
    if (!KNOWN_LEAKED_HOOK_IDS.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

/** Every file under `dir`, recursively, skipping the trees that are not ours. */
function walk(dir, skip = new Set(['node_modules', '.git', '.next'])) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
}

// Binary-ish payloads carry no source identifiers and reading them as utf8 is noise.
const TEXTUAL = /\.(js|mjs|cjs|jsx|ts|tsx|json|html|htm|css|txt|map|svg|xml|md)$/i;

function hits(files, needle) {
  const found = [];
  for (const f of files) {
    if (!TEXTUAL.test(f)) continue;
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    if (typeof needle === 'string') {
      if (src.includes(needle)) found.push(relative(ROOT, f));
      continue;
    }
    // A function needle returns the offending values, or an EMPTY array for a clean file —
    // and an empty array is truthy, which is exactly the way this helper got it wrong once.
    const offenders = needle(src);
    if (Array.isArray(offenders) ? offenders.length > 0 : !!offenders) {
      found.push(`${relative(ROOT, f)} → ${[].concat(offenders).join(', ')}`);
    }
  }
  return found;
}

describe('the deploy hook stays on the server', () => {
  test('the variable is read under functions/ — the guard is not vacuous', () => {
    // Without this, every assertion below would pass on a repo where the feature was deleted.
    const server = hits(walk(join(ROOT, 'functions')), (src) => READS_VAR.test(src) && [VAR])
      .map((f) => f.split(' → ')[0]);
    assert.ok(
      server.length >= 1,
      `${VAR} is not read anywhere under functions/. Either the rebuild endpoint was removed `
      + '(in which case delete this file too) or it stopped reading its own env var.',
    );
    assert.ok(
      server.includes('functions/api/bookstore/rebuild.js'),
      `the endpoint that owns ${VAR} must be the one reading it; found: ${server.join(', ')}`,
    );
  });

  test('THE RULE: nothing under app/ READS it', () => {
    const leaked = hits(walk(join(ROOT, 'app')), (src) => READS_VAR.test(src) && [VAR])
      .map((f) => f.split(' → ')[0]);
    assert.deepEqual(
      leaked, [],
      `${VAR} is read in client-tree sources: ${leaked.join(', ')}. Next inlines a defined `
      + 'env var into the browser bundle at build time, so reading it here ships it. The client '
      + 'half must know only the ENDPOINT path — see app/lib/bookstore/rebuild.js.',
    );
  });

  test('no UNLISTED deploy-hook URL is hardcoded anywhere in the repo sources', () => {
    // The ratchet. The two ids in KNOWN_LEAKED_HOOK_IDS are already public and are being
    // rotated by hand; a THIRD one appearing is a new leak and fails here on the day it lands.
    const dirs = ['app', 'functions', 'scripts', 'tests', 'public'];
    const leaked = [];
    for (const d of dirs) {
      const p = join(ROOT, d);
      if (!existsSync(p)) continue;
      leaked.push(...hits(walk(p), unlistedHookIds)
        .filter((f) => !f.startsWith('tests/bookstore/rebuild.test.mjs')));
    }
    assert.deepEqual(
      leaked, [],
      `a Cloudflare deploy-hook URL not on the dated exception list is written into: ${leaked.join(', ')}. `
      + 'It is an unauthenticated trigger — possession is authorisation — and it belongs in the '
      + 'Pages project environment, read server-side by functions/api/bookstore/rebuild.js, and '
      + 'nowhere else. (tests/bookstore/rebuild.test.mjs is exempt: its hook is a fabricated '
      + 'literal that exists so the specs can prove the real one is never echoed.)',
    );
  });

  test('the two known leaks are still exactly where this file says they are', () => {
    // The other half of a ratchet: an exception list that stops matching reality is worse than
    // no list, because it silently forgives whatever moved. If one of these fails, the leak was
    // either fixed — in which case delete the entry and celebrate — or it moved, in which case
    // the header above is now lying to whoever reads it next.
    const clientLeaks = hits(walk(join(ROOT, 'app')), (src) => {
      const ids = [...src.matchAll(HOOK_SHAPE)].map((m) => m[1]);
      return ids.length ? ids : false;
    }).map((f) => f.split(' → ')[0]);

    assert.deepEqual(
      clientLeaks.sort(),
      ['app/admin/forum/page.jsx', 'app/admin/page.js', 'app/admin/voices/page.js'],
      'the client-side deploy-hook leaks recorded in this file\'s header have changed. If one was '
      + 'FIXED, remove it here and from the header (and from KNOWN_LEAKED_HOOK_IDS once no file '
      + 'carries that id). If a NEW one appeared, the test above has already failed and this is '
      + 'the second alarm.',
    );
  });

  test('the built export carries neither the variable nor a hook URL', () => {
    const OUT = join(ROOT, 'out');
    if (!existsSync(OUT)) {
      // LOUD, not silent. A skip that reads like a pass is how this assertion would rot.
      console.log(
        '\n⚠ out/ is absent, so the BUILT half of this assertion did not run. It is the half '
        + 'that matters — the sources can be clean and a bundler can still emit the value. Run '
        + '`npx next build` first; reader-tests.yml runs this step after its build.\n',
      );
      return;
    }

    const files = walk(OUT);
    assert.ok(files.length > 50, `out/ holds only ${files.length} files — that is not a build`);

    const named = hits(files, VAR);
    assert.deepEqual(named, [], `${VAR} was emitted into the static export: ${named.join(', ')}`);

    // Chunk filenames are content-hashed, so out/ cannot be allow-listed by path — the ratchet
    // is on the hook ID instead. The two known ones are expected here (they are compiled from
    // the three client components named in the header); a third would be a new leak.
    const shaped = hits(files, unlistedHookIds);
    assert.deepEqual(
      shaped, [],
      `a deploy-hook URL not on the dated exception list was emitted into the static export: ${shaped.join(', ')}`,
    );

    // And if a real hook is in this process's environment — as it would be on a machine
    // configured to run the endpoint locally — its literal value must be absent too.
    const live = process.env[VAR];
    if (live) {
      const literal = hits(files, live);
      assert.deepEqual(literal, [], `the LIVE hook URL was emitted into the static export: ${literal.join(', ')}`);
    }

    console.log(`\n✓ scanned ${files.length} files in out/ — no ${VAR}, no hook URL${live ? ', no live value' : ''}.\n`);
  });
});
