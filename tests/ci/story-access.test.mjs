// The entitlement policy: which stories are free, and why. W4 (Ikenna's rulings, 24–25 Sep 2026).
//
//   node --test tests/ci/story-access.test.mjs      (npm run test:ci)
//
// PINNED CLOCKS, never today's. The free week is Monday 00:00 → Sunday 23:59:59.999 London; at
// Monday 00:00 the whole week goes to the archive; the gate itself switches on at 30 Sept 00:00
// London; poetry stays free; news locks; there is no floor.
//
// The cases live in app/lib/storyAccess.parity.json — written by hand, not generated — and the
// app's port runs the SAME file (harness/story-access-parity.mjs in the app repo). A change of
// policy is a change to that file, on both sides at once.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  policyGrantFor as grantFor, grantFor as shippedGrantFor, gatingOn, GATE_ON_MS,
  isGateable, isReaderMode, readerShapeError, ARCHIVE_MIN_TIER, freeUntilFor,
} from '../../app/lib/storyAccess.js';
import { londonWeekStart, londonWeekEnd } from '../../app/lib/londonWeek.js';
import { effectiveTier } from '../../app/lib/membership.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../../app/lib/storyAccess.parity.json', import.meta.url), 'utf8'));
const NOW = GATE_ON_MS + 3 * 86400000;           // Sat 3 Oct 2026, gate on
const DAY = 86400000;
const ago = (days) => NOW - days * DAY;
const story = (over = {}) => ({ title: 'A Story', category: 'short', published: true, publishedAtMs: ago(30), ...over });

describe('THE PARITY FIXTURE — every case, by value (the app runs the same file)', () => {
  for (const c of FIXTURE.cases) {
    test(c.name, () => {
      const g = shippedGrantFor(c.story, { tier: c.tier, now: c.now });
      assert.deepEqual({ access: g.access, reason: g.reason, freeUntilMs: g.freeUntilMs }, c.expect);
    });
  }
  for (const w of FIXTURE.weeks) {
    test(`the London week containing ${w.atIso}`, () => {
      assert.equal(londonWeekStart(w.at), w.weekStart);
      assert.equal(londonWeekEnd(w.at), w.weekEnd);
    });
  }
  test('the fixture\'s switch instant is the code\'s', () => assert.equal(FIXTURE.gateOnMs, GATE_ON_MS));
});

describe('the date switch', () => {
  test('launch day 00:00 London = 23:00 UTC the day before, derived from LAUNCH', () => {
    assert.equal(new Date(GATE_ON_MS).toISOString(), '2026-09-29T23:00:00.000Z');
    assert.equal(gatingOn(GATE_ON_MS - 1), false);
    assert.equal(gatingOn(GATE_ON_MS), true);
  });
  test('before it, every prose story reads as today — even to a signed-out reader', () => {
    const g = shippedGrantFor(story({ publishedAtMs: GATE_ON_MS - 400 * DAY }), { tier: 'free', now: GATE_ON_MS - 1 });
    assert.deepEqual([g.access, g.reason], ['full', 'gating_off']);
  });
  test('the founder preview (forceGate) applies the gate early, at the real time', () => {
    const t = GATE_ON_MS - 5 * DAY;   // Thu 24 Sept
    assert.equal(shippedGrantFor(story({ publishedAtMs: t - 20 * DAY }), { tier: 'free', now: t, forceGate: true }).access, 'preview');
    assert.equal(shippedGrantFor(story({ publishedAtMs: t - DAY }), { tier: 'free', now: t, forceGate: true }).reason, 'free_week',
      'this week\'s story still opens in full in the preview');
  });
  test('the archive opens at gold', () => assert.equal(ARCHIVE_MIN_TIER, 'gold'));
});

