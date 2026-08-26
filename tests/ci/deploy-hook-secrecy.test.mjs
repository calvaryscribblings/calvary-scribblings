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
// ── WHY THIS FILE EXISTS: IT FOUND A LIVE LEAK, AND THE LEAK IS NOW CLOSED ───────────────
//
// 26 Aug 2026, R19.6, first run against a built out/: TWO Cloudflare deploy-hook URLs were
// hardcoded in client components and were already shipping in the production JavaScript bundle.
//
//   df2479ae-…   app/admin/page.js:1042, app/admin/voices/page.js:12
//   6667c809-…   app/admin/forum/page.jsx:34  (+ a legitimate server use in
//                functions/api/open-pages/moderate.js)
//
// All three client files carry 'use client', so both UUIDs were in out/_next/static/chunks/ and
// had been served to every visitor of the site for as long as they existed. A deploy hook is an
// unauthenticated trigger — POST to the URL and a build starts, with no token, no signature and
// no expiry. Possession IS authorisation, and there is nothing to revoke short of destroying
// the hook.
//
// ── WHAT HAPPENED NEXT, AND WHY THE EXCEPTION LIST IS EMPTY ──────────────────────────────
//
// R19.6 could not fix it: rewiring the three call sites before replacement hooks existed would
// have left the story, voices and Open Pages publish paths dead, and it would not have
// un-published a UUID already sitting in browser caches and in git history. So R19.6 recorded
// both ids as DATED EXCEPTIONS — the leak could not grow, but it was still there.
//
//   ✔ 26 Aug 2026 — BOTH HOOKS WERE ROTATED IN CLOUDFLARE. df2479ae-… and 6667c809-… are dead
//     URLs; POSTing either one starts nothing. Three fresh hooks were created and their URLs
//     put in the Pages project environment as DEPLOY_HOOK_URL, CMS_DEPLOY_HOOK_URL and
//     OPEN_PAGES_DEPLOY_HOOK_URL.
//
//   ✔ R19.7 — all four call sites moved onto /api/rebuild, which takes an IDENTIFIER
//     ('bookstore' | 'cms' | 'openPages') and maps it to an environment variable server-side.
//     No URL crosses the boundary in either direction.
//
// So KNOWN_LEAKED_HOOK_IDS is EMPTY, and it is empty because the leak was closed — not because
// it was never populated. That distinction is the reason this note is long: an empty allow-list
// with no history reads like a guard that has never caught anything, and the next person to hit
// a failure here needs to know it has.
//
// ⚠ DO NOT RE-POPULATE IT. If this suite fails, a deploy-hook URL has been written into the
// tree or emitted into the build, and the fix is to route that call through /api/rebuild — not
// to add its id below.
//
// ── WHY THE NEW HOOK CANNOT LEAK THE SAME WAY ────────────────────────────────────────────
//
// Next SUBSTITUTES any env var defined at build time into the client bundle — `process.env.X`
// in a client component is not a runtime read in a static export, it is a string literal in a
// chunk. (app/lib/firebase.js's header documents the mirror-image case: an UNDEFINED variable
// is left as a live property read, which is why that file's emulator switch needed a second
// fence. Both facts are measured.) So the rule is not "be careful with it" — it is "app/ must
// never read it at all", which is what the second test asserts.
//
// FOUR ASSERTIONS, and the last one needs a build:
//
//   SOURCES  — always run. The env vars are read under functions/ and nowhere under app/; no
//              hook URL is written down anywhere; and no client file POSTs api.cloudflare.com
//              directly, which is the shape the whole leak took.
//   OUT/     — runs when out/ exists. Scans every emitted byte for the variable names, for any
//              Cloudflare deploy-hook URL at all, and for the live values if they are in the
//              environment. reader-tests.yml runs this AFTER `npx next build`, which is the run
//              that matters; a bare `npm run test:ci` on a clean checkout reports the skip
//              loudly rather than passing silently on an assertion it never made.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { HOOK_ENV } from '../../functions/api/_deploy-hooks.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// The three deploy-hook environment variables. Read from functions/api/_deploy-hooks.js rather
// than retyped, so adding a fourth hook cannot quietly escape this scan.
const HOOK_VARS = Object.values(HOOK_ENV);

