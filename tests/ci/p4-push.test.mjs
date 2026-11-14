// P4-B1 — personal pushes, the pure half (app/lib/pushP4.js, app/lib/pushWords.js). Every decision
// the drain makes, handed a world and a clock. Invented readers only; nothing is read or sent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dueTime, morningAfter, inQuietHours, london, londonInstant, intervalFor, decide, devicesFor, rowsHolding,
  prefOn, prefWrites, kindAllowed, nextDay, finishedWith, queueKey, namedActors, pushesPersonally,
  MORNING_CAP, DAILY_CAP, CONVERSATION_INTERVAL_MS, STALE_MS, CHANNEL_FOR_PREF, DAY_KEY,
  FOUNDERS_ONLY, P4_ARMED, PUSH_QUOTED_WORDS, PUSH_CAPS_MIN, DRAIN_STALE_MS,
} from '../../app/lib/pushP4.js';
import { rowFor, needs, pushWords, badgeFor, FALLBACK_URL } from '../../app/lib/pushWords.js';
import { GROUPED_PUSH_INTERVAL_MS, INBOX_KINDS, PUSH } from '../../app/lib/notificationKinds.js';
import { CARD_LIVE } from '../../app/lib/notifySettings.js';

const MIN = 60000, H = 60 * MIN, D = 24 * H;
const at = (iso) => Date.parse(iso);
const A = 'adaInvented000000000000001', B = 'benInvented000000000000002', C = 'calInvented000000000000003';
const TOKEN = (n) => `ExponentPushToken[invented-${n}]`;

describe('the switches stand as built for this round', () => {
  test('founders only, armed, quoted words on, cards held', () => {
    assert.equal(FOUNDERS_ONLY, true, 'until switch-on the drain sends only to founders');
    assert.equal(P4_ARMED, true, 'armed in P4-B3 (founders only): the launch check watches the drain heartbeat, notify and seen send at once');
    assert.equal(PUSH_QUOTED_WORDS, true, 'ruling 365 as written');
    assert.equal(CARD_LIVE.PEOPLE, false);
    assert.equal(CARD_LIVE['YOUR WRITING'], false);
  });
  test('the numbers (366, 367, 369, the chosen two hours, five minutes, pushCaps 1)', () => {
    assert.equal(MORNING_CAP, 3);
    assert.equal(CONVERSATION_INTERVAL_MS, 2 * MIN);
    assert.equal(DAILY_CAP, 20);
    assert.equal(STALE_MS, 2 * H);
    assert.equal(DRAIN_STALE_MS, 5 * MIN);
    assert.equal(PUSH_CAPS_MIN, 1);
  });
  test('368: every personal kind names people or your_writing', () => {
    for (const [kind, k] of Object.entries(INBOX_KINDS)) {
      if (!pushesPersonally(kind)) continue;
      assert.ok(['people', 'your_writing'].includes(CHANNEL_FOR_PREF[k.pref]), kind);
    }
    assert.equal(CHANNEL_FOR_PREF.responses, 'your_writing');
    assert.equal(CHANNEL_FOR_PREF.replies_mentions, 'people');
  });
  test('only at-once and hourly kinds push through the drain', () => {
    assert.deepEqual(Object.keys(INBOX_KINDS).filter(pushesPersonally).sort(),
      ['follow', 'mention', 'message', 'open_pages_live', 'quote', 'reaction', 'reply', 'response', 'story_reaction'], 'open_pages_live pushes when P7 writes it (309)');
  });
});

