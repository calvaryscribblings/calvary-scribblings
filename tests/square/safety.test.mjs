// W53 — Mute and Block, the reader card's words, and rulings 206 and 207, without a browser.
//
//   npm run test:square
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { SAFETY_COPY, hiddenUids, readingSince, joinedAt, unreadShown, otherInConversation, isPermissionDenied } from '../../app/lib/squareSafety.js';
import { buildThread, latestReply, THREAD_COPY } from '../../app/lib/squareThreads.js';
import PostBody from '../../app/components/conversation/PostBody.js';
import { SURFACES } from '../../app/lib/squarePostBody.js';

describe('the lists', () => {
  test('hidden = muted ∪ blocked', () => {
    assert.deepEqual([...hiddenUids({ a: true }, { b: true, a: true })].sort(), ['a', 'b']);
    assert.equal(hiddenUids(null, undefined).size, 0);
  });
  test('the other reader in a conversation id', () => {
    assert.equal(otherInConversation('aaa_bbb', 'aaa'), 'bbb');
    assert.equal(otherInConversation('aaa_bbb', 'bbb'), 'aaa');
  });
  test('a refusal by the rules is told apart from a network failure', () => {
    assert.equal(isPermissionDenied({ code: 'PERMISSION_DENIED' }), true);
    assert.equal(isPermissionDenied(new Error('PERMISSION_DENIED: Permission denied')), true);
    assert.equal(isPermissionDenied(new Error('network error')), false);
  });
});

