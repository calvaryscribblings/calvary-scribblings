// W46 — the pure half of the Readers' Notes contract (app/lib/series/notes.js), unit by unit.
//
//   node --test tests/series-notes/contract.test.mjs     (part of npm run test:series-notes)
//
// Every rule the brief states that can be decided without I/O is decided in notes.js, and is
// asserted here: the flag, the door's light and opening words, readiness and publishing of the
// three questions, note/reply/line limits, the summary's public shape, sorting, folding, the
// tally's arithmetic and the ranking of lines. tests/series-notes/contract-mutations.mjs proves
// these assertions bite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../app/lib/series/notes.js';

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 14, 12);

describe('W46 · §0 the flag', () => {
  test('the flag is in the state the round left it: ON since W46 §8 (14 Oct 2026)', () => {
    assert.equal(N.SERIES_NOTES_ENABLED, true);
  });
  test('notesEnabled() is the constant in production', () => {
    assert.equal(N.notesEnabled({}), N.SERIES_NOTES_ENABLED);
    assert.equal(N.notesEnabled(undefined), N.SERIES_NOTES_ENABLED || process.env.NEXT_PUBLIC_SERIES_NOTES_PREVIEW === '1');
  });
  test('an endpoint test may force it either way with env.SERIES_NOTES_TEST, nothing else does', () => {
    assert.equal(N.notesEnabled({ SERIES_NOTES_TEST: '1' }), true);
    assert.equal(N.notesEnabled({ SERIES_NOTES_TEST: '0' }), false);
    assert.equal(N.notesEnabled({ SERIES_NOTES_TEST: 'true' }), N.SERIES_NOTES_ENABLED);
  });
});

describe('W46 · the words', () => {
  test('roman numerals and {N}', () => {
    assert.equal(N.romanOf(1), 'I');
    assert.equal(N.romanOf(4), 'IV');
    assert.equal(N.romanOf(9), 'IX');
    assert.equal(N.romanOf(14), 'XIV');
    assert.equal(N.instName(3), 'Instalment III');
  });
  test('the approved copy, exactly', () => {
    const C = N.NOTES_COPY;
    assert.equal(C.elseCard('Instalment I'), 'Or tell us about anything else from Instalment I that stayed with you.');
    assert.equal(C.firstQuestions('24 October'), 'The first three questions arrive with instalment I, on 24 October.');
    assert.equal(C.sealedBody(3), 'The room opens on the last page, so nothing in here can spoil it. 3 notes are waiting for you.');
    assert.equal(C.partway('Instalment II'), 'You’re partway through Instalment II.');
    assert.equal(C.youreWith(58, 12), 'You’re with 58% of 12 readers.');
    assert.equal(C.stepInsideMore(9), 'Step inside: two more questions, 9 notes');
    assert.equal(C.composerBar('Instalment I'), 'Leave a note on Instalment I…');
    assert.equal(C.onlyFinishers('Instalment I'), 'Only readers who’ve finished Instalment I will see this.');
    assert.equal(C.checklist(2), 'Questions: 2 of 3 ready');
    assert.equal(C.tookASide('Freedom'), 'TOOK A SIDE · FREEDOM');
    assert.equal(C.moreReplies(3), 'View 3 more replies');
  });
  // W48 — launch-morning fixes. The app's parity test reads NOTES_COPY, so these are its words too.
  test('W48: the line with an empty margin (ruling 175), the way back, and "Underlined · n"', () => {
    const C = N.NOTES_COPY;
    assert.equal(C.lineFirst, 'Choose your line in the book first: press on it and tap “This is my line”.');
    assert.equal(C.chooseInBook, 'Choose it in the book');
    assert.equal(C.lineSaved, 'Saved as your line.');
    assert.equal(C.backToNote, 'Back to your note');
    assert.ok(C.lineFirst.includes(`“${C.thisIsMyLine}”`), 'the guidance names the chip by its own words');
    assert.equal(C.underlined(24), 'Underlined · 24');
    assert.equal(C.underlined(1), 'Underlined · 1');
    assert.equal(C.underline(3), 'Underline · 3');
    assert.equal(N.chooseLineHref('beta-princess-i2'), '/series/read/beta-princess-i2?from=notes', 'the reader\'s own place: no ?at=');
    assert.equal(N.backToNoteHref('beta-princess', 'beta-princess-i2'), '/series/beta-princess/notes?i=beta-princess-i2&compose=line');
  });
  test('bars carry text', () => {
    assert.equal(N.barLabel('Freedom', 58, true), 'Freedom, 58 percent, your side');
    assert.equal(N.barLabel('Duty', 42, false), 'Duty, 42 percent');
  });
});

