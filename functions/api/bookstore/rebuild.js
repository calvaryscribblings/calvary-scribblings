// SUMMON A DEPLOY — the endpoint that closes the publish → deploy gap. R19.6.
//
//   POST /api/bookstore/rebuild
//   Authorization: Bearer <firebase id token>          → 202 { building: true }
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE GAP THIS CLOSES
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// next.config.mjs sets `output: 'export'`. Every /bookstore/{slug} and /reader/{slug} page is
// a FILE, enumerated at build time by generateStaticParams() reading live bookstore_titles.
// So publishing a title in the CMS writes a record that nothing serves: the pages for it do
// not exist until the next build runs, and nothing was making one run.
//
// MEASURED, 26 Aug 2026 — `rogues-of-the-east` was published in the CMS and both of its pages
// answered 404 in production for days, while an older title (`basil`) answered 200 from the
// same deploy. The record was correct the whole time. The gap was never in the data.
//
// The publish path can now ask for the build itself. It is a REQUEST, not a promise: Cloudflare
// queues the deploy and takes a minute or two to serve it, which is what the admin's own
// message says (app/lib/bookstore/rebuild.js owns that wording).
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THE HOOK URL IS SERVER-SIDE ONLY, AND MUST STAY THAT WAY
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// A Cloudflare Pages deploy hook is an UNAUTHENTICATED TRIGGER: anyone who POSTs to the URL
// starts a build, forever, with no credential of any kind. It is a secret in the only sense
// that matters — possession IS authorisation.
//
// So it lives in `env.DEPLOY_HOOK_URL`, which a Pages Function reads at request time on the
// server, and it is NEVER read through `process.env` in app/ code. A NEXT_PUBLIC_* variable
// would be inlined into the client bundle; a bare `process.env.X` read in a client component
// would too, because Next's browser shim substitutes any variable defined at build time. This
// endpoint is the ONLY thing that knows the URL, and it never echoes it — not in the 202, not
// in an error body, not in a log line. tests/ci/deploy-hook-secrecy.test.mjs asserts all of
// that, including a scan of the built out/ tree.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// AUTHORISATION — the founders, and no one else
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Same ID-token pattern as every other admin write in functions/api/: the caller presents a
// Firebase ID token as `Authorization: Bearer <token>`, the uid is DERIVED from it through
// identitytoolkit accounts:lookup, and only then compared with the founder list. The admin
// uids are public — they are written into database.rules.json — so anything that trusts a
// uid the CALLER supplies is not an authorisation check at all (see the header of
// functions/api/newsletter/drafts.js for what that cost the newsletter).
//
// The list is the two founder uids from database.rules.json, deliberately WITHOUT the
// email-based widening functions/api/admin/lookup-user.js allows. Publishing a book is one
// thing; spending the account's build minutes at will is another, and this is the narrower
// of the two grants.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// NO RATE LIMIT, AND THE REASON IS NOT "WE FORGOT"
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// R19.1 gave the two endpoints that spend a ceiling (functions/api/_ratelimit.js) and that
// limiter FAILS CLOSED — no FIREBASE_CLIENT_EMAIL, no allowance. Its threat model is "anyone
// on the internet" (/api/hit) and "any signed-in reader" (/api/evaluate-quiz). This endpoint's
// caller set is two verified people. Putting the limiter in front of it would trade a threat
// that does not exist for a real one: a publish that cannot summon its own deploy because a
// service-account variable is unset. If the caller set ever widens beyond the founders, add
// the ceiling in the same change.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// METHOD
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// POST only, by exporting only onRequestPost — Cloudflare Pages answers 405 for every other
// method on its own. A GET that starts a build would be reachable from a prefetch, a link
// preview or a crawler.

import { PROVIDER_TIMEOUT_MS, json } from './_lib.js';

// database.rules.json's admin pair. Kept as a literal rather than imported from app/ because
// a Pages Function is bundled by workerd and must not pull a React tree in behind it — the
// same reason _lib.js re-states FB_DB.
const FOUNDER_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

/**
 * The verified uid behind an ID token, or null.
 *
 * LB-10: the identitytoolkit round trip carries PROVIDER_TIMEOUT_MS, like every other
 * third-party call in this surface. Without a signal, a Google endpoint that accepts the
 * connection and then stops talking holds the invocation until Cloudflare kills it by
 * wall-clock — which no catch block here can observe.
 */
async function verifyIdToken(token, apiKey) {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.users?.[0]?.localId ?? null;
  } catch (e) {
    // A timeout and a rejected token both mean "not authorised here". Logged so the two are
    // distinguishable in the tail even though the caller sees one answer.
    console.error('[bookstore/rebuild] token verification failed:', e?.message || e);
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const uid = await verifyIdToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid || !FOUNDER_UIDS.includes(uid)) return json({ error: 'Unauthorised.' }, 401);

  // ENV ABSENT → 503, AND SAY SO PLAINLY. The hook has to be created by hand in the Cloudflare
  // dashboard (Pages → the project → Settings → Builds & deployments → Deploy hooks) and its
  // URL pasted into the project's environment variables. Until that is done this endpoint
  // cannot work, and the honest answer is "not configured" — not a 500, which reads as a bug,
  // and not a 202, which would lie about a build that is not coming.
  const hook = env.DEPLOY_HOOK_URL;
  if (!hook) {
    console.error('[bookstore/rebuild] DEPLOY_HOOK_URL is not set — cannot summon a deploy');
    return json({
      error: 'Rebuilds are not configured on this deployment. '
           + 'Add DEPLOY_HOOK_URL to the Cloudflare Pages project environment, '
           + 'then publish again — or retry the deployment from the Cloudflare dashboard.',
      code: 'deploy_hook_unconfigured',
    }, 503);
  }

  // The hook takes an empty POST and answers immediately; the BUILD is asynchronous. Same
  // budget as every other third-party call here.
  let res;
  try {
    res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (e) {
    console.error('[bookstore/rebuild] deploy hook unreachable:', e?.message || e);
    return json({
      error: 'The deploy could not be started just now. '
           + 'Retry the deployment from the Cloudflare Pages dashboard.',
      code: 'deploy_hook_unreachable',
    }, 502);
  }

  if (!res.ok) {
    // The STATUS, never the URL. An error body from Cloudflare can echo the request target,
    // so nothing from `res` is forwarded to the caller.
    console.error(`[bookstore/rebuild] deploy hook refused: HTTP ${res.status}`);
    return json({
      error: `The deploy could not be started (the hook answered ${res.status}). `
           + 'Retry the deployment from the Cloudflare Pages dashboard.',
      code: 'deploy_hook_refused',
    }, 502);
  }

  // 202, not 200: the build is ACCEPTED, not finished. The pages this deploy will serve do not
  // exist yet at the moment this response is written.
  console.log(`[bookstore/rebuild] deploy requested by ${uid}`);
  return json({ building: true }, 202);
}
