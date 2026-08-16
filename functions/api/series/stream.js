// THE SERIES INSTALMENT ENDPOINT — Cloudflare Pages Function.
//
// POST /api/series/stream
//   credential:  Authorization: Bearer <Firebase ID token>   (preferred)
//                or body { idToken }                          (the web reader)
//   selector:    body { instalmentId } — or ?instalmentId= in the query string
//
//   → 200 { url, expiresAt, version, md5, reason }
//   → 401 { code: 'signed_out' }          ← not reachable while the tier gate is off
//   → 403 { code: 'not_released' }      ← checked FIRST, for everyone
//   → 403 { code: 'tier_too_low', reason: 'needs_platinum' | 'needs_gold' | 'pass_excluded' }
//   → 404 { code: 'not_found' }
//   → 502 { code: 'unavailable' }
//
// A DELIBERATE TRANSPLANT of functions/api/bookstore/stream.js. The five parts that made
// that endpoint work are copied rather than reinvented — storage prefix at `read: false`,
// short-lived signed URL, identity from a VERIFIED token, entitlement read with an ADMIN
// token, and refusal codes distinct enough to word an honest sentence. Everything below that
// differs from the bookstore differs for a stated reason, and the four reasons are these.
//
// ── 0. THE TIER GATE IS CURRENTLY OFF, AND THE RELEASE GATE IS NOT ───────────────────────
//
// SERIES_TIER_GATE_ENABLED (app/lib/series/access.js) is false while MEMBERSHIPS_ON_SALE is
// false: nobody can buy Platinum before 30 September, so gating against it would refuse every
// reader in the name of a tier the site will not sell them. While it is off this endpoint
// asks for no credential and reads no membership, and answers 200 with reason 'tier_gate_off'
// to anyone.
//
// THE RELEASE CHECK IS UNAFFECTED AND STILL RUNS FIRST, FOR EVERYONE. The two gates answer
// different questions and only one of them is about money. Flipping the flag back to true
// restores the tier behaviour exactly — nothing below is deleted, bypassed or stubbed, and
// the policy it runs is still asserted by the suite while the switch is off.
//
// ── 1. RELEASE IS A GATE THE BOOKSTORE DOES NOT HAVE ─────────────────────────────────────
//
// A purchased book is available the moment it is bought. An instalment is not available to
// ANYONE — Platinum included — until releaseAtMs. That check runs before identity and before
// tier (see app/lib/series/access.js for why the order is load-bearing), and it runs HERE on
// the server clock as well as in database.rules.json, which independently denies the detail
// record until the same instant. Two enforcements of one fact, on two clocks that are the
// same clock: the rule stops a direct RTDB read, this stops a signed URL.
//
// ── 2. ENTITLEMENT IS TWO READS, NOT ONE, AND THE ANSWER EXPIRES ─────────────────────────
//
// A purchase is one lookup of a durable fact. A tier is `users/{uid}/membership` AND
// `memberships/{uid}` — the scalar plus the billing record — read together. The Promise.all
// shape is lifted from functions/api/story.js:233-241, which already does exactly this.
//
// ONLY THE SUBSCRIPTION DECIDES. The pass on the detail record is read so the refusal can be
// worded, and never so it can open anything. app/lib/membershipPasses.js sets PASS_TIER =
// 'gold', so a £1 day pass produces the same tier string a real Gold membership does; a gate
// written against effectiveTier() would hand every freeForGold instalment of every series to
// a day-pass holder. See the long note in app/lib/series/access.js:grantForInstalment.
//
// ── 3. A LAPSED MEMBER KEEPS READING FOR THE REST OF THE TTL. DOCUMENTED, NOT FIXED. ─────
//
// The signed URL lives 300 seconds. Entitlement is checked once, when it is minted. A member
// whose subscription lapses ten seconds later can still fetch the file for the remaining
// 290. This is ACCEPTED and stated rather than hidden, for the same reason the bookstore
// accepts its own: the alternative is a proxy that re-checks per byte range, which would put
// this Worker in the path of every page turn of every book on the site to close a
// five-minute window on an edge case that costs nothing. Nothing durable is handed over —
// the URL is single-use in practice and the reader re-requests on the next open.
//
// ── 4. DOWNGRADES FAIL OPEN. ALSO DELIBERATE, ALSO NOT A BUG. ────────────────────────────
//
// functions/api/membership/_membership.js reuses classifyRevocation(): when a cancellation
// event cannot be matched to the stored subscription, NOTHING is written and a human is
// told. Its own header explains why — "leaving a lapsed member on Gold until someone looks
// is the cheaper error; taking Gold from someone who just paid for it is not." The
// consequence for this endpoint is that a FAILED downgrade over-grants the Series rather
// than under-granting it. That is the platform's posture, inherited on purpose. It is
// written here so that the first person to notice a lapsed member still reading files it as
// the known trade-off it is, and not as a hole in this gate.
//
// ── WHAT IS THE SAME, AND MUST STAY THE SAME ─────────────────────────────────────────────
//
//   · The uid comes from a verified ID token, never from the request body.
//   · The entitlement read uses the ADMIN token, so the decision never passes through a
//     client that could lie about it.
//   · A read failure FAILS CLOSED (502), because an unknown entitlement is indistinguishable
//     from no entitlement and the safe reading of an unknown is to withhold.
//   · The object metadata read happens AFTER entitlement, so a refused caller learns nothing
//     about the object — not even that it exists.
//   · `version` is the Cloud Storage generation, ALWAYS a string, NEVER request-derived. It
//     is the app's download-cache key and the pin beside a stored CFI. An explicit null means
//     do-not-cache; an omitted key would be a guess. See docs/reading-position-pin.md.
//   · /api/ is in PASS_THROUGH_PATHS in public/sw.js, so the service worker never caches or
//     replays this. A cached signed URL is a stale one.