describe('the reader card', () => {
  test('the words, as ruled', () => {
    assert.equal(SAFETY_COPY.mute, 'Mute in the Square');
    assert.equal(SAFETY_COPY.muteHint, 'Their posts stop showing for you. They won’t know.');
    assert.equal(SAFETY_COPY.block('ada'), 'Block @ada');
    assert.equal(SAFETY_COPY.blockHint, 'They can’t message you, and their posts leave your Square.');
    assert.equal(SAFETY_COPY.unmute, 'Unmute');
    assert.equal(SAFETY_COPY.unblock('ada'), 'Unblock @ada');
    assert.equal(SAFETY_COPY.cantMessage, 'You can’t message this reader.');
    assert.equal(SAFETY_COPY.youBlocked('ada'), 'You’ve blocked @ada.');
    assert.equal(SAFETY_COPY.reportMessage, 'Report a message');
    assert.equal(SAFETY_COPY.reportMessageHint, 'Pick the message. A moderator sees only that one.');
    assert.equal(SAFETY_COPY.reported, 'Reported. A moderator sees only this message.');
  });
  test('W55.1 — " · reading since {Month}": joinDate, then createdAt, else nothing', () => {
    const mar = Date.UTC(2026, 2, 14), jun = Date.UTC(2025, 5, 2);
    assert.equal(readingSince({ joinDate: mar }), ' · reading since March 2026');
    assert.equal(readingSince({ createdAt: jun }), ' · reading since June 2025');
    assert.equal(readingSince({ joinDate: mar, createdAt: jun }), ' · reading since March 2026');   // joinDate wins
    assert.equal(readingSince({ joinDate: String(mar) }), ' · reading since March 2026');
    assert.equal(readingSince({ joinDate: '2026-03-14T10:00:00Z' }), ' · reading since March 2026');
    assert.equal(readingSince({ joinDate: 'garbage', createdAt: jun }), ' · reading since June 2025');  // unusable joinDate: createdAt
    for (const r of [undefined, null, {}, { joinDate: null, createdAt: null }, { joinDate: 0 }, { joinDate: 1 }, { joinDate: 'x' },
      { joinDate: NaN }, { joinDate: 1e17 }, { joinDate: {} }, { createdAt: true }]) {
      assert.equal(readingSince(r), '', JSON.stringify(r));
    }
    assert.equal(joinedAt({ joinDate: mar }), mar);
  });
  test('W55.1 — a date the formatter rejects leaves the line out rather than throwing', () => {
    const real = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = () => { throw new RangeError('no'); };
    try { assert.equal(readingSince({ joinDate: Date.UTC(2026, 2, 14) }), ''); } finally { Date.prototype.toLocaleDateString = real; }
  });
  test('W55.1 / ruling 218 — a muted conversation counts no unread', () => {
    const conv = { convId: 'a_b', unread: 3 };
    assert.equal(unreadShown(conv, {}), 3);
    assert.equal(unreadShown(conv, { a_b: true }), 0);
    assert.equal(unreadShown(conv, { a_c: true }), 3);
    assert.equal(unreadShown({ convId: 'a_b', unread: 'x' }, {}), 0);
    assert.equal(unreadShown(null, {}), 0);
  });
  test('W55.1 — the sheet\'s words (ruling 217) and the report heading (220)', () => {
    assert.equal(SAFETY_COPY.viewProfile, 'View profile');
    assert.equal(SAFETY_COPY.muteConversation, 'Mute this conversation');
    assert.equal(SAFETY_COPY.unmuteConversation, 'Unmute this conversation');
    assert.equal(SAFETY_COPY.cancel, 'Cancel');
    assert.equal(SAFETY_COPY.reportHeading.toUpperCase(), 'THE MESSAGE A MODERATOR WILL SEE');
  });
  test('W55.1 — the messages list never draws a raw unread count', () => {
    const src = readFileSync(new URL('../../app/components/square/MessagesPanel.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /conv\.unread\b/);
  });
});

describe('ruling 207 — a hidden reader\'s replies', () => {
  let t = 0;
  const r = (id, over = {}) => ({ id, parentId: 'R', authorUid: `u-${id}`, createdAt: (t += 10), ...over });
  test('leave the thread unless replies you can see hang beneath them; never counted', () => {
    t = 0;
    const muted = r('m', { authorUid: 'MUTED' });
    const under = r('k', { replyToId: 'm' });
    const lone = r('l', { authorUid: 'MUTED' });
    const nested = r('n', { replyToId: 'k', authorUid: 'MUTED' });
    const { groups, count } = buildThread([muted, under, lone, nested], { hidden: new Set(['MUTED']) });
    assert.deepEqual(groups.map((g) => g.top.id), ['m']);
    assert.deepEqual(groups[0].nested.map((x) => x.id), ['k']);
    assert.equal(count, 1);
    assert.equal(THREAD_COPY.hiddenReply, 'A reply you’ve hidden.');
  });
  test('without the list, the same thread is whole', () => {
    t = 0;
    const { count } = buildThread([r('a', { authorUid: 'MUTED' }), r('b')]);
    assert.equal(count, 2);
  });
  test('the feed\'s latest line skips them', () => {
    t = 0;
    const a = r('a'), b = r('b', { authorUid: 'MUTED' });
    assert.equal(latestReply([a, b], new Set(['MUTED'])).id, 'a');
  });
});

describe('ruling 206 — who removed a post', () => {
  const html = (surface, removedBy) => renderToStaticMarkup(createElement(PostBody, { text: '', surface, withdrawn: true, removedBy }));
  test('a moderator\'s removal reads "This post was removed."', () => {
    for (const s of ['feed-post', 'permalink', 'quoted-card', 'closed-preview', 'profile-own', 'profile-other']) {
      assert.match(html(s, 'moderator'), /This post was removed\./, s);
    }
  });
  test('the author\'s, and every older record with no removedBy, keeps "The author withdrew this post."', () => {
    for (const s of ['feed-post', 'permalink']) {
      assert.match(html(s, 'author'), /The author withdrew this post\./, s);
      assert.match(html(s, undefined), /The author withdrew this post\./, s);
    }
  });
  test('the draw sites pass removedBy', () => {
    const feed = readFileSync(new URL('../../app/square/page.js', import.meta.url), 'utf8');
    const thread = readFileSync(new URL('../../app/square/p/page.js', import.meta.url), 'utf8');
    assert.match(feed, /surface="feed-post" withdrawn=\{p\.withdrawn === true\} deleted=\{isTombstone\(p\)\} removedBy=\{p\.removedBy\}/);
    assert.match(thread, /surface="permalink"[^>]*removedBy=\{root\.removedBy\}/);
    assert.ok(SURFACES['feed-post'].removedNote);
  });
});

describe('ruling 204 — switching who you reply to keeps what is typed', () => {
  test('answer() only changes who is answered; no prefill is written into the box', () => {
    const thread = readFileSync(new URL('../../app/square/p/page.js', import.meta.url), 'utf8');
    const body = thread.slice(thread.indexOf('const answer = (r) => {'), thread.indexOf('};', thread.indexOf('const answer = (r) => {')));
    assert.doesNotMatch(body, /setBox|setText|replyPrefill/);
    assert.doesNotMatch(thread, /replyPrefill/);
  });
});
