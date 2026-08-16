// THE SERIES GATE, asserted. `npm run test:ci`.
//
// Every test here is about a decision that is invisible from the outside until it is wrong:
// a day pass that quietly unlocks a Platinum benefit, a release date compared as a string, a
// Platinum member told next month's instalment is not for their tier. None of these produce
// an error — they produce a plausible wrong answer — so they are asserted rather than trusted.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  grantForInstalment,
  isReleased,
  releasedCount,
  instalmentsOf,
  refusalCopy,
  REFUSAL_STATUS,
} from '../../app/lib/series/access.js';
import {
  validateSeries,
  validateInstalment,
  validateInstalmentDetail,
  epubObjectPath,
  INSTALMENT_ID_RE,
} from '../../app/lib/series/schema.js';
import { formatRelease, shelfLine, instalmentLabel } from '../../app/lib/series/format.js';
import { IMMERSIVE_ROUTES, isImmersive } from '../../app/lib/immersiveRoutes.js';

const ROOT = new URL('../../', import.meta.url);
const NOW = Date.UTC(2026, 9, 20); // 20 Oct 2026
const PAST = Date.UTC(2026, 9, 14);
const FUTURE = Date.UTC(2026, 10, 14);

const row = (over = {}) => ({
  schemaVersion: 1,
  seriesId: 'beta-princess',
  ordinal: 1,
  releaseAtMs: PAST,
  freeForGold: false,
  status: 'published',
  addedAt: 1,
  updatedAt: 1,
  ...over,
});

describe('release is a gate before tier, for everyone', () => {
  test('an unreleased instalment is refused to PLATINUM, as not_released', () => {
    const g = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.code, 'not_released');
    assert.equal(g.status, 403);
    // The date travels with the refusal so the reader is told WHEN, not just no.
    assert.equal(g.releaseAtMs, FUTURE);
  });

  test('a Platinum member is never told an unreleased instalment is a tier problem', () => {
    const g = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', now: NOW });
    assert.notEqual(g.code, 'tier_too_low');
    assert.match(refusalCopy(g), /not arrived yet/i);
  });

  test('unreleased answers identically signed out and signed in — no schedule leak', () => {
    const a = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'free', signedIn: false, now: NOW });
    const b = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', signedIn: true, now: NOW });
    assert.equal(a.code, b.code);
    assert.equal(a.code, 'not_released');
  });

  test('a draft or unpublished row is not_released, and does not announce itself', () => {
    for (const status of ['draft', 'unpublished']) {
      const g = grantForInstalment(row({ status, releaseAtMs: PAST }), { subscriptionTier: 'platinum', now: NOW });
      assert.equal(g.code, 'not_released', status);
    }
  });

  test('releaseAtMs exactly equal to now HAS released — the boundary is inclusive', () => {
    assert.equal(isReleased(row({ releaseAtMs: NOW }), NOW), true);
    assert.equal(isReleased(row({ releaseAtMs: NOW + 1 }), NOW), false);
  });

  test('a non-numeric releaseAtMs never releases', () => {
    // The scar this guards: a string compares against a clock as a string. It must fail
    // CLOSED — an instalment nobody can read is recoverable; one that leaked early is not.
    for (const bad of ['2026-10-14', null, undefined, NaN, {}]) {
      assert.equal(isReleased(row({ releaseAtMs: bad }), NOW), false, String(bad));
    }
  });
});

describe('the tier gate — subscription only', () => {
  test('Platinum reads a released instalment', () => {
    const g = grantForInstalment(row(), { subscriptionTier: 'platinum', now: NOW });
    assert.equal(g.access, 'granted');
    assert.equal(g.reason, 'platinum');
  });

  test('Gold reads ONLY the freeForGold instalment', () => {
    assert.equal(grantForInstalment(row({ freeForGold: true }), { subscriptionTier: 'gold', now: NOW }).access, 'granted');
    assert.equal(grantForInstalment(row({ freeForGold: false }), { subscriptionTier: 'gold', now: NOW }).access, 'locked');
  });

  test('Free reads nothing, freeForGold included', () => {
    for (const f of [true, false]) {
      const g = grantForInstalment(row({ freeForGold: f }), { subscriptionTier: 'free', now: NOW });
      assert.equal(g.access, 'locked', `freeForGold=${f}`);
      assert.equal(g.code, 'tier_too_low');
    }
  });

  test('freeForGold is read as an explicit boolean, never inferred from ordinal', () => {
    // Instalment 1 with the flag OFF is locked to Gold; instalment 5 with it ON is open.
    assert.equal(grantForInstalment(row({ ordinal: 1, freeForGold: false }), { subscriptionTier: 'gold', now: NOW }).access, 'locked');
    assert.equal(grantForInstalment(row({ ordinal: 5, freeForGold: true }), { subscriptionTier: 'gold', now: NOW }).access, 'granted');
    // A missing flag is not truthy-tested into a grant.
    const g = grantForInstalment({ ...row(), freeForGold: undefined }, { subscriptionTier: 'gold', now: NOW });
    assert.equal(g.access, 'locked');
  });

  test('a released instalment refuses a signed-out reader with signed_out, not tier_too_low', () => {
    const g = grantForInstalment(row(), { subscriptionTier: 'free', signedIn: false, now: NOW });
    assert.equal(g.code, 'signed_out');
    assert.equal(g.status, 401);
  });
});