import {
  json,
  dbBase,
  verifyIdToken,
  mintAccessToken,
  signGetUrl,
  STORAGE_BUCKET,
  STORAGE_READ_SCOPE,
  SCOPES,
  FIREBASE_TIMEOUT_MS,
  PROVIDER_TIMEOUT_MS,
} from '../bookstore/_lib.js';
import { effectiveTier, normaliseTier } from '../../../app/lib/membership.js';
import {
  grantForInstalment,
  policyGrantForInstalment,
  refusalCopy,
  REFUSAL_STATUS,
  SERIES_TIER_GATE_ENABLED,
  TIER_GATE_OFF,
} from '../../../app/lib/series/access.js';
import { epubObjectPath, INSTALMENT_ID_RE, INSTALMENTS_PATH } from '../../../app/lib/series/schema.js';

const SIGNED_URL_TTL_SECONDS = 300;

// One token, two Google calls: the RTDB reads and the object-metadata read. Minting a second
// for the metadata would double the OAuth round-trips on every open.
const STREAM_SCOPES = `${SCOPES} ${STORAGE_READ_SCOPE}`;

/**
 * The object's `generation` and `md5Hash`, or nulls. NEVER THROWS — the caller has already
 * proved entitlement, so a metadata hiccup must not stand between a member and an instalment
 * they are entitled to. Byte-for-byte the bookstore's function; kept local rather than
 * exported from _lib.js because that file is the BOOKSTORE's shared half and this endpoint
 * must be able to change without a bookstore review.
 */