describe('W46 · §3 the door', () => {
  test('the light: brightest within 6 hours, softer within 48, faint after, none without a note', () => {
    assert.equal(N.doorLight(NOW - 1 * H, NOW), 'bright');
    assert.equal(N.doorLight(NOW - 6 * H, NOW), 'bright');
    assert.equal(N.doorLight(NOW - 6 * H - 1, NOW), 'soft');
    assert.equal(N.doorLight(NOW - 48 * H, NOW), 'soft');
    assert.equal(N.doorLight(NOW - 48 * H - 1, NOW), 'faint');
    assert.equal(N.doorLight(null, NOW), 'none');
  });
  test('it breathes only within an hour of a note', () => {
    assert.equal(N.doorBreathes(NOW - 59 * 60_000, NOW), true);
    assert.equal(N.doorBreathes(NOW - H - 1, NOW), false);
    assert.equal(N.doorBreathes(null, NOW), false);
  });
  test('"Opens {weekday}", or the date if it is more than a week away', () => {
    const fri = Date.UTC(2026, 9, 16, 9); // Friday 16 Oct
    assert.equal(N.opensLabel(fri, NOW), 'Friday');
    assert.equal(N.opensLabel(NOW + 8 * 24 * H, NOW), '22 October');
  });
  test('"{n} new" counts only what arrived since the last visit on this device', () => {
    assert.equal(N.newSince([NOW, NOW - 10, NOW - 1000], NOW - 100), 2);
    assert.equal(N.newSince([NOW], null), 0, 'a first visit shows no "new"');
  });
  const rows = [
    { id: 'i1', status: 'published', ordinal: 1, releaseAtMs: NOW - 10 * 24 * H },
    { id: 'i2', status: 'published', ordinal: 2, releaseAtMs: NOW - 24 * H },
    { id: 'i3', status: 'published', ordinal: 3, releaseAtMs: NOW + 24 * H },
    { id: 'd', status: 'draft', ordinal: 4, releaseAtMs: NOW - 24 * H },
  ];
  test('closed until instalment I releases: the date, no light', () => {
    const s = N.doorState({ rows: rows.map((r) => ({ ...r, releaseAtMs: NOW + 3 * 24 * H + r.ordinal })), now: NOW });
    assert.equal(s.phase, 'closed');
    assert.ok(s.opensLabel && s.firstDate);
    assert.equal(s.light, undefined);
  });
  test('open: leads with the latest released instalment that has a published Sit question', () => {
    const summary = { lastAt: NOW - H, faces: [{ initials: 'A' }, { initials: 'B' }, { initials: 'C' }, { initials: 'D' }, { initials: 'E' }], byInst: { i1: { notes: 4, kinds: { sit: 3 } }, i2: { notes: 1, kinds: { sit: 1 } } } };
    const s = N.doorState({ rows, summary, sitByInst: { i1: 'What did the house keep?' }, now: NOW });
    assert.equal(s.phase, 'open');
    assert.equal(s.inst, 'i1');
    assert.equal(s.sit, 'What did the house keep?');
    assert.equal(s.answers, 3);
    assert.equal(s.faces.length, 4, 'up to four faces');
    assert.equal(s.light, 'bright');
  });
  test('no published questions yet: the counts, and no question', () => {
    const s = N.doorState({ rows, summary: { byInst: { i2: { notes: 2, kinds: {} } } }, now: NOW });
    assert.equal(s.inst, 'i2', 'the latest released, never the unreleased i3 or the draft');
    assert.equal(s.sit, null);
    assert.equal(s.notes, 2);
    assert.equal(s.light, 'none');
  });
});

