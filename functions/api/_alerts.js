// RULING 261 (Ikenna, 31 Oct 2026) — ONE SMALL ALERT SERVICE FOR THE EDITORS.
//
// NOT A ROUTE (underscore prefix; exports no onRequest*). Pages Functions import it and call
// raiseAlert(); nothing outside the server can reach it.
//
//   raiseAlert(env, { kind, key, subject, lines })
//
// · ONE RECIPIENT, FIXED HERE. The address the launch check already mails (functions/api/ops/
//   launch-email.js): env.LAUNCH_ALERT_EMAIL, else LAUNCH_RECIPIENT_DEFAULT. The caller cannot name
//   one, so no request can turn this into a relay.
// · ONCE PER (kind, key). Before it sends, it CLAIMS ops/editor_alerts/{kind}/{key} with a
//   write-once PUT (RTDB's ETag precondition). A provider retry, two deliveries racing, a replayed
//   event — whichever arrives second finds the claim and sends nothing. The claim is taken before
//   the send, deliberately: a lost email is one alert missed, and a double email teaches the reader
//   to ignore the next one. The record keeps whether the send worked.
// · NEVER THE CALLER'S PROBLEM. Every failure — no mail configured, the claim refused, Resend down
//   — is logged and returned as { sent: false, why }. raiseAlert does not throw, and nothing the
//   caller answers may depend on it.
// · NOTHING PERSONAL. Internal references only: a uid, a titleId, a rail, an amount. The message
//   is checked before it goes, and one that carries an email address or a provider payment
//   reference is REFUSED, not sent (impersonalityFault). No story text is ever passed in.
//
// Through the Pages project's own Resend setup, read by name only: RESEND_API_KEY and FROM_EMAIL.
//
// The record (server-written; rules: founder-read, .write false for every client):
//   ops/editor_alerts/{kind}/{key} { kind, subject, raisedAt, sent, sentAt?, emailId?, why? }

import { dbBase, mintAccessToken, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from './bookstore/_lib.js';
import { LAUNCH_RECIPIENT_DEFAULT } from './ops/launch-email.js';

export const ALERTS_PATH = 'ops/editor_alerts';
export const ALERT_SUBJECT_PREFIX = '[alert] ';
export const RESEND_API = 'https://api.resend.com/emails';

/** The one recipient. Never taken from a request. */
export const alertRecipient = (env) =>
  (typeof env?.LAUNCH_ALERT_EMAIL === 'string' && env.LAUNCH_ALERT_EMAIL.includes('@')) ? env.LAUNCH_ALERT_EMAIL : LAUNCH_RECIPIENT_DEFAULT;

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** A record key from anything: a SHA-256 prefix, so a key never carries what it was made from. */
export async function alertKey(...parts) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.map(String).join('\u0000'))));
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Provider payment references, either rail: Stripe's object ids, and the Paystack reference this
// shop mints (cs.<uid>.<titleId>.<nonce>, functions/api/bookstore/_lib.js).
const PAYMENT_REF = /\b(?:cs|pi|ch|re|dp|evt|in|sub|cus|pm|py|txn)_(?:test_|live_)?[A-Za-z0-9_]{6,}\b|\bcs\.[A-Za-z0-9]+\.[A-Za-z0-9-]+\.[a-f0-9]{8,}\b/;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/;

/** Pure. Why this message may not be sent, or null. */
export function impersonalityFault(text) {
  const s = String(text || '');
  if (EMAIL.test(s)) return 'carries an email address';
  if (PAYMENT_REF.test(s)) return 'carries a payment reference';
  return null;
}

/** Pure. The email as it will be sent. */
export function composeAlert(env, { subject, lines }) {
  return {
    from: `Calvary Scribblings <${env.FROM_EMAIL}>`,
    to: [alertRecipient(env)],
    subject: `${ALERT_SUBJECT_PREFIX}${subject}`,
    text: (lines || []).join('\n'),
  };
}

async function claimOnce(env, token, path, record) {
  const url = `${dbBase(env)}/${path}.json`;
  const head = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!head.ok) throw new Error(`claim read failed: ${head.status}`);
  if ((await head.json()) !== null) return false;
  const etag = head.headers.get('ETag');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (res.status === 412) return false;
  if (!res.ok) throw new Error(`claim write failed: ${res.status}`);
  return true;
}

async function note(env, token, path, fields) {
  try {
    await fetch(`${dbBase(env)}/${path}.json`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
  } catch (e) { console.error(`[alerts] could not note the outcome on ${path}: ${e?.name || 'Error'}`); }
}

/**
 * Raise one editor alert, once. Never throws.
 *
 *   kind    a short slug naming the alert (e.g. 'duplicate_payment')
 *   key     what makes this alert this one — a [A-Za-z0-9_-] segment; make it with alertKey()
 *   subject the subject after "[alert] "
 *   lines   the body, one string per line
 *   token   optional admin token the caller already holds
 *
 * Resolves to { sent: boolean, why?: string }.
 */
export async function raiseAlert(env, { kind, key, subject, lines, token: given } = {}) {
  const label = `[alerts] ${kind || '?'}`;
  try {
    if (!SAFE_SEGMENT.test(String(kind)) || !SAFE_SEGMENT.test(String(key))) return { sent: false, why: 'bad kind or key' };
    const mail = composeAlert(env, { subject, lines });
    const fault = impersonalityFault(`${mail.subject}\n${mail.text}`);
    if (fault) {
      console.error(`${label}: REFUSED — the message ${fault}. Nothing was sent.`);
      return { sent: false, why: `refused: ${fault}` };
    }

    const token = given || await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const path = `${ALERTS_PATH}/${kind}/${key}`;
    const claimed = await claimOnce(env, token, path, { kind, subject: mail.subject, raisedAt: Date.now(), sent: false });
    if (!claimed) return { sent: false, why: 'already raised' };

    if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
      console.error(`${label}: mail is not configured (RESEND_API_KEY / FROM_EMAIL). Recorded, not sent.`);
      await note(env, token, path, { why: 'mail not configured' });
      return { sent: false, why: 'mail not configured' };
    }
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`${label}: Resend refused the alert: HTTP ${res.status}`);
      await note(env, token, path, { why: `resend ${res.status}` });
      return { sent: false, why: `resend ${res.status}` };
    }
    const sent = await res.json().catch(() => ({}));
    await note(env, token, path, { sent: true, sentAt: Date.now(), emailId: typeof sent?.id === 'string' ? sent.id : null });
    return { sent: true };
  } catch (e) {
    console.error(`${label}: not sent (${e?.name || 'Error'}: ${String(e?.message || '').slice(0, 120)})`);
    return { sent: false, why: 'error' };
  }
}