async function readObjectVersion({ bucket, objectPath, token }) {
  try {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`
      + `/o/${encodeURIComponent(objectPath)}?fields=generation,md5Hash`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GCS metadata GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const meta = await res.json();
    // A decimal string that exceeds Number.MAX_SAFE_INTEGER — parsing it would quietly
    // corrupt the cache key and, since R11.22, the position pin with it.
    const version = typeof meta?.generation === 'string' && meta.generation ? meta.generation : null;
    if (!version) throw new Error(`GCS metadata carried no generation: ${JSON.stringify(meta).slice(0, 200)}`);
    return { version, md5: typeof meta?.md5Hash === 'string' && meta.md5Hash ? meta.md5Hash : null };
  } catch (e) {
    console.error(`[series/stream] version lookup FAILED for ${objectPath} — serving version:null:`, e.message || e);
    return { version: null, md5: null };
  }
}

/** Header first, body second. The native app sends the header; the web reader sends the body. */
function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  const fromBody = body?.idToken;
  return typeof fromBody === 'string' && fromBody ? fromBody : null;
}

async function readJson(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const now = Date.now();

  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error('[series/stream] NEXT_PUBLIC_FIREBASE_API_KEY is not set');
    return json({ error: 'The Series is not configured yet. Please try again later.', code: 'unavailable' }, 500);
  }
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[series/stream] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'The Series is not configured yet. Please try again later.', code: 'unavailable' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  const query = new URL(request.url).searchParams;
  const instalmentId = body?.instalmentId || query.get('instalmentId');

  if (!instalmentId || typeof instalmentId !== 'string' || !INSTALMENT_ID_RE.test(instalmentId)) {
    return json({ error: 'instalmentId required.' }, 400);
  }

  // ── the admin token ────────────────────────────────────────────────────────
  // Minted BEFORE the release check, because the release check needs a read. The public row
  // is world-readable and could in principle be fetched without a token, but doing it with
  // one keeps every read on this path on the same credential and out of reach of a rules
  // change nobody remembered this endpoint depended on.
  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, STREAM_SCOPES);
  } catch (e) {
    console.error('[series/stream] admin token mint failed:', e.message || e);
    return json({ error: refusalCopy({ reason: 'unavailable' }), code: 'unavailable' }, REFUSAL_STATUS.unavailable);
  }

  // ── the instalment row ─────────────────────────────────────────────────────
  let row;
  try {
    row = await readJson(env, token, `${INSTALMENTS_PATH}/${encodeURIComponent(instalmentId)}`);
  } catch (e) {
    // FAIL CLOSED. A read error is indistinguishable from "no such instalment".
    console.error(`[series/stream] row read failed for ${instalmentId}:`, e.message || e);
    return json({ error: refusalCopy({ reason: 'unavailable' }), code: 'unavailable' }, REFUSAL_STATUS.unavailable);
  }

  if (!row || typeof row !== 'object') {
    return json({ error: 'That instalment could not be found.', code: 'not_found' }, REFUSAL_STATUS.not_found);
  }

  // ── GATE 1: release. Everyone, tier ignored, before identity. ──────────────
  // Evaluated with signedIn:true so that an unreleased instalment answers not_released to a
  // signed-out caller too, rather than asking them to sign in for something sign-in cannot
  // reach. The signed-out case is handled immediately after, for RELEASED instalments only.
  const releaseGrant = grantForInstalment(row, { signedIn: true, now });
  if (releaseGrant.reason === 'not_released') {
    console.log(`[series/stream] not_released instalmentId=${instalmentId} releaseAtMs=${releaseGrant.releaseAtMs ?? 'null'}`);
    return json({
      error: refusalCopy(releaseGrant),
      code: 'not_released',
      releaseAtMs: releaseGrant.releaseAtMs,
    }, releaseGrant.status);
  }

  // ── GATE 2: entitlement — SKIPPED ENTIRELY WHILE THE TIER GATE IS OFF ──────
  //
  // Not "checked and forgiven": not asked at all. With SERIES_TIER_GATE_ENABLED false the
  // Series is free to everyone, so there is no uid to establish and no membership to read —
  // and doing either anyway would cost two RTDB round-trips per open to reach a conclusion
  // the flag has already made. It would also break the promise: a reader with no account
  // cannot be signed in, and "free to everyone" that still demands a sign-in is a smaller
  // wall, not an open door.
  //
  // NOTE WHAT IS ABOVE THIS LINE AND STAYS THERE: the release check. It has already run, on
  // the server clock, for everybody. An unreleased instalment is refused here exactly as it
  // is when the gate is on. The flag is about money; the date is not.
  let uid = null;
  let grant;

  if (!SERIES_TIER_GATE_ENABLED) {
    grant = { access: 'granted', reason: TIER_GATE_OFF, code: null, status: 200 };
    console.log(`[series/stream] tier gate OFF — granting instalmentId=${instalmentId} to an unauthenticated caller`);
  } else {
    // ── identity ─────────────────────────────────────────────────────────────
    if (!idToken) {
      return json({ error: 'Sign in to read this instalment.', code: 'signed_out' }, REFUSAL_STATUS.signed_out);
    }
    uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
    if (!uid) {
      return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, REFUSAL_STATUS.signed_out);
    }

    // Two reads, subscription decides.
    let scalar;
    let detail;
    try {
      [scalar, detail] = await Promise.all([
        readJson(env, token, `users/${encodeURIComponent(uid)}/membership`),
        readJson(env, token, `memberships/${encodeURIComponent(uid)}`),
      ]);
    } catch (e) {
      // FAIL CLOSED, and 502 not 503 — see the ruling in app/lib/series/access.js. Unlike
      // /api/story, which can still serve a preview when the membership read fails, there is
      // no degraded thing to hand over here: an instalment is a whole file or nothing.
      console.error(`[series/stream] membership read failed for ${uid}:`, e.message || e);
      return json({ error: refusalCopy({ reason: 'unavailable' }), code: 'unavailable' }, REFUSAL_STATUS.unavailable);
    }

    const subscriptionTier = normaliseTier(scalar);
    // policyGrantForInstalment, not grantForInstalment: this branch only runs when the flag is
    // ON, so the flag has nothing left to say and calling the wrapped version would be asking
    // a question already answered. It also keeps the two paths honest — the branch that
    // enforces reads the POLICY, the branch that does not enforce never reaches it.
    grant = policyGrantForInstalment(row, {
      subscriptionTier,
      effectiveTier: effectiveTier(scalar, detail, now),
      signedIn: true,
      now,
    });

    if (grant.access !== 'granted') {
      console.log(
        `[series/stream] refused uid=${uid} instalmentId=${instalmentId} code=${grant.code} reason=${grant.reason} sub=${subscriptionTier}`,
      );
      return json({
        error: refusalCopy(grant),
        code: grant.code,
        reason: grant.reason,
        requiredTier: grant.requiredTier || null,
      }, grant.status);
    }
  }

  // ── the bytes ──────────────────────────────────────────────────────────────
  // DERIVED from the id, never read from the record — epubObjectPath() in
  // app/lib/series/schema.js is the single definition the uploader also writes through. This
  // is the bookstore's pattern verbatim, and its reason: a second RTDB round-trip to learn a
  // constant would cost latency on every open.
  const objectPath = epubObjectPath(instalmentId);
  const bucket = env.FIREBASE_STORAGE_BUCKET || STORAGE_BUCKET;

  let signed;
  try {
    signed = await signGetUrl({
      bucket,
      objectPath,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKeyPem: env.FIREBASE_PRIVATE_KEY,
      expiresSeconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (e) {
    console.error(`[series/stream] signing failed for ${objectPath}:`, e.message || e);
    return json({ error: refusalCopy({ reason: 'unavailable' }), code: 'unavailable' }, 500);
  }

  const { version, md5 } = await readObjectVersion({ bucket, objectPath, token });

  console.log(
    `[series/stream] signed uid=${uid || '-'} instalmentId=${instalmentId} reason=${grant.reason} ttl=${SIGNED_URL_TTL_SECONDS}s version=${version ?? 'null'}`,
  );
  return json({ url: signed.url, expiresAt: signed.expiresAt, version, md5, reason: grant.reason });
}
