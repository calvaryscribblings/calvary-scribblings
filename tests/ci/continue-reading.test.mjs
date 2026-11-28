// CR-2 — Continue Reading, the pure half: the rules generator in step, the merge, hiding and
// returning, finished, the minutes, the percentage, the kind line and the access states, and where
// the row and its chrome sit. The rules themselves are proved on the emulator in
// tests/rules/cr-2.test.mjs; the row and the resume jump in a browser in tests/continue-reading/.
//
//   node --test tests/ci/continue-reading.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeEntries, minutesLeft, minutesLine, kindLine, storyState, instalmentState, resolveCards,
  threadFraction, scrollForFraction, shouldSave, clampFraction,
} from '../../app/lib/continueReading/model.js';
import {
  POSITION_PATH, ROW_MAX, SAVE_MIN_STEP, SAVE_MIN_INTERVAL_MS, STARTED_DWELL_MS, STARTED_SCROLL,
  RESUME_HASH, isStorySlug,
} from '../../app/lib/continueReading/schema.js';
import { barFor, barLabel } from '../../app/lib/readingBar.js';
import { build, RULES_SLUG_RE, CONTINUE_RULES } from '../../scripts/continue-reading/write-rules.mjs';
import { build as buildRadio } from '../../scripts/radio/write-rules.mjs';
import { build as buildNotify } from '../../scripts/notify/write-rules.mjs';
import { formFor, allPairs } from '../../scripts/push/forms.mjs';
import { isId } from '../../app/lib/ids.js';
import { OWNED_NODES } from '../../functions/api/account/_deletion.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RULES_TEXT = read('database.rules.json');
const RULES = JSON.parse(RULES_TEXT);
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 28, 12);   // gate on (after 30 Sep 2026)

describe('the rules', () => {
  test('database.rules.json is in step with all three generators, whichever runs last', () => {
    const out = (r) => JSON.stringify(r, null, 2) + '\n';
    assert.equal(out(build(RULES)), RULES_TEXT, 'run node scripts/continue-reading/write-rules.mjs');
    assert.equal(out(buildRadio(RULES)), RULES_TEXT, 'run node scripts/radio/write-rules.mjs');
    assert.equal(out(buildNotify(RULES)), RULES_TEXT, 'run node scripts/notify/write-rules.mjs');
    assert.equal(out(build(buildRadio(build(RULES)))), RULES_TEXT);
    assert.deepEqual(RULES.rules[POSITION_PATH], CONTINUE_RULES[POSITION_PATH]);
  });
  test('the node sits before Radio\'s, which keeps its own four last', () => {
    const keys = Object.keys(RULES.rules);
    assert.ok(keys.indexOf(POSITION_PATH) < keys.indexOf('radio_collections'));
  });
  test('the rules\' slug pattern is app/lib/ids.js\'s slug, in the rules\' dialect', () => {
    const re = new RegExp(RULES_SLUG_RE.slice(1, -1));
    for (const s of ['a', 'the-number-thirteen', 'x1-2-3', 'a'.repeat(128), 'a'.repeat(129), '', '-a', 'a-', 'a--b', 'A', 'a_b', 'a.b', 'a/b', '../x', 'a b']) {
      const rules = re.test(s) && s.length <= 128;
      assert.equal(rules, isId('slug', s), s);
      assert.equal(isStorySlug(s), isId('slug', s), s);
    }
  });
  test('account deletion takes the node whole', () => {
    assert.ok(OWNED_NODES.includes(POSITION_PATH));
  });
});

