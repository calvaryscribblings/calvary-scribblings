// THE APOLOGY BANNER IS FOR ONE COHORT — accounts created inside the verification-mail incident
// and still unverified. A reader who signed up seconds ago must never be told we failed them.
//
//   node --test tests/ci/verify-cohort.test.mjs      (npm run test:ci)
//
// The window and the evidence for each end live in app/lib/verifyCohort.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  showsVerifyApology, createdAtMsOf, INCIDENT_OPENS_MS, INCIDENT_CLOSES_MS,
} from '../../app/lib/verifyCohort.js';

// A Firebase User, as far as the banner reads one.
const user = (creationTime) => ({ metadata: { creationTime } });
const decide = (u, verified) => showsVerifyApology({ createdAtMs: createdAtMsOf(u), verified });

describe('who sees "that one is on us"', () => {
  test('A NEW ACCOUNT, created now and unverified, NEVER sees it', () => {
    assert.equal(decide(user(new Date().toUTCString()), false), false);
    // …nor one created a minute after the window closed, nor months later.
    assert.equal(decide(user(new Date(INCIDENT_CLOSES_MS + 60000).toUTCString()), false), false);
    assert.equal(decide(user('Wed, 23 Sep 2026 18:00:00 GMT'), false), false);
  });

  test('a COHORT account that is still unverified DOES see it', () => {
    // Real creation times of unverified password accounts in the live export (23 Sep 2026).
    for (const t of ['Sun, 17 May 2026 12:38:56 GMT', 'Fri, 10 Jul 2026 11:02:45 GMT',
      'Sat, 01 Aug 2026 08:58:28 GMT', 'Tue, 04 Aug 2026 16:41:09 GMT']) {
      assert.equal(decide(user(t), false), true, t);
    }
  });

  test('a COHORT account that has verified does NOT see it', () => {
    assert.equal(decide(user('Sun, 17 May 2026 12:38:56 GMT'), true), false);
  });

  test('until the verification probe has answered (null), nobody sees it', () => {
    assert.equal(decide(user('Sun, 17 May 2026 12:38:56 GMT'), null), false);
  });

  test('the edges: opens inclusive, closes exclusive, and nothing before the window', () => {
    assert.equal(showsVerifyApology({ createdAtMs: INCIDENT_OPENS_MS, verified: false }), true);
    assert.equal(showsVerifyApology({ createdAtMs: INCIDENT_OPENS_MS - 1, verified: false }), false);
    assert.equal(showsVerifyApology({ createdAtMs: INCIDENT_CLOSES_MS - 1, verified: false }), true);
    assert.equal(showsVerifyApology({ createdAtMs: INCIDENT_CLOSES_MS, verified: false }), false);
  });

  test('the window is the one the evidence names — 2cdb2f43 to 18997510', () => {
    assert.equal(new Date(INCIDENT_OPENS_MS).toISOString(), '2026-04-04T11:37:43.000Z');
    assert.equal(new Date(INCIDENT_CLOSES_MS).toISOString(), '2026-08-05T18:58:13.000Z');
  });

  test('an account whose creation time cannot be read is NOT apologised to', () => {
    for (const u of [{}, { metadata: {} }, user(''), user('not a date'), null]) {
      assert.equal(decide(u, false), false);
    }
  });
});

describe('the banner actually asks the cohort question', () => {
  const src = readFileSync(new URL('../../app/components/VerifyEmailBanner.js', import.meta.url), 'utf8');

  test('it renders nothing unless showsVerifyApology says so, fed the user\'s creation time', () => {
    assert.match(src, /import \{[^}]*showsVerifyApology[^}]*\} from '\.\.\/lib\/verifyCohort'/);
    assert.match(src,
      /if \(!showsVerifyApology\(\{ createdAtMs: createdAtMsOf\(user\), verified \}\)\) return null;/);
  });

  test('the old unverified-only gate is gone — it is what showed the apology to new readers', () => {
    assert.doesNotMatch(src, /if \(verified !== false\) return null;/);
  });

  test('the apology copy is untouched — it stays, for the cohort only', () => {
    assert.match(src, /That one is on us — the email we owed you when you joined never went out\./);
  });
});
