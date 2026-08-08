// Story serving — Cloudflare Pages Function. THE implementation of STORY-SERVING-CONTRACT.md.
//
// POST /api/story
//   credential:  Authorization: Bearer <Firebase ID token>   (preferred)
//                or body { idToken }                          (the web story page)
//                or NOTHING AT ALL — see below
//   selector:    body { slug } (aliases: storySlug, id)
//
//   → 200 { slug, access, reason, publishedAtMs, freeUntilMs, readTimeMinutes,
//           degraded, readerHref, content? | preview?+previewOf? }
//   → 400 { code: 'bad_request' }        401 { code: 'signed_out' }
//   → 404 { code: 'not_found' }          405 { code: 'method_not_allowed' }
//   → 500 { code: 'misconfigured' | 'preview_failed' }
//   → 502 { code: 'unavailable' }        503 { code: 'entitlement_unavailable' }
//
// ── THE CREDENTIAL IS OPTIONAL, AND THAT IS THE FIRST DIFFERENCE FROM stream.js ──
//
// bookstore/stream.js opens a book somebody bought, so no token means no answer.
// This serves a magazine. A signed-out reader is entitled to every story inside the
// free window, to the five newest, to all poetry, and to a preview of everything
// else — answering them 401 would paywall the front page.
//
//   no token at all                  → tier 'free', 200
//   a token that does not verify     → 401 signed_out
//
// Those are NOT the same case. An expired token means a reader who THINKS they are
// signed in; silently downgrading them to free shows a paying member a paywall with
// no way to understand it.
//
// ── A GATE IS NEVER A REFUSAL ────────────────────────────────────────────────────
//
// There is deliberately NO 403 in this file. Not being entitled is a 200 with a
// preview. If you find yourself adding a 403 here, the gate has been modelled wrong.
//
// ── WHERE THE DECISION LIVES ─────────────────────────────────────────────────────
//
// Not here. grantFor() in app/lib/storyAccess.js decides, and effectiveTier() in
// app/lib/membership.js resolves the tier it is given. This file's job is I/O:
// verify a token, read three nodes with an admin token, hand the pure functions
// their inputs, and serialise the answer. That split is what lets `node --test`
// assert the policy without a network.

import {
  json,
  dbBase,
  verifyIdToken,
  mintAccessToken,
  SCOPES,
  FIREBASE_TIMEOUT_MS,
} from './bookstore/_lib.js';
import { effectiveTier } from '../../app/lib/membership.js';
import { grantFor, resolveRecentFloor, readerShapeError } from '../../app/lib/storyAccess.js';
import { indexReadTime } from '../../app/lib/storyIndex.js';
import { cutPreview } from '../../app/lib/previewCut.js';
import { MalformedHtmlError } from '../../app/lib/htmlBlocks.js';
import { readTelemetry, recordClient } from './_telemetry.js';

const STORIES_PATH = 'cms_stories';
const BODIES_PATH = 'story_bodies';
const INDEX_PATH = 'cms_stories_index';

// Slugs are produced by slugify() in the admin composer. Generous rather than tight —
// it exists to stop a crafted id walking out of the node into some other path.
const SLUG_RE = /^[A-Za-z0-9_-]{1,200}$/;

// ── THE FLOOR CACHE ──────────────────────────────────────────────────────────────
// The most-recent-5 set is IDENTICAL for every reader and every slug, and changes
// only when a story publishes or is withdrawn. Resolving it per request would put a
// second RTDB round-trip on every story open to learn a value that changes a few
// times a week.
//
// Cached in the isolate, which Cloudflare keeps warm across requests. 60s.
//
// STALENESS ONLY EVER ERRS TOWARD FREE, and that is why 60s is safe: a story that
// should have LEFT the floor stays free for up to a minute longer. It cannot err the
// other way, because a story that should have JOINED the floor is newly published and
// therefore inside the seven-day window regardless.
const FLOOR_TTL_MS = 60_000;
let floorCache = { at: 0, slugs: [] };