describe('W46 · §7 the three questions (ruling 159)', () => {
  const ready = { sit: 'What stays?', side: { text: 'Leave or stay?', options: { a: 'Leave', b: 'Stay' } }, line: 'Which line?' };
  test('n of 3 ready', () => {
    assert.equal(N.readyCount(null), 0);
    assert.equal(N.readyCount({ sit: 'x' }), 1);
    assert.equal(N.readyCount(ready), 3);
  });
  test('Take a side has 2–4 sides, contiguous from a, each short', () => {
    assert.equal(N.slotReady('side', { text: 'q', options: { a: 'one' } }), false);
    assert.equal(N.slotReady('side', { text: 'q', options: { a: '1', b: '2', c: '3', d: '4' } }), true);
    assert.equal(N.slotReady('side', { text: 'q', options: { a: '1', c: '3' } }), false);
    assert.equal(N.slotReady('side', { text: 'q', options: { a: '1', b: 'x'.repeat(N.OPTION_MAX + 1) } }), false);
    assert.equal(N.slotReady('side', { text: '', options: { a: '1', b: '2' } }), false);
  });
  test('a blank or overlong question is not ready', () => {
    assert.equal(N.slotReady('sit', '   '), false);
    assert.equal(N.slotReady('line', 'x'.repeat(N.QUESTION_MAX + 1)), false);
  });
  test('all three or nothing; the public half carries the Sit question alone', () => {
    assert.ok(N.publishableQuestions({ ...ready, line: '' }).error);
    const p = N.publishableQuestions(ready, 5);
    assert.deepEqual(Object.keys(p.public).sort(), ['publishedAt', 'sit']);
    assert.deepEqual(p.questions.side.options, { a: 'Leave', b: 'Stay' });
    assert.equal(p.questions.publishedAt, 5);
  });
});

describe('W46 · §2 what a note may be', () => {
  test('1–500 characters, after normalising', () => {
    assert.equal(N.checkNoteInput({ kind: 'sit', text: '   ' }).error, 'empty');
    assert.equal(N.checkNoteInput({ kind: 'sit', text: 'x'.repeat(500) }).ok, true);
    assert.equal(N.checkNoteInput({ kind: 'sit', text: 'x'.repeat(501) }).error, 'too_long');
  });
  test('characters, not UTF-16 units: 500 emoji-free astral letters are 500', () => {
    assert.equal(N.checkNoteInput({ kind: 'else', text: '𝔄'.repeat(500) }).ok, true);
  });
  test('a side note takes the RECORDED side, never one from the body', () => {
    assert.equal(N.checkNoteInput({ kind: 'side', text: 'because', side: 'b' }).error, 'no_side');
    assert.equal(N.checkNoteInput({ kind: 'side', text: 'because' }, { recordedSide: 'a' }).note.side, 'a');
  });
  test('a line note needs its line, ≤400 chars, with its place and its bytes', () => {
    const line = { text: 'It was the kind of quiet that keeps.', cfi: 'epubcfi(/6/4!/4)', epubVersion: '17' };
    assert.equal(N.checkNoteInput({ kind: 'line', text: 'this' }).error, 'bad_line');
    assert.equal(N.checkNoteInput({ kind: 'line', text: 'this', line }).ok, true);
    assert.equal(N.checkNoteInput({ kind: 'line', text: 'this', line: { ...line, text: 'x'.repeat(401) } }).error, 'bad_line');
    assert.equal(N.checkNoteInput({ kind: 'line', text: 'this', line: { ...line, epubVersion: '' } }).error, 'bad_line');
    assert.equal(N.checkNoteInput({ kind: 'sit', text: 'this', line }).error, 'bad_line', 'only the line carries a line');
  });
  test('unknown kinds are refused', () => {
    assert.equal(N.checkNoteInput({ kind: 'reply', text: 'x' }).error, 'bad_kind');
  });
  test('replies: 1–300', () => {
    assert.equal(N.checkReplyInput({ text: 'x'.repeat(300) }).ok, true);
    assert.equal(N.checkReplyInput({ text: 'x'.repeat(301) }).error, 'too_long');
    assert.equal(N.checkReplyInput({ text: '' }).error, 'empty');
  });
  test('control characters go; three blank lines become one', () => {
    assert.equal(N.normaliseText('a\u0007b\r\n\n\n\nc'), 'ab\n\nc');
  });
  test('the author snapshot: name, handle without "@", an https picture, the island count', () => {
    const a = N.authorSnapshot({ displayName: 'Ada  Obi', handle: '@ada', avatarUrl: 'https://x/y.png', readCount: 12.7 });
    assert.deepEqual(a, { name: 'Ada Obi', handle: 'ada', photoURL: 'https://x/y.png', badge: 12 });
    assert.deepEqual(N.authorSnapshot({ avatarUrl: 'javascript:alert(1)' }), { name: 'Reader' });
  });
});

