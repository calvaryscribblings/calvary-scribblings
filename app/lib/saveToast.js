// THE SAVE TOAST — the confirmation a story save or removal gets, W5. The app's own toast is the
// reference (Ikenna's ruling: "the website confirms a story save the way the app now does"):
//
//   saved    "Saved to My Library"      VIEW → /my-library
//   removed  "Removed from My Library"  UNDO → the same story back, with the same saved date
//
// One toast at a time: a new one replaces the old, and with it the old one's Undo. It is
// announced to screen readers (a polite live region that is always mounted), and it moves only
// when motion is allowed — under Reduce Motion it fades and nothing else. The component is
// app/components/SaveToast.js, mounted once in Providers; anything on the page calls showToast().
//
// No React here, so tests/ci/save-toast.test.mjs can drive the queue directly.

// DRAFT for Ikenna — the app's words, as the brief gives them.
export const SAVE_TOAST_COPY = {
  saved: 'Saved to My Library',
  view: 'View',
  removed: 'Removed from My Library',
  undo: 'Undo',
  undoFailed: 'Couldn’t put that back. Save it again from the story.',
};

export const TOAST_MS = 5000;

let current = null;
let seq = 0;
const listeners = new Set();

/** The toast on screen now, or null. */
export const currentToast = () => current;

/** Show a toast, replacing whatever is showing. Returns its id. */
export function showToast({ message, action = null }) {
  seq += 1;
  current = { id: seq, message, action };
  for (const fn of listeners) fn(current);
  return seq;
}

/** Dismiss — only the toast with this id, so a late timer never clears its replacement. */
export function dismissToast(id) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  for (const fn of listeners) fn(null);
}

export function subscribeToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "Saved to My Library", with View. */
export const toastSaved = () => showToast({ message: SAVE_TOAST_COPY.saved, action: { label: SAVE_TOAST_COPY.view, href: '/my-library' } });

/**
 * "Removed from My Library", with Undo. `undo` puts the story back (restoreSaved with the
 * snapshot removeSaved returned) and refreshes whatever the caller shows.
 */
export function toastRemoved(undo) {
  const id = showToast({
    message: SAVE_TOAST_COPY.removed,
    action: {
      label: SAVE_TOAST_COPY.undo,
      onClick: async () => {
        dismissToast(id);
        try { await undo(); } catch { showToast({ message: SAVE_TOAST_COPY.undoFailed }); }
      },
    },
  });
  return id;
}