describe("London's clock: quiet hours and 08:00, across both clock changes", () => {
  test('00:00–08:00 is quiet, 08:00 is not', () => {
    assert.equal(inQuietHours(at('2026-11-14T00:00:00Z')), true);
    assert.equal(inQuietHours(at('2026-11-14T07:59:00Z')), true);
    assert.equal(inQuietHours(at('2026-11-14T08:00:00Z')), false);
    assert.equal(inQuietHours(at('2026-07-14T06:59:00Z')), true, '07:59 BST');
    assert.equal(inQuietHours(at('2026-07-14T07:00:00Z')), false, '08:00 BST');
  });
  test('08:00 London is 08:00Z in winter and 07:00Z in summer, and on both change days', () => {
    assert.equal(morningAfter(at('2026-11-14T03:00:00Z')), at('2026-11-14T08:00:00Z'));
    assert.equal(morningAfter(at('2026-07-14T01:00:00Z')), at('2026-07-14T07:00:00Z'));
    assert.equal(morningAfter(at('2026-03-29T00:30:00Z')), at('2026-03-29T07:00:00Z'), 'spring forward');
    assert.equal(morningAfter(at('2026-10-25T00:30:00Z')), at('2026-10-25T08:00:00Z'), 'fall back');
    for (const day of ['2026-03-29', '2026-10-25', '2026-11-14', '2026-06-01']) {
      const t = londonInstant(day, 8);
      assert.deepEqual([london(t).day, london(t).hour, london(t).minute], [day, 8, 0], day);
    }
  });
  test('every five minutes of three days: a due time is never inside the quiet hours', () => {
    for (const start of ['2026-03-28T22:00:00Z', '2026-10-24T22:00:00Z', '2026-11-13T22:00:00Z']) {
      for (let t = at(start); t < at(start) + 30 * H; t += 5 * MIN) {
        for (const kind of ['reply', 'reaction', 'message']) {
          const { dueAt, held } = dueTime(kind, t);
          assert.equal(inQuietHours(dueAt), false, `${kind} at ${new Date(t).toISOString()}`);
          assert.equal(held, inQuietHours(t));
          assert.ok(dueAt >= t);
        }
      }
    }
  });
});

describe('when a push is due', () => {
  const noon = at('2026-11-14T12:00:00Z');
  test('at once, and the first push of a group at once (310 read so)', () => {
    assert.deepEqual(dueTime('reply', noon), { dueAt: noon, held: false });
    assert.deepEqual(dueTime('reaction', noon), { dueAt: noon, held: false });
    assert.deepEqual(dueTime('response', noon), { dueAt: noon, held: false });
  });
  test('a group waits an hour after its last push (310, 318); a conversation two minutes (367)', () => {
    assert.equal(intervalFor('reaction'), GROUPED_PUSH_INTERVAL_MS);
    assert.equal(intervalFor('message'), 2 * MIN);
    assert.equal(intervalFor('reply'), 0);
    assert.equal(dueTime('reaction', noon + 20 * MIN, { pushedAt: noon }).dueAt, noon + H);
    assert.equal(dueTime('reaction', noon + 90 * MIN, { pushedAt: noon }).dueAt, noon + 90 * MIN);
    assert.equal(dueTime('message', noon + 30 * 1000, { pushedAt: noon }).dueAt, noon + 2 * MIN);
    assert.equal(dueTime('reply', noon + MIN, { pushedAt: noon }).dueAt, noon + MIN, 'one per event: no gate');
  });
  test('a group gated past midnight waits for 08:00', () => {
    const late = at('2026-11-14T23:30:00Z');
    assert.deepEqual(dueTime('reaction', late + 10 * MIN, { pushedAt: late }), { dueAt: at('2026-11-15T08:00:00Z'), held: true });
  });
});

// One reader's world for decide().
const reader = (over = {}) => ({ prefs: {}, legacy: {}, devices: [{ token: TOKEN(1) }], muted: {}, blocked: {}, actorBlocks: {}, dmMuted: false, ...over });
const entry = (kind, t, rid = `${kind}:x`) => ({ uid: A, rid, kind, at: t, dueAt: t });
const one = (kind, t, extra = {}) => ({ kind, actor: B, subject: { slug: 's', commentId: '-c' }, at: t, ...extra });
const group = (kind, t, extra = {}) => ({ kind, subject: { postId: '-p', threadId: '-p' }, count: 2, actorCount: 2, actors: { [B]: 1, [C]: 1 }, recent: [B, C], events: {}, firstAt: t, at: t, ...extra });
const OFF = { foundersOnly: false };

