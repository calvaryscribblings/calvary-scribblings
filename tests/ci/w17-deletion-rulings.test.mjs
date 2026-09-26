// W17 — rulings 29–34 on the account-deletion plan, pinned where they are drawn and where they are
// recorded. The scrub itself is proven in tests/account/deletion.test.mjs (pure) and
// tests/account/deletion.emulator.test.mjs (both halves against the database emulator).
//
//   node --test tests/ci/w17-deletion-rulings.test.mjs      (part of npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PostBody from '../../app/components/conversation/PostBody.js';
import { SURFACES } from '../../app/lib/squarePostBody.js';
import { DELETED_RESPONSE, DELETED_POST, isTombstone } from '../../app/lib/deletedContent.js';
import { countNodes } from '../../app/lib/openPagesThread.js';

const src = (p) => readFileSync(p, 'utf8');

describe('ruling 30 · the words', () => {
  test('"This response was deleted." and "This post was deleted." — ruled, word for word', () => {
    assert.equal(DELETED_RESPONSE, 'This response was deleted.');
    assert.equal(DELETED_POST, 'This post was deleted.');
  });
  test('a tombstone is { deleted: true }, nothing looser', () => {
    assert.equal(isTombstone({ deleted: true }), true);
    for (const x of [null, {}, { deleted: 'true' }, { deleted: 1 }, { withdrawn: true }]) assert.equal(isTombstone(x), false);
  });
});

describe('ruling 30 · every thread surface draws the tombstone', () => {
  test('PostBody: every Square surface draws "This post was deleted." and never the stored words', () => {
    for (const surface of Object.keys(SURFACES)) {
      const html = renderToStaticMarkup(createElement(PostBody, { text: 'their words', surface, deleted: true }));
      assert.match(html, /This post was deleted\./, surface);
      assert.doesNotMatch(html, /their words/, surface);
      assert.match(html, /data-deleted="true"/, surface);
    }
  });
  test('the story page and the reader: a tombstone draws the words and its replies — no avatar, reactions or Reply', () => {
    for (const p of ['app/stories/[slug]/page-client.js', 'app/reader/[slug]/page-reader.js']) {
      const s = src(p);
      const at = s.indexOf('if (isTombstone(comment)) {');
      const branch = s.slice(at, s.indexOf('\n  }\n', at));
      assert.match(branch, /\{DELETED_RESPONSE\}/, p);
      assert.match(branch, /\{replies\}/, p);
      assert.doesNotMatch(branch, /Avatar|ReactionRow|cs-reply-btn|CommentName/, p);
      assert.match(s, /const liveResponses = comments\.filter\(c => !isTombstone\(c\)\)\.length;/, p);
    }
  });
  test('Open Pages: tombstones survive the parse while a reply hangs beneath, and draw no author', () => {
    const s = src('app/open-pages/[id]/page-client.js');
    assert.match(s, /\.filter\(c => c\.text \|\| \(c\.deleted && c\.replies\.length\)\)/);
    const at = s.indexOf('if (isTombstone(node)) {');
    const branch = s.slice(at, s.indexOf('\n    }\n', at));
    assert.match(branch, /\{DELETED_RESPONSE\}/);
    assert.match(branch, /renderNode\(child, depth \+ 1\)/);
    assert.doesNotMatch(branch, /avatar|Reaction|Reply/);
    assert.equal(countNodes([{ deleted: true, replies: [{ text: 'a' }, { text: 'b' }] }]), 2, 'a tombstone is not counted as a comment');
  });
  test('the Square: feed post, reply, quoted card, closed preview and permalink hide the author and reactions', () => {
    const feed = src('app/square/page.js');
    for (const re of [
      /isTombstone\(p\) \? <div style=\{\{ width: 34, flex: 'none' \}\} \/> : <Avatar/,
      /isTombstone\(r\) \? <div style=\{\{ width: 26, flex: 'none' \}\} \/> : <Avatar/,
      /isTombstone\(p\) \? <div style=\{\{ width: 28, flex: 'none' \}\} \/> : <Avatar/,
      /\{!isTombstone\(quotedPost\) && <div/,
      /\{!isTombstone\(p\) && ReactionBar\(\{ p, size: 16 \}\)\}/,
      /\{!isTombstone\(r\) && ReactionBar\(\{ p: r, size: 16 \}\)\}/,
      /surface="feed-post" withdrawn=\{p\.withdrawn === true\} deleted=\{isTombstone\(p\)\}/,
      /surface="feed-reply" withdrawn=\{r\.withdrawn === true\} deleted=\{isTombstone\(r\)\}/,
      /surface="quoted-card" deleted=\{isTombstone\(quotedPost\)\}/,
      /surface="closed-preview" deleted=\{isTombstone\(p\)\}/,
    ]) assert.match(feed, re);
    const perm = src('app/square/p/page.js');
    assert.match(perm, /surface="permalink" withdrawn=\{post\.withdrawn === true\} deleted=\{isTombstone\(post\)\}/);
    assert.match(perm, /isTombstone\(post\) \? <div/);
  });
});

describe('rulings 29–34 · recorded in the plan and in the code', () => {
  test('docs/ACCOUNT-SCRUB-PLAN.md records all six, and no decision is still waiting on them', () => {
    const d = src('docs/ACCOUNT-SCRUB-PLAN.md');
    for (const n of [29, 30, 31, 32, 33, 34]) assert.match(d, new RegExp(`\\*\\*${n}\\.?\\*\\*|Ruling ${n}\\b|ruling ${n}\\b`), `ruling ${n}`);
    assert.doesNotMatch(d, /## Decisions waiting on the sign-off/);
  });
  test('the scrub plan carries no DRAFT mark on any ruled line', () => {
    const s = src('scripts/account/scrub-plan.mjs');
    assert.doesNotMatch(s, /DRAFT/);
    assert.match(s, /POLICY — RULED by Ikenna, 26 Sep 2026 \(rulings 29–34/);
  });
  test('the scrub workflow can summon the rebuild a removed voice needs (ruling 33)', () => {
    assert.match(src('.github/workflows/account-scrub.yml'), /CMS_DEPLOY_HOOK_URL: \$\{\{ secrets\.CMS_DEPLOY_HOOK_URL \}\}/);
  });
});
