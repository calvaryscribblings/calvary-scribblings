// PROOFS — POST /api/proofs/report  (rulings 252–254)
//
//   credential: Authorization: Bearer <Firebase ID token>   (required)
//   body:       { slug, message }
//   → 200 { id, status: 'received' }
//   → 400 bad_request | too_short | too_long · 401 signed_out · 404 not_found
//   → 429 rate_limited · 500 misconfigured · 502 unavailable
//
// A report is a note to the editors. It NEVER holds a story back: nothing here touches the
// story, its schedule or its record. It is:
//   1. validated (reportFault: 10–2000 characters, a real slug);
//   2. rate-limited through the shared limiter (functions/api/_ratelimit.js), which fails closed;
//   3. checked against the same visibility as the proof itself — a writer can only report on
//      their own scheduled story, and 404 otherwise, exactly as the proof answers;
//   4. written server-side to story_proof_reports/{id} (clients cannot create one: the rules
//      give no client a create);
//   5. mailed to the editors through _alerts.js, ONCE per report (keyed on the report id). The
//      mail carries the slug, the time and the report id, and never the writer's words: those
//      may quote the unreleased text, and _alerts.js carries no story text by rule.
import { consume } from '../_ratelimit.js';
import { raiseAlert, alertKey } from '../_alerts.js';
import { dbBase, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { identify, readBody, readJson, respond, configured, NOT_FOUND } from './_proofs.js';
import { isProof, maySee, goLiveMs, londonWhen, reportFault, reportBuckets, limitCode, isProofSlug, isReportId, PROOF_REPORTS_PATH, PROOFS_COPY } from '../../../app/lib/proofs.js';
import { RETIRED_PATH } from '../../../app/lib/retiredStories.js';

const MESSAGES = {
  bad_request: 'Invalid request.',
  too_short: PROOFS_COPY.reportTooShort,
  too_long: PROOFS_COPY.reportTooLong,
};

export async function handleReport(context, { now = Date.now(), founders } = {}) {
  const { request, env } = context;
  if (!configured(env)) return respond({ error: 'Reports aren’t configured yet.', code: 'misconfigured' }, 500);
  const body = await readBody(request);
  if (body === null) return respond({ error: MESSAGES.bad_request, code: 'bad_request' }, 400);
  // LIVE-PATHS-1: the slug is checked before anything leaves this handler (identity included).
  if (!isProofSlug(body.slug)) return respond({ error: MESSAGES.bad_request, code: 'bad_request' }, 400);

  const who = await identify(request, body, env, { founders });
  if (who.error) return who.error;
  const { uid, founder, open, token } = who;
  if (!open) return respond(NOT_FOUND, 404);

  const fault = reportFault(body);
  if (fault) return respond({ error: MESSAGES[fault], code: fault }, 400);
  const slug = body.slug;
  const message = body.message.trim();

  // Counted before the story is read: a refused request still counts (the limiter's rule).
  const limit = await consume(context, reportBuckets(uid));
  if (!limit.ok) {
    // Ruling 276: the writer's minute cap and daily cap each have their own line; the site-wide
    // cap, and a limiter that couldn't count, are told only as a failure to send.
    const code = limitCode(limit);
    const res = code === 'rate_limited' ? respond({ error: PROOFS_COPY.reportRateLimited, code }, 429)
      : code === 'daily_limit' ? respond({ error: PROOFS_COPY.reportDailyLimit, code }, 429)
      : respond({ error: PROOFS_COPY.reportFailed, code: 'unavailable' }, limit.reason === 'limit' ? 429 : 503);
    if (limit.retryAfter) res.headers.set('Retry-After', String(limit.retryAfter));
    return res;
  }

  let rec;
  try {
    const [r, retired] = await Promise.all([
      readJson(env, token, `cms_stories/${encodeURIComponent(slug)}`),
      readJson(env, token, `${RETIRED_PATH}/${encodeURIComponent(slug)}`),
    ]);
    if (retired) return respond(NOT_FOUND, 404);
    rec = r;
  } catch (e) {
    console.error(`[proofs/report] read failed for ${slug}:`, e?.message || e);
    return respond({ error: PROOFS_COPY.reportFailed, code: 'unavailable' }, 502);
  }
  if (!isProof(rec, now) || !maySee(rec, uid, { founder })) return respond(NOT_FOUND, 404);

  const record = {
    slug,
    reporterUid: uid,
    storyAuthorUid: typeof rec.authorUid === 'string' ? rec.authorUid : null,
    message,
    status: 'received',
    goLiveAt: goLiveMs(rec),
    createdAt: { '.sv': 'timestamp' },
    statusAt: { '.sv': 'timestamp' },
  };
  let id;
  try {
    const res = await fetch(`${dbBase(env)}/${PROOF_REPORTS_PATH}.json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`write ${res.status}`);
    id = (await res.json())?.name;
    if (!isReportId(id)) throw new Error('no report id');
  } catch (e) {
    console.error(`[proofs/report] write failed for ${slug}:`, e?.message || e);
    return respond({ error: PROOFS_COPY.reportFailed, code: 'unavailable' }, 502);
  }

  // The editors' email. Off the response path, and never the writer's problem: raiseAlert never
  // throws, and the report stands whether or not the mail goes.
  const mail = (async () => raiseAlert(env, {
    kind: 'proof_report',
    key: await alertKey('proof_report', id),
    subject: PROOFS_COPY.emailSubject,
    lines: PROOFS_COPY.emailLines({ slug, when: londonWhen(goLiveMs(rec)), reportId: id }),
    token,
  }))();
  if (context.waitUntil) context.waitUntil(mail); else await mail;

  console.log(`[proofs/report] ${id} on ${slug} by ${uid}${founder ? ' (founder)' : ''}`);
  return respond({ id, status: 'received' });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleReport(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
