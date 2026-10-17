// W46 — the room's view model (app/components/seriesNotes/roomModel.js). Pure; `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lightOpacity, pickInstalment, releasedRows, roomPhase, listOf, underlineCounts, kindCounts, visibleNotes,
  noteHeading, arrivals, mergeLocal, sealedCounts, seriesTotals, asPost, progressPercent, shareOf, authorMark,
} from '../../../app/components/seriesNotes/roomModel.js';
import { identityOf } from '../../../app/lib/squareIdentity.js';

const NOW = Date.UTC(2026, 9, 14, 12);
const DAY = 86_400_000;
const row = (id, ordinal, releaseAtMs, status = 'published') => ({ id, ordinal, releaseAtMs, status });
const ROWS = [row('s-i1', 1, NOW - 9 * DAY), row('s-i2', 2, NOW - 2 * DAY), row('s-i3', 3, NOW + 5 * DAY), row('s-i4', 4, NOW - DAY, 'draft')];

test('light opacity follows the canvas: bright 1, soft 0.6, faint 0.3, none 0', () => {
  assert.equal(lightOpacity('bright'), 1);
  assert.equal(lightOpacity('soft'), 0.6);
  assert.equal(lightOpacity('faint'), 0.3);
  assert.equal(lightOpacity('none'), 0);
  assert.equal(lightOpacity('nonsense'), 0);
});

test('pickInstalment: only a released, published row; falls back to the summary lead, then the latest', () => {
  assert.equal(pickInstalment(ROWS, 's-i1', null, NOW).id, 's-i1');
  assert.equal(pickInstalment(ROWS, 's-i3', null, NOW).id, 's-i2', 'unreleased is refused');
  assert.equal(pickInstalment(ROWS, 's-i4', null, NOW).id, 's-i2', 'a draft is refused');
  assert.equal(pickInstalment(ROWS, null, { inst: 's-i1' }, NOW).id, 's-i1');
  assert.equal(pickInstalment(ROWS, 'nope', { inst: 'gone' }, NOW).id, 's-i2');
  assert.equal(pickInstalment([row('x', 1, NOW + DAY)], null, null, NOW), null);
  assert.deepEqual(releasedRows(ROWS, NOW).map((r) => r.id), ['s-i1', 's-i2']);
});

test('roomPhase: signed out and unfinished are sealed; finished non-member joins; member is open', () => {
  assert.equal(roomPhase({ user: null, finished: 1, member: 1 }), 'sealed');
  assert.equal(roomPhase({ user: { uid: 'u' }, finished: null, member: 1 }), 'sealed');
  assert.equal(roomPhase({ user: { uid: 'u' }, finished: 5, member: null }), 'joining');
  assert.equal(roomPhase({ user: { uid: 'u' }, finished: 5, member: 6 }), 'open');
});

test('listOf keeps ids and drops malformed rows; underlineCounts counts and marks mine', () => {
  const l = listOf({ a: { text: 'x', kind: 'sit' }, b: null, c: { kind: 'sit' }, d: 'str' });
  assert.deepEqual(l.map((n) => n.id), ['a']);
  assert.deepEqual(listOf(null), []);
  const u = underlineCounts({ n1: { u1: true, u2: true }, n2: { u2: true }, n3: null }, 'u1');
  assert.deepEqual(u.counts, { n1: 2, n2: 1, n3: 0 });
  assert.deepEqual([...u.mine], ['n1']);
});

const NOTES = [
  { id: 'a', kind: 'sit', text: 'a', createdAt: 1 },
  { id: 'b', kind: 'side', side: 'a', text: 'b', createdAt: 3 },
  { id: 'c', kind: 'line', text: 'c', createdAt: 2, line: { text: 'L', cfi: 'x', epubVersion: '1' } },
  { id: 'w', kind: 'else', text: 'w', createdAt: 0, writer: true },
  { id: 'z', kind: 'bogus', text: 'z' },
];

test('kindCounts: per kind and all; unknown kinds are not counted', () => {
  assert.deepEqual(kindCounts(NOTES), { all: 4, side: 1, sit: 1, line: 1, else: 1 });
});

test('visibleNotes: the writer stays pinned; Most underlined then newest; a filter keeps the order', () => {
  assert.deepEqual(visibleNotes(NOTES.slice(0, 4), { sort: 'underlined', counts: { a: 5, c: 1 } }).map((n) => n.id), ['w', 'a', 'c', 'b']);
  assert.deepEqual(visibleNotes(NOTES.slice(0, 4), { sort: 'newest' }).map((n) => n.id), ['w', 'b', 'c', 'a']);
  assert.deepEqual(visibleNotes(NOTES.slice(0, 4), { filter: 'line' }).map((n) => n.id), ['c']);
});

