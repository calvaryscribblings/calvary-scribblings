// W19 / RULING 47 (Ikenna, 27 Sep 2026) — A LINK TO A DELETED OPEN PAGES PIECE.
//
// It shows exactly "This piece was deleted.": on the piece's own page, on the site 404 its address
// lands on once a rebuild has taken the page away, and on every Square surface that draws the
// announcement quoting it. No link, no byline. Lists leave the piece out (they read open_pages,
// where it no longer is). The Square's post body and card are rendered for real (no JSX in them);
// the two JSX pages are held by source guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PostBody from '../../app/components/conversation/PostBody.js';
import AttachmentCard from '../../app/components/conversation/AttachmentCard.js';
import { attachmentOf, SURFACE_KEYS } from '../../app/lib/squarePostBody.js';
import { buildAnnouncement } from '../../app/lib/openPagesAnnounce.js';
import { rememberPiece } from '../../app/lib/pieceGone.js';
import {
  DELETED_PIECE, PIECE_ID_RE, PIECE_PATH_RE, pieceIdFromPath, announcedPieceOf,
} from '../../app/lib/deletedContent.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, '');

const GONE = '-Oxgonegonegonegone1';
const LIVE = '-Oxlivelivelivelive1';
rememberPiece(GONE, true);
rememberPiece(LIVE, false);
const announcement = (id) => buildAnnouncement({ authorUid: 'u', authorName: 'A Writer' }, {}, { title: 'The Title Of The Piece', postId: id, now: 1 });

test('ruling 47: the words, exactly', () => {
  assert.equal(DELETED_PIECE, 'This piece was deleted.');
});

test('a piece address is a push id; the build placeholder and mangled ids are not', () => {
  assert.equal(pieceIdFromPath(`/open-pages/${GONE}`), GONE);
  assert.equal(pieceIdFromPath(`/open-pages/${GONE}/`), GONE);
  for (const p of ['/open-pages/none', '/open-pages/new', '/open-pages/drafts', `/open-pages/edit/${GONE}`, '/open-pages/-short', `/stories/${GONE}`]) {
    assert.equal(pieceIdFromPath(p), null, p);
  }
  assert.ok(PIECE_ID_RE.test(GONE) && !PIECE_ID_RE.test('none'));
});

test('every Square surface: an announcement of a deleted piece draws only the ruled line', () => {
  const post = announcement(GONE);
  assert.equal(announcedPieceOf(post), GONE);
  for (const surface of SURFACE_KEYS) {
    const html = renderToStaticMarkup(createElement(PostBody, { text: post.text, surface, piece: announcedPieceOf(post) }));
    assert.equal(text(html), DELETED_PIECE, surface);
    assert.ok(!html.includes('The Title Of The Piece'), `${surface} still quotes the title`);
    assert.ok(!html.includes('<a'), `${surface} links`);
  }
});

test('the announcement card of a deleted piece is gone; a live piece keeps its card and words', () => {
  assert.equal(renderToStaticMarkup(createElement(AttachmentCard, { attachment: attachmentOf(announcement(GONE)) })), '');
  const live = announcement(LIVE);
  assert.match(renderToStaticMarkup(createElement(AttachmentCard, { attachment: attachmentOf(live) })), /The Title Of The Piece/);
  assert.match(renderToStaticMarkup(createElement(PostBody, { text: live.text, surface: 'feed-post', piece: LIVE })), /The Title Of The Piece/);
});

test('a surface never claims a deletion it has not seen: an unread piece draws normally', () => {
  const unread = '-Oxunreadunreadunrea';
  const html = renderToStaticMarkup(createElement(PostBody, { text: announcement(unread).text, surface: 'feed-post', piece: unread }));
  assert.match(html, /The Title Of The Piece/);
});

test('every draw site passes the announced piece to PostBody (the DM bubble carries no attachment)', () => {
  const sites = ['app/square/page.js', 'app/square/p/page.js', 'app/profile/page.js', 'app/user/page.js'];
  let n = 0;
  for (const f of sites) {
    for (const m of read(f).matchAll(/<PostBody [^>]*surface="([a-z-]+)"[^>]*\/>/g)) {
      if (m[1] === 'dm-bubble') continue;
      n++;
      assert.match(m[0], /piece=\{announcedPieceOf\(/, `${f} ${m[1]}`);
    }
  }
  assert.equal(n, 7);
});

test('the piece page: the deleted state shows exactly the line, only when the database answered "no piece"', () => {
  const src = read('app/open-pages/[id]/page-client.js');
  assert.match(src, /if \(!snap\.exists\(\) && PIECE_ID_RE\.test\(id\)\) setPieceGone\(true\);/);
  const branch = src.slice(src.indexOf('if (post === null && pieceGone)'), src.indexOf('// ---- Not found ----'));
  assert.match(branch, /\{DELETED_PIECE\}/);
  assert.ok(!/<a |<Link |href=|author/i.test(branch), 'the line has no link and no byline');
  assert.match(branch, /fontStyle: 'italic', fontFamily: SERIF/, 'drawn like the page\'s empty-state note');
});

test('the site 404: a piece-shaped address that the database says is empty shows exactly the line', () => {
  const src = read('app/components/NotFoundPage.js');
  assert.match(src, /pieceIdFromPath\(window\.location\.pathname\)/);
  assert.match(src, /pieceGone\(id\)/);
  assert.match(src, /\{deletedPiece \? \(/);
  const branch = src.slice(src.indexOf('{deletedPiece ? ('), src.indexOf(') : ('));
  assert.match(branch, /\{DELETED_PIECE\}/);
  assert.ok(!/<a |<Link |href=/.test(branch));
  // The ordinary words are held back before first paint on a piece address, so they never flash.
  assert.match(src, /\$\{PIECE_PATH_RE\}\.test\(location\.pathname\)/);
  assert.match(src, /html\[data-piece-path\] \[data-nf-general\]\{visibility:hidden\}/);
  assert.ok(PIECE_PATH_RE.test(`/open-pages/${GONE}`));
});

test('removing a piece summons the rebuild that takes its baked title and excerpt away', () => {
  const forum = read('app/admin/forum/page.jsx');
  const remove = forum.slice(forum.indexOf('async function removePost'), forum.indexOf('async function dismissReports'));
  assert.match(remove, /fireRebuild\(\{ hook: HOOKS\.OPEN_PAGES/);
  const scrub = read('scripts/account/scrub.mjs');
  assert.match(scrub, /else if \(plan\.counts\.openPages && rebuild\)/);
});
