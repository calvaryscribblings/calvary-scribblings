// PUSH — the pure half: scan, seed, audience, payload, tickets, receipts, pruning.
//
//   npm run test:push
//
// No network, no emulator. The IO half — claims, concurrency, retries against a real
// transaction — is tests/push/announcer.emulator.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isStoryVisible, isInstalmentVisible, planAnnouncements, planSeed, buildAudience,
  storyMessage, instalmentMessage, assertSafe, forbiddenIn, messagesFor, planTickets,
  receiptsToFetch, planReceipts, chunk, londonClock, isQuietHour, sentOnLondonDay, planSendWindow,
  TOKEN_STALE_MS, RECEIPT_MIN_AGE_MS, RECEIPT_MAX_AGE_MS, EXPO_BATCH, DAILY_CAP, PUSH_SOUND, ANDROID_CHANNEL_ID,
} from '../../scripts/push/lib.mjs';
import { formFor, allPairs, SUBCATEGORY_FORM, CATEGORY_FORM, FORMS_STATUS } from '../../scripts/push/forms.mjs';
import { frequencyStats, visibleItemsSince, capStats } from '../../scripts/push/frequency.mjs';

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
      sound: 'default',
      channelId: 'stories',
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

  test('NO IMAGES and nothing else rides along: title, body, data.url, sound, channel — and only those', () => {
    const { message } = storyMessage('s', story({ cover: 'https://x/c.png', coverHash: 'abc' }));
    assert.deepEqual(Object.keys(message).sort(), ['body', 'channelId', 'data', 'sound', 'title']);
    assert.deepEqual(Object.keys(message.data), ['url']);
    assert.throws(() => assertSafe({ ...message, image: 'https://x/c.png' }), /unexpected keys/);
    assert.throws(() => assertSafe({ ...message, richContent: { image: 'x' } }), /unexpected keys/);
    assert.throws(() => assertSafe({ ...message, data: { url: message.data.url, image: 'x' } }), /more than url/);
  });

  test('the destination is a story or an instalment and NOTHING ELSE — never the Book Store', () => {
    const ok = { title: 't', body: 'New poem by A', sound: 'default', channelId: 'stories' };
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
    const base = { title: 'T', body: 'New poem by A', data: { url: '/stories/s' }, sound: 'default', channelId: 'stories' };
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

describe('payload — SOUND (RULED): the default sound on iOS, one named channel on Android', () => {
  test('every push carries sound "default" and the ruled channel — story and instalment alike', () => {
    const s = storyMessage('s', story()).message;
    const i = instalmentMessage('beta-princess-i3', inst(), { title: 'Part Three', author: 'Monica Garcia' }, SERIES.bp).message;
    for (const m of [s, i]) {
      assert.equal(m.sound, 'default');
      assert.equal(m.channelId, 'stories');
    }
    assert.equal(PUSH_SOUND, 'default');
    assert.equal(ANDROID_CHANNEL_ID, 'stories');
  });

  test('a push without the sound, or on another channel, never leaves', () => {
    const m = storyMessage('s', story()).message;
    const { sound, ...silent } = m;
    assert.throws(() => assertSafe(silent), /unexpected keys/);
    assert.throws(() => assertSafe({ ...m, sound: null }), /sound\/channel/);
    assert.throws(() => assertSafe({ ...m, channelId: 'marketing' }), /sound\/channel/);
    // A12: no app build ever created "default" — naming it lands on expo's fallback channel.
    assert.throws(() => assertSafe({ ...m, channelId: 'default' }), /sound\/channel/);
    assert.throws(() => messagesFor(silent, [{ uid: 'u', tokenKey: 'k', token: 'ExpoPushToken[x]' }]), /unexpected keys/);
  });

  test('the test script sends through the same builder and gate, so it names the same channel', () => {
    const src = readFileSync(new URL('../../scripts/push-test.mjs', import.meta.url), 'utf8');
    assert.match(src, /import \{[^}]*storyMessage[^}]*\} from '\.\/push\/lib\.mjs'/);
    assert.doesNotMatch(src, /channelId/, 'push-test.mjs must not set its own channel');
  });
});

