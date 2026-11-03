// POST /api/story-index/build — LIMITS-1. The index record a story will have once it is live,
// built by the REAL builder (app/lib/storyIndex.js buildIndexRecord), for the scheduled-publish
// job in the calvary-newsletter Worker.
//
//   body:  { slug, story }       story = the record as it will be live: { ...story, ...body, published: true }
//   → 200  { record }
//   → 400  { code: 'bad_request' } · 413 { code: 'too_large' }
//
// WHY THIS EXISTS. The Worker is pasted into the Cloudflare dashboard and cannot import app/lib.
// Its hand-copied projection has no `opening`: carrying it would mean transcribing parseBlocks and
// walkToProse, the predicate the drop cap also uses, and two copies of one predicate is how the
// search line and the drop cap stop agreeing (R49: never transcribe it). So a scheduled story went
// live with an index record short of its opening line until the quarter-hourly reconciler filled
// it in, and search showed it without one for up to fifteen minutes (test:ci raced it on the
// morning of 3 Nov). Now the Worker sends the story here first and writes what comes back IN ITS
// ONE ATOMIC PUBLISH WRITE. If this answers anything else, the Worker writes its own projection, as
// before, and the reconciler stays the safety net.
//
// PURE. It reads and writes nothing, holds no credential and makes no outbound call: it projects
// what the caller sent. So it reveals nothing the caller did not already have, which is why it needs
// no sign-in. The size cap bounds the work.
//
// LOGGING: codes only, never a slug or a title.
import { buildIndexRecord } from '../../../app/lib/storyIndex.js';
import { isId } from '../../../app/lib/ids.js';

export const MAX_BODY_BYTES = 4 * 1024 * 1024;

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function onRequestPost({ request }) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return reply({ code: 'too_large' }, 413);
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) return reply({ code: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return reply({ code: 'bad_request' }, 400); }
  const { slug, story } = body || {};
  if (!isId('slug', slug) || !story || typeof story !== 'object' || Array.isArray(story)) return reply({ code: 'bad_request' }, 400);
  return reply({ record: buildIndexRecord(slug, story) });
}

