// R32 — asking for a comment to be screened, from the browser, after it is written.
//
// One function, two call sites (the story page and the reading room), so the two cannot
// drift into asking differently. It is deliberately tiny and deliberately silent.
//
// ⚠⚠ THIS IS FIRE AND FORGET, AND THAT IS THE WHOLE DESIGN.
//
// A moderation failure must never block somebody from commenting. The comment has already
// landed in RTDB by the time this is called — in the same atomic multi-path update that
// carries its user_comments index entry — so nothing here can undo it, delay it, or make it
// look like it failed. If the endpoint is down, slow, unconfigured or removed, comments keep
// working perfectly and simply never become promotable, which is the safe direction: no
// verdict means not promotable, permanently, until something re-runs.
//
// So: no await at the call sites, no error surfaced, no state, no toast. The only reason it
// returns a promise at all is so the suite can await it.

/**
 * @param {object} opts
 * @param {() => Promise<string|null>} opts.getIdToken  the caller's Firebase ID token
 * @param {string} opts.slug
 * @param {string} opts.commentId
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<boolean>} true only if the endpoint answered at all. Never throws.
 */
export async function requestScreening({ getIdToken, slug, commentId, fetchImpl = fetch }) {
  try {
    if (!slug || !commentId) return false;
    const token = await getIdToken?.();
    if (!token) return false;
    // The body carries two identifiers and NOTHING ELSE — in particular not the text. The
    // endpoint re-reads the stored comment, so there is no way to get one string screened
    // and a different one saved.
    const res = await fetchImpl('/api/comments/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, commentId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