test('noteHeading: the question above the reader, in the approved words', () => {
  const q = { sit: 'What stays?', line: 'Which line?', side: { text: 'Who was right?', options: { a: 'Freedom', b: 'Duty' } } };
  assert.deepEqual(noteHeading(NOTES[1], q, 4), { label: 'TOOK A SIDE · FREEDOM', question: 'Who was right?' });
  assert.deepEqual(noteHeading(NOTES[0], q, 4), { label: 'SIT WITH THIS', question: 'What stays?' });
  const line = noteHeading(NOTES[2], q, 4);
  assert.equal(line.label, 'THE LINE');
  assert.equal(line.quote.text, 'L');
  assert.deepEqual(noteHeading(NOTES[3], q, 4), { label: 'ANYTHING ELSE', question: 'Something else from Instalment IV that stayed with them' });
});

test('arrivals: new notes from others wait; the reader’s own never do', () => {
  const fresh = [{ id: 'a', uid: 'x' }, { id: 'n1', uid: 'x' }, { id: 'n2', uid: 'me' }];
  assert.deepEqual(arrivals(fresh, new Set(['a']), 'me').map((n) => n.id), ['n1']);
  assert.deepEqual(arrivals(fresh, ['a', 'n1'], 'me'), []);
});

test('mergeLocal: pending first; a local copy drops once the server (or the held list) has it', () => {
  const server = [{ id: 'r1' }];
  const local = [{ id: 'tmp-1', local: 'pending' }, { id: 'r1', realId: 'r1' }, { id: 'r2', realId: 'r2' }, { id: 'h1', realId: 'h1' }];
  assert.deepEqual(mergeLocal(server, local, new Set(['h1'])).map((n) => n.id), ['tmp-1', 'r2', 'r1']);
});

test('sealedCounts and seriesTotals read the public summary only', () => {
  const summary = { byInst: { i1: { notes: 4, readers: 3, kinds: { side: 7, sit: 2, line: 1, else: 1 } }, i2: { notes: 2, readers: 2 } } };
  assert.deepEqual(sealedCounts(summary, 'i1'), { notes: 4, readers: 3, side: 7, sit: 2, line: 1, else: 1 });
  assert.deepEqual(sealedCounts(null, 'i1'), { notes: 0, readers: 0, side: 0, sit: 0, line: 0, else: 0 });
  assert.deepEqual(seriesTotals(summary), { notes: 6, readers: 5 });
});

test('asPost maps the author snapshot onto identityOf()’s post shape', () => {
  assert.deepEqual(asPost({ uid: 'u', writer: true, author: { name: 'N', handle: 'h', photoURL: 'https://p', badge: 30 } }), {
    authorUid: 'u', authorName: 'N', authorHandle: 'h', authorAvatarUrl: 'https://p', authorReadCount: 30, isAuthor: true,
  });
});

test('progressPercent floors, never shows 100 unfinished; shareOf reads a share', () => {
  assert.equal(progressPercent(0.996), 99);
  assert.equal(progressPercent(0.004), 1);
  assert.equal(progressPercent(null), 0);
  assert.equal(progressPercent(0.42), 42);
  assert.equal(shareOf({ a: 58 }, 'a'), 58);
  assert.equal(shareOf({}, 'b'), 0);
});

// W48 §2 — the author line feeds UserBadge exactly what the Square feeds it for the same reader:
// the Square's who(p) is identityOf(post, liveRecord), and its badge is
// <UserBadge readCount={who.readCount} isAuthor={who.isAuthor} />.
test('authorMark: the Square’s badge inputs for the same reader; Writer for a writer; WRITER for the series’ writer', () => {
  const squarePost = (uid, stale) => ({ authorUid: uid, authorName: 'Old', authorReadCount: stale, isAuthor: false });
  const note = (uid, extra = {}) => ({ uid, author: { name: 'Old', badge: 1000 }, ...extra });
  const LIVE = {
    reader: { displayName: 'Ada', readCount: 30 },
    islander: { displayName: 'Ben', readCount: 120 },
    writer: { displayName: 'Dee', readCount: 40, isAuthor: true },
  };
  for (const [uid, rec] of Object.entries(LIVE)) {
    const square = identityOf(squarePost(uid, 1000), rec);
    const room = authorMark(note(uid), identityOf(asPost(note(uid)), rec));
    assert.deepEqual(room, { mark: 'badge', readCount: square.readCount, isAuthor: square.isAuthor }, uid);
  }
  assert.equal(authorMark(note('reader'), identityOf(asPost(note('reader')), LIVE.reader)).readCount, 30, 'the live count, not the snapshot');
  assert.equal(authorMark(note('writer'), identityOf(asPost(note('writer')), LIVE.writer)).isAuthor, true, 'a writer: the Writer badge');
  // The series' own writer (note.writer, set by the endpoint) keeps the mark, live record or not.
  assert.deepEqual(authorMark(note('w', { writer: true }), identityOf(asPost(note('w', { writer: true })), LIVE.writer)), { mark: 'writer' });
  assert.deepEqual(authorMark(note('w', { writer: true }), identityOf(asPost(note('w', { writer: true })), null)), { mark: 'writer' });
  // No live record (a deleted account): the snapshot is the fallback, as on the Square.
  assert.deepEqual(authorMark(note('gone'), identityOf(asPost(note('gone')), null)), { mark: 'badge', readCount: 1000, isAuthor: false });
});