describe('payload — RULED: instalments are "{series}" / "{part} by {author} · {logline}"', () => {
  const detail = { title: 'Part Three', author: 'Monica Garcia', logline: 'Sibry holds the walls until dawn.' };

  test('title = the SERIES name; body = the part as the series names it, then the byline, then the logline', () => {
    const { message } = instalmentMessage('beta-princess-i3', inst(), detail, SERIES.bp);
    assert.deepEqual(message, {
      title: 'Beta Princess',
      body: 'Part Three by Monica Garcia · Sibry holds the walls until dawn.',
      data: { url: '/series/instalment/beta-princess-i3' },
      sound: 'default',
      channelId: 'stories',
    });
  });

  test('the part is named as the series names it — a chapter stays a chapter', () => {
    const r = instalmentMessage('diary-of-a-lagos-9-5er-i1', inst(),
      { title: 'Chapter I: It’s Monday Again ', author: 'Tricia Ajax', logline: 'NEPA woke him.' },
      { title: 'Diary of a Lagos 9-5er', status: 'published' });
    assert.equal(r.message.title, 'Diary of a Lagos 9-5er');
    assert.equal(r.message.body, 'Chapter I: It’s Monday Again by Tricia Ajax · NEPA woke him.');
  });

  test('no logline → the body ends at "{part} by {author}"; no author → the part alone', () => {
    assert.equal(instalmentMessage('i', inst(), { ...detail, logline: null }, SERIES.bp).message.body,
      'Part Three by Monica Garcia');
    assert.equal(instalmentMessage('i', inst(), { ...detail, author: ' ', logline: '' }, SERIES.bp).message.body,
      'Part Three');
  });

  test('the live Lagos 9-5er logline carries "₦2,200" — the logline is dropped, the byline kept', () => {
    const r = instalmentMessage('diary-of-a-lagos-9-5er-i1', inst(),
      { title: 'Chapter I: It’s Monday Again ', author: 'Tricia Ajax', logline: 'Four hours, ₦2,200 and one egg later, Yemi reaches his desk.' },
      { title: 'Diary of a Lagos 9-5er', status: 'published' });
    assert.equal(r.message.body, 'Chapter I: It’s Monday Again by Tricia Ajax');
    assert.ok(r.dropped);
  });

  test('no series name, no part name, or a forbidden term in either → refused, never sent', () => {
    assert.ok(instalmentMessage('i', inst(), null, SERIES.bp).refused, 'no detail');
    assert.ok(instalmentMessage('i', inst(), detail, null).refused, 'no series');
    assert.ok(instalmentMessage('i', inst(), detail, { title: 'Book Store Tales' }).refused);
    assert.ok(instalmentMessage('i', inst(), { ...detail, title: 'Part £5' }, SERIES.bp).refused);
  });
});

// ── WHEN AND HOW MANY ───────────────────────────────────────────────────────────────────

// British Summer Time ends at 01:00Z on Sunday 25 October 2026; it began 01:00Z Sunday 29 March.
const at = (s) => Date.parse(s);
const ready = (n) => Array.from({ length: n }, (_, i) => ({ item: { kind: 'story', id: `s${i}` } }));

describe('the 08:00 hold — RULED: nothing before 08:00 London, correct across BST and GMT', () => {
  test('London\'s wall clock, from the tz database', () => {
    assert.deepEqual(londonClock(at('2026-09-25T06:59:59Z')), { day: '2026-09-25', hour: 7 }, 'BST: UTC+1');
    assert.deepEqual(londonClock(at('2026-12-01T07:59:59Z')), { day: '2026-12-01', hour: 7 }, 'GMT: UTC+0');
    assert.deepEqual(londonClock(at('2026-09-25T23:30:00Z')), { day: '2026-09-26', hour: 0 }, 'BST midnight is 23:00Z the day before');
  });

  test('SUMMER (BST): 06:59Z is 07:59 London — held; 07:00Z is 08:00 London — goes', () => {
    assert.equal(isQuietHour(at('2026-09-25T06:59:00Z')), true);
    assert.equal(isQuietHour(at('2026-09-25T07:00:00Z')), false);
  });

  test('WINTER (GMT): 07:59Z is 07:59 London — held; 08:00Z goes', () => {
    assert.equal(isQuietHour(at('2026-12-01T07:59:00Z')), true);
    assert.equal(isQuietHour(at('2026-12-01T08:00:00Z')), false);
  });

  test('ACROSS THE CHANGE, 25 Oct 2026: 07:30Z is 07:30 GMT and still held — a UTC+1 rule would have sent it', () => {
    assert.equal(isQuietHour(at('2026-10-24T07:30:00Z')), false, 'Saturday, still BST: 08:30 London');
    assert.equal(isQuietHour(at('2026-10-25T07:30:00Z')), true, 'Sunday, GMT: 07:30 London');
    assert.equal(isQuietHour(at('2026-10-25T08:00:00Z')), false);
    // and the spring change, 29 Mar 2026
    assert.equal(isQuietHour(at('2026-03-28T07:30:00Z')), true, 'Saturday, GMT');
    assert.equal(isQuietHour(at('2026-03-29T07:30:00Z')), false, 'Sunday, BST: 08:30 London');
  });

  test('from midnight to 07:59 London everything is held; from 08:00 to midnight it goes at once', () => {
    for (const t of ['2026-09-24T23:00:00Z', '2026-09-25T02:15:00Z', '2026-09-25T05:30:00Z', '2026-09-25T06:45:00Z']) {
      const w = planSendWindow(ready(1), {}, at(t));
      assert.equal(w.send.length, 0, t); assert.equal(w.held.length, 1, t);
    }
    for (const t of ['2026-09-25T07:00:00Z', '2026-09-25T12:00:00Z', '2026-09-25T22:45:00Z']) {
      const w = planSendWindow(ready(1), {}, at(t));
      assert.equal(w.send.length, 1, t); assert.equal(w.held.length, 0, t);
    }
  });

  test('a held item is still due on the 08:00 run — the hold is not a record', () => {
    const stories = { early: story({ publishAt: iso(at('2026-09-25T05:30:00Z')), published: true }) };
    const held = at('2026-09-25T06:45:00Z'), eight = at('2026-09-25T07:00:00Z');
    assert.equal(planAnnouncements({ stories }, held).length, 1);
    assert.equal(planSendWindow(ready(1), {}, held).held.length, 1);
    assert.equal(planAnnouncements({ stories }, eight).length, 1, 'still due at 08:00');
    assert.equal(planSendWindow(ready(1), {}, eight).send.length, 1);
  });
});

