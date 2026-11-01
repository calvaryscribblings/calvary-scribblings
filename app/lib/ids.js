// LIVE-PATHS-1 — AN ID IS CHECKED BEFORE IT BECOMES A DATABASE ADDRESS.
//
// Every path this codebase builds from a value a caller can influence (a URL, a query string, a
// body, a form, a field a reader can write) goes through assertId() first. An id that does not
// match its kind's pattern is REFUSED: never trimmed, decoded, lower-cased or otherwise cleaned
// into something that passes. A refusal is an IdError carrying status 400; nothing has been sent
// to the database when it is thrown.
//
// Why a pattern and not "no slashes": over REST, `newsletter_drafts/${id}.json` with id
// `../subscribers` resolves to `/subscribers.json`, an id of `.` in an incoming URL is normalised
// away to '' before the code ever sees it, and an empty segment collapses `x/${id}` onto the
// whole of `x`. The SDK refuses `.` but not '' or '/'. A positive pattern refuses all of these
// and anything nobody has thought of yet.
//
// HOW EACH PATTERN WAS DERIVED (1 Nov 2026; keys-only reads of the public nodes, no records):
//
//   slug     cms_stories (270 keys), cms_stories_index (213), cms_quizzes (160): every key is
//            lowercase a-z0-9 words joined by single hyphens, longest 91. That is exactly what
//            app/lib/storySlug.js slugify() makes (and newStorySlug offers `-2`…`-50` on it).
//            Cap 128: 37 characters of headroom over the longest live slug.
//   draftId  newsletter_drafts has no database rule, so no client can write it: the only writer
//            is the newsletter Worker's save, whose id is `Date.now().toString()` in every
//            version of the mirror since it was first committed (6327e1d1). The admin only
//            ever sends back an id the Worker returned. 13 digits, no leading zero, until 2286.
//   uid      Firebase Auth generates 28-character alphanumeric uids (the live test reader is
//            created the same way). /^[A-Za-z0-9]{1,64}$/ is REF_SAFE_UID, already the live
//            gate on every money flow (membership + bookstore checkouts), so no real account
//            fails it.
//   sendId   newsletter_sends keys are RTDB push ids (the Worker POSTs to newsletter_sends.json):
//            always exactly 20 characters of [A-Za-z0-9_-].
//
// THE NEWSLETTER WORKER CARRIES A COPY of the block between the two MIRROR markers below
// (workers-external/calvary-newsletter.worker.js; it is pasted into the Cloudflare dashboard and
// cannot import). tests/ci/live-paths-ids.test.mjs fails if the two copies differ by a byte.

// ── ID RULES MIRROR (app/lib/ids.js ⇄ workers-external/calvary-newsletter.worker.js) ──
const ID_RULES = {
  slug: { re: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, max: 128 },
  draftId: { re: /^[1-9][0-9]{12}$/, max: 13 },
  uid: { re: /^[A-Za-z0-9]+$/, max: 64 },
  sendId: { re: /^[A-Za-z0-9_-]{20}$/, max: 20 },
};

function isId(kind, value) {
  const rule = ID_RULES[kind];
  if (!rule) throw new Error(`isId: unknown id kind "${kind}"`);
  return typeof value === "string" && value.length > 0 && value.length <= rule.max && rule.re.test(value);
}
// ── END ID RULES MIRROR ──

export { ID_RULES, isId };

/** A refused id. `status` is what an HTTP handler answers with. */
export class IdError extends Error {
  constructor(kind, value) {
    const shown = typeof value === 'string' ? (value.length > 40 ? `${value.slice(0, 40)}…` : value) : typeof value;
    super(`Refused ${kind}: ${JSON.stringify(shown)} is not a valid ${kind}. Nothing was written.`);
    this.name = 'IdError';
    this.kind = kind;
    this.status = 400;
  }
}

/** Returns the id unchanged, or throws IdError. Call it BEFORE building the path. */
export function assertId(kind, value) {
  if (!isId(kind, value)) throw new IdError(kind, value);
  return value;
}