describe('THE £1 DAY PASS IS EXCLUDED — the one that will not fall out of copying', () => {
  // PASS_TIER is 'gold' (app/lib/membershipPasses.js), so effectiveTier() returns the SAME
  // string for a day-pass holder as for a paying Gold member. A gate written against
  // effectiveTier would hand every freeForGold instalment of every series to a £1 purchase.
  const dayPassHolder = { subscriptionTier: 'free', effectiveTier: 'gold' };

  test('a day-pass holder does NOT get the Gold taste', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { ...dayPassHolder, now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.code, 'tier_too_low');
  });

  test('and is told the actual reason, not a generic Platinum line', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { ...dayPassHolder, now: NOW });
    assert.equal(g.reason, 'pass_excluded');
    assert.match(refusalCopy(g), /passes do not include the Series/i);
  });

  test('a real Gold member with the same effective tier DOES get it', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { subscriptionTier: 'gold', effectiveTier: 'gold', now: NOW });
    assert.equal(g.access, 'granted');
    assert.equal(g.reason, 'gold_taste');
  });

  test('a Gold member holding a pass is unaffected — the pass adds nothing and takes nothing', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { subscriptionTier: 'gold', effectiveTier: 'gold', now: NOW });
    assert.equal(g.access, 'granted');
  });

  test('a pass could never reach Platinum content either', () => {
    const g = grantForInstalment(row({ freeForGold: false }), { ...dayPassHolder, now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.reason, 'needs_platinum');
  });

  test('omitting effectiveTier falls back to the subscription and never over-grants', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { subscriptionTier: 'free', now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.reason, 'needs_gold');
  });
});

describe('refusal codes and statuses', () => {
  test('the four codes map to the statuses the endpoint documents', () => {
    assert.equal(REFUSAL_STATUS.signed_out, 401);
    assert.equal(REFUSAL_STATUS.not_released, 403);
    assert.equal(REFUSAL_STATUS.tier_too_low, 403);
    assert.equal(REFUSAL_STATUS.not_found, 404);
  });

  test('502, not 503, on a read failure — the 502-vs-503 ruling', () => {
    // functions/api/story.js answers 503 for the same class; the Series takes the bookstore's
    // 502 because it is a transplant of that endpoint. Asserted so it cannot drift back.
    assert.equal(REFUSAL_STATUS.unavailable, 502);
  });

  test('every reason a grant can carry has copy behind it', () => {
    const reasons = new Set();
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const freeForGold of [true, false]) {
        for (const releaseAtMs of [PAST, FUTURE]) {
          for (const signedIn of [true, false]) {
            const g = grantForInstalment(row({ freeForGold, releaseAtMs }), {
              subscriptionTier: tier, effectiveTier: 'gold', signedIn, now: NOW,
            });
            if (g.access === 'locked') reasons.add(g.reason);
          }
        }
      }
    }
    assert.ok(reasons.size >= 4, `expected several refusal reasons, got ${[...reasons]}`);
    for (const r of reasons) {
      assert.notEqual(refusalCopy({ reason: r }), refusalCopy({ reason: '__missing__' }), `no copy for ${r}`);
    }
  });
});

