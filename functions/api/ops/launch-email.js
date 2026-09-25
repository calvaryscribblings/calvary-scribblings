// W7 — POST /api/ops/launch-email: mail the launch check's table to Ikenna, and only to him.
//
// The recipient is fixed HERE (env.LAUNCH_ALERT_EMAIL, else Ikenna's address), never taken from
// the request, so this cannot be used as a relay. The subject must begin "[launch] ". Auth is
// functions/api/ops/_opsAuth.js: a founder, or the launch check's service-signed token. Sent
// through Resend with the Pages project's own RESEND_API_KEY, which GitHub Actions does not hold.

import { json } from '../bookstore/_lib.js';
import { authoriseOps } from './_opsAuth.js';

export const LAUNCH_RECIPIENT_DEFAULT = 'Ikennaworksfromhome@gmail.com';
const MAX_BODY = 60_000;

/** Pure: is this a mail the endpoint will send? Returns the refusal, or null. */
export function refusalFor(body) {
  if (!body || typeof body !== 'object') return 'A JSON body is required.';
  const { subject, text, html } = body;
  if (typeof subject !== 'string' || !subject.startsWith('[launch] ') || subject.length > 120) return 'The subject must begin "[launch] " and be at most 120 characters.';
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_BODY) return 'A text body is required (at most 60,000 characters).';
  if (html !== undefined && (typeof html !== 'string' || html.length > MAX_BODY)) return 'The html body must be a string of at most 60,000 characters.';
  return null;
}

export async function onRequestPost({ request, env }) {
  const who = await authoriseOps(request, env);
  if (!who.ok) return json({ error: 'Not authorised.' }, who.status);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const refusal = refusalFor(body);
  if (refusal) return json({ error: refusal }, 400);
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return json({ error: 'Mail is not configured (RESEND_API_KEY / FROM_EMAIL).' }, 503);
  const to = (typeof env.LAUNCH_ALERT_EMAIL === 'string' && env.LAUNCH_ALERT_EMAIL.includes('@')) ? env.LAUNCH_ALERT_EMAIL : LAUNCH_RECIPIENT_DEFAULT;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Calvary Scribblings <${env.FROM_EMAIL}>`, to: [to], subject: body.subject, text: body.text, ...(body.html ? { html: body.html } : {}) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: `The mail service refused it (HTTP ${res.status}).` }, 502);
  console.log(`[ops/launch-email] sent by ${who.who}: ${body.subject}`);
  return json({ ok: true, id: out.id || null });
}