describe('decide()', () => {
  const noon = at('2026-11-14T12:00:00Z');
  test('sends a reply at once', () => {
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader(), noon, {}, OFF).action, 'send');
  });
  test('founders only: anyone else is dropped', () => {
    assert.deepEqual(decide(entry('reply', noon), one('reply', noon), {}, reader(), noon, {}, { foundersOnly: true }), { action: 'drop', reason: 'founders_only' });
  });
  test('gone, no device, switched off', () => {
    assert.equal(decide(entry('reply', noon), null, {}, reader(), noon, {}, OFF).reason, 'gone');
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader({ devices: [] }), noon, {}, OFF).reason, 'no_device');
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader({ prefs: { replies_mentions: false } }), noon, {}, OFF).reason, 'switched_off');
  });
  test('362: the old mention switch off and no value of its own: replies and mentions are off', () => {
    const r = reader({ legacy: { mentionNotifications: false } });
    assert.equal(decide(entry('mention', noon), one('mention', noon), {}, r, noon, {}, OFF).reason, 'switched_off');
    const own = reader({ legacy: { mentionNotifications: false }, prefs: { replies_mentions: true } });
    assert.equal(decide(entry('mention', noon), one('mention', noon), {}, own, noon, {}, OFF).action, 'send', 'its own value wins');
    assert.equal(decide(entry('follow', noon, `follow:${B}`), one('follow', noon), {}, r, noon, {}, OFF).action, 'send', 'other kinds are untouched');
  });
  test('the hourly gate: a second reaction within the hour waits, nothing new is dropped', () => {
    const state = { 'reaction:x': { pushedAt: noon, recAt: noon } };
    assert.deepEqual(decide(entry('reaction', noon + 20 * MIN), group('reaction', noon + 20 * MIN), state, reader(), noon + 20 * MIN, {}, OFF), { action: 'later', dueAt: noon + H });
    assert.equal(decide(entry('reaction', noon + H), group('reaction', noon + 20 * MIN), state, reader(), noon + H, {}, OFF).action, 'send');
    assert.equal(decide(entry('reaction', noon), group('reaction', noon), state, reader(), noon + 5 * MIN, {}, OFF).reason, 'nothing_new');
  });
  test('the quiet hours: held for 08:00, sent then', () => {
    const t = at('2026-11-14T02:00:00Z');
    assert.deepEqual(decide(entry('reply', t), one('reply', t), {}, reader(), t, {}, OFF), { action: 'later', dueAt: at('2026-11-14T08:00:00Z') });
    assert.deepEqual(decide(entry('reply', t), one('reply', t), {}, reader(), at('2026-11-14T08:00:00Z'), {}, OFF), { action: 'send', held: true, dueAt: at('2026-11-14T08:00:00Z') });
  });
  test('stale: more than two hours past its time is dropped, never sent late', () => {
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader(), noon + 2 * H, {}, OFF).action, 'send');
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader(), noon + 2 * H + 1, {}, OFF).reason, 'stale');
  });
  test('re-checked at send time: a block either way, a mute, a muted conversation', () => {
    const rec = one('reply', noon);
    assert.equal(decide(entry('reply', noon), rec, {}, reader({ blocked: { [B]: true } }), noon, {}, OFF).reason, 'silenced');
    assert.equal(decide(entry('reply', noon), rec, {}, reader({ muted: { [B]: true } }), noon, {}, OFF).reason, 'silenced');
    assert.equal(decide(entry('reply', noon), rec, {}, reader({ actorBlocks: { [B]: { [A]: true } } }), noon, {}, OFF).reason, 'silenced');
    const msg = { kind: 'message', subject: { convId: 'c' }, count: 1, actorCount: 1, recent: [B], at: noon };
    assert.equal(decide(entry('message', noon), msg, {}, reader({ dmMuted: true }), noon, {}, OFF).reason, 'silenced');
  });
  test('369: twenty a London day, then dropped; a new day starts over', () => {
    const full = { [DAY_KEY]: { day: '2026-11-14', n: DAILY_CAP, morning: 0 } };
    assert.equal(decide(entry('reply', noon), one('reply', noon), full, reader(), noon, {}, OFF).reason, 'daily_cap');
    const yesterday = { [DAY_KEY]: { day: '2026-11-13', n: DAILY_CAP, morning: 3 } };
    assert.equal(decide(entry('reply', noon), one('reply', noon), yesterday, reader(), noon, {}, OFF).action, 'send');
    assert.equal(decide(entry('reply', noon), one('reply', noon), {}, reader(), noon, { [A]: { n: DAILY_CAP, morning: 0 } }, OFF).reason, 'daily_cap', 'counts within one run too');
  });
  test('366: three held pushes at 08:00, then the rest stay in the list', () => {
    const t = at('2026-11-14T03:00:00Z'), eight = at('2026-11-14T08:00:00Z');
    const three = { [DAY_KEY]: { day: '2026-11-14', n: 3, morning: MORNING_CAP } };
    assert.equal(decide(entry('reply', t), one('reply', t), three, reader(), eight, {}, OFF).reason, 'morning_cap');
    assert.equal(decide(entry('reply', eight + MIN), one('reply', eight + MIN), three, reader(), eight + MIN, {}, OFF).action, 'send', 'a push that was never held is not capped');
  });
  test('nextDay counts the day and the morning, and starts a new day over', () => {
    assert.deepEqual(nextDay({}, at('2026-11-14T08:00:00Z'), 3, 3), { day: '2026-11-14', n: 3, morning: 3 });
    assert.deepEqual(nextDay({ [DAY_KEY]: { day: '2026-11-14', n: 3, morning: 3 } }, at('2026-11-14T09:00:00Z'), 1, 0), { day: '2026-11-14', n: 4, morning: 3 });
    assert.deepEqual(nextDay({ [DAY_KEY]: { day: '2026-11-13', n: 9, morning: 3 } }, at('2026-11-14T09:00:00Z'), 1, 0), { day: '2026-11-14', n: 1, morning: 0 });
  });
});