describe('the released count is derived, never stored', () => {
  const rows = [
    row({ ordinal: 1, releaseAtMs: PAST }),
    row({ ordinal: 2, releaseAtMs: PAST }),
    row({ ordinal: 3, releaseAtMs: FUTURE }),
    row({ ordinal: 4, status: 'draft', releaseAtMs: PAST }),
  ];

  test('counts only published rows whose date has passed', () => {
    assert.equal(releasedCount(rows, NOW), 2);
  });

  test('the same rows give a different count at a different clock — which is the point', () => {
    assert.equal(releasedCount(rows, FUTURE + 1), 3);
    assert.equal(releasedCount(rows, PAST - 1), 0);
  });

  test('accepts the { id: row } shape an RTDB snapshot yields', () => {
    const asObject = Object.fromEntries(rows.map((r, i) => [`x-i${i}`, r]));
    assert.equal(releasedCount(asObject, NOW), 2);
  });

  test('instalmentsOf orders by ordinal and drops drafts', () => {
    const list = instalmentsOf([rows[2], rows[0], rows[3], rows[1]], 'beta-princess', NOW);
    assert.deepEqual(list.map((r) => r.ordinal), [1, 2, 3]);
    assert.deepEqual(list.map((r) => r.released), [true, true, false]);
  });
});

describe('schema', () => {
  test('releaseAtMs must be an integer — an ISO string is rejected', () => {
    const r = validateInstalment({ ...row(), releaseAtMs: '2026-10-14' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /releaseAtMs/.test(e)));
  });

  test('freeForGold must be present and boolean', () => {
    assert.equal(validateInstalment({ ...row(), freeForGold: undefined }).valid, false);
    assert.equal(validateInstalment({ ...row(), freeForGold: 'yes' }).valid, false);
    assert.equal(validateInstalment(row()).valid, true);
  });

  test('an instalment detail without authorUid/authorHandle is rejected', () => {
    const base = {
      schemaVersion: 1, title: 'Part One', synopsis: null, author: 'Monica Garcia',
      authorUid: 'u', authorHandle: 'h', coverUrl: null, epubPath: 'p', updatedAt: 1,
    };
    assert.equal(validateInstalmentDetail(base).valid, true);
    assert.equal(validateInstalmentDetail({ ...base, authorUid: '' }).valid, false);
    assert.equal(validateInstalmentDetail({ ...base, authorHandle: '' }).valid, false);
  });

  test('a published instalment must have an epubPath', () => {
    const base = {
      schemaVersion: 1, title: 't', synopsis: null, author: 'a', authorUid: 'u',
      authorHandle: 'h', coverUrl: null, epubPath: null, updatedAt: 1,
    };
    assert.equal(validateInstalmentDetail(base, { publishing: true }).valid, false);
    assert.equal(validateInstalmentDetail(base, { publishing: false }).valid, true);
  });

  test('a published series must have a poster', () => {
    const base = { schemaVersion: 1, slug: 'x', title: 'X', synopsis: 's', coverUrl: null, status: 'draft', addedAt: 1, updatedAt: 1 };
    assert.equal(validateSeries(base).valid, true);
    assert.equal(validateSeries({ ...base, status: 'published' }).valid, false);
    assert.equal(validateSeries({ ...base, status: 'published', coverUrl: 'u' }).valid, true);
  });

  test('no schema carries an instalmentCount — the count is derived', () => {
    const src = readFileSync(fileURLToPath(new URL('app/lib/series/schema.js', ROOT)), 'utf8');
    assert.equal(/^\s*instalmentCount:/m.test(src), false);
  });

  test('the epub path is derived from the id and lives under the gated prefix', () => {
    assert.equal(epubObjectPath('beta-princess-i1'), 'series_epubs/beta-princess-i1/master.epub');
  });

  test('the id pattern refuses anything that could walk out of the prefix', () => {
    for (const bad of ['../secrets', 'a/b', 'x'.repeat(129), '', 'a b']) {
      assert.equal(INSTALMENT_ID_RE.test(bad), false, bad);
    }
    assert.equal(INSTALMENT_ID_RE.test('beta-princess-i1'), true);
  });
});

