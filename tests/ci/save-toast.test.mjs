// W5 · the save toast's queue — app/lib/saveToast.js. One at a time; a late timer never clears
// the toast that replaced its own; Undo dismisses first and then puts the story back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  showToast, dismissToast, currentToast, subscribeToast, toastSaved, toastRemoved, SAVE_TOAST_COPY,
} from '../../app/lib/saveToast.js';

test('the copy: Saved / View, Removed / Undo', () => {
  const id = toastSaved();
  assert.equal(currentToast().message, 'Saved to My Library');
  assert.deepEqual(currentToast().action, { label: 'View', href: '/my-library' });
  dismissToast(id);
  toastRemoved(async () => {});
  assert.equal(currentToast().message, 'Removed from My Library');
  assert.equal(currentToast().action.label, 'Undo');
  dismissToast();
});

test('one toast at a time: a new one replaces the old, and the old id cannot dismiss it', () => {
  const seen = [];
  const off = subscribeToast((t) => seen.push(t && t.message));
  const a = showToast({ message: 'first' });
  const b = showToast({ message: 'second' });
  dismissToast(a); // the first toast's timer, firing late
  assert.equal(currentToast().message, 'second');
  dismissToast(b);
  assert.equal(currentToast(), null);
  assert.deepEqual(seen, ['first', 'second', null]);
  off();
});

test('Undo dismisses, then restores; a failed restore says so', async () => {
  let restored = 0;
  toastRemoved(async () => { restored += 1; });
  await currentToast().action.onClick();
  assert.equal(restored, 1);
  assert.equal(currentToast(), null);

  toastRemoved(async () => { throw new Error('idb gone'); });
  await currentToast().action.onClick();
  assert.equal(currentToast().message, SAVE_TOAST_COPY.undoFailed);
  dismissToast();
});
