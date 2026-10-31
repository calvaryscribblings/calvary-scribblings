// SAFETY-1 — nothing under scripts/ writes to production except through the guard.
//
//   A bulk write goes through the guard: a dry run first, then a fresh, verified backup,
//   then the write. No exceptions, founders included.            (CLAUDE.md)
//
// The static half (scripts/safety/check.mjs) reads every file under scripts/. The emulator half
// (tests/safety/guard.emulator.test.mjs) proves the guard does what it says. This file fails the
// build if a script grows a raw write, and proves the check would have caught the script that
// started this round: backfill-story-bodies.mjs as it stood before PROOFS-R1, PUTting the whole of
// story_bodies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { checkTree, findRawWrites, EXEMPT, REASONS } from '../../scripts/safety/check.mjs';
import { checkPath, checkObjectName, openGuard, pushId, GuardRefusal } from '../../scripts/safety/guard.mjs';

const fixture = (n) => readFileSync(new URL(`./fixtures/safety/${n}`, import.meta.url), 'utf8');

describe('SAFETY-1 · every production write under scripts/ goes through the guard', () => {
  test('the whole tree is clean', () => {
    const bad = checkTree();
    assert.deepEqual(bad.map((b) => `${b.file}: ${b.hits.map((h) => `line ${h.line} ${h.kind}`).join(', ')}`), [],
      'these files write to production without scripts/safety/guard.mjs. Route the write through openGuard() '
      + '(guard.update / guard.transact / guard.storage, or guard.adminDb / guard.adminBucket around a firebase-admin '
      + 'handle). A script that only reads wraps its handle in readOnlyDb / readOnlyBucket.');
  });

  test('THE CASE THAT STARTED IT: the pre-PROOFS-R1 backfill-story-bodies.mjs (a wholesale PUT of story_bodies) fails', () => {
    const hits = findRawWrites(fixture('backfill-story-bodies.pre-proofs-r1.mjs.txt'));
    assert.ok(hits.some((h) => h.kind === 'rest' && /PUT/.test(h.detail)), JSON.stringify(hits));
  });

  test('each way round the guard is caught', () => {
    const cases = {
      'REST PATCH': "await fetch(`${DB_URL}/.json`, { method: 'PATCH', body })",
      'REST DELETE, URL from a parameter': "await fetch(url, { method: 'DELETE' })",
      'method held in a variable': 'await fetch(u, { method, headers })',
      'REST POST (a push)': "await fetch(`${DB_URL}/x.json`, { method: 'POST', body })",
      'a raw admin database': "const db = getDatabase();\nawait db.ref('x').set(null);",
      'old-style admin.database()': 'const db = admin.database();',
      'a raw bucket': "const b = getStorage().bucket();\nawait b.file('a').delete();",
      'the client SDK': "import { ref, set } from 'firebase/database';",
    };
    for (const [name, src] of Object.entries(cases)) assert.ok(findRawWrites(src).length > 0, `not caught: ${name}`);
  });

  test('…and the guarded and read-only forms pass', () => {
    const ok = {
      'guard.update': "const guard = await openGuard('x');\nawait guard.update({ 'a/b': 1 });",
      'adminDb': "const db = guard.adminDb(getDatabase());",
      'adminBucket': "const bucket = guard.adminBucket(getStorage().bucket());",
      'readOnlyDb': 'const db = readOnlyDb(getDatabase());',
      'a GET': "await fetch(`${DB_URL}/x.json`, { method: 'GET' })",
      'no method': 'await fetch(`${DB_URL}/x.json`)',
      'Stripe': "await fetch('https://api.stripe.com/v1/prices', { method: 'POST' })",
      'a reasoned non-Firebase call': "await fetch(url, { method: 'POST' }); // safety-guard: not-firebase (the deploy hook)",
      'a commented-out write': "// await fetch(u, { method: 'PUT' })",
    };
    for (const [name, src] of Object.entries(ok)) assert.deepEqual(findRawWrites(src), [], `wrongly flagged: ${name}`);
  });

  test('a not-firebase marker needs a reason in brackets', () => {
    assert.ok(findRawWrites("await fetch(url, { method: 'POST' }); // safety-guard: not-firebase").length > 0);
  });

  test('the exemptions are few, named, and each has a known reason', () => {
    for (const [file, [reason, why]] of Object.entries(EXEMPT)) {
      assert.ok(REASONS[reason], `${file}: unknown reason ${reason}`);
      assert.ok(why && why.length > 20, `${file}: say why`);
      assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `${file} is exempt but does not exist`);
    }
    assert.ok(Object.keys(EXEMPT).length <= 8, 'the exemption list is growing: is this still the exception?');
  });

  test('a retired script stays retired: scripts/RETIRED-SCRIPTS.md names none that still exists', () => {
    const md = readFileSync(new URL('../../scripts/RETIRED-SCRIPTS.md', import.meta.url), 'utf8');
    const named = [...md.matchAll(/^\| `(scripts\/[^`]+)`/gm)].map((m) => m[1]);
    assert.ok(named.length >= 20, 'the retirement list is missing');
    for (const f of named) assert.equal(existsSync(new URL(`../../${f}`, import.meta.url)), false, `${f} is listed as retired but exists`);
  });
});

describe('SAFETY-1 · the guard refuses before it reaches the network', () => {
  test('the root, a blank id, a placeholder segment', () => {
    assert.throws(() => checkPath(''), GuardRefusal);
    assert.throws(() => checkPath('/'), GuardRefusal);
    assert.throws(() => checkPath('story_bodies/'), /empty segment/);
    assert.throws(() => checkPath('story_bodies//content'), /empty segment/);
    assert.throws(() => checkPath(`cms_stories/${undefined}`), /placeholder/);
    assert.throws(() => checkPath('a/b.c'), /illegal/);
    assert.equal(checkPath('/story_bodies/a-slug'), 'story_bodies/a-slug');
    assert.throws(() => checkObjectName('covers/'), GuardRefusal);
    assert.throws(() => checkObjectName(''), GuardRefusal);
  });

  test('dry by default: without --apply it never calls fetch', async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('no network in a dry run'); };
    try {
      const lines = [];
      const g = await openGuard('ci-dry', { argv: ['node', 'x'], token: 't', env: {}, log: (s) => lines.push(s) });
      assert.equal(g.apply, false);
      const r = await g.update({ story_bodies: null, 'cms_stories/a/content': null });
      assert.equal(r.applied, false);
      assert.equal(calls, 0);
      assert.match(lines.join('\n'), /DRY RUN, would write 2 path\(s\) in 2 node\(s\), 2 of them deletions/);
      const s = await g.storage({ deletes: [{ name: 'covers/a.png' }] });
      assert.equal(s.applied, false);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = real; }
  });

  test('a push id is a Firebase push id: 20 characters, time-ordered', () => {
    const a = pushId(1e12), b = pushId(1e12 + 1);
    assert.equal(a.length, 20);
    assert.ok(a.slice(0, 8) < b.slice(0, 8));
  });
});