describe('the merge', () => {
  const pos = (stories, hidden = {}) => ({ stories, hidden });
  test('stories and instalments together, newest first', () => {
    const list = mergeEntries({
      positions: pos({ 'old-tale': { fraction: 0.4, updatedAt: 100 }, 'new-tale': { fraction: 0.2, updatedAt: 300 } }),
      seriesProgress: { 'bp-i2': { fraction: 0.5, updatedAt: 200, cfi: 'x' } },
    });
    assert.deepEqual(list.map((e) => `${e.kind}:${e.id}`), ['story:new-tale', 'instalment:bp-i2', 'story:old-tale']);
  });
  test('a finished instalment drops; an unfinished one stays', () => {
    const list = mergeEntries({ seriesProgress: { 'bp-i1': { fraction: 0.99, updatedAt: 1 }, 'bp-i2': { fraction: 0.3, updatedAt: 2 } }, seriesFinished: { 'bp-i1': 5 } });
    assert.deepEqual(list.map((e) => e.id), ['bp-i2']);
  });
  test('a ✕ hides a card; a position saved LATER brings it back; one saved before does not', () => {
    const hidden = { stories: { tale: 500 }, instalments: { 'bp-i1': 500 } };
    let list = mergeEntries({ positions: pos({ tale: { fraction: 0.3, updatedAt: 400 } }, hidden), seriesProgress: { 'bp-i1': { fraction: 0.3, updatedAt: 500 } } });
    assert.equal(list.length, 0, 'hidden at or after the position hides it');
    list = mergeEntries({ positions: pos({ tale: { fraction: 0.5, updatedAt: 600 } }, hidden), seriesProgress: { 'bp-i1': { fraction: 0.4, updatedAt: 501 } } });
    assert.deepEqual(list.map((e) => e.id), ['tale', 'bp-i1'], 'read on after the ✕ → back');
  });
  test('a malformed key or record is dropped, never thrown on', () => {
    const list = mergeEntries({
      positions: { stories: { 'Bad Slug': { fraction: 0.2, updatedAt: 1 }, ok: { fraction: 'x', updatedAt: 1 }, fine: { fraction: 2, updatedAt: 3 } } },
      seriesProgress: { 'a/b': { fraction: 0.2, updatedAt: 1 }, 'bp-i3': null },
    });
    assert.deepEqual(list.map((e) => [e.id, e.fraction]), [['fine', 1]]);
    assert.deepEqual(mergeEntries({}), []);
    assert.deepEqual(mergeEntries(), []);
  });
});

describe('what a card says', () => {
  test('minutes left: total × (1 − fraction), rounded up, at least 1', () => {
    assert.equal(minutesLeft(10, 0.5), 5);
    assert.equal(minutesLeft(10, 0.55), 5);
    assert.equal(minutesLeft(10, 0.41), 6);
    assert.equal(minutesLeft(7, 0.99), 1);
    assert.equal(minutesLeft(7, 1), 1);
    assert.equal(minutesLeft(12, 0), 12);
    assert.equal(minutesLeft(0, 0.5), null);
    assert.equal(minutesLeft(null, 0.5), null);
    assert.equal(minutesLine(1), '1 minute left');
    assert.equal(minutesLine(2), '2 minutes left');
    assert.equal(minutesLine(14), '14 minutes left');
  });
  test('the percentage is floored, as barFor does (the bar My Library draws)', () => {
    assert.equal(barLabel(barFor(0.436)), '43%');
    assert.equal(barLabel(barFor(0.999)), '99%');
    assert.equal(barLabel(barFor(0.001)), '1%');
    assert.equal(barLabel(barFor(0)), '');
    assert.equal(barLabel(barFor(1)), 'FINISHED');
  });
  test('the kind line is the push table\'s form name, for every pair the taxonomy makes', () => {
    for (const { category, subcategory, form } of allPairs()) {
      assert.equal(kindLine({ kind: 'story', category, subcategory }), form);
    }
    assert.equal(kindLine({ kind: 'story', category: 'short', subcategory: 'Horror' }), formFor('short', 'Horror'));
    assert.equal(kindLine({ kind: 'story' }), 'story');
    assert.equal(kindLine({ kind: 'instalment', ordinal: 3 }), 'The Series · Instalment 3');
  });
  test('…imported, never copied', () => {
    const src = read('app/lib/continueReading/model.js');
    assert.match(src, /import \{ formFor \} from '..\/..\/..\/scripts\/push\/forms\.mjs'/);
    for (const phrase of ['flash fiction', 'short story', 'spoken word']) assert.equal(src.includes(phrase), false, phrase);
  });
});