describe('W46 · the public summary holds no words a reader wrote', () => {
  const notes = {
    n1: { uid: 'u1', kind: 'sit', text: 'SECRET ONE', author: { name: 'Ada Obi', photoURL: 'https://p/1' }, createdAt: NOW - 3 },
    n2: { uid: 'u2', kind: 'line', text: 'SECRET TWO', author: { name: 'Bo' }, createdAt: NOW - 2 },
    n3: { uid: 'u1', kind: 'else', text: 'SECRET THREE', author: { name: 'Ada Obi' }, createdAt: NOW - 1 },
  };
  const stats = N.instStats({ ordinal: 1, notes, members: { u1: 1, u2: 1, u3: 1 }, sides: { u1: 'a', u3: 'b' } });
  test('instalment stats', () => {
    assert.deepEqual(stats.kinds, { side: 2, sit: 1, line: 1, else: 1 }, 'a tap on a side is an answer (161)');
    assert.equal(stats.notes, 3);
    assert.equal(stats.readers, 3);
    assert.equal(stats.lastAt, NOW - 1);
  });
  const s = N.foldSummary(null, { inst: 'i1', stats, notes, sit: 'What stays?' });
  test('the fold', () => {
    assert.equal(s.inst, 'i1');
    assert.equal(s.sit, 'What stays?');
    assert.equal(s.sitAnswers, 1);
    assert.equal(s.lastAt, NOW - 1);
    assert.deepEqual(s.latestNotes, [NOW - 1, NOW - 2, NOW - 3]);
    assert.deepEqual(s.faces, [{ initials: 'AO' }, { initials: 'B' }], 'one face per reader, newest first');
  });
  test('no note text, no name, no uid anywhere in it', () => {
    const json = JSON.stringify(s);
    for (const leak of ['SECRET', 'Ada', 'Bo"', 'u1', 'u2']) assert.ok(!json.includes(leak), `summary leaks ${leak}`);
  });
  test('folding a second instalment keeps the first and the series-wide stamps', () => {
    const s2 = N.foldSummary(s, { inst: 'i2', stats: { ordinal: 2, notes: 1, readers: 1, kinds: { sit: 0 }, lastAt: NOW }, notes: { x: { uid: 'u9', createdAt: NOW, author: {} } } });
    assert.ok(s2.byInst.i1 && s2.byInst.i2);
    assert.equal(s2.inst, 'i1', 'the lead stays put unless asked');
    assert.equal(s2.lastAt, NOW);
    assert.equal(s2.latestNotes[0], NOW);
    assert.equal(s2.latestNotes.length, 4);
  });
  test('a removed note leaves the stamps', () => {
    const s3 = N.foldSummary(s, { inst: 'i1', stats: N.instStats({ ordinal: 1, notes: { n1: notes.n1 } }), notes: { n1: notes.n1 } });
    assert.deepEqual(s3.latestNotes, [NOW - 3]);
  });
});