describe('devices: the newest row speaks for a phone, and only an A60 phone (pushCaps)', () => {
  const now = at('2026-11-14T12:00:00Z');
  const tokens = {
    [A]: { k1: { token: TOKEN(1), platform: 'ios', appVersion: '1.7.1', updatedAt: now - D, pushCaps: 1 }, k2: { token: TOKEN(2), platform: 'ios', appVersion: '1.7.1', updatedAt: now, pushCaps: 1 }, k3: { token: TOKEN(3), platform: 'android', appVersion: '1.7.1', updatedAt: now } },
    [B]: { k1: { token: TOKEN(1), platform: 'ios', appVersion: '1.7.1', updatedAt: now - H, pushCaps: 1 } },
  };
  test('a phone signed into two accounts belongs to the newer one', () => {
    assert.deepEqual(devicesFor(A, tokens).map((d) => d.token), [TOKEN(2)]);
    assert.deepEqual(devicesFor(B, tokens).map((d) => d.token), [TOKEN(1)]);
  });
  test('no pushCaps, no personal push (an older app on the same native version)', () => {
    assert.ok(!devicesFor(A, tokens).some((d) => d.token === TOKEN(3)));
  });
  test('a dead device comes off every account that holds it', () => {
    assert.deepEqual(rowsHolding([TOKEN(1)], tokens).sort((a, b) => (a.uid < b.uid ? -1 : 1)), [{ uid: A, tokenKey: 'k1' }, { uid: B, tokenKey: 'k1' }].sort((a, b) => (a.uid < b.uid ? -1 : 1)));
  });
});

describe('the switches (359, 362)', () => {
  test('359: Stories is on only when neither field is off; switching writes both', () => {
    assert.equal(prefOn('stories', {}, {}), true);
    assert.equal(prefOn('stories', { stories: true }, { storyNotifications: false }), false);
    assert.equal(prefOn('stories', { stories: false }, { storyNotifications: true }), false);
    assert.deepEqual(prefWrites(A, 'stories', true), { [`notify_prefs/${A}/stories`]: true, [`users/${A}/storyNotifications`]: true });
    assert.deepEqual(prefWrites(A, 'messages', false), { [`notify_prefs/${A}/messages`]: false });
  });
  test('362: replies and mentions read the old field only without a value of their own', () => {
    assert.equal(prefOn('replies_mentions', {}, { mentionNotifications: false }), false);
    assert.equal(prefOn('replies_mentions', { replies_mentions: true }, { mentionNotifications: false }), true);
    assert.equal(prefOn('replies_mentions', {}, {}), true);
    assert.equal(kindAllowed('quote', {}, { mentionNotifications: false }), false);
    assert.equal(kindAllowed('message', {}, { mentionNotifications: false }), true);
  });
  test('defaults: every personal switch on', () => {
    for (const k of ['replies_mentions', 'messages', 'followers', 'reactions', 'responses']) assert.equal(prefOn(k, null, {}), true, k);
  });
});

describe('the queue: one entry per reader and record; a finished entry is cleared, a rewritten one is new', () => {
  test('keys and claims', () => {
    assert.equal(queueKey(A, 'reaction:sq:-p'), `${A}~reaction:sq:-p`);
    assert.equal(finishedWith({ at: 5, state: 'sending', claimedFor: 5 }), true);
    assert.equal(finishedWith({ at: 9, state: 'sending', claimedFor: 5 }), false, 'notify rewrote it since');
    assert.equal(finishedWith({ at: 5 }), false);
  });
});

