// NOTIF-B2 — the one list as data (app/lib/bell.js), and the source facts the browser suite can't
// see cheaply: every web writer goes through /api/notify after its event and writes no old note;
// nothing writes the followers' "posted" note; the header places the bell; the Square's bell and the
// Profile page open the one list; the settings screen's switches are exactly notify_prefs.
//
//   node --test tests/ci/notif-b2-bell.test.mjs      (npm run test:ci)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildList, isUnread, unreadCount, badgeText, BADGE_CAP, ariaLabel, timeLabel, sectionOf, sections, headline, fromInbox, READ_LIMITS,
} from '../../app/lib/bell.js';
import { PREFS } from '../../app/lib/notificationKinds.js';
import { SETTINGS_CARDS } from '../../app/lib/notifySettings.js';

const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const T = Date.parse('2026-11-04T12:00:00Z');
const H = 3600000, D = 86400000;

describe('each event once', () => {
  test('an old note the server mirrored (nid) is not shown; its inbox record is', () => {
    const list = buildList({
      inbox: { 'reply:s:c2': { kind: 'reply', actor: 'ada', subject: { slug: 's', commentId: 'c2' }, at: T } },
      library: { 'nb2:reply:s:c2': { type: 'reply', fromUid: 'ada', slug: 's', read: false, createdAt: T, nid: 'reply:s:c2' } },
    });
    assert.deepEqual(list.map((r) => r.key), ['inbox:reply:s:c2']);
  });

  test('new stories: the announcement once; the old per-follower copy only when there is no announcement, once', () => {
    const list = buildList({
      announcements: { story_a: { kind: 'story', id: 'a', authorUid: 'w', at: T } },
      library: {
        n1: { type: 'new_story', fromUid: 'w', storySlug: 'a', createdAt: T - 1, read: false },
        n2: { type: 'new_story', fromUid: 'w', storySlug: 'b', createdAt: T - 2, read: false },
        n3: { type: 'new_story', fromUid: 'w', storySlug: 'b', createdAt: T - 3, read: false },
      },
    }, { followed: { w: true } });
    assert.deepEqual(list.map((r) => [r.source, r.slug]), [['announcement', 'a'], ['library_notifications', 'b']]);
    assert.ok(list.every((r) => r.fromFollowed), 'FROM A WRITER YOU FOLLOW (323)');
  });

  test('ruling 323 comes from the reader\'s own following list', () => {
    const a = { story_a: { kind: 'story', id: 'a', authorUid: 'w', at: T } };
    assert.equal(buildList({ announcements: a }, { followed: {} })[0].fromFollowed, false);
    assert.equal(buildList({ announcements: a }, { followed: { w: true } })[0].fromFollowed, true);
  });

  test('ruling 320: an old `square_post` note is never shown, in either old node, whoever wrote it', () => {
    assert.deepEqual(buildList({ square: { n: { type: 'square_post', fromUid: 'x', postId: 'p', createdAt: T } } }), []);
    assert.deepEqual(buildList({ library: { n: { type: 'square_post', fromUid: 'x', postId: 'p', createdAt: T, read: false } } }), []);
  });

  test('blocked or muted senders are absent from every source', () => {
    const hidden = new Set(['bad']);
    const list = buildList({
      inbox: { r: { kind: 'reply', actor: 'bad', subject: { postId: 'p', threadId: 'p' }, at: T }, g: { kind: 'reaction', recent: ['ok', 'bad'], actorCount: 2, count: 2, subject: { postId: 'p' }, at: T } },
      library: { l: { type: 'follow', fromUid: 'bad', createdAt: T } },
      square: { s: { type: 'mention', fromUid: 'bad', postId: 'p', createdAt: T } },
      announcements: { story_x: { kind: 'story', id: 'x', authorUid: 'bad', at: T } },
    }, { hidden });
    assert.deepEqual(list, []);
  });

  test('newest first across the four sources', () => {
    const list = buildList({
      inbox: { a: { kind: 'follow', actor: 'u', subject: { uid: 'u' }, at: T - 3 * H, recent: ['u'], actorCount: 1, count: 1 } },
      announcements: { story_s: { kind: 'story', id: 's', at: T - H } },
      library: { b: { type: 'reward', fromName: 'Calvary Scribblings', message: 'm', createdAt: T - 2 * H, read: false } },
      square: { c: { type: 'mention', fromUid: 'v', postId: 'p', createdAt: T } },
    });
    assert.deepEqual(list.map((r) => r.source), ['notifications', 'announcement', 'library_notifications', 'inbox']);
  });
});

