// W17 — THE LIVE-TEST SAFETY RULES, pinned.
//
//   node --test tests/ci/w17-live-safety.test.mjs      (part of npm run test:ci)
//
// The browser half is tests/live/firewall-proof.mjs, which forces the SDK onto long-polling
// against the live database and proves nothing lands.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { refusal, isWriteFrame, ALLOW_POST } from '../live/firewall.mjs';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

const SITE = 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const src = (p) => readFileSync(p, 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SELF = 'tests/ci/w17-live-safety.test.mjs';
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  if (e === 'node_modules' || e.startsWith('.')) return [];
  return statSync(p).isDirectory() ? walk(p) : /\.m?js$/.test(e) ? [p] : [];
});

describe('W17 · the firewall refuses every write path', () => {
  const r = (url, method = 'GET') => refusal({ url, method, siteOrigin: SITE });
  test('LONG-POLLING is refused outright — reads and writes, any method', () => {
    assert.equal(r(`${DB}/.lp?start=t&ser=1&cb=1&v=5`), 'lp');
    assert.equal(r(`${DB}/.lp?id=1&pw=2&ser=3&ns=x&seg0=0&ts0=1&d0=eyJ0Ijoi`), 'lp');
    assert.equal(r('https://calvary-scribblings-default-rtdb.firebaseio.com/.lp?start=t'), 'lp');
  });
  test('the database REST API: GET reads, anything else refused', () => {
    assert.equal(r(`${DB}/cms_stories_index.json`), null);
    for (const m of ['PUT', 'PATCH', 'POST', 'DELETE']) assert.equal(r(`${DB}/users/x/readStories.json`, m), 'rest', m);
  });
  test('/api/hit is refused whatever its method (a GET that increments)', () => {
    assert.equal(r(`${SITE}/api/hit?slug=x`), 'hit');
    assert.equal(r(`${SITE}/api/hit`, 'POST'), 'hit');
  });
  test('the POSTs that only read are allowed; every other /api POST is refused', () => {
    for (const p of ['/api/story', '/api/series/stream', '/api/bookstore/stream', '/api/membership/return-status']) assert.equal(r(SITE + p, 'POST'), null, p);
    for (const p of ['/api/record-attempt', '/api/evaluate-quiz', '/api/open-pages/moderate', '/api/account/delete', '/api/comments/post', '/api/membership/portal']) assert.equal(r(SITE + p, 'POST'), 'api', p);
  });
  test('the allow-list is exactly six entries — adding one is a decision, not a convenience', () => {
    assert.equal(ALLOW_POST.length, 6);
  });
  test('token refresh and the account lookup pass; every other identity or storage write is refused', () => {
    assert.equal(r('https://securetoken.googleapis.com/v1/token?key=k', 'POST'), null);
    assert.equal(r('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k', 'POST'), null);
    assert.equal(r('https://identitytoolkit.googleapis.com/v1/accounts:update?key=k', 'POST'), 'other');
    assert.equal(r('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=k', 'POST'), 'other');
    assert.equal(r('https://firebasestorage.googleapis.com/v0/b/x/o?name=a', 'POST'), 'other');
    assert.equal(r('https://www.google-analytics.com/g/collect', 'POST'), 'other');
  });
  test('socket write frames: set, update, and every onDisconnect', () => {
    for (const a of ['p', 'm', 'o', 'om', 'oc', 'on']) assert.equal(isWriteFrame({ t: 'd', d: { r: 1, a, b: {} } }), true, a);
    for (const a of ['q', 'n', 'g', 's', 'auth', 'unauth']) assert.equal(isWriteFrame({ t: 'd', d: { r: 1, a, b: {} } }), false, a);
  });
});

// Every file that drives a browser against production signed in.
const LIVE_HARNESSES = ['tests/reactions/live.mjs', 'tests/offline/offline-shelf-probe.mjs', 'tests/storybar/lock-shots.mjs',
  'tests/storybar/readout-shot.mjs', 'scripts/audit/states-shots.mjs', 'tests/live/firewall-proof.mjs', 'tests/live/w33-live-check.mjs'];

describe('W17 · every live harness uses the firewall and the test reader', () => {
  for (const p of LIVE_HARNESSES) {
    test(p, () => {
      const s = code(p);
      assert.match(s, /installFirewall\(|liveContext\(/, 'installs the W17 firewall');
      assert.match(s, /ensureTestReader\(\)/, 'signs in as the test reader');
      for (const f of FOUNDER_UIDS) assert.ok(!s.includes(f), 'names no founder uid');
      assert.doesNotMatch(s, /createCustomToken/, 'mints no token of its own');
    });
  }
  test('only tests/live/test-reader.mjs signs in to PRODUCTION with a custom token', () => {
    const hits = [...walk('tests'), ...walk('scripts')].filter((p) => p !== SELF && /accounts:signInWithCustomToken/.test(code(p)));
    assert.deepEqual(hits.sort(), ['tests/live/test-reader.mjs']);
  });
  test('no harness keeps its own socket-only guard (the W9–W16 pattern) — except the proof\'s labelled CONTROL', () => {
    const hits = [...walk('tests'), ...walk('scripts')].filter((p) => p !== SELF && /\.routeWebSocket\(/.test(src(p)));
    assert.deepEqual(hits.sort(), ['tests/live/firewall-proof.mjs', 'tests/live/firewall.mjs', 'tests/states/states.spec.mjs']);
    assert.match(src('tests/live/firewall-proof.mjs'), /async function legacySocketOnly\(/);
  });
  test('the founder-session module is gone', () => {
    assert.throws(() => src('tests/storybar/founder-session.mjs'));
  });
  test('the test reader: never a founder, no claims, no sign-in method, no founder_preview, uid never in the repo', () => {
    const t = code('tests/live/test-reader.mjs');
    assert.match(t, /FOUNDER_UIDS\.includes\(uid\)\) throw/);
    assert.match(t, /customClaims/);
    assert.match(t, /founder_preview\/\$\{uid\}/);
    assert.match(t, /ops\/live_test_reader/);
    assert.doesNotMatch(t, /console\.log/);
  });
});