// limitToLast is over ALL index records, but the floor counts only GATEABLE ones
// (published, not reader-mode, not poetry — see isGateable). So the query has to
// over-fetch and filter. 40 gives comfortable headroom: it would take 35 consecutive
// poetry/reader-mode publications to exhaust it, against a corpus where they are ~15%.
const FLOOR_QUERY_LIMIT = 40;

async function loadRecentFloor(env, token, now) {
  if (now - floorCache.at < FLOOR_TTL_MS && floorCache.slugs.length) return floorCache.slugs;

  // Requires "publishedAtMs" in .indexOn on cms_stories_index (database.rules.json).
  // Without it Firebase REFUSES the query rather than answering slowly, so a failure
  // here is a rules problem, not a performance one.
  const url = `${dbBase(env)}/${INDEX_PATH}.json`
    + `?orderBy=${encodeURIComponent('"publishedAtMs"')}&limitToLast=${FLOOR_QUERY_LIMIT}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`floor query failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const slugs = resolveRecentFloor((await res.json()) || {});
  floorCache = { at: now, slugs };
  return slugs;
}

/** The ID token, preferring the header. Same precedence as bookstore/stream.js. */
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
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Cache-Control on EVERY path including the anonymous preview: `access` varies by
// reader and by clock, and one CDN or service-worker hit that serves a member's full
// body to a signed-out device undoes the whole thing.
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function respond(data, status = 200) {
  const res = json(data, status);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

async function handlePost(context) {
  const { request, env } = context;
  const now = Date.now();

  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[story] server env incomplete');
    return respond({ error: 'Reading is not configured yet. Please try again later.', code: 'misconfigured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); }
    catch { return respond({ error: 'Invalid request body.', code: 'bad_request' }, 400); }
  }

  const slug = body?.slug || body?.storySlug || body?.id;
  if (!slug || typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return respond({ error: 'slug required.', code: 'bad_request' }, 400);
  }

  // ── TELEMETRY. NEVER an input to entitlement or to the response shape ──────
  // It exists so that when the node is cut (T3) we can see who is still on the old
  // path — "proceed on a number", not on a date.
  //
  // updateId AND runtime were added at the app session's request (R11.10) and they
  // are the fields that make the number real. The fleet updates over the air, so
  // clientVersion '1.2.0' is the same string on a device carrying today's OTA bundle
  // and on one that has not fetched an update in a month — and the OTA lane is
  // exactly what T2 has to count. Expo's Updates.updateId distinguishes them;
  // `runtime` (the runtime version) separates a native rebuild from an OTA push.
  const telemetry = readTelemetry(body);
  const { client, clientVersion, updateId, runtime } = telemetry;

  // ── identity (optional) ────────────────────────────────────────────────────
  const idToken = readIdToken(request, body);
  let uid = null;
  if (idToken) {
    uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
    // PRESENT AND BROKEN is a 401. ABSENT is not — see the header note.
    if (!uid) {
      return respond({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
    }
  }

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES);
  } catch (e) {
    console.error('[story] admin token mint failed:', e.message || e);
    return respond({ error: 'Could not open that story just now. Please try again.', code: 'unavailable' }, 502);
  }

  // Adoption counter, fired and forgotten. NEVER awaited on the response path — a
  // slow counter must not cost a reader a story. See functions/api/_telemetry.js for
  // why /api/hit carries the other half of this measurement.
  if (context.waitUntil) {
    context.waitUntil(recordClient({ dbUrl: dbBase(env), token, surface: 'story', tele: telemetry, now }));
  }

  // ── the story record ───────────────────────────────────────────────────────
  let story;
  try {
    story = await readJson(env, token, `${STORIES_PATH}/${encodeURIComponent(slug)}`);
  } catch (e) {
    // Fail CLOSED. A read error is indistinguishable from "no such story", and the
    // safe reading of an unknown state is to withhold.
    console.error(`[story] record read failed for ${slug}:`, e.message || e);
    return respond({ error: 'Could not open that story just now. Please try again.', code: 'unavailable' }, 502);
  }

  // Hidden is 404, not 403 — a 403 would confirm that unpublished editorial work
  // exists. There is no reader-facing difference between "never existed" and "not
  // for you to know about yet", and the one that leaks less wins.
  if (!story || typeof story !== 'object' || story.published === false) {
    return respond({ error: 'That story could not be found.', code: 'not_found' }, 404);
  }

  // ── the floor, then entitlement ────────────────────────────────────────────
  let floorSlugs = [];
  let floorDegraded = false;
  try {
    floorSlugs = await loadRecentFloor(env, token, now);
  } catch (e) {
    // NOT fatal. The floor can only ever make a story MORE free, so losing it
    // withholds a grant rather than handing one out — the safe direction. Logged
    // loudly because a persistent failure silently gates five stories that policy
    // says are free, which is invisible from the outside.
    console.error('[story] recent-floor query FAILED — five stories may gate early:', e.message || e);
    floorDegraded = true;
  }

  // The membership read is SKIPPED unless it can change the answer: a story that is
  // already free to everyone costs a signed-out reader zero membership reads, and a
  // membership outage cannot degrade a story nobody needed a tier for.
  const provisional = grantFor(story, { tier: 'free', floorSlugs, slug, now });

  let tier = 'free';
  let entitlementDegraded = false;
  if (provisional.access === 'preview' && uid) {
    try {
      const [scalar, detail] = await Promise.all([
        readJson(env, token, `users/${encodeURIComponent(uid)}/membership`),
        readJson(env, token, `memberships/${encodeURIComponent(uid)}`),
      ]);
      tier = effectiveTier(scalar, detail, now);
    } catch (e) {
      console.error(`[story] membership read failed for ${uid}:`, e.message || e);
      entitlementDegraded = true;
    }
  }

  const grant = entitlementDegraded
    ? provisional
    : grantFor(story, { tier, floorSlugs, slug, now });

  const base = {
    slug,
    access: grant.access,
    reason: grant.reason,
    publishedAtMs: typeof story.publishedAtMs === 'number' ? story.publishedAtMs : null,
    freeUntilMs: grant.freeUntilMs,
    readerHref: null,
    // ── READ TIME FOR THE WHOLE STORY, NOT FOR WHAT WE SENT ──────────────────
    // Added R11.10 at the app session's request. The app computed this client-side
    // from whatever body it held, which understates on a preview (30% of the prose
    // reads as 30% of the minutes) and collapses to "1 min read" on a T3 tombstone.
    // Both are wrong in the direction that makes the story look slighter than it is.
    //
    // Filled in below, once the full body has been read. Always a NUMBER on a prose
    // response and null on access:'reader', where the text is an EPUB this endpoint
    // never opens — an explicit null the app can branch on, not an omission.
    readTimeMinutes: null,
    degraded: entitlementDegraded || floorDegraded,
  };

  console.log(
    `[story] ${slug} access=${grant.access} reason=${grant.reason} uid=${uid || '-'} tier=${tier}`
    + `${base.degraded ? ' DEGRADED' : ''}`
    + `${client ? ` client=${client}/${clientVersion}${updateId ? `/${updateId}` : ''}${runtime ? ` rt=${runtime}` : ''}` : ''}`,
  );

  // THE DATA ERROR, absorbed here and nowhere else. category says book, flags say
  // prose — see readerShapeError() for the ruling. The story is still routed to
  // /reader below so no reader is broken by a record they did not write, but it is
  // logged loudly because clients are forbidden from carrying the fallback and this
  // is therefore the only place the shape can be found.
  if (readerShapeError(story)) {
    console.error(
      `[story] DATA ERROR ${slug}: category='${story.category}'`
      + `${story.epubUrl ? ' with epubUrl' : ''} but readerMode/bookReader are not set.`
      + ' Routed to /reader defensively. Set the flag on the record.',
    );
  }

  // ── reader-mode: the carve-out, stated rather than hidden ──────────────────
  // Its bytes are an EPUB at a public Firebase Storage URL. Withholding the HTML
  // while the file is one unauthenticated GET away is theatre, and shipping theatre
  // as a gate is worse than shipping neither — it makes us believe a door is shut.
  if (grant.access === 'reader') {
    return respond({ ...base, readerHref: `/reader/${slug}` });
  }

  // ── the body ───────────────────────────────────────────────────────────────
  let bodyRec;
  try {
    bodyRec = await readJson(env, token, `${BODIES_PATH}/${encodeURIComponent(slug)}`);
  } catch (e) {
    console.error(`[story] body read failed for ${slug}:`, e.message || e);
    return respond({ ...base, error: 'Could not open that story just now. Please try again.', code: 'unavailable' }, 502);
  }

  const content = typeof bodyRec?.content === 'string' ? bodyRec.content : '';
  if (!content) {
    // The record exists but its body does not. During T1 that means the dual-write
    // missed it; scripts/backfill-story-bodies.mjs --verify finds these.
    console.error(`[story] NO BODY at ${BODIES_PATH}/${slug} — dual-write gap?`);
    return respond({ ...base, error: 'Could not open that story just now. Please try again.', code: 'unavailable' }, 502);
  }

  // ⚠ indexReadTime, NOT a local word count, and ALWAYS over the full `content`
  // even when only a preview is being sent. Two reasons, both load-bearing:
  //
  //   1. WHOLE-STORY. That is the entire point of the field — see base above.
  //   2. THE SAME FUNCTION the index projection uses, which is itself a byte-for-byte
  //      reimplementation of the app's lib/storyDerived.ts:37. It counts RAW HTML
  //      TOKENS: markup counts as words. That is a PRESERVED QUIRK, not a bug to fix
  //      here — the app's search, profile and author-list surfaces render the index's
  //      number, and a story page that "corrected" it would disagree with every one
  //      of them. Cross-platform parity outranks correctness; if it is ever fixed it
  //      is fixed in all four places in one change.
  base.readTimeMinutes = indexReadTime(content);

  if (grant.access === 'full') {
    return respond({ ...base, content });
  }

  // ── the preview ────────────────────────────────────────────────────────────
  let cut;
  try {
    cut = cutPreview(content);
  } catch (e) {
    // THE HARD GATE. No patching, no naive character slice, and above all NO
    // FALLBACK TO THE FULL BODY — that would make malformed HTML a paywall bypass,
    // and the worse the markup the more reliably it would work. Loud, because it is
    // our bug and no reader action fixes it.
    if (e instanceof MalformedHtmlError) {
      console.error(`[story] PREVIEW FAILED for ${slug} — malformed body: ${e.message}`, e.detail || '');
      return respond({ ...base, error: 'This story could not be prepared for preview.', code: 'preview_failed' }, 500);
    }
    throw e;
  }

  const payload = {
    ...base,
    preview: cut.html,
    previewOf: { paragraphs: cut.prose, of: cut.total },
  };

  // The awkward case, stated in the contract rather than improvised here: the story
  // is fine but we do not KNOW whether this reader is entitled. Assume free and a
  // paying member sees a paywall they paid to be rid of; assume entitled and one
  // flaky read hands the archive to everyone. So: the preview, a 503, and
  // degraded:true — the reader sees the opening, the client shows a retry, and it
  // must never render an upsell to somebody who may already have paid.
  if (entitlementDegraded) {
    return respond({ ...payload, error: 'We could not check your membership just now.', code: 'entitlement_unavailable' }, 503);
  }

  return respond(payload);
}

// ONE exported handler, branching on method, rather than onRequestPost + onRequest
// side by side: Pages resolves those two by a precedence rule, and a 405 that
// depends on remembering which one wins is a 405 that will one day be a 200.
//
// POST-only. The selector could ride in a query string but the credential could
// not: an ID token in a URL lands in access logs, Referer headers and shared links.
export async function onRequest(context) {
  if (context.request.method === 'POST') return handlePost(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