describe('copy', () => {
  test('the vocabulary is "instalment", never "episode"', () => {
    const files = [
      'app/lib/series/schema.js', 'app/lib/series/access.js', 'app/lib/series/format.js',
      'app/lib/series/loader.js', 'app/lib/series/admin-writes.js', 'app/lib/series/stream.js',
      'functions/api/series/stream.js', 'docs/series.md', 'audit/membership-copy-deck.md',
    ];
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(f, ROOT)), 'utf8');
      // 'episode' survives only where the correction itself is being described.
      const offending = src.split('\n').filter(
        (l) => /episode/i.test(l) && !/said|corrected|"episodes"|\*\*episodes\*\*/i.test(l),
      );
      assert.deepEqual(offending, [], `${f} still says "episode": ${offending.join(' | ')}`);
    }
  });

  test('instalmentLabel is the one place the row label is spelled', () => {
    assert.equal(instalmentLabel(3), 'Instalment 3');
  });

  test('a release date renders in UTC, with the year only when it is not this one', () => {
    assert.equal(formatRelease(Date.UTC(2026, 9, 14), NOW), '14 October');
    assert.equal(formatRelease(Date.UTC(2027, 9, 14), NOW), '14 October 2027');
    assert.equal(formatRelease(null, NOW), null);
  });

  test('the shelf line counts what is readable and names what is next', () => {
    const rows = [
      row({ ordinal: 1, releaseAtMs: PAST }),
      row({ ordinal: 2, releaseAtMs: FUTURE }),
    ];
    assert.equal(shelfLine(rows, NOW), '1 instalment · next 14 November');
    assert.equal(shelfLine([rows[0]], NOW), '1 instalment');
    assert.equal(shelfLine([rows[1]], NOW), 'Arriving soon · next 14 November');
    assert.equal(shelfLine([], NOW), 'Arriving soon');
  });

  test('two instalments is plural, one is not', () => {
    const two = [row({ ordinal: 1, releaseAtMs: PAST }), row({ ordinal: 2, releaseAtMs: PAST })];
    assert.equal(shelfLine(two, NOW), '2 instalments');
  });
});

describe('wiring', () => {
  test('the instalment reader is an immersive route — no verification banner over a book', () => {
    assert.equal(isImmersive('/series/read/beta-princess-i1'), true);
    assert.equal(isImmersive('/series/read/'), true);
    // The landing page is NOT immersive: it is a browsing surface and wants the banner.
    assert.equal(isImmersive('/series'), false);
    assert.equal(isImmersive('/series/beta-princess'), false);
    assert.ok(IMMERSIVE_ROUTES.some((re) => re.source.includes('series')));
  });

  test('/serial is retired: no route, no sitemap entry, and a redirect exists', () => {
    // Comments are stripped first — the sitemap's own note explains the swap and names the
    // retired route, and a naive grep would read that prose as a live entry.
    const sitemap = readFileSync(fileURLToPath(new URL('app/sitemap.js', ROOT)), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.equal(/'\/serial'/.test(sitemap), false, 'sitemap still lists /serial');
    assert.ok(/'\/series'/.test(sitemap), 'sitemap does not list /series');

    const redirects = readFileSync(fileURLToPath(new URL('scripts/generate-redirects.mjs', ROOT)), 'utf8');
    assert.ok(/\['\/serial',\s*'\/series'\]/.test(redirects), 'no /serial → /series redirect');
  });

  test('the gating kill switch states that it does not cover the Series', () => {
    const src = readFileSync(fileURLToPath(new URL('app/lib/storyAccess.js', ROOT)), 'utf8');
    assert.ok(/WHAT THIS SWITCH DOES NOT COVER: THE SERIES/.test(src));
  });

  test('the release rule is in database.rules.json and compares against `now`', () => {
    const rules = JSON.parse(readFileSync(fileURLToPath(new URL('database.rules.json', ROOT)), 'utf8')).rules;
    const read = rules.series_instalments_detail.$instalmentId['.read'];
    assert.ok(/releaseAtMs/.test(read), 'the detail rule does not mention releaseAtMs');
    assert.ok(/<= now/.test(read), 'the detail rule does not compare against the server clock');
    assert.ok(/isNumber\(\)/.test(read), 'the detail rule does not require a numeric releaseAtMs');
    // The detail node must NOT be listable, or the whole split is decorative.
    assert.equal(rules.series_instalments_detail['.read'], undefined);
    // The row node must be public — it is what a locked card prints.
    assert.equal(rules.series_instalments['.read'], true);
  });

  test('progress is owner-writable, so account deletion can wipe it from the client', () => {
    const rules = JSON.parse(readFileSync(fileURLToPath(new URL('database.rules.json', ROOT)), 'utf8')).rules;
    const node = rules.series_reading_progress.$uid;
    assert.equal(node['.write'], 'auth != null && auth.uid == $uid');
    // Closed record, same as the bookstore's — which is why it could not be shared.
    assert.equal(node.$instalmentId.$other['.validate'], false);
  });

  test('series EPUBs are read:false in storage.rules', () => {
    const src = readFileSync(fileURLToPath(new URL('storage.rules', ROOT)), 'utf8');
    const block = src.slice(src.indexOf('match /series_epubs/'));
    assert.ok(/allow read: if false;/.test(block.slice(0, 400)), 'series_epubs master.epub is not read:false');
  });
});