describe('access', () => {
  const archived = { id: 'old', category: 'short', publishedAtMs: NOW - 60 * DAY, title: 'Old', author: 'W', readTime: 10 };
  const fresh = { ...archived, id: 'fresh', publishedAtMs: NOW - DAY };
  test('a story: full shows the minutes; the archive preview is locked', () => {
    assert.equal(storyState(archived, { tier: 'free', now: NOW }), 'locked');
    assert.equal(storyState(archived, { tier: 'gold', now: NOW }), 'open');
    assert.equal(storyState(fresh, { tier: 'free', now: NOW }), 'open');
    assert.equal(storyState({ ...archived, category: 'poetry' }, { tier: 'free', now: NOW }), 'open');
  });
  const row = { seriesId: 'bp', ordinal: 2, releaseAtMs: NOW - DAY, freeForGold: false, status: 'published' };
  test('an instalment: granted is open; a lapsed membership (tier_too_low) is locked; unreleased drops', () => {
    assert.equal(instalmentState(row, { subscriptionTier: 'platinum', now: NOW }), 'open');
    assert.equal(instalmentState(row, { subscriptionTier: 'free', now: NOW }), 'locked');
    assert.equal(instalmentState(row, { subscriptionTier: 'gold', now: NOW }), 'locked');
    assert.equal(instalmentState({ ...row, freeForGold: true }, { subscriptionTier: 'gold', now: NOW }), 'open');
    assert.equal(instalmentState({ ...row, openToFree: true, freeForGold: true }, { subscriptionTier: 'free', now: NOW }), 'open');
    assert.equal(instalmentState({ ...row, releaseAtMs: NOW + DAY }, { subscriptionTier: 'platinum', now: NOW }), null);
  });
  test('the cards: locked cards carry no minutes; dead pieces drop; a coverless instalment shows its poster', () => {
    const entries = [
      { kind: 'story', id: 'fresh', fraction: 0.5, updatedAt: 9 },
      { kind: 'story', id: 'gone', fraction: 0.5, updatedAt: 8 },
      { kind: 'instalment', id: 'bp-i2', fraction: 0.25, updatedAt: 7 },
      { kind: 'instalment', id: 'bp-i3', fraction: 0.25, updatedAt: 6 },
      { kind: 'story', id: 'old', fraction: 0.1, updatedAt: 5 },
    ];
    const series = { title: 'Beta', status: 'published', coverUrl: 'https://x/poster.webp', author: 'S' };
    const cards = resolveCards(entries, {
      liveStories: [fresh, archived], tier: 'free', subscriptionTier: 'platinum', now: NOW,
      instalments: {
        'bp-i2': { row, series, detail: { author: 'Writer', wordCount: 2300 } },
        'bp-i3': { row: { ...row, status: 'unpublished' }, series, detail: null },
      },
    });
    assert.deepEqual(cards.map((c) => c.key), ['story:fresh', 'instalment:bp-i2', 'story:old']);
    const [f, i, o] = cards;
    assert.deepEqual([f.state, f.minutes, f.kindLine, f.href], ['open', 5, 'short story', '/stories/fresh']);
    assert.deepEqual([i.state, i.title, i.writer, i.cover, i.kindLine, i.href, i.minutes],
      ['open', 'Beta', 'Writer', 'https://x/poster.webp', 'The Series · Instalment 2', '/series/read/bp-i2', 9]);
    assert.deepEqual([o.state, o.minutes, o.href], ['locked', null, '/stories/old']);
    const locked = resolveCards([entries[2]], { liveStories: [], instalments: { 'bp-i2': { row, series, detail: { coverUrl: 'https://x/own.webp' } } }, subscriptionTier: 'free', now: NOW })[0];
    assert.deepEqual([locked.state, locked.cover, locked.href, locked.minutes], ['locked', 'https://x/own.webp', '/series/instalment/bp-i2', null]);
  });
  test('the row keeps ten', () => {
    const many = Array.from({ length: 14 }, (_, n) => ({ ...fresh, id: `s${n}` }));
    const entries = many.map((s, n) => ({ kind: 'story', id: s.id, fraction: 0.3, updatedAt: 100 - n }));
    const cards = resolveCards(entries, { liveStories: many, now: NOW });
    assert.equal(ROW_MAX, 10);
    assert.deepEqual(cards.map((c) => c.id), many.slice(0, 10).map((s) => s.id));
  });
});

