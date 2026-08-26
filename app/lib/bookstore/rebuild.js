// THE PUBLISH → DEPLOY HANDSHAKE, client half. R19.6.
//
// A static export serves FILES. Publishing a title writes a record; the /bookstore/{slug} and
// /reader/{slug} pages for it are not built until a deploy runs. So the admin asks for one,
// right after the status flip that made the record public — see functions/api/bookstore/
// rebuild.js for why the trigger cannot live in the browser and what the endpoint refuses.
//
// ⚠ THE HOOK URL IS NOT HERE, AND MUST NEVER BE. Nothing in this file, or anywhere under app/,
// reads the deploy-hook environment variable. A Cloudflare deploy hook is an unauthenticated
// trigger — possession is authorisation — and a `process.env` read of it in a client component
// would be inlined into the bundle by Next at build time. This module knows one thing: the path
// of an endpoint that will do it for you, if you can prove you are a founder.
//
// (The variable is not spelled out above on purpose: tests/ci/deploy-hook-secrecy.test.mjs
// scans app/ for a READ of it, and the read form written into a comment is indistinguishable
// from the real thing to a scanner — which is the correct way round for that scanner to be
// wrong.)
// tests/ci/deploy-hook-secrecy.test.mjs asserts the absence, in the sources AND in built out/.
//
// Pure except for the fetch it is handed, so the two rules below can be specified without a
// browser, a network or a Firebase user.

export const REBUILD_ENDPOINT = '/api/bookstore/rebuild';

/**
 * Does flipping `prev` → `next` change what the world can see?
 *
 *   draft → published        yes — the pages must start existing
 *   published → unpublished  yes — the pages must stop existing
 *   draft → unpublished      no  — invisible either way, no build is owed
 *   published → published    no  — a no-op flip, and the endpoint must be called ONCE PER
 *                                  FLIP, not once per click
 *
 * A build is minutes of somebody's compute. The rule is "publishedness changed", not "status
 * changed", because the second one spends them on transitions nobody can see.
 */
export function rebuildNeeded(prev, next) {
  return (prev === 'published') !== (next === 'published');
}

// THE WORDING, IN ONE PLACE. Two minutes is what Cloudflare Pages takes for this project on a
// cold cache — the covers workflow, which builds nothing, runs 2m17s–2m50s — so it is a
// truthful expectation rather than a comfortable one. It says "will exist", not "is live",
// because that is the actual claim: the pages do not exist yet at the moment it is shown.
export const REBUILD_STARTED = 'Rebuild started — this book’s pages will exist in about two minutes.';

// THE FALLBACK IS NAMED. A failed trigger is not a failed publish, and the message must not
// read like one: the record is already public, and the only thing missing is the deploy that
// serves it. So it says what to do, in the place where it can be done.
export const REBUILD_FALLBACK = 'Retry the deployment from the Cloudflare Pages dashboard.';

/**
 * Ask the server to summon a deploy.
 *
 * NEVER THROWS. The publish has already succeeded by the time this runs, and an exception
 * escaping here would land in the caller's own catch and read as a failed save — the one
 * outcome that must not happen. Every path returns a verdict instead.
 *
 * @param {object}   opts
 * @param {() => Promise<string|null>} opts.getIdToken  Resolves the caller's Firebase ID token.
 * @param {typeof fetch} [opts.fetchImpl]               Injected for the specs.
 * @returns {Promise<{ ok: boolean, status: number|null, message: string }>}
 */
export async function requestRebuild({ getIdToken, fetchImpl = fetch } = {}) {
  let token = null;
  try {
    token = await getIdToken?.();
  } catch (e) {
    return { ok: false, status: null, message: `Could not confirm who you are, so no rebuild was started. ${REBUILD_FALLBACK}` };
  }
  if (!token) {
    return { ok: false, status: null, message: `Could not confirm who you are, so no rebuild was started. ${REBUILD_FALLBACK}` };
  }

  let res;
  try {
    res = await fetchImpl(REBUILD_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, status: null, message: `The rebuild could not be reached. ${REBUILD_FALLBACK}` };
  }

  if (res.status === 202) return { ok: true, status: 202, message: REBUILD_STARTED };

  // The endpoint's own sentence when it has one — it is the half that knows WHY. Falling back
  // to the status is deliberate: a body that will not parse must not swallow the failure.
  let served = '';
  try {
    served = (await res.json())?.error || '';
  } catch { /* not JSON; the status below still names the failure */ }

  return {
    ok: false,
    status: res.status,
    message: served
      ? `${served} The book is published either way.`
      : `The rebuild request failed (${res.status}). The book is published either way. ${REBUILD_FALLBACK}`,
  };
}