describe('the count (ruling 326)', () => {
  const list = buildList({
    inbox: { a: { kind: 'follow', actor: 'u', subject: { uid: 'u' }, at: T, recent: ['u'], actorCount: 1, count: 1 } },
    library: { b: { type: 'reply', fromUid: 'v', slug: 's', createdAt: T - D, read: true }, c: { type: 'reply', fromUid: 'v', slug: 's', createdAt: T - 2 * D, read: false } },
  });
  test('after a seenAt: what arrived since', () => {
    assert.equal(unreadCount(list, T - H, 0), 1);
    assert.equal(unreadCount(list, T + 1, 0), 0);
  });
  test('before any seenAt: an old note by its own read flag, anything new since joining', () => {
    assert.equal(unreadCount(list, null, T - 10 * D), 2);
    assert.equal(isUnread(list[0], null, T + 1), false, 'not before they joined');
  });
  test('the badge: nothing at zero, the number, 99+ above 99; the label', () => {
    assert.equal(badgeText(0), null);
    assert.equal(badgeText(3), '3');
    assert.equal(badgeText(99), '99');
    assert.equal(badgeText(100), '99+');
    assert.equal(ariaLabel(3), 'Notifications, 3 unread');
    assert.equal(ariaLabel(0), 'Notifications, 0 unread');
  });
});

describe('time and sections, on London\'s clock', () => {
  test('"12m", "1h", a weekday, "28 Oct"', () => {
    assert.equal(timeLabel(T - 12 * 60000, T), '12m');
    assert.equal(timeLabel(T - H, T), '1h');
    assert.equal(timeLabel(T - 2 * D, T), 'Mon');
    assert.equal(timeLabel(Date.parse('2026-10-28T10:00:00Z'), T), '28 Oct');
  });
  test('TODAY, THIS WEEK, EARLIER', () => {
    assert.equal(sectionOf(T - H, T), 'TODAY');
    assert.equal(sectionOf(T - 2 * D, T), 'THIS WEEK');
    assert.equal(sectionOf(T - 9 * D, T), 'EARLIER');
    assert.deepEqual(sections([{ at: T }, { at: T - 9 * D }], T).map((s) => s.label), ['TODAY', 'EARLIER']);
  });
});

describe('the words', () => {
  test('grouped reactions: "Ada Obi and 4 others liked your response"', () => {
    const r = fromInbox('g', { kind: 'reaction', recent: ['a', 'b', 'c'], actorCount: 5, count: 6, subject: { slug: 's', commentId: 'c' }, at: T });
    const parts = headline(r, { a: { displayName: 'Ada Obi' } });
    assert.equal(parts.map((p) => p.name || p.text).join(''), 'Ada Obi and 4 others liked your response');
  });
  test('an unknown inbox kind is dropped, never drawn as something else', () => {
    assert.equal(fromInbox('x', { kind: 'nonsense', at: T }), null);
  });
});

describe('every read is bounded', () => {
  test('the hook reads each source with a limit, and never a whole node', () => {
    const s = code('app/lib/useBell.js');
    for (const [path, lim] of [['inbox/${uid}', 'inbox'], ['announcements', 'announcements'], ['library_notifications/${uid}', 'library'], ['notifications/${uid}', 'square'], ['following/${uid}', 'following']]) {
      const re = new RegExp(`ref\\(db, [\`']${path.replace(/[$/{}]/g, (c) => `\\${c}`)}[\`']\\)[^\\n]*limitTo(Last|First)\\(READ_LIMITS\\.${lim}\\)`);
      assert.match(s, re, path);
    }
    assert.ok(Object.values(READ_LIMITS).every((n) => n > 0 && n <= 1000));
    for (const k of ['inbox', 'library', 'square']) assert.ok(READ_LIMITS[k] > BADGE_CAP, `${k}: a window past the badge's ceiling, so "99+" is reachable`);
  });
  test('the rules index what the hook orders by', () => {
    const r = JSON.parse(src('database.rules.json')).rules;
    assert.deepEqual(r.inbox.$uid['.indexOn'], ['at']);
    assert.deepEqual(r.announcements['.indexOn'], ['at']);
    assert.deepEqual(r.library_notifications.$uid['.indexOn'], ['createdAt']);
    assert.deepEqual(r.notifications.$uid['.indexOn'], ['createdAt']);
  });
});

