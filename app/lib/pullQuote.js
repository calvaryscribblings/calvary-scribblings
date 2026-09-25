// THE PULL QUOTE'S INNER TEXT — W5, matching the app's lib/pullQuote.ts (app commit 469dcc0) by
// rule. That repo is not visible from here; the rule is Ikenna's, as the brief states it:
//
//   curly double quotes OUTSIDE, curly single quotes INSIDE, ’ for apostrophes, never wrapped twice.
//
// Every surface that prints a book's opening line as a pull quote draws its own outer “ ” (the
// Opening Lines rail keeps them in separate spans so the words can turn without them), so this
// returns the words only: any outer pair the curator typed is taken off, and every quote inside
// becomes a single. The Awakening's line is the case that found it — Chopin's parrot, in straight
// double quotes, inside the house's curly doubles.
//
// Pure; tests/ci/pull-quote.test.mjs.

const DOUBLE = /["“”„]/;
// An opening mark follows the start, a space, or an opening bracket or dash.
const OPENS_AFTER = /[\s([{—–-]/;

/** True when the whole line is one quotation: a double mark first and last, and none between. */
function wrappedWhole(s) {
  if (s.length < 2 || !DOUBLE.test(s[0]) || !DOUBLE.test(s[s.length - 1])) return false;
  return !DOUBLE.test(s.slice(1, -1));
}

/** The words of a pull quote, ready to sit inside the house's “ ”. */
export function pullQuoteText(line) {
  let s = String(line ?? '').trim();
  if (!s) return '';
  if (wrappedWhole(s)) s = s.slice(1, -1).trim();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i === 0 ? ' ' : s[i - 1];
    const opening = OPENS_AFTER.test(prev);
    if (c === '"' || c === '“' || c === '„') out += (c === '"' ? (opening ? '‘' : '’') : '‘');
    else if (c === '”') out += '’';
    else if (c === "'") out += opening ? '‘' : '’';
    else out += c;
  }
  return out;
}
