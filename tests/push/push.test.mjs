// PUSH — the pure half: scan, seed, audience, payload, tickets, receipts, pruning.
//
//   npm run test:push
//
// No network, no emulator. The IO half — claims, concurrency, retries against a real
// transaction — is tests/push/announcer.emulator.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStoryVisible, isInstalmentVisible, planAnnouncements, planSeed, buildAudience,
  storyMessage, instalmentMessage, assertSafe, forbiddenIn, messagesFor, planTickets,
  receiptsToFetch, planReceipts, chunk,
  TOKEN_STALE_MS, RECEIPT_MIN_AGE_MS, RECEIPT_MAX_AGE_MS, EXPO_BATCH,
} from '../../scripts/push/lib.mjs';
import { formFor, allPairs, SUBCATEGORY_FORM, CATEGORY_FORM, FORMS_STATUS } from '../../scripts/push/forms.mjs';
import { frequencyStats, visibleItemsSince } from '../../scripts/push/frequency.mjs';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const H = 3600000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();

const story = (over = {}) => ({
  title: 'Threshold', author: 'Dera Okaro', category: 'short', subcategory: 'Drama',
  trailerQuote: 'She kept the door open an inch.', published: true, publishedAtMs: NOW - 2 * D, ...over,
});
const SERIES = { bp: { title: 'Beta Princess', status: 'published' }, dr: { title: 'Drafted', status: 'draft' } };
const inst = (over = {}) => ({ seriesId: 'bp', ordinal: 1, status: 'published', releaseAtMs: NOW - H, ...over });

// ── THE SCAN ────────────────────────────────────────────────────────────────────────────

describe('scan — what counts as newly visible', () => {
  test('a story: published, and not scheduled into the future', () => {
    assert.equal(isStoryVisible(story(), NOW), true);
    assert.equal(isStoryVisible(story({ published: undefined }), NOW), true, 'absent published = live, as isIndexed');
    assert.equal(isStoryVisible(story({ published: false }), NOW), false, 'hidden, held, or scheduled-not-yet-flipped');
    assert.equal(isStoryVisible(story({ publishAt: iso(NOW + H) }), NOW), false, 'a live record with a future publishAt is still gated');
    assert.equal(isStoryVisible(story({ publishAt: iso(NOW - H) }), NOW), true);
    assert.equal(isStoryVisible(null, NOW), false);
  });

  test('an instalment: published, released by the clock, and in a published series', () => {
    assert.equal(isInstalmentVisible(inst(), SERIES.bp, NOW), true);
    assert.equal(isInstalmentVisible(inst({ releaseAtMs: NOW }), SERIES.bp, NOW), true, 'the release instant itself');
    assert.equal(isInstalmentVisible(inst({ releaseAtMs: NOW + 1 }), SERIES.bp, NOW), false);
    assert.equal(isInstalmentVisible(inst({ status: 'draft' }), SERIES.bp, NOW), false);
    assert.equal(isInstalmentVisible(inst({ status: 'unpublished' }), SERIES.bp, NOW), false, 'withdrawn');
    assert.equal(isInstalmentVisible(inst({ releaseAtMs: undefined }), SERIES.bp, NOW), false);
    assert.equal(isInstalmentVisible(inst(), SERIES.dr, NOW), false, 'a draft series');
    assert.equal(isInstalmentVisible(inst(), undefined, NOW), false, 'an orphan');
  });

  test('due = visible and never announced, in ANY state; oldest first', () => {
    const due = planAnnouncements({
      stories: {
        live: story({ publishedAtMs: NOW - D }),
        older: story({ publishedAtMs: NOW - 3 * D }),
        hidden: story({ published: false }),
        future: story({ publishAt: iso(NOW + H) }),
        done: story(), seeded: story(), partial: story(), refused: story(),
      },
      instalments: { i1: inst(), i2: inst({ releaseAtMs: NOW + D }), i3: inst({ status: 'draft' }) },
      series: SERIES,
      announced: {
        story: {
          done: { state: 'sent' }, seeded: { state: 'seeded' },
          partial: { state: 'partial' }, refused: { state: 'refused' },
        },
      },
    }, NOW);
    assert.deepEqual(due.map((d) => `${d.kind}/${d.id}`), ['story/older', 'story/live', 'instalment/i1']);
  });

  test('an EDIT never re-sends — the entry, not the content, decides', () => {
    const announced = { story: { s: { state: 'sent' } } };
    for (const edit of [{ title: 'New title' }, { trailerQuote: 'rewritten' }, { publishedAtMs: NOW }, { category: 'flash' }]) {
      assert.deepEqual(planAnnouncements({ stories: { s: story(edit) }, announced }, NOW), []);
    }
  });

  test('HIDE then UNHIDE does not announce twice', () => {
    const announced = { story: { s: { state: 'sent' } } };
    assert.deepEqual(planAnnouncements({ stories: { s: story({ published: false }) }, announced }, NOW), []);
    assert.deepEqual(planAnnouncements({ stories: { s: story() }, announced }, NOW), []);
  });

  test('a SCHEDULED story is due the tick after it crosses publishAt, and not before', () => {
    const s = story({ published: true, publishAt: iso(NOW + 10 * 60000) });
    assert.equal(planAnnouncements({ stories: { s } }, NOW).length, 0);
    assert.equal(planAnnouncements({ stories: { s } }, NOW + 15 * 60000).length, 1);
  });

  test('an instalment released by the CLOCK — no write at that moment — is due next tick', () => {
    const w = { instalments: { i: inst({ releaseAtMs: NOW + 5 * 60000 }) }, series: SERIES };
    assert.equal(planAnnouncements(w, NOW).length, 0);
    assert.equal(planAnnouncements(w, NOW + 15 * 60000).length, 1);
  });
});

