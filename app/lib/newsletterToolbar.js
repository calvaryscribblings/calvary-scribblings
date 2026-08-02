// Selection surgery for the newsletter composer's formatting toolbar.
//
// These are pure string functions on purpose. The toolbar's real logic — where
// the markers land, what happens to a selection that already has them, how a
// link's text is protected — is the part worth testing, and none of it needs a
// DOM. The React layer in app/admin/newsletter/page.js does nothing but read
// selectionStart/selectionEnd off the textarea, call one of these, and write
// the result back. tests/newsletter/toolbar.test.mjs is the contract.
//
// Every function takes (value, start, end, …) and returns a full replacement
// { value, selectionStart, selectionEnd }, so the caller never computes an
// offset itself.

// The grammar's markers, from app/lib/newsletterRender.js. Kept as a map rather
// than inlined at the call sites so the toolbar cannot invent a marker the
// renderer does not recognise.
export const MARKERS = { bold: '**', italic: '*', underline: '__' };

// Is the selection already wrapped in this marker, just outside its edges?
function wrappedOutside(value, start, end, m) {
  if (start < m.length) return false;
  if (value.slice(start - m.length, start) !== m) return false;
  if (value.slice(end, end + m.length) !== m) return false;
  // '*' is a PREFIX of '**'. Without this guard, hitting italic with the word
  // inside a **bold** run selected would read the inner asterisk of each `**`
  // as an italic marker, strip one from each side, and silently downgrade the
  // bold to italic. The author asked to toggle italic; they did not ask to
  // break the bold they already had.
  if (m === '*') {
    if (value[start - 2] === '*') return false;
    if (value[end + 1] === '*') return false;
  }
  return true;
}

// …or wrapped INSIDE the selection, because the author dragged across the
// markers too — selecting "**word**" rather than "word". Both are the same
// intent and both must untoggle rather than nest into "***word***".
function wrappedInside(sel, m) {
  if (sel.length <= 2 * m.length) return false;
  if (!sel.startsWith(m) || !sel.endsWith(m)) return false;
  // Same prefix problem as above, from the other side: "**x**" is not an
  // italic run with a stray character, it is a bold run.
  if (m === '*' && sel.startsWith('**')) return false;
  return true;
}

/**
 * Toggle an emphasis marker around the selection.
 *
 * No selection at all inserts the empty pair and puts the caret between the
 * halves, so the next keystroke lands inside the formatting — the behaviour
 * every editor has trained people to expect from Ctrl+B on an empty cursor.
 */
export function applyMarker(value, start, end, m) {
  const v = String(value ?? '');
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(v.length, Math.max(start, end));

  if (wrappedOutside(v, a, b, m)) {
    const next = v.slice(0, a - m.length) + v.slice(a, b) + v.slice(b + m.length);
    return { value: next, selectionStart: a - m.length, selectionEnd: b - m.length };
  }

  const sel = v.slice(a, b);

  if (wrappedInside(sel, m)) {
    const inner = sel.slice(m.length, sel.length - m.length);
    return {
      value: v.slice(0, a) + inner + v.slice(b),
      selectionStart: a,
      selectionEnd: a + inner.length,
    };
  }

  return {
    value: v.slice(0, a) + m + sel + m + v.slice(b),
    selectionStart: a + m.length,
    selectionEnd: b + m.length,
  };
}

// The renderer's SAFE_URL, restated. A link whose URL is not http(s) is not a
// recognised marker, so it falls through and mails as the literal characters
// the author typed. That is the correct failure — but it is a failure the
// author should hear about while typing, not discover in the preview.
export const isSafeUrl = (u) => /^https?:\/\//i.test(String(u ?? '').trim());

/**
 * Protect literal characters in link text.
 *
 * `]` closes the link-text slot early; a lone `\` can pair with whatever
 * follows and vanish. The grammar's own backslash escape is the fix, and it
 * round-trips: extract() lifts backslash escapes into placeholder slots BEFORE
 * the link pattern runs, so an escaped `]` inside link text is invisible to the
 * link regex and comes back as itself in the mail.
 */
export function escapeLinkText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/]/g, '\\]');
}

/**
 * Wrap the selection in a link. Empty selection yields `[](url)` with the caret
 * between the brackets, ready for the text.
 *
 * The returned selection covers the link TEXT, not the whole construct, so the
 * obvious next action — typing to replace a placeholder — works without the
 * author having to reselect.
 */
export function applyLink(value, start, end, url) {
  const v = String(value ?? '');
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(v.length, Math.max(start, end));
  const text = escapeLinkText(v.slice(a, b));
  const u = String(url ?? '').trim();
  return {
    value: `${v.slice(0, a)}[${text}](${u})${v.slice(b)}`,
    selectionStart: a + 1,
    selectionEnd: a + 1 + text.length,
  };
}