describe('the cap — RULED: at most two per reader per London day; a third is not sent', () => {
  const NOON = at('2026-09-25T11:00:00Z'); // 12:00 London
  const sent = (t, state = 'sent') => ({ state, sentAt: at(t) });

  test('the day\'s count is what went out (sent or partial) since LONDON midnight', () => {
    const announced = {
      story: {
        a: sent('2026-09-25T07:05:00Z'), b: sent('2026-09-25T09:00:00Z', 'partial'),
        yesterday: sent('2026-09-24T22:30:00Z'),        // 23:30 London on the 24th
        seeded: { state: 'seeded', at: NOON }, refused: { state: 'refused' }, capped: { state: 'capped', at: NOON },
      },
      instalment: { i: sent('2026-09-24T23:10:00Z') },   // 00:10 London on the 25th — today
    };
    assert.equal(sentOnLondonDay(announced, NOON), 3);
  });

  test('0 sent today: two go, the third is capped', () => {
    const w = planSendWindow(ready(3), {}, NOON);
    assert.deepEqual(w.send.map((r) => r.item.id), ['s0', 's1']);
    assert.deepEqual(w.capped.map((r) => r.item.id), ['s2']);
    assert.equal(DAILY_CAP, 2);
  });

  test('1 sent earlier today: one more goes; 2 sent: nothing goes', () => {
    const one = { story: { a: sent('2026-09-25T07:05:00Z') } };
    assert.equal(planSendWindow(ready(2), one, NOON).send.length, 1);
    const two = { story: { a: sent('2026-09-25T07:05:00Z'), b: sent('2026-09-25T09:00:00Z') } };
    const w = planSendWindow(ready(1), two, NOON);
    assert.equal(w.send.length, 0); assert.equal(w.capped.length, 1);
  });

  test('the count resets at London midnight — 23:30 BST yesterday does not count, 00:10 BST today does', () => {
    const a = { story: { late: sent('2026-09-24T22:30:00Z'), later: sent('2026-09-24T22:40:00Z') } };
    assert.equal(planSendWindow(ready(1), a, NOON).send.length, 1);
    const b = { story: { x: sent('2026-09-24T23:10:00Z'), y: sent('2026-09-24T23:20:00Z') } };
    assert.equal(planSendWindow(ready(1), b, NOON).send.length, 0);
  });

  test('three held overnight: at 08:00 the oldest two go, the third is capped', () => {
    const w = planSendWindow(ready(3), {}, at('2026-09-25T07:00:00Z'));
    assert.deepEqual(w.send.map((r) => r.item.id), ['s0', 's1']);
    assert.deepEqual(w.capped.map((r) => r.item.id), ['s2']);
  });

  test('frequency: over a 30-day set, how many thirds the cap would have stopped', () => {
    const items = ['2026-09-01T05:30:00Z', '2026-09-01T10:00:00Z', '2026-09-01T15:00:00Z', '2026-09-01T22:30:00Z',
      '2026-09-02T09:00:00Z', '2026-09-03T23:30:00Z', '2026-09-04T09:00:00Z', '2026-09-04T12:00:00Z']
      .map((t, i) => ({ id: `x${i}`, at: at(t) }));
    const c = capStats(items);
    assert.equal(c.capped, 3, '1 Sep London has 4 (22:30Z is 23:30 London, still the 1st) → 2 capped; 4 Sep has 3 (23:30Z on the 3rd is 00:30 London on the 4th) → 1');
    assert.equal(c.daysCapped, 2);
  });
});

describe('forms — RULED table, and it covers the whole taxonomy', () => {
  test('ruled as drafted, 25 Sep 2026', () => { assert.equal(FORMS_STATUS, 'RULED'); });

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
  const msg = { title: 'T', body: 'New poem by A', data: { url: '/stories/s' }, sound: 'default', channelId: 'stories' };
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
