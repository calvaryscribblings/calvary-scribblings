// THE BAR's arithmetic — one component in three states, as the app draws it (lib/libraryShelves.ts:
// barState/barLabel). Lifted out of app/my-library/page.js in CR-2 so My Library and Continue
// Reading draw the same bar from the same numbers; the component is app/components/ReadingBar.js.
//
// The percent is FLOORED, never rounded: 99.6% is not finished, and the one state that may print a
// hundred prints a word instead. Pure, so node --test can hold it.

export function barFor(progress) {
  if (typeof progress !== 'number' || !(progress > 0)) return { kind: 'unstarted' };
  if (progress >= 1) return { kind: 'finished' };
  return { kind: 'reading', percent: Math.max(1, Math.floor(progress * 100)) };
}

export function barLabel(bar) {
  if (bar.kind === 'finished') return 'FINISHED';
  if (bar.kind === 'reading') return `${bar.percent}%`;
  return '';
}