describe('saving and resuming', () => {
  test('the thresholds are the read counter\'s own, and the story page uses them for both', () => {
    assert.equal(STARTED_DWELL_MS, 12000);
    assert.equal(STARTED_SCROLL, 0.25);
    const page = read('app/stories/[slug]/page-client.js');
    assert.match(page, /dwellMs >= STARTED_DWELL_MS\) fire\(\)/);
    assert.match(page, /range >= STARTED_SCROLL\) fire\(\)/);
    assert.match(page, /threadFraction\(articleMetrics\.current, scrollY, window\.innerHeight\)/);
  });
  test('the thread\'s measure, clamped, and its inverse', () => {
    const m = { top: 500, height: 3000 };
    assert.equal(threadFraction(m, 0, 1000), 0);
    assert.equal(threadFraction(m, 500, 1000), 0);
    assert.equal(threadFraction(m, 1500, 1000), 0.5);
    assert.equal(threadFraction(m, 9999, 1000), 1);
    assert.equal(threadFraction({ top: 0, height: 500 }, 0, 1000), 1);
    for (const f of [0, 0.13, 0.5, 0.87, 1]) assert.ok(Math.abs(threadFraction(m, scrollForFraction(m, 1000, f), 1000) - f) < 1 / 2000);
    assert.equal(clampFraction(-1), 0);
    assert.equal(clampFraction(NaN), 0);
  });
  test('the first write, then 0.02 AND 15 s, plus any change on hide', () => {
    assert.equal(shouldSave(0.1, null, 0), true);
    const last = { fraction: 0.3, at: 1000 };
    assert.equal(shouldSave(0.31, last, 1000 + SAVE_MIN_INTERVAL_MS), false, 'not far enough');
    assert.equal(shouldSave(0.3 + SAVE_MIN_STEP, last, 1000 + SAVE_MIN_INTERVAL_MS - 1), false, 'not long enough');
    assert.equal(shouldSave(0.3 + SAVE_MIN_STEP, last, 1000 + SAVE_MIN_INTERVAL_MS), true);
    assert.equal(shouldSave(0.3 - SAVE_MIN_STEP, last, 1000 + SAVE_MIN_INTERVAL_MS), true, 'back is a move too');
    assert.equal(shouldSave(0.301, last, 1001, { force: true }), true);
    assert.equal(shouldSave(0.3, last, 1001, { force: true }), false);
  });
  test('a card opens with a hash, never a query string', () => {
    assert.match(RESUME_HASH, /^#[a-z-]+$/);
    const row = read('app/components/ContinueReadingRow.js');
    assert.match(row, /`\$\{card\.href\}\$\{RESUME_HASH\}`/);
    assert.equal(/\?resume|\?continue/.test(row), false);
  });
});

describe('where the row sits, and what it reuses', () => {
  const page = read('app/public-library/page.js');
  const body = page.slice(page.indexOf('export default function'));
  test('after the hero, before the desktop Square banner, loaded with dynamic(), for a signed-in reader only', () => {
    const row = body.indexOf('<ContinueReadingRow');
    assert.ok(row > 0);
    assert.ok(row > body.lastIndexOf('Hero Carousel'), 'after the hero');
    assert.ok(row < body.indexOf('<div className="sq-banner-desktop">'), 'before the desktop Square banner');
    assert.match(body, /\{user && <ContinueReadingRow /);
    assert.match(page, /const ContinueReadingRow = dynamic\(\(\) => import\('\.\.\/components\/ContinueReadingRow'\)/);
  });
  test('Just Added and Continue Reading share one header and one strip; nobody restates the strip', () => {
    assert.match(body, /<ShelfRowHeader kicker="FRESH OFF THE PRESS" title="Just Added" \/>/);
    assert.match(body, /className="just-added-scroll" style=\{SHELF_STRIP_STYLE\}/);
    const row = read('app/components/ContinueReadingRow.js');
    assert.match(row, /<ShelfRowHeader kicker=\{CR_KICKER\} title=\{CR_TITLE\} \/>/);
    assert.match(row, /style=\{SHELF_STRIP_STYLE\}/);
    assert.equal(/gap: 14/.test(row), false);
    assert.match(row, /CR_KICKER = 'Where you left off'/);
    assert.match(row, /CR_TITLE = 'Continue Reading'/);
  });
  test('My Library and Continue Reading draw ONE bar', () => {
    const lib = read('app/my-library/page.js');
    assert.match(lib, /<ReadingBar progress=\{progress\} \/>/);
    assert.equal(/function barFor/.test(lib), false);
    assert.equal(/\.ml-bar-track \{/.test(lib), false, 'the bar\'s rules live in ReadingBar.js only');
    assert.match(read('app/components/ContinueReadingRow.js'), /<ReadingBar progress=\{card\.fraction\} className="cr-bar" \/>/);
  });
});
