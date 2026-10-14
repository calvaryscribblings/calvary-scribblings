// W46 §7 — the admin's pure half (app/admin/series/notesModel.js).   node --test tests/series-notes/admin/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SLOTS, slotsFrom, draftFields, slotsReady, slotIsReady, addOption, removeOption, slotsEmpty,
  sameQuestions, publishState, counter, reviewItems,
} from '../../../app/admin/series/notesModel.js';
import { QUESTION_MAX, OPTION_MAX } from '../../../app/lib/series/notes.js';

const full = { sit: 'What stayed?', side: { text: 'Who was right?', options: ['Ama', 'Kofi'] }, line: 'Which line?' };

test('slotsFrom: a missing node is the empty form, with the two required sides', () => {
  assert.deepEqual(slotsFrom(null), EMPTY_SLOTS);
  assert.deepEqual(slotsFrom({ sit: 'x' }).side.options, ['', '']);
});

test('slotsFrom keeps a stored gap visible rather than shifting the sides', () => {
  const s = slotsFrom({ side: { text: 't', options: { a: 'A', b: 'B', d: 'D' } } });
  assert.deepEqual(s.side.options, ['A', 'B', '', 'D']);
});

test('draftFields: keys stay contiguous a..d after a removal, and draftedAt-style fields are not invented', () => {
  const slots = { ...full, side: { text: 't', options: ['A', 'B', 'C', 'D'] } };
  const removed = { ...slots, side: { ...slots.side, options: removeOption(slots.side.options, 1) } };
  assert.deepEqual(draftFields(removed).side.options, { a: 'A', b: 'C', c: 'D' });
  assert.deepEqual(Object.keys(draftFields(removed)).sort(), ['line', 'side', 'sit']);
});

test('add/remove enforce 2–4', () => {
  assert.deepEqual(addOption(['a', 'b']), ['a', 'b', '']);
  assert.deepEqual(addOption(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(removeOption(['a', 'b'], 0), ['a', 'b']);
  assert.deepEqual(removeOption(['a', 'b', 'c'], 0), ['b', 'c']);
  assert.deepEqual(removeOption(['a', 'b', 'c'], 7), ['a', 'b', 'c']);
});

test('readiness counts through the contract', () => {
  assert.equal(slotsReady(EMPTY_SLOTS), 0);
  assert.equal(slotsReady({ ...EMPTY_SLOTS, sit: 'x' }), 1);
  assert.equal(slotsReady(full), 3);
  assert.equal(slotIsReady('side', { ...full, side: { text: 't', options: ['A', ''] } }), false);
  assert.equal(slotIsReady('side', { ...full, side: { text: 't', options: ['A', '', 'C'] } }), false, 'a gap is not ready');
  assert.equal(slotIsReady('sit', { ...full, sit: 'x'.repeat(QUESTION_MAX + 1) }), false);
});

test('slotsEmpty', () => {
  assert.equal(slotsEmpty(EMPTY_SLOTS), true);
  assert.equal(slotsEmpty({ ...EMPTY_SLOTS, side: { text: '', options: ['', ' x'] } }), false);
  assert.equal(slotsEmpty({ ...EMPTY_SLOTS, line: '   ' }), true);
});

test('publishState: none, published, changed (whitespace and publishedAt ignored)', () => {
  const live = { sit: 'What stayed?', side: { text: 'Who was right?', options: { a: 'Ama', b: 'Kofi' } }, line: 'Which line?', publishedAt: 5 };
  assert.equal(publishState(full, null), 'none');
  assert.equal(publishState(full, live), 'published');
  assert.equal(publishState({ ...full, sit: '  What   stayed? ' }, live), 'published');
  assert.equal(publishState({ ...full, line: 'Another' }, live), 'changed');
  assert.equal(publishState({ ...full, side: { ...full.side, options: ['Ama', 'Kofi', 'Esi'] } }, live), 'changed');
  assert.equal(sameQuestions(draftFields(full), live), true);
});

test('counter shows only near the limit, and flags over', () => {
  assert.equal(counter('x'.repeat(10), QUESTION_MAX), null);
  assert.deepEqual(counter('x'.repeat(Math.ceil(QUESTION_MAX * 0.8)), QUESTION_MAX), { text: `${Math.ceil(QUESTION_MAX * 0.8)} / ${QUESTION_MAX}`, over: false });
  assert.equal(counter('x'.repeat(OPTION_MAX + 1), OPTION_MAX).over, true);
});

test('reviewItems: held offer approve/remove, reported offer remove/dismiss, newest first', () => {
  const items = reviewItems({
    held: { h1: { uid: 'u1', kind: 'sit', text: 'held text', reason: 'spam', createdAt: 100, author: { name: 'Ada' } } },
    reports: {
      n1: { u2: { at: 300, reason: 'rude' }, u3: { at: 250 } },
      n2: { u4: { at: 50 } },
    },
    notes: { n1: { uid: 'u9', kind: 'line', text: 'live text', createdAt: 90, author: { name: 'Bo' } }, n2: null },
  });
  assert.deepEqual(items.map((i) => i.key), ['reported:n1', 'held:h1', 'reported:n2']);
  const [r1, h1, r2] = items;
  assert.deepEqual(r1.decisions, ['remove', 'dismiss']);
  assert.equal(r1.reportCount, 2);
  assert.deepEqual(r1.reasons, ['rude']);
  assert.equal(r1.authorName, 'Bo');
  assert.equal(r1.text, 'live text');
  assert.deepEqual(h1.decisions, ['approve', 'remove']);
  assert.equal(h1.reason, 'spam');
  assert.equal(r2.gone, true);
  assert.deepEqual(reviewItems({}), []);
});