// ── THE SEED ────────────────────────────────────────────────────────────────────────────

describe('seed — the back catalogue is marked before the first run', () => {
  const corpus = () => ({
    stories: {
      live: story(),
      hidden: story({ published: false }),                              // Hide — was live once
      scheduled: story({ published: false, publishAt: iso(NOW + D) }),  // on its way in
      justDue: story({ published: false, publishAt: iso(NOW - 5 * 60000) }), // the Worker's next tick
      longPast: story({ published: false, publishAt: iso(NOW - 10 * D) }), // hidden after going live
      held: story({ published: false, coverHold: true }),               // waiting for a cover
    },
    instalments: {
      out: inst(), withdrawn: inst({ status: 'unpublished' }),
      soon: inst({ releaseAtMs: NOW + D }), draft: inst({ status: 'draft' }),
      inDraftSeries: inst({ seriesId: 'dr' }),
    },
    series: SERIES,
  });

  test('marks everything EXCEPT what is provably on its way in', () => {
    const { mark, pending } = planSeed(corpus(), NOW);
    const ids = (l) => l.map((x) => `${x.kind}/${x.id}`).sort();
    assert.deepEqual(ids(mark), [
      'instalment/out', 'instalment/withdrawn',
      'story/hidden', 'story/live', 'story/longPast',
    ]);
    assert.deepEqual(ids(pending), [
      'instalment/draft', 'instalment/inDraftSeries', 'instalment/soon',
      'story/held', 'story/justDue', 'story/scheduled',
    ]);
  });

  test('AFTER THE SEED, NOTHING IS DUE — the first run announces zero back catalogue', () => {
    const w = corpus();
    const { mark } = planSeed(w, NOW);
    const announced = {};
    for (const { kind, id } of mark) (announced[kind] ||= {})[id] = { state: 'seeded' };
    // The one visible-and-unmarked item at seed time is justDue — still published:false, so not
    // visible yet either. Nothing is due.
    assert.deepEqual(planAnnouncements({ ...w, announced }, NOW), []);
  });

  test('WITHOUT the seed the same corpus would announce the back catalogue', () => {
    // The failure the seed exists for, measured rather than asserted in prose.
    assert.ok(planAnnouncements(corpus(), NOW).length >= 2);
  });

  test('and every pending item IS announced once it arrives, exactly once', () => {
    const w = corpus();
    const announced = {};
    for (const { kind, id } of planSeed(w, NOW).mark) (announced[kind] ||= {})[id] = { state: 'seeded' };
    const later = NOW + 2 * D;
    for (const s of Object.values(w.stories)) if (s.publishAt && Date.parse(s.publishAt) <= later) s.published = true;
    w.stories.held.published = true; delete w.stories.held.coverHold;
    w.instalments.draft.status = 'published';
    w.series.dr.status = 'published';
    const due = planAnnouncements({ ...w, announced }, later).map((d) => `${d.kind}/${d.id}`).sort();
    // longPast was hidden-after-live and got marked, so un-hiding it (above) does NOT announce.
    assert.deepEqual(due, [
      'instalment/draft', 'instalment/inDraftSeries', 'instalment/soon',
      'story/held', 'story/justDue', 'story/scheduled',
    ]);
  });

  test('re-seeding skips what is already marked', () => {
    const w = corpus();
    w.announced = { story: { live: { state: 'sent' } } };
    assert.equal(planSeed(w, NOW).mark.some((m) => m.id === 'live'), false);
  });
});

