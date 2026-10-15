// A STORED CFI IS WRAPPED EXACTLY ONCE — W47. Pure; no browser, no database.
//
// W45 wrote a mapped position as epubcfi(epubcfi(/6/84!…)): map-positions' cfiFor wrapped the
// result of foliate's joinIndir, which already wraps (epubcfi.js `lift`). foliate's parser
// happened to read the doubled value at the right place, so the mapping's own round trip passed
// and nothing caught it. Nothing may rely on that: the app has its own reader, and a later
// replacement would carry the doubled value forward as "kept".
//
// So the carry-over checks every cfi it is about to write, whichever branch produced it, and
// refuses (reports, never writes) one that is not `epubcfi(` + body + `)` with no second
// `epubcfi(` inside. An escaped "(" in an id assertion is "^(", so a real body never contains
// the literal "epubcfi(".

export const WRAPPED_ONCE = 'wrapped once';

/** True only for `epubcfi(<body>)` where <body> is non-empty and holds no second `epubcfi(`. */
export function wrappedOnce(cfi) {
  if (typeof cfi !== 'string' || !cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) return false;
  const body = cfi.slice('epubcfi('.length, -1);
  return body.length > 0 && !body.includes('epubcfi(');
}

/** One word for a dry-run line: does this cfi meet the rule? */
export const cfiShape = (cfi) => (wrappedOnce(cfi) ? WRAPPED_ONCE : 'NOT WRAPPED ONCE');

export const REFUSED_CFI = 'refused: cfi not wrapped once';

/**
 * The guard. A decision to write a record whose next cfi is not wrapped once becomes a refusal:
 * it is reported, counted, and never written. Every other decision passes through unchanged.
 */
export function guardCfi(decision) {
  if (decision?.action !== 'write') return decision;
  if (wrappedOnce(decision.next?.cfi)) return decision;
  return { ...decision, action: 'refuse', planned: decision.why, why: REFUSED_CFI };
}
