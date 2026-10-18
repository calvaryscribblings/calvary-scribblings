// W53 — Mute and Block, the reader card's words, and rulings 206 and 207, without a browser.
//
//   npm run test:square
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { SAFETY_COPY, hiddenUids, readingSince, otherInConversation, isPermissionDenied } from '../../app/lib/squareSafety.js';
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
  test('" · reading since {Month}" only when the record has a join date', () => {
    assert.equal(readingSince(Date.UTC(2026, 2, 14)), ' · reading since March 2026');
    for (const v of [undefined, null, 0, 1, 'x', NaN]) assert.equal(readingSince(v), '', String(v));
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