describe('the words: the row, exactly (365), through the bell', () => {
  const users = { [B]: { displayName: 'Ben Invented' }, [C]: { displayName: 'Cal Invented' } };
  const now = at('2026-11-14T12:00:00Z');
  test('a message names the sender, never the words; "sent you 3 messages" (367)', () => {
    const rec = { kind: 'message', subject: { convId: `${A}_${B}` }, count: 3, actorCount: 1, actors: { [B]: 3 }, recent: [B], at: now };
    const w = pushWords(rowFor('message:c', rec), { users });
    assert.equal(w.body, 'Ben Invented sent you 3 messages');
    assert.equal(w.title, undefined);
    assert.equal(w.channelId, 'people');
    assert.ok(w.url.startsWith('/square?dm='));
  });
  test('two reactors are both named (340), the story title is the second line', () => {
    const rec = { kind: 'reaction', subject: { slug: 'a-story', commentId: '-c' }, count: 2, actorCount: 2, recent: [B, C], at: now };
    const row = rowFor('reaction:c:a-story:-c', rec);
    assert.deepEqual(needs(row, rec).users, [B, C]);
    const w = pushWords(row, { users, stories: { 'a-story': { title: 'An Invented Story' } } });
    assert.equal(w.title, 'Ben Invented and Cal Invented liked your response');
    assert.equal(w.body, 'on An Invented Story');
  });
  test('a reply quotes the words its row quotes; the money guard drops a priced line', () => {
    const rec = { kind: 'reply', actor: B, subject: { postId: '-p2', threadId: '-p1', to: 'you' }, at: now };
    const row = rowFor('reply:sq:-p2', rec);
    assert.equal(needs(row, rec).post, '-p2');
    const w = pushWords(row, { users, posts: { '-p2': { text: 'What a line.' } } });
    assert.equal(w.title, 'Ben Invented replied to you');
    assert.equal(w.body, '“What a line.”');
    assert.equal(w.url, '/square/p?id=-p1&reply=-p2');
    const priced = pushWords(row, { users, posts: { '-p2': { text: 'It cost me ₦2,200 in the book store' } } });
    assert.equal(priced.title, undefined);
    assert.equal(priced.body, 'Ben Invented replied to you');
    assert.equal(priced.dropped, 'money_guard');
  });
  test('responses on your story go to your_writing with the bell\'s words', () => {
    const rec = { kind: 'response', subject: { slug: 'a-story' }, count: 2, actorCount: 2, recent: [B, C], at: now };
    const w = pushWords(rowFor('response:a-story', rec), { users, stories: { 'a-story': { title: 'An Invented Story' } } });
    assert.equal(w.title, '2 new responses on your story');
    assert.equal(w.body, 'An Invented Story');
    assert.equal(w.channelId, 'your_writing');
  });
  test('a follow opens the follower; a row with no href opens the list', () => {
    const w = pushWords(rowFor(`follow:${B}`, { kind: 'follow', subject: { uid: B }, count: 1, actorCount: 1, recent: [B], at: now }), { users });
    assert.equal(w.body, 'Ben Invented started following you');
    assert.equal(w.url, `/user?id=${B}`);
    assert.equal(FALLBACK_URL, '/notifications');
  });
  test('namedActors: one actor, or two when the row names two', () => {
    assert.deepEqual(namedActors({ actor: B }), [B]);
    assert.deepEqual(namedActors({ recent: [B, C, A], actorCount: 3 }), [B]);
    assert.deepEqual(namedActors({ recent: [B, C], actorCount: 2 }), [B, C]);
  });
});

describe('the badge: the bell\'s own unread count', () => {
  const now = at('2026-11-14T12:00:00Z');
  test('records and announcements after seenAt, without the muted and blocked; none without a seenAt', () => {
    const inbox = {
      'reply:a': { kind: 'reply', actor: B, subject: { slug: 's', commentId: '-1' }, at: now },
      'reply:b': { kind: 'reply', actor: C, subject: { slug: 's', commentId: '-2' }, at: now - MIN },
      'reply:old': { kind: 'reply', actor: B, subject: { slug: 's', commentId: '-3' }, at: now - D },
    };
    const announcements = { story_x: { kind: 'story', id: 'x', at: now - 2 * MIN } };
    assert.equal(badgeFor({ inbox, announcements, seenAt: now - H }), 3);
    assert.equal(badgeFor({ inbox, announcements, muted: { [C]: true }, seenAt: now - H }), 2);
    assert.equal(badgeFor({ inbox, announcements, seenAt: null }), null);
  });
});

describe('notificationKinds still says what P4 builds', () => {
  test('each pushing kind\'s push mode', () => {
    for (const k of ['reply', 'mention', 'quote', 'message', 'follow']) assert.equal(INBOX_KINDS[k].push, PUSH.AT_ONCE, k);
    for (const k of ['reaction', 'response', 'story_reaction']) assert.equal(INBOX_KINDS[k].push, PUSH.GROUPED_HOURLY, k);
  });
});