describe('the whole week locks together — no story has its own window', () => {
  test('every story of one week shares ONE freeUntil: Sunday 23:59:59.999 London', () => {
    const monday = Date.parse('2026-09-28T00:30:00+01:00');
    const ends = [0, 1, 2, 3, 4, 5, 6].map((d) => freeUntilFor({ publishedAtMs: monday + d * DAY + 23 * 3600000 - 3600000 }));
    assert.equal(new Set(ends).size, 1);
    assert.equal(new Date(ends[0]).toISOString(), '2026-10-04T22:59:59.999Z');
  });
  test('NO FLOOR: six stories from last week, the newest still archives on Monday', () => {
    const lastWeek = GATE_ON_MS + 12 * 3600000;   // launch day, midday London
    for (let i = 0; i < 6; i++) {
      assert.equal(grantFor(story({ publishedAtMs: lastWeek + i * 3600000 }), { tier: 'free', now: Date.parse('2026-10-05T00:00:00+01:00') }).access, 'preview');
    }
  });
  test('the old policy is gone from the module: no floor, no 7-day window', () => {
    const src = readFileSync(new URL('../../app/lib/storyAccess.js', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /RECENT_FLOOR|resolveRecentFloor|FREE_WINDOW_(MS|DAYS)|floorSlugs/);
    const endpoint = readFileSync(new URL('../../functions/api/story.js', import.meta.url), 'utf8');
    assert.doesNotMatch(endpoint, /resolveRecentFloor|floorSlugs|loadRecentFloor/);
  });
});

describe('a pass reads the archive — that is the whole point of "24 hours of Gold"', () => {
  test('an active day pass confers gold through effectiveTier', () => {
    const detail = { pass: { tier: 'gold', expiresAt: NOW + 3600_000 } };
    const tier = effectiveTier('free', detail, NOW);
    assert.equal(tier, 'gold');
    const g = grantFor(story({ publishedAtMs: ago(400) }), { tier, now: NOW });
    assert.equal(g.access, 'full');
    assert.equal(g.reason, 'tier');
  });

  test('an expired pass does not', () => {
    const detail = { pass: { tier: 'gold', expiresAt: NOW - 1 } };
    const tier = effectiveTier('free', detail, NOW);
    assert.equal(tier, 'free');
    assert.equal(grantFor(story({ publishedAtMs: ago(400) }), { tier, now: NOW }).access, 'preview');
  });
});

describe('reader-mode is a carve-out, not a grant', () => {
  for (const over of [
    { readerMode: true },
    { bookReader: true },
    { category: 'novel' },
    { category: 'poetry', epubUrl: 'https://example.test/x.epub' },
  ]) {
    test(`${JSON.stringify(over)} → access 'reader'`, () => {
      const g = grantFor(story(over), { tier: 'free', now: NOW });
      assert.equal(g.access, 'reader');
      assert.equal(g.reason, 'reader_mode');
    });
  }

  test('reader-mode wins over poetry — an EPUB poem is served at /reader', () => {
    const g = grantFor(story({ category: 'poetry', epubUrl: 'x' }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'reader');
  });
});

describe('reader-mode is FLAG-DRIVEN, and the category-only shape is a data error', () => {
  // The ruling, R11.10. Measured before making it: zero of 176 live records carried
  // the category-only shape, and four published stories were readerMode:true with
  // category:'short' — so the flag was already the only reliable signal.
  test('the flags define it', () => {
    assert.equal(isReaderMode({ readerMode: true }), true);
    assert.equal(isReaderMode({ bookReader: true }), true);
    assert.equal(isReaderMode({ category: 'novel' }), false, 'category alone is NOT reader-mode');
    assert.equal(isReaderMode({ category: 'poetry', epubUrl: 'x' }), false);
  });

  test('the category-only shape is detected as an error', () => {
    assert.equal(readerShapeError({ category: 'novel' }), true);
    assert.equal(readerShapeError({ category: 'poetry', epubUrl: 'x' }), true);
  });

  test('a flagged record is never an error, whatever its category', () => {
    assert.equal(readerShapeError({ category: 'novel', readerMode: true }), false);
    assert.equal(readerShapeError({ category: 'short', readerMode: true }), false,
      'four live records are exactly this shape');
    assert.equal(readerShapeError({ category: 'short' }), false);
    assert.equal(readerShapeError({ category: 'poetry' }), false, 'poetry without an EPUB is prose');
  });

  test('the server still ROUTES the error to /reader — defence, not support', () => {
    const g = grantFor({ category: 'novel', published: true }, { tier: 'free', now: NOW });
    assert.equal(g.access, 'reader', 'breaking a reader to make a point about a bad record is worse');
  });

  test('an erroneous record is never a gateable prose story', () => {
    assert.equal(isGateable({ category: 'novel', published: true }), false);
  });
});

describe('isGateable', () => {
  test('a published prose story is gateable', () => {
    assert.equal(isGateable(story()), true);
  });
  test('unpublished, reader-mode and poetry are not', () => {
    assert.equal(isGateable(story({ published: false })), false);
    assert.equal(isGateable(story({ readerMode: true })), false);
    assert.equal(isGateable(story({ category: 'poetry' })), false);
  });
});