// ── THE AUDIENCE ────────────────────────────────────────────────────────────────────────

describe('audience — every token whose owner has not switched story notifications off', () => {
  const row = (token, updatedAt = NOW - D) => ({ token, platform: 'ios', appVersion: '1', updatedAt });

  test('absent = on, true = on, false = off', () => {
    const tokens = { a: { k: row('T[a]') }, b: { k: row('T[b]') }, c: { k: row('T[c]') } };
    const { recipients, optedOut } = buildAudience(tokens, { b: true, c: false }, NOW);
    assert.deepEqual(recipients.map((r) => r.uid).sort(), ['a', 'b']);
    assert.equal(optedOut, 1);
  });

  test('a row not refreshed in 60 days is not sent to, and is listed for pruning', () => {
    const tokens = { a: { fresh: row('T[1]', NOW - TOKEN_STALE_MS + H), old: row('T[2]', NOW - TOKEN_STALE_MS - H) } };
    const { recipients, stale } = buildAudience(tokens, {}, NOW);
    assert.deepEqual(recipients.map((r) => r.tokenKey), ['fresh']);
    assert.deepEqual(stale, [{ uid: 'a', tokenKey: 'old' }]);
  });

  test('ONE DEVICE, ONE NOTIFICATION — the latest owner of a token speaks for it', () => {
    // A phone that signed out of A and into B carries its token under both.
    const tokens = { A: { k: row('T[phone]', NOW - 5 * D) }, B: { k: row('T[phone]', NOW - D) } };
    assert.deepEqual(buildAudience(tokens, {}, NOW).recipients.map((r) => r.uid), ['B']);
    // …and it is B's switch that applies, not A's.
    assert.equal(buildAudience(tokens, { B: false }, NOW).recipients.length, 0);
    assert.equal(buildAudience(tokens, { A: false }, NOW).recipients.length, 1);
  });

  test('a row with no token string is skipped, not sent', () => {
    const { recipients } = buildAudience({ a: { k: { updatedAt: NOW } } }, {}, NOW);
    assert.equal(recipients.length, 0);
  });
});

// ── THE PAYLOAD ─────────────────────────────────────────────────────────────────────────

