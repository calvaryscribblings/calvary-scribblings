// THE PUBLISH → DEPLOY HANDSHAKE, client half. R19.6, generalised in R19.7.
//
// A static export serves FILES. Publishing writes a record; the page for it is not built until
// a deploy runs. So every publish path asks for one — see functions/api/rebuild.js for why the
// trigger cannot live in the browser and what the endpoint refuses.
//
// Moved out of app/lib/bookstore/ alongside the endpoint: four surfaces use it and only one of
// them is the bookstore.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ A HOOK IS NAMED HERE. A HOOK IS NEVER HELD HERE.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Nothing in this file, or anywhere under app/, holds a deploy-hook URL or reads the
// environment variable that carries one. A Cloudflare deploy hook is an unauthenticated
// trigger — possession is authorisation — and a `process.env` read of one in a client component
// would be inlined into the bundle by Next at build time.
//
// THIS IS NOT A PRECAUTION, IT IS A REPAIR. Until 26 Aug 2026 two live hook URLs were hardcoded
// in app/admin/page.js, app/admin/voices/page.js and app/admin/forum/page.jsx, and had been
// served in out/_next/static/chunks to every visitor of the site. Both were rotated that day
// and are dead. R19.7 moved all three onto this module, and
// tests/ci/deploy-hook-secrecy.test.mjs now allows no exceptions in the sources or in built
// out/.
//
// A SECOND THING THE MOVE BOUGHT, worth knowing before anyone "simplifies" it back: the old
// call sites fired at api.cloudflare.com from the browser with `mode: 'no-cors'`, because the
// hook answers without an `access-control-allow-origin` header. The response was OPAQUE — a
// dead hook and a successful build were indistinguishable, which is exactly how two rotated
// UUIDs could have kept "working" silently. /api/rebuild is same-origin, so its answer is
// readable and a failure is now a failure.
//
// Pure except for the fetch it is handed, so every rule below is specified without a browser,
// a network or a Firebase user.

export const REBUILD_ENDPOINT = '/api/rebuild';

/**
 * THE HOOK IDENTIFIERS. Mirrors HOOK_ENV in functions/api/_deploy-hooks.js, which owns the map
 * from these to environment variables. Only the NAMES live on this side.
 *
 * tests/ci/rebuild.test.mjs asserts the two sets are identical, so the mirror cannot drift —
 * which is the one way a two-sided table like this normally rots.
 */
export const HOOKS = Object.freeze({
  BOOKSTORE: 'bookstore',   // bookstore titles          → /bookstore/{slug}, /reader/{slug}
  CMS: 'cms',               // stories and voices        → /stories/{slug}, /voices/{slug}
  OPEN_PAGES: 'openPages',  // Open Pages posts          → /open-pages/{id}
});

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

// THE WORDING, IN ONE PLACE. Two minutes is what Cloudflare Pages takes for this project — the
// R19.6 deploy was measured live at 140 seconds from push to a 200 — so it is a truthful
// expectation rather than a comfortable one. It says "will exist", not "is live", because that
// is the actual claim: the pages do not exist yet at the moment it is shown.
export const REBUILD_STARTED = 'Rebuild started — the pages will exist in about two minutes.';

// THE FALLBACK IS NAMED. A failed trigger is not a failed publish, and the message must not read
// like one: the record is already public, and the only thing missing is the deploy that serves
// it. So it says what to do, in the place where it can be done.
export const REBUILD_FALLBACK = 'Retry the deployment from the Cloudflare Pages dashboard.';

// The RTDB write must land before the build reads it, or the deploy renders the world as it was
// a moment ago and the publish looks lost. Ten seconds is what app/admin/page.js has waited
// since long before this module existed; it is preserved rather than reasoned afresh, because
// the number is empirical and nothing has been measured to replace it.
export const SETTLE_MS = 10_000;

/**
 * Ask the server to summon a deploy.
 *
 * NEVER THROWS. The publish has already succeeded by the time this runs, and an exception
 * escaping here would land in the caller's own catch and read as a failed save — the one
 * outcome that must not happen. Every path returns a verdict instead.
 *
 * @param {object}   opts
 * @param {string}   opts.hook                       One of HOOKS.
 * @param {() => Promise<string|null>} opts.getIdToken  Resolves the caller's Firebase ID token.
 * @param {typeof fetch} [opts.fetchImpl]            Injected for the specs.
 * @returns {Promise<{ ok: boolean, status: number|null, message: string }>}
 */
export async function requestRebuild({ hook, getIdToken, fetchImpl = fetch } = {}) {
  const unidentified = `Could not confirm who you are, so no rebuild was started. ${REBUILD_FALLBACK}`;

  let token = null;
  try {
    token = await getIdToken?.();
  } catch (e) {
    return { ok: false, status: null, message: unidentified };
  }
  if (!token) return { ok: false, status: null, message: unidentified };

  let res;
  try {
    res = await fetchImpl(REBUILD_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook }),
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
      ? `${served} The record is published either way.`
      : `The rebuild request failed (${res.status}). The record is published either way. ${REBUILD_FALLBACK}`,
  };
}

/**
 * The fire-and-forget form the CMS surfaces use: wait for the write to settle, then ask.
 *
 * The three CMS call sites have never shown the reader a rebuild verdict — they logged a
 * warning and carried on — and R19.7 does not change that, because changing it would mean
 * redesigning three unrelated save flows in a round about secrets. What it changes is that a
 * failure is now VISIBLE IN THE CONSOLE AS A FAILURE: the old opaque `mode: 'no-cors'` fetch
 * resolved successfully against a hook that no longer existed.
 */
export async function fireRebuild({ hook, getIdToken, fetchImpl, settleMs = SETTLE_MS, wait }) {
  const sleep = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (settleMs > 0) await sleep(settleMs);
  const verdict = await requestRebuild({ hook, getIdToken, fetchImpl });
  if (!verdict.ok) console.warn(`[rebuild:${hook}] not started —`, verdict.status, verdict.message);
  return verdict;
}