describe('W46 · §4 the room', () => {
  const list = [
    { id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }, { id: 'c', createdAt: 3, writer: true }, { id: 'd', createdAt: 4 },
  ];
  test('the writer is pinned first (ruling 163), then Most underlined, ties to newest', () => {
    assert.deepEqual(N.sortNotes(list, { counts: { a: 5, b: 1 } }).map((n) => n.id), ['c', 'a', 'b', 'd']);
    assert.deepEqual(N.sortNotes(list, { counts: { a: 5 } }).map((n) => n.id), ['c', 'a', 'd', 'b']);
  });
  test('Newest ignores underlines but keeps the writer first', () => {
    assert.deepEqual(N.sortNotes(list, { by: 'newest', counts: { a: 99 } }).map((n) => n.id), ['c', 'd', 'b', 'a']);
  });
  test('replies oldest first, folded after two', () => {
    const r = [{ id: 'z', createdAt: 3 }, { id: 'x', createdAt: 1 }, { id: 'y', createdAt: 2 }];
    assert.deepEqual(N.orderReplies(r).map((x) => x.id), ['x', 'y', 'z']);
    const f = N.foldReplies(r);
    assert.deepEqual(f.shown.map((x) => x.id), ['x', 'y']);
    assert.equal(f.hidden, 1);
    assert.equal(N.foldReplies(r, true).hidden, 0);
    assert.equal(N.foldReplies(r.slice(0, 2)).hidden, 0);
  });
  test('shares are whole numbers that sum to 100', () => {
    const s = N.tallyShares({ a: 1, b: 1, c: 1 }, ['a', 'b', 'c']);
    assert.equal(s.a + s.b + s.c, 100);
    assert.equal(s.total, 3);
    assert.deepEqual(N.tallyShares({}, ['a', 'b']), { total: 0, a: 0, b: 0 });
    const t = N.tallyShares({ a: 7, b: 5 }, ['a', 'b']);
    assert.deepEqual([t.a, t.b], [58, 42]);
  });
  test('moving a side: never negative, a re-tap is a no-op', () => {
    assert.deepEqual(N.moveTally({ a: 1 }, null, 'b'), { a: 1, b: 1 });
    assert.deepEqual(N.moveTally({ a: 1, b: 1 }, 'a', 'b'), { a: 0, b: 2 });
    assert.deepEqual(N.moveTally({ a: 0 }, 'a', 'b'), { a: 0, b: 1 });
    assert.deepEqual(N.moveTally({ a: 1 }, 'a', 'a'), { a: 1 });
  });
  test('lines ranked by how many READERS chose them; the same words are the same line', () => {
    const L = (uid, text) => ({ uid, line: { text, cfi: 'c', epubVersion: 'v' }, createdAt: 1 });
    const ranked = N.rankLines([L('u1', 'The sea kept it.'), L('u2', 'the sea kept it'), L('u2', 'The sea kept it!'), L('u3', 'Another.')], 'u3');
    assert.equal(ranked[0].count, 2);
    assert.equal(ranked[0].mostChosen, true);
    assert.equal(ranked[1].mine, true);
  });
  test('the room and the line have one URL each', () => {
    assert.equal(N.roomHref('beta-princess', 'beta-princess-i2'), '/series/beta-princess/notes?i=beta-princess-i2');
    assert.equal(N.lineHref('x-i1', { cfi: 'epubcfi(/6)', epubVersion: '9' }), '/series/read/x-i1?at=epubcfi(%2F6)&v=9');
  });
});
