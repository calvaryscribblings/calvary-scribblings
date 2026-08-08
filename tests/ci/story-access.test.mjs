// The entitlement policy: which stories are free, and why.
//
//   node --test tests/ci/story-access.test.mjs      (npm run test:ci)
//
// This is STORY-SERVING-CONTRACT.md §3 as assertions. The endpoint
// (functions/api/story.js) does I/O and nothing else — it verifies a token, reads
// three nodes and calls grantFor() — precisely so that the policy can be tested
// here without a network, a Worker or a database.
//
// The tier is passed in ALREADY RESOLVED (effectiveTier from app/lib/membership.js
// does that, pass included), so the pass cases below assert the composition of the
// two modules rather than a second expiry implementation living in this one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  grantFor, isGateable, resolveRecentFloor, isReaderMode, readerShapeError,
  FREE_WINDOW_DAYS, FREE_WINDOW_MS, RECENT_FLOOR_COUNT, ARCHIVE_MIN_TIER,
} from '../../app/lib/storyAccess.js';
import { effectiveTier } from '../../app/lib/membership.js';

const NOW = Date.UTC(2026, 7, 8);              // 2026-08-08, the day the corpus was measured
const DAY = 86400000;
const ago = (days) => NOW - days * DAY;

const story = (over = {}) => ({
  title: 'A Story', category: 'short', published: true,
  publishedAtMs: ago(30), ...over,
});

describe('the settled constants', () => {
  test('the window is 7 days — the newsletter cycle', () => {
    assert.equal(FREE_WINDOW_DAYS, 7);
    assert.equal(FREE_WINDOW_MS, 7 * DAY);
  });
  test('the floor is 5', () => assert.equal(RECENT_FLOOR_COUNT, 5));
  test('the archive opens at gold', () => assert.equal(ARCHIVE_MIN_TIER, 'gold'));
});

describe('the four grants are ORed — whichever leaves a story free wins', () => {
  test('inside the window: free to a signed-out reader', () => {
    const g = grantFor(story({ publishedAtMs: ago(3) }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'full');
    assert.equal(g.reason, 'free_window');
  });

  test('on the boundary: still free at exactly 7 days', () => {
    const g = grantFor(story({ publishedAtMs: NOW - FREE_WINDOW_MS }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'full', 'the window is inclusive of its own edge');
  });

  test('one millisecond past the boundary: gated', () => {
    const g = grantFor(story({ publishedAtMs: NOW - FREE_WINDOW_MS - 1 }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'preview');
    assert.equal(g.reason, 'archive');
  });

  test('in the most-recent-5: free regardless of age', () => {
    const g = grantFor(story({ publishedAtMs: ago(400) }), {
      tier: 'free', floorSlugs: ['old-but-recent'], slug: 'old-but-recent', now: NOW,
    });
    assert.equal(g.access, 'full');
    assert.equal(g.reason, 'recent_floor');
  });

  test('poetry: free at any age, to anyone', () => {
    const g = grantFor(story({ category: 'poetry', publishedAtMs: ago(400) }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'full');
    assert.equal(g.reason, 'poetry');
  });

  test('gold opens the archive', () => {
    const g = grantFor(story({ publishedAtMs: ago(400) }), { tier: 'gold', now: NOW });
    assert.equal(g.access, 'full');
    assert.equal(g.reason, 'tier');
  });

  test('platinum opens the archive', () => {
    assert.equal(grantFor(story({ publishedAtMs: ago(400) }), { tier: 'platinum', now: NOW }).access, 'full');
  });

  test('free tier, outside every grant: a preview', () => {
    const g = grantFor(story({ publishedAtMs: ago(400) }), { tier: 'free', now: NOW });
    assert.equal(g.access, 'preview');
    assert.equal(g.reason, 'archive');
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

  test('an erroneous record does not occupy a floor slot either', () => {
    assert.equal(isGateable({ category: 'novel', published: true }), false);
  });
});

describe('an unparseable publication date cannot open the window', () => {
  test('publishedAtMs null → freeUntilMs null, and the story gates', () => {
    const g = grantFor({ category: 'short', published: true, date: 'wat', publishAt: null }, { tier: 'free', now: NOW });
    assert.equal(g.freeUntilMs, null);
    assert.equal(g.access, 'preview', 'treating null as "just published" would hand over the archive');
  });

  test('…but the floor and the tier still work on it', () => {
    const s = { category: 'short', published: true, date: 'wat' };
    assert.equal(grantFor(s, { tier: 'gold', now: NOW }).access, 'full');
    assert.equal(grantFor(s, { tier: 'free', floorSlugs: ['x'], slug: 'x', now: NOW }).access, 'full');
  });
});

describe('freeUntilMs', () => {
  test('is publishedAtMs + the window, and is in the PAST on a floor grant', () => {
    const s = story({ publishedAtMs: ago(400) });
    const g = grantFor(s, { tier: 'free', floorSlugs: ['s'], slug: 's', now: NOW });
    assert.equal(g.freeUntilMs, s.publishedAtMs + FREE_WINDOW_MS);
    assert.ok(g.freeUntilMs < NOW, 'a client printing "free until {date}" here would print a date that has gone');
    assert.equal(g.reason, 'recent_floor', 'which is exactly why reason must be checked before rendering it');
  });
});

describe('isGateable — the set the floor counts over', () => {
  test('a published prose story is gateable', () => {
    assert.equal(isGateable(story()), true);
  });
  test('unpublished, reader-mode and poetry are not', () => {
    assert.equal(isGateable(story({ published: false })), false);
    assert.equal(isGateable(story({ readerMode: true })), false);
    assert.equal(isGateable(story({ category: 'poetry' })), false);
  });
});

describe('resolveRecentFloor', () => {
  const index = {
    'poem-new': { category: 'poetry', published: true, publishedAtMs: ago(0) },
    'book-new': { category: 'short', readerMode: true, published: true, publishedAtMs: ago(1) },
    'hidden': { category: 'short', published: false, publishedAtMs: ago(2) },
    a: { category: 'short', published: true, publishedAtMs: ago(3) },
    b: { category: 'short', published: true, publishedAtMs: ago(4) },
    c: { category: 'short', published: true, publishedAtMs: ago(5) },
    d: { category: 'short', published: true, publishedAtMs: ago(6) },
    e: { category: 'short', published: true, publishedAtMs: ago(7) },
    f: { category: 'short', published: true, publishedAtMs: ago(8) },
    nodate: { category: 'short', published: true },
  };

  test('picks the 5 newest GATEABLE records, newest first', () => {
    assert.deepEqual(resolveRecentFloor(index), ['a', 'b', 'c', 'd', 'e']);
  });

  test('poetry and reader-mode do not consume floor slots', () => {
    const floor = resolveRecentFloor(index);
    assert.ok(!floor.includes('poem-new'), 'poetry is already free — a slot spent on it protects nothing');
    assert.ok(!floor.includes('book-new'));
  });

  test('a record with no publishedAtMs is invisible to the floor', () => {
    assert.ok(!resolveRecentFloor(index).includes('nodate'));
  });

  test('fewer than five gateable records yields fewer than five', () => {
    assert.deepEqual(resolveRecentFloor({ a: index.a, 'poem-new': index['poem-new'] }), ['a']);
  });
});