describe('payload — RULED: title, then "New {form} by {author} · {quote}", byline first', () => {
  test('the ruled shape, exactly', () => {
    const { message } = storyMessage('threshold', story());
    assert.deepEqual(message, {
      title: 'Threshold',
      body: 'New short story by Dera Okaro · She kept the door open an inch.',
      data: { url: '/stories/threshold' },
    });
  });

  test('BYLINE FIRST — the collapsed Android line is the byline', () => {
    const { message } = storyMessage('s', story());
    assert.match(message.body, /^New short story by Dera Okaro/);
  });

  test('NO QUOTE → the body ENDS at the byline; nothing is invented', () => {
    for (const q of [undefined, '', '   ', null]) {
      const { message } = storyMessage('s', story({ trailerQuote: q }));
      assert.equal(message.body, 'New short story by Dera Okaro');
    }
  });

  test('NO IMAGES and nothing else rides along: title, body, data.url — and only those', () => {
    const { message } = storyMessage('s', story({ cover: 'https://x/c.png', coverHash: 'abc' }));
    assert.deepEqual(Object.keys(message).sort(), ['body', 'data', 'title']);
    assert.deepEqual(Object.keys(message.data), ['url']);
    assert.throws(() => assertSafe({ ...message, image: 'https://x/c.png' }), /unexpected keys/);
    assert.throws(() => assertSafe({ ...message, richContent: { image: 'x' } }), /unexpected keys/);
    assert.throws(() => assertSafe({ ...message, data: { url: message.data.url, image: 'x' } }), /more than url/);
  });

  test('the destination is a story or an instalment and NOTHING ELSE — never the Book Store', () => {
    const ok = { title: 't', body: 'New poem by A' };
    assert.ok(assertSafe({ ...ok, data: { url: '/stories/a-slug' } }));
    assert.ok(assertSafe({ ...ok, data: { url: '/series/instalment/beta-princess-i1' } }));
    for (const url of ['/bookstore', '/bookstore/some-book', '/membership', '/shop', '/stories/../bookstore',
      'https://calvaryscribblings.co.uk/stories/x', '/stories/x?ref=push', '/']) {
      assert.throws(() => assertSafe({ ...ok, data: { url } }), /not a story or instalment/, url);
    }
  });

  test('NEVER a price, a purchase or the Book Store: a quote that carries one is DROPPED', () => {
    for (const q of ['Only £4.99 this week', 'It cost ₦2,200 and one egg', 'Buy the book now',
      'Now in the Book Store', 'available in our bookstore', 'purchase your copy', '20 naira']) {
      const r = storyMessage('s', story({ trailerQuote: q }));
      assert.equal(r.message.body, 'New short story by Dera Okaro', q);
      assert.ok(r.dropped, q);
    }
  });

  test('a TITLE carrying an amount, a purchase or the Book Store refuses the item — it is never sent', () => {
    for (const t of ['£5 Stories', 'Purchase Order', 'Letters from the Bookstore']) {
      assert.ok(storyMessage('s', story({ title: t })).refused, t);
    }
    // …but a literary title using an ordinary word is not a price.
    for (const t of ['The Price of Silence', 'Bought and Sold']) {
      assert.ok(storyMessage('s', story({ title: t })).message, t);
    }
  });

  test('assertSafe is the last gate: a forbidden term anywhere in a finished push throws', () => {
    const base = { title: 'T', body: 'New poem by A', data: { url: '/stories/s' } };
    assert.throws(() => assertSafe({ ...base, body: 'New poem by A · only £3' }), /forbidden/);
    assert.throws(() => assertSafe({ ...base, title: 'In the Book Store' }), /forbidden/);
    assert.throws(() => assertSafe({ ...base, body: 'A new poem' }), /byline/);
  });

  test('a story with no title is refused, not sent as a blank', () => {
    assert.ok(storyMessage('s', story({ title: '  ' })).refused);
  });

  test('whitespace in stored fields is flattened, never shown as a line break', () => {
    const { message } = storyMessage('s', story({ title: ' Two\n Lines ', trailerQuote: 'a\n\nb' }));
    assert.equal(message.title, 'Two Lines');
    assert.ok(message.body.endsWith('· a b'));
  });
});

describe('payload — DRAFT: instalments', () => {
  const detail = { title: 'Part Three', author: 'Monica Garcia', logline: 'Sibry holds the walls until dawn.' };

  test('title = the instalment title; body = byline · series — logline', () => {
    const { message } = instalmentMessage('beta-princess-i3', inst(), detail, SERIES.bp);
    assert.deepEqual(message, {
      title: 'Part Three',
      body: 'New instalment by Monica Garcia · Beta Princess — Sibry holds the walls until dawn.',
      data: { url: '/series/instalment/beta-princess-i3' },
    });
  });

  test('no logline → byline · series; neither → byline alone', () => {
    assert.equal(instalmentMessage('i', inst(), { ...detail, logline: null }, SERIES.bp).message.body,
      'New instalment by Monica Garcia · Beta Princess');
    assert.equal(instalmentMessage('i', inst(), { ...detail, logline: '' }, null).message.body,
      'New instalment by Monica Garcia');
  });

  test('the live Lagos 9-5er logline carries "₦2,200" — the logline is dropped, the series kept', () => {
    const r = instalmentMessage('diary-of-a-lagos-9-5er-i1', inst(),
      { title: 'Chapter I: It’s Monday Again ', author: 'Tricia Ajax', logline: 'Four hours, ₦2,200 and one egg later, Yemi reaches his desk.' },
      { title: 'Diary of a Lagos 9-5er', status: 'published' });
    assert.equal(r.message.title, 'Chapter I: It’s Monday Again');
    assert.equal(r.message.body, 'New instalment by Tricia Ajax · Diary of a Lagos 9-5er');
    assert.ok(r.dropped);
  });

  test('an instalment with no detail record is refused, not sent blank', () => {
    assert.ok(instalmentMessage('i', inst(), null, SERIES.bp).refused);
  });
});