// A READ of one of them, in any of the forms that would make Next inline it:
// `env.X`, `process.env.X`, `env['X']`.
//
// Matching the READ rather than the NAME is deliberate. A bare substring scan would forbid
// app/lib/rebuild.js from carrying the comment that explains why it must never touch these —
// and a rule that punishes its own documentation is a rule people delete the documentation to
// satisfy. Nothing is inlined by a mention in a comment; only a read is.
const readsVar = (name) => new RegExp(
  `(?:process\\s*\\.\\s*)?env\\s*(?:\\.\\s*${name}\\b|\\[\\s*['"\`]${name}['"\`]\\s*\\])`,
);
const readsAnyVar = (src) => HOOK_VARS.filter((n) => readsVar(n).test(src));

// THE SHAPE THE LEAK ACTUALLY TOOK: a client file POSTing api.cloudflare.com itself. Matched as
// a STRING LITERAL (quote or backtick immediately before the scheme), so the prose above a call
// site may still name the host while the call itself may not exist.
const CALLS_CLOUDFLARE = /['"`]https:\/\/api\.cloudflare\.com/;

// The shape of a Cloudflare Pages deploy hook, so a HARDCODED one is caught even if somebody
// renames the variable on the way in. Captures the id, because the ratchet is per-hook.
const HOOK_SHAPE = /pages\/webhooks\/deploy_hooks\/([0-9a-f-]{8,})/g;

// ⚠ EMPTY, AND IT STAYS EMPTY. Both entries this set once held — df2479ae-… and 6667c809-… —
// were rotated in Cloudflare on 26 Aug 2026 and are dead URLs. R19.7 moved every call site onto
// /api/rebuild, so nothing in this repo needs to name a hook again. Read the header before
// adding anything here; the answer to a failure below is a call site to fix, not an id to
// forgive.
const KNOWN_LEAKED_HOOK_IDS = new Set([]);

/** Every deploy-hook id in `src` that is not on the (now empty) exception list. */
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

describe('the deploy hooks stay on the server', () => {
  test('the mapping exists and is reachable — the guard is not vacuous', () => {
    // Without this, every assertion below would pass on a repo where the feature was deleted:
    // "no file names a hook variable" is trivially true when nothing uses hooks at all.
    //
    // The lookup is DYNAMIC — `env?.[HOOK_ENV[id]]` — so no file literally contains
    // `env.DEPLOY_HOOK_URL`, and scanning for that form would be the wrong question. What must
    // be true is that the table names all three, that it reads the environment through them,
    // and that a route resolves through the table.
    const owner = join(ROOT, 'functions/api/_deploy-hooks.js');
    assert.ok(existsSync(owner), 'functions/api/_deploy-hooks.js must exist — it owns the mapping');
    const src = readFileSync(owner, 'utf8');

    for (const name of HOOK_VARS) {
      assert.match(src, new RegExp(`['"\`]${name}['"\`]`), `${name} must appear in the mapping table`);
    }
    assert.match(src, /env\s*\??\.?\[/, 'the mapping must read the environment by computed key');

    const consumers = hits(walk(join(ROOT, 'functions')), (s2) => /resolveHook\s*\(/.test(s2) && ['resolveHook'])
      .map((f) => f.split(' → ')[0])
      .filter((f) => f !== 'functions/api/_deploy-hooks.js');
    assert.ok(
      consumers.includes('functions/api/rebuild.js'),
      `the rebuild endpoint must resolve through the table; consumers found: ${consumers.join(', ') || 'none'}`,
    );
    assert.ok(
      consumers.includes('functions/api/open-pages/moderate.js'),
      'the Open Pages auto-publish path must resolve through the table too — it held a hook '
      + 'literal until R19.7, and that literal is now a rotated, dead URL',
    );
  });

  test('THE RULE: nothing under app/ READS a hook variable', () => {
    const leaked = hits(walk(join(ROOT, 'app')), readsAnyVar);
    assert.deepEqual(
      leaked, [],
      `a deploy-hook variable is read in client-tree sources: ${leaked.join(', ')}. Next inlines `
      + 'a defined env var into the browser bundle at build time, so reading one here ships it. '
      + 'The client half must know only the ENDPOINT path and an IDENTIFIER — see app/lib/rebuild.js.',
    );
  });

  test('THE COMPANION: no client file POSTs a deploy hook directly', () => {
    // The exact shape the R19.6 leak took, kept as its own assertion because it fails EARLIER
    // and more legibly than the URL scan: a call site that has re-acquired `fetch(CLOUDFLARE…)`
    // is a mistake to name as such, not a hex id to report.
    const calling = hits(walk(join(ROOT, 'app')), (src) => CALLS_CLOUDFLARE.test(src) && ['api.cloudflare.com'])
      .map((f) => f.split(' → ')[0]);
    assert.deepEqual(
      calling, [],
      `client code is calling api.cloudflare.com directly: ${calling.join(', ')}. A deploy hook `
      + 'is an unauthenticated trigger and must never be reachable from a browser bundle. Post '
      + "to /api/rebuild with a hook IDENTIFIER instead — app/lib/rebuild.js's HOOKS.",
    );
  });

  test('THE FINDING, CLOSED: no deploy-hook URL is written down anywhere in the repo', () => {
    // The exception list is EMPTY as of R19.7 — see the header. Any hit at all is a leak.
    const dirs = ['app', 'functions', 'scripts', 'tests', 'public'];
    const leaked = [];
    for (const d of dirs) {
      const p = join(ROOT, d);
      if (!existsSync(p)) continue;
      leaked.push(...hits(walk(p), unlistedHookIds)
        .filter((f) => !f.startsWith('tests/ci/rebuild.test.mjs')));
    }
    assert.deepEqual(
      leaked, [],
      `a Cloudflare deploy-hook URL is written into: ${leaked.join(', ')}. It is an `
      + 'unauthenticated trigger — possession is authorisation — and it belongs in the Pages '
      + 'project environment, resolved server-side by functions/api/_deploy-hooks.js, and '
      + 'nowhere else. (tests/ci/rebuild.test.mjs is exempt: its hook is a fabricated literal '
      + 'that exists so the specs can prove a real one is never echoed.)',
    );
  });

  test('the built export carries no hook variable and no hook URL', () => {
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

    const named = hits(files, readsAnyVar);
    assert.deepEqual(named, [], `a deploy-hook variable was emitted into the static export: ${named.join(', ')}`);

    // Chunk filenames are content-hashed, so out/ cannot be allow-listed by path. With the
    // exception list empty, the rule is simply: not one.
    const shaped = hits(files, unlistedHookIds);
    assert.deepEqual(
      shaped, [],
      `a deploy-hook URL was emitted into the static export: ${shaped.join(', ')}`,
    );

    const calling = hits(files, (src) => CALLS_CLOUDFLARE.test(src) && ['api.cloudflare.com']);
    assert.deepEqual(calling, [], `the export calls api.cloudflare.com directly: ${calling.join(', ')}`);

    // And if real hooks are in this process's environment — as they would be on a machine
    // configured to run the endpoint locally — their literal values must be absent too.
    const live = HOOK_VARS.map((n) => process.env[n]).filter(Boolean);
    for (const value of live) {
      const literal = hits(files, value);
      assert.deepEqual(literal, [], `a LIVE hook URL was emitted into the static export: ${literal.join(', ')}`);
    }

    console.log(
      `\n✓ scanned ${files.length} files in out/ — no hook variable, no hook URL, no direct `
      + `Cloudflare call${live.length ? `, and none of the ${live.length} live value(s) present` : ''}.\n`,
    );
  });
});