describe('the writers moved to /api/notify (item 3)', () => {
  const WRITERS = {
    'app/stories/[slug]/page-client.js': ["notifyEvent(user, 'comment_reaction'", "notifyEvent(user, 'comment'"],
    'app/reader/[slug]/page-reader.js': ["notifyEvent(user, 'comment_reaction'", "notifyEvent(user, 'comment'"],
    'app/user/page.js': ["notifyEvent(currentUser, 'follow'"],
    'app/square/page.js': ["notifyEvent(user, 'square_post'", "notifyEvent(user, 'square_reaction'"],
    'app/square/p/page.js': ["notifyEvent(user, 'square_post'", "notifyEvent(user, 'square_reaction'"],
    'app/open-pages/[id]/page-client.js': ["notifyEvent(user, 'open_pages_reply'"],
    'app/components/square/MessagesPanel.js': ["notifyEvent(user, 'message'"],
  };
  for (const [f, calls] of Object.entries(WRITERS)) {
    test(`${f}: calls /api/notify, never awaited, and writes no old note itself`, () => {
      const s = code(f);
      for (const c of calls) assert.ok(src(f).includes(c), c);
      assert.doesNotMatch(s, /await\s+notifyEvent/, 'fire and forget');
      // The only old-node writes left on the web are a reader's own reward (to themselves).
      const pushes = [...s.matchAll(/push\(ref\(db, `(library_notifications|notifications)\/\$\{([^}]+)\}`\)/g)].map((m) => m[2]);
      assert.ok(pushes.every((who) => who === 'user.uid' || who === 'uid'), `${f} pushes an old note to ${pushes.join(', ')}`);
    });
  }
  test('ruling 320: nothing on the web writes the followers\' `square_post` note', () => {
    for (const f of ['app/square/page.js', 'app/square/p/page.js']) assert.doesNotMatch(code(f), /type: 'square_post'/);
  });
  test('brief item 2: both publish paths still write the per-follower `new_story` copies the app\'s Home bell reads', () => {
    const cms = code('app/admin/page.js');
    assert.match(cms, /pushNotif\(ref\(db, `library_notifications\/\$\{fid\}`\), \{\s*type: 'new_story'/);
    const reconciler = code('scripts/covers/on-publish.mjs');
    assert.match(reconciler, /updates\[`library_notifications\/\$\{fid\}\/\$\{pushId\(\)\}`\] = \{\s*type: 'new_story'/);
  });
  test('the old client-side mention writer is gone', () => {
    assert.doesNotMatch(code('app/lib/mentions.js'), /export async function notifyMentions/);
  });
});

describe('one list, one count (rulings 305, 325, 327)', () => {
  test('the header: the panel bell left of the avatar; the page bell left of the menu', () => {
    const s = code('app/components/Navbar.js');
    const desk = s.indexOf('<Bell user={user} mode="panel"');
    const avatar = s.indexOf('className="cs-nav-avatar"');
    const phone = s.indexOf('<Bell user={user} mode="page" phone');
    const menu = s.indexOf('className="cs-hamburger" onClick');
    assert.ok(desk > 0 && desk < avatar, 'desk bell before the avatar');
    assert.ok(phone > 0 && phone < menu, 'phone bell before the menu button');
    assert.match(s, /\{user \? <span className="cs-bell-desk">/, 'signed-in only');
  });
  test('the Square keeps its bell, and it is the same Bell (panel on iPad/desktop, page on a phone)', () => {
    const s = code('app/square/page.js');
    assert.match(s, /<Bell user=\{user\} mode="auto"/);
    assert.doesNotMatch(s, /function NotificationsPanel/);
    assert.doesNotMatch(s, /onValue\(ref\(db, `notifications\//, 'no second count');
  });
  test('the Profile page\'s panel is a link to /notifications, with the one count', () => {
    const s = code('app/profile/page.js');
    assert.match(s, /<a href="\/notifications" data-profile-bell/);
    assert.match(s, /useBell\(bellUser\)/);
    assert.doesNotMatch(s, /library_notifications/);
  });
});

describe('settings (ruling 312)', () => {
  test('every switch is a notify_prefs key, each once, and the Square starts off', () => {
    const keys = SETTINGS_CARDS.flatMap((c) => c.rows.map((r) => r.key));
    assert.deepEqual([...keys].sort(), Object.keys(PREFS).sort());
    assert.equal(PREFS.square_opens.default, false);
    assert.deepEqual(SETTINGS_CARDS.map((c) => c.heading), ['STORIES', 'PEOPLE', 'YOUR WRITING', 'THE SQUARE']);
    assert.equal(SETTINGS_CARDS.find((c) => c.heading === 'YOUR WRITING').writersOnly, true);
  });
});
