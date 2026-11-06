// STORY-W1 / RULING 328 — muting or blocking someone hides their responses under stories, for the
// reader who did it, as the Square does (ruling 207). app/lib/storyResponses.js, without a browser.
//
//   node --test tests/ci/story-w1-block.test.mjs      (npm run test:ci)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shownResponses, HIDDEN_RESPONSE } from '../../app/lib/storyResponses.js';
import { SAFETY_COPY, hiddenUids } from '../../app/lib/squareSafety.js';
import { THREAD_COPY } from '../../app/lib/squareThreads.js';

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');

let t = 0;
const r = (id, authorUid, parentId = null, extra = {}) => ({ id, authorUid, parentId, text: `words of ${id}`, authorName: `name of ${authorUid}`, createdAt: ++t, ...extra });
const tomb = (id, parentId = null) => ({ id, parentId, deleted: true, createdAt: ++t });
const ids = (out) => out.shown.map((c) => c.id);
const standIns = (out) => out.shown.filter((c) => c.hiddenByYou).map((c) => c.id);
const H = (...u) => new Set(u);

describe('ruling 328 · nobody hidden: exactly what the page drew before', () => {
  const list = [r('a', 'u1'), r('b', 'u2', 'a'), tomb('c'), r('d', 'u3', 'c'), r('orphan', 'u4', 'missing')];
  for (const hidden of [null, undefined, new Set(), hiddenUids({}, {})]) {
    test(`hidden = ${hidden === null ? 'null' : hidden === undefined ? 'undefined' : 'empty'}`, () => {
      const out = shownResponses(list, hidden);
      assert.deepEqual(out.shown, list);
      assert.equal(out.count, list.filter((c) => c.deleted !== true).length, 'the old count, tombstones aside');
    });
  }
  test('not an array: nothing, counted as nothing', () => {
    assert.deepEqual(shownResponses(null, H('x')), { shown: [], count: 0 });
    assert.deepEqual(shownResponses(undefined, null), { shown: [], count: 0 });
  });
});

describe('ruling 328 · a hidden reader\'s top-level response leaves with its whole thread', () => {
  const list = [r('a', 'bad'), r('a1', 'u2', 'a'), r('a2', 'me', 'a1'), r('b', 'u3'), r('b1', 'u4', 'b')];
  test('muted or blocked alike (one set, the Square\'s hiddenUids)', () => {
    for (const hidden of [hiddenUids({ bad: true }, {}), hiddenUids({}, { bad: true })]) {
      const out = shownResponses(list, hidden);
      assert.deepEqual(ids(out), ['b', 'b1']);
      assert.equal(out.count, 2, 'the replies that left with it are not counted either');
    }
  });
  test('the reader\'s own reply under it goes too: what it answers is gone', () => {
    assert.ok(!ids(shownResponses(list, H('bad'))).includes('a2'));
  });
});

describe('ruling 328 · a hidden reader\'s reply under someone else\'s response (207)', () => {
  test('with nothing visible beneath it, it leaves', () => {
    const out = shownResponses([r('a', 'u1'), r('a1', 'bad', 'a'), r('a2', 'u2', 'a')], H('bad'));
    assert.deepEqual(ids(out), ['a', 'a2']);
    assert.deepEqual(standIns(out), []);
    assert.equal(out.count, 2);
  });
  test('holding up a reply you can see, it is a stand-in: no name, no words, never counted', () => {
    const out = shownResponses([r('a', 'u1'), r('a1', 'bad', 'a', { heartCount: 3 }), r('a11', 'u2', 'a1')], H('bad'));
    assert.deepEqual(ids(out), ['a', 'a1', 'a11']);
    assert.deepEqual(standIns(out), ['a1']);
    const stand = out.shown.find((c) => c.id === 'a1');
    assert.deepEqual(Object.keys(stand).sort(), ['createdAt', 'hiddenByYou', 'id', 'parentId']);
    assert.equal(out.count, 2);
  });
  test('deep: a chain of hidden replies holds up a visible one at the bottom', () => {
    const out = shownResponses([r('a', 'u1'), r('x', 'bad', 'a'), r('y', 'worse', 'x'), r('z', 'u2', 'y')], H('bad', 'worse'));
    assert.deepEqual(ids(out), ['a', 'x', 'y', 'z']);
    assert.deepEqual(standIns(out), ['x', 'y']);
    assert.equal(out.count, 2);
  });
  test('a hidden reply with only hidden replies or tombstones beneath leaves, all of it', () => {
    const out = shownResponses([r('a', 'u1'), r('x', 'bad', 'a'), r('y', 'bad', 'x'), tomb('z', 'x')], H('bad'));
    assert.deepEqual(ids(out), ['a']);
    assert.equal(out.count, 1);
  });
  test('only the reader who hid them: someone else sees everything', () => {
    const list = [r('a', 'u1'), r('a1', 'bad', 'a')];
    assert.deepEqual(ids(shownResponses(list, H('someone-else'))), ['a', 'a1']);
  });
});

