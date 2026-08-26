// SUMMON A DEPLOY — one endpoint, three named hooks. R19.7.
//
//   POST /api/rebuild
//   Authorization: Bearer <firebase id token>
//   { "hook": "bookstore" | "cms" | "openPages" }      → 202 { building: true, hook }
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS MOVED OUT OF functions/api/bookstore/ (it was /api/bookstore/rebuild in R19.6)
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// It has no bookstore logic and never had any — it verifies a founder and POSTs a URL. As of
// R19.7 three of its four callers are not the bookstore at all: the story CMS, the voices
// admin and the Open Pages moderation queue. Leaving it where it was would have meant the
// forum admin POSTing to a bookstore URL, which is a lie in the path that every future reader
// has to un-learn.
//
// It also had a concrete cost in CI. reader-tests.yml triggers on `functions/api/bookstore/**`,
// so a change to the CMS's deploy wiring would have run the entire browser matrix — twelve
// suites, two builds, thirteen minutes — while proving nothing about it; and a change to the
// forum's wiring would have run nothing at all. At the top level, rules-and-hygiene.yml's
// `functions/**` picks it up and the specs that actually cover it run.
//
// The move costs one path change. Its only R19.6 caller was app/admin/bookstore/page.js, which
// moves in this same commit and ships in the same build.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE GAP THIS CLOSES
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// next.config.mjs sets `output: 'export'`. Every /bookstore/{slug}, /stories/{slug},
// /voices/{slug} and /open-pages/{id} page is a FILE, enumerated at build time from live RTDB.
// Publishing writes a record that nothing serves until a build runs.
//
// MEASURED, 26 Aug 2026 — `rogues-of-the-east` was published in the CMS and both of its pages
// answered 404 in production for days, while an older title answered 200 from the same deploy.
// The record was correct the whole time. The gap was never in the data.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE CLIENT NAMES A HOOK. IT NEVER HOLDS ONE.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The request body carries an IDENTIFIER — 'bookstore', 'cms', 'openPages' — and this endpoint
// maps it to an environment variable through functions/api/_deploy-hooks.js. A URL never
// crosses the boundary in either direction: not accepted from a caller (which would make this
// an open proxy for POSTing anywhere, authenticated by a founder token), and not echoed in a
// 202, an error body or a log line.
//
// That rule is not theoretical. R19.6 found two live hook URLs already hardcoded in client
// components and already shipped in the bundle; both were rotated on 26 Aug 2026 and are dead.
// tests/ci/deploy-hook-secrecy.test.mjs scans the sources AND the built out/ and now allows no
// exceptions at all.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// AUTHORISATION — the founders, and no one else
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Same ID-token pattern as every other admin write in functions/api/: the caller presents a
// Firebase ID token as `Authorization: Bearer <token>`, the uid is DERIVED from it through
// identitytoolkit accounts:lookup, and only then compared with the founder list. The admin uids
// are public — they are written into database.rules.json — so anything that trusts a uid the
// CALLER supplies is not an authorisation check at all (see functions/api/newsletter/drafts.js
// for what that once cost the newsletter).
//
// Deliberately WITHOUT the email-based widening functions/api/admin/lookup-user.js allows.
// Publishing is one thing; spending the account's build minutes at will is another.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// NO RATE LIMIT, AND THE REASON IS NOT "WE FORGOT"
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// R19.1 gave the two endpoints that spend a ceiling (functions/api/_ratelimit.js) and that
// limiter FAILS CLOSED — no FIREBASE_CLIENT_EMAIL, no allowance. Its threat model is "anyone on
// the internet" (/api/hit) and "any signed-in reader" (/api/evaluate-quiz). This endpoint's
// caller set is two verified people. Putting the limiter in front of it would trade a threat
// that does not exist for a real one: a publish that cannot summon its own deploy because a
// service-account variable is unset. If the caller set ever widens, add the ceiling then.
//
// POST only, by exporting only onRequestPost — Pages answers 405 for every other method on its
// own. A GET that starts a build would be reachable from a prefetch or a link preview.

import { PROVIDER_TIMEOUT_MS, json } from './bookstore/_lib.js';
import { HOOK_IDS, resolveHook, fire } from './_deploy-hooks.js';

// database.rules.json's admin pair. A literal rather than an import from app/, because a Pages
// Function is bundled by workerd and must not pull a React tree in behind it — the same reason
// bookstore/_lib.js re-states FB_DB.
const FOUNDER_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

/** The verified uid behind an ID token, or null. */
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
    // A timeout and a rejected token both mean "not authorised here". Logged so the two stay
    // distinguishable in the tail even though the caller sees one answer.
    console.error('[rebuild] token verification failed:', e?.message || e);
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

  // A body that will not parse is the same mistake as a missing `hook`, and gets the same
  // answer — the one that names what was expected.
  let body = null;
  try { body = await request.json(); } catch { /* handled by the resolve below */ }

  const resolved = resolveHook(env, body?.hook);

  if (!resolved.ok && resolved.reason === 'unknown') {
    return json({
      error: `Unknown deploy hook. Expected one of: ${HOOK_IDS.join(', ')}.`,
      code: 'unknown_hook',
      allowed: HOOK_IDS,
    }, 400);
  }

  // ENV ABSENT → 503, AND SAY SO PLAINLY. The hook is created by hand in the Cloudflare
  // dashboard (Pages → the project → Settings → Builds & deployments → Deploy hooks) and its
  // URL pasted into the project's environment variables. Until that is done this cannot work,
  // and the honest answer is "not configured" — not a 500, which reads as a bug, and not a 202,
  // which would lie about a build that is not coming. The VARIABLE NAME is safe to state: it is
  // configuration, it is in this repo, and it is the one fact that makes the message actionable.
  if (!resolved.ok) {
    console.error(`[rebuild] ${resolved.envVar} is not set — cannot summon a deploy`);
    return json({
      error: `Rebuilds are not configured for this surface. Add ${resolved.envVar} to the `
           + 'Cloudflare Pages project environment, then publish again — or retry the '
           + 'deployment from the Cloudflare dashboard.',
      code: 'deploy_hook_unconfigured',
    }, 503);
  }

  const shot = await fire(resolved.url, PROVIDER_TIMEOUT_MS);
  if (!shot.ok) {
    // The STATUS, never the URL. A Cloudflare error body can echo the request target, so
    // nothing from the response is forwarded to the caller.
    return json({
      error: shot.reason === 'refused'
        ? `The deploy could not be started (the hook answered ${shot.status}). `
          + 'Retry the deployment from the Cloudflare Pages dashboard.'
        : 'The deploy could not be started just now. '
          + 'Retry the deployment from the Cloudflare Pages dashboard.',
      code: shot.reason === 'refused' ? 'deploy_hook_refused' : 'deploy_hook_unreachable',
    }, 502);
  }

  // 202, not 200: the build is ACCEPTED, not finished. The pages this deploy will serve do not
  // exist yet at the moment this response is written.
  console.log(`[rebuild] ${body.hook} deploy requested by ${uid}`);
  return json({ building: true, hook: body.hook }, 202);
}