describe('forms — DRAFT table, and it covers the whole taxonomy', () => {
  test('headed DRAFT until Ikenna rules it', () => { assert.equal(FORMS_STATUS, 'DRAFT'); });

  test('EVERY category/subcategory the taxonomy can produce has its own row', () => {
    for (const p of allPairs()) {
      if (!p.subcategory) { assert.ok(CATEGORY_FORM[p.category], p.category); continue; }
      assert.ok(SUBCATEGORY_FORM[p.category]?.[p.subcategory], `${p.category}/${p.subcategory} has no {form}`);
    }
  });

  test('the phrases are lower case mid-sentence words, and an unknown category falls back to "story"', () => {
    for (const p of allPairs()) assert.match(p.form, /^[a-z][a-z -]*$/, `${p.category}/${p.subcategory}: ${p.form}`);
    assert.equal(formFor('nonsense', ''), 'story');
    assert.equal(formFor('poetry', 'Not A Sub'), 'poem');
  });

  test('no {form} phrase can trip the guard', () => {
    for (const p of allPairs()) assert.equal(forbiddenIn(`New ${p.form} by A`), null);
  });
});

// ── BATCHING, TICKETS, RECEIPTS ─────────────────────────────────────────────────────────

describe('Expo — batches of 100, tickets, receipts, dead devices', () => {
  const msg = { title: 'T', body: 'New poem by A', data: { url: '/stories/s' } };
  const recips = (n) => Array.from({ length: n }, (_, i) => ({ uid: `u${i}`, tokenKey: `k${i}`, token: `ExpoPushToken[${i}]` }));

  test('250 devices → 100, 100, 50, every message addressed to one token', () => {
    const b = messagesFor(msg, recips(250));
    assert.deepEqual(b.map((x) => x.length), [100, 100, 50]);
    assert.equal(EXPO_BATCH, 100);
    assert.deepEqual(b[2][49], { to: 'ExpoPushToken[249]', ...msg });
    assert.deepEqual(chunk([], 100), []);
  });

  test('tickets map to recipients BY POSITION; DeviceNotRegistered is final at once', () => {
    const r = recips(3);
    const t = planTickets([
      { status: 'ok', id: 't0' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
    ], r, { kind: 'story', id: 's' });
    assert.deepEqual(t.pending, [{ ticketId: 't0', uid: 'u0', tokenKey: 'k0', kind: 'story', id: 's' }]);
    assert.deepEqual(t.dead, [{ uid: 'u1', tokenKey: 'k1' }]);
    assert.deepEqual(t.errors, [{ uid: 'u2', tokenKey: 'k2', error: 'MessageTooBig' }]);
  });

  test('receipts are asked for only once they are 15 minutes old', () => {
    const stored = { young: { at: NOW - RECEIPT_MIN_AGE_MS + 1000 }, ripe: { at: NOW - RECEIPT_MIN_AGE_MS } };
    assert.deepEqual(receiptsToFetch(stored, NOW), ['ripe']);
  });

  test('a receipt: ok clears; DeviceNotRegistered clears AND kills the token; not-ready waits; expired clears', () => {
    const stored = {
      a: { uid: 'u1', tokenKey: 'k1', at: NOW - H },
      b: { uid: 'u2', tokenKey: 'k2', at: NOW - H },
      c: { uid: 'u3', tokenKey: 'k3', at: NOW - H },
      d: { uid: 'u4', tokenKey: 'k4', at: NOW - RECEIPT_MAX_AGE_MS - H },
      e: { uid: 'u5', tokenKey: 'k5', at: NOW - H },
    };
    const answers = {
      a: { status: 'ok' },
      b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      e: { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
    };
    const p = planReceipts(stored, answers, ['a', 'b', 'c', 'd', 'e'], NOW);
    assert.equal(p.ok, 1);
    assert.deepEqual(p.dead, [{ uid: 'u2', tokenKey: 'k2' }]);
    assert.deepEqual(p.clear.sort(), ['a', 'b', 'd', 'e']);
    assert.deepEqual(p.errors, [{ ticketId: 'e', error: 'MessageRateExceeded' }]);
  });
});

describe('frequency — the numbers Ikenna rules on', () => {
  test('items per week, worst rolling week, busiest day', () => {
    const since = NOW - 30 * D;
    const stories = {};
    for (let i = 0; i < 20; i++) stories[`s${i}`] = story({ publishedAtMs: since + (i + 1) * D });
    stories.twin = story({ publishedAtMs: since + 5 * D });
    stories.old = story({ publishedAtMs: since - D });
    const items = visibleItemsSince({ stories, instalments: { i: inst({ releaseAtMs: NOW - D }) }, series: SERIES }, since, NOW);
    const st = frequencyStats(items, since, NOW);
    assert.equal(st.total, 22);
    assert.equal(st.busiestDay, 2);
    assert.ok(Math.abs(st.perWeek - 22 / (30 / 7)) < 1e-9);
    assert.ok(st.worstWeek >= 7 && st.worstWeek <= 8);
  });
});
