// PROOFS (rulings 249–258) — POST /api/proofs
//
//   credential: Authorization: Bearer <Firebase ID token>          (required)
//   body:       { action: 'list' }                                  → the caller's proofs + reports
//               { action: 'proof', slug }                           → one proof, with its text
//
//   → 200 list:  { founder, stories: [entry…], groups?: [{ authorUid, author, stories }], reports: [report…] }
//   → 200 proof: { story: { slug, …record fields, content }, goLiveMs, reports: [report…] }
//   → 400 bad_request · 401 signed_out · 404 not_found · 405 · 500 misconfigured · 502 unavailable
//
// ── WHO GETS WHAT ───────────────────────────────────────────────────────────────────────
//   · a writer:  only scheduled stories whose authorUid is their uid (ruling 250). Another
//                writer's proof answers 404, exactly like a slug that never existed.
//   · a founder: every scheduled story, grouped by writer (ruling 258).
//   · anyone else, and every non-founder while Proofs is closed: the same nothing — an empty
//     list, and 404 for any proof. "Closed" and "you have none" are indistinguishable on purpose.
//
// ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────────────────
//   · Count anything. No hit, no read credit, no telemetry: a proof is not a read.
//   · Serve a live story. The moment a story goes live it is not a proof (isProof), and its
//     proof answers 404 here: the story page is where it lives now.
//   · Get cached. private, no-store on every answer.
import { identify, readBody, readJson, respond, configured, NOT_FOUND } from './_proofs.js';
import { isProof, maySee, listEntry, groupByWriter, bySoonest, goLiveMs, SLUG_RE, PROOF_REPORTS_PATH } from '../../../app/lib/proofs.js';
import { RETIRED_PATH } from '../../../app/lib/retiredStories.js';

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`).join('&');

/** The caller's own reports, newest first. Only what the writer needs: no other uid. */
export async function reportsFor(env, token, uid, slug = null) {
  const all = (await readJson(env, token, PROOF_REPORTS_PATH, q({ orderBy: 'reporterUid', equalTo: uid }))) || {};
  return Object.entries(all)
    .filter(([, r]) => r && typeof r === 'object' && (!slug || r.slug === slug))
    .map(([id, r]) => ({ id, slug: r.slug, message: r.message, status: r.status, createdAt: r.createdAt ?? null, statusAt: r.statusAt ?? null }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function scheduled(env, token, { uid, founder }, now) {
  // An indexed query either way (cms_stories .indexOn authorUid, published), so a writer's list
  // never downloads the catalogue.
  const query = founder ? q({ orderBy: 'published', equalTo: false }) : q({ orderBy: 'authorUid', equalTo: uid });
  const [recs, retired] = await Promise.all([
    readJson(env, token, 'cms_stories', query),
    readJson(env, token, RETIRED_PATH, 'shallow=true'),
  ]);
  return Object.entries(recs || {})
    .filter(([slug, rec]) => !retired?.[slug] && isProof(rec, now) && maySee(rec, uid, { founder }))
    .map(([slug, rec]) => listEntry(slug, rec))
    .sort(bySoonest);
}

export async function handleProofs(context, { now = Date.now(), founders } = {}) {
  const { request, env } = context;
  if (!configured(env)) {
    console.error('[proofs] server env incomplete');
    return respond({ error: 'Proofs isn’t configured yet.', code: 'misconfigured' }, 500);
  }
  const body = await readBody(request);
  if (body === null) return respond({ error: 'Invalid request body.', code: 'bad_request' }, 400);

  const who = await identify(request, body, env, { founders });
  if (who.error) return who.error;
  const { uid, founder, open, token } = who;
  const action = body.action || 'list';

  if (action === 'list') {
    if (!open) return respond({ founder: false, stories: [], reports: [] });
    try {
      const [stories, reports] = await Promise.all([scheduled(env, token, { uid, founder }, now), reportsFor(env, token, uid)]);
      console.log(`[proofs] list uid=${uid} founder=${founder} n=${stories.length}`);
      return respond({ founder, stories, ...(founder ? { groups: groupByWriter(stories) } : {}), reports });
    } catch (e) {
      console.error('[proofs] list failed:', e?.message || e);
      return respond({ error: 'Your proofs couldn’t be opened just now. Please try again.', code: 'unavailable' }, 502);
    }
  }

  if (action === 'proof') {
    const slug = body.slug;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return respond({ error: 'slug required.', code: 'bad_request' }, 400);
    if (!open) return respond(NOT_FOUND, 404);
    try {
      const [rec, retired] = await Promise.all([
        readJson(env, token, `cms_stories/${encodeURIComponent(slug)}`),
        readJson(env, token, `${RETIRED_PATH}/${encodeURIComponent(slug)}`),
      ]);
      // Not a proof, not theirs, retired: all the same 404, so nothing about the story leaks.
      if (retired || !isProof(rec, now) || !maySee(rec, uid, { founder })) return respond(NOT_FOUND, 404);
      const [bodyRec, reports] = await Promise.all([
        readJson(env, token, `story_bodies/${encodeURIComponent(slug)}`),
        reportsFor(env, token, uid, slug),
      ]);
      const content = typeof bodyRec?.content === 'string' ? bodyRec.content : '';
      // A record's own copy of the text is never used: ruling 255 keeps it off cms_stories until
      // live, and if one is there anyway it is not what will publish.
      const { content: _c, extractedText: _x, ...meta } = rec;
      console.log(`[proofs] proof ${slug} uid=${uid} founder=${founder}${content ? '' : ' NO-BODY'}`);
      return respond({ story: { slug, ...meta, content }, goLiveMs: goLiveMs(rec), reports });
    } catch (e) {
      console.error(`[proofs] proof ${slug} failed:`, e?.message || e);
      return respond({ error: 'This proof couldn’t be opened just now. Please try again.', code: 'unavailable' }, 502);
    }
  }

  return respond({ error: 'Unknown action.', code: 'bad_request' }, 400);
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleProofs(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