describe('ruling 328 · tombstones (ruling 30) and the hide', () => {
  test('a tombstone still holding up a visible reply is drawn, and not counted', () => {
    const out = shownResponses([tomb('t'), r('t1', 'u1', 't'), r('t2', 'bad', 't')], H('bad'));
    assert.deepEqual(ids(out), ['t', 't1']);
    assert.equal(out.count, 1);
  });
  test('a tombstone whose every reply is hidden is not drawn: it would stand over nothing', () => {
    const out = shownResponses([tomb('t'), r('t1', 'bad', 't')], H('bad'));
    assert.deepEqual(ids(out), []);
    assert.equal(out.count, 0);
  });
  test('a childless tombstone keeps its old treatment', () => {
    assert.deepEqual(ids(shownResponses([tomb('t'), r('a', 'u1')], H('bad'))), ['t', 'a']);
  });
  test('a tombstone has no author, so it is never "by" a hidden reader', () => {
    assert.deepEqual(standIns(shownResponses([r('a', 'u1'), { ...tomb('t', 'a'), authorUid: 'bad' }, r('t1', 'u2', 't')], H('bad'))), []);
  });
});

describe('ruling 328 · odd data never throws', () => {
  test('a parentId cycle', () => {
    const out = shownResponses([r('p', 'bad', 'q'), r('q', 'u1', 'p')], H('bad'));
    assert.ok(Array.isArray(out.shown));
  });
  test('holes in the list', () => {
    assert.deepEqual(ids(shownResponses([null, r('a', 'u1'), undefined], H('bad'))), ['a']);
  });
});

describe('ruling 328 · the words and the wiring', () => {
  test('the stand-in says the Square\'s ruled words (207)', () => {
    assert.equal(HIDDEN_RESPONSE, SAFETY_COPY.hiddenReply);
    assert.equal(HIDDEN_RESPONSE, THREAD_COPY.hiddenReply);
  });
  test('the hook reads the Square\'s lists through the Square\'s own hook, not a second copy', () => {
    const s = src('app/lib/useShownResponses.js');
    assert.match(s, /import useSafety from '\.\.\/components\/square\/useSafety'/);
    assert.match(s, /shownResponses\(comments, hidden\)/);
  });
  for (const p of ['app/stories/[slug]/page-client.js', 'app/reader/[slug]/page-reader.js']) {
    test(`${p}: draws what shownResponses() keeps, and a stand-in without a name, words or reactions`, () => {
      const s = src(p);
      assert.match(s, /useShownResponses\(comments, user\?\.uid\)/);
      assert.match(s, /comments=\{visibleComments\}/);
      const at = s.indexOf('if (comment.hiddenByYou) {');
      assert.ok(at > 0, 'the stand-in branch');
      const branch = s.slice(at, s.indexOf('\n  }\n', at));
      assert.match(branch, /\{HIDDEN_RESPONSE\}/);
      assert.match(branch, /\{replies\}/);
      assert.doesNotMatch(branch, /Avatar|ReactionRow|cs-reply-btn|CommentName|comment\.text/);
    });
  }
});
