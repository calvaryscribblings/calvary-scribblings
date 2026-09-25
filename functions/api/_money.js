// MONEY FAILURES — W3 / MON-04. No money failure is ever silent.
//
// NOT A ROUTE (underscore prefix; exports no onRequest*).
//
// Before W3 every webhook answered 200 `degraded` after ANY failure past signature
// verification, and NEEDS-MANUAL-REVIEW / REFUND BY HAND were console.error lines in a Pages
// log nobody reads and nothing retains. An RTDB blip during a grant meant: the reader paid,
// the provider saw success and never retried, and nobody was told.
//
// ── THE POLICY (decided, W3) ─────────────────────────────────────────────────────────────
//
//   A failure a RETRY could fix  → the webhook answers 500, so Stripe/Paystack redeliver.
//                                  Safe because every handler is idempotent (invoice / session /
//                                  reference keys; the ended-subscription tombstones).
//                                  Thrown as MoneyTransientError, or any unexpected exception.
//   A failure a retry CANNOT fix → the webhook answers 200 (a retry storm fixes nothing), and a
//                                  human is told. Returned as a verdict: 'review' and friends.
//
// BOTH kinds are written to ops/money_failures/{key} and emailed to MONEY_ALERT_EMAIL through
// Resend — the email once per key (a provider retrying the same event for three days sends one
// email, and the record counts the attempts). Neither write may throw into the caller: a failed
// alert must never turn a correct 200 into a 500 or mask the original error.

import { dbBase, mintAccessToken, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from './bookstore/_lib.js';

export const FAILURES_PATH = 'ops/money_failures';
export const FAULT_PATH = 'ops/money_fault';
export const TEST_BUYERS_PATH = 'ops/test_buyers';

/** A failure worth a provider retry. Anything else thrown is treated the same way. */
export class MoneyTransientError extends Error {
  constructor(message) { super(message); this.name = 'MoneyTransientError'; }
}

/** RTDB keys cannot hold . $ # [ ] / — event ids and references can (Paystack's `ms.` refs). */
export const failureKey = (s) => String(s || 'unknown').replace(/[.$#[\]/]/g, '_').slice(0, 700) || 'unknown';

/**
 * Is this environment on TEST keys only? The two test-mode switches below are read ONLY when
 * this is true, so with a live key in either slot they are never consulted — not merely
 * ignored. A key that is absent counts as test (nothing can be charged on it).
 */
export function isTestEnv(env) {
  const live = (k) => typeof k === 'string' && /^(sk|rk)_live_/.test(k);
  return !live(env?.STRIPE_SECRET_KEY) && !live(env?.PAYSTACK_SECRET_KEY);
}

/** Verdicts a retry cannot fix, which a human must see. */
export const REVIEW_VERDICTS = new Set(['review', 'second_subscription', 'paid_after_deletion', 'refund_unmatched']);

async function adminToken(env, token) {
  if (token) return token;
  return mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
}

/** The email body. Pure — the harness asserts it never carries a secret or a full card of data. */
export function alertEmail({ key, rail, kind, summary, uid, ref, eventType, retryable }) {
  const subject = `[money] ${retryable ? 'RETRYING' : 'NEEDS A HUMAN'}: ${kind} (${rail || '—'})`;
  const text = [
    summary,
    '',
    `rail:       ${rail || '—'}`,
    `kind:       ${kind}`,
    `event:      ${eventType || '—'}`,
    `reader uid: ${uid || '—'}`,
    `reference:  ${ref || '—'}`,
    `record:     ops/money_failures/${key}`,
    '',
    retryable
      ? 'The provider will redeliver this event. If it keeps failing you will not get another email; the record counts the attempts.'
      : 'A retry cannot fix this one. Nothing further happens until someone looks.',
  ].join('\n');
  return { subject, text };
}

/**
 * Record a money failure and tell a human. NEVER throws.
 *
 * @returns {{recorded:boolean, emailed:boolean}}
 */
export async function recordMoneyFailure(env, {
  key, rail, kind, summary, uid = null, ref = null, eventType = null, retryable = false, token = null,
  now = Date.now(), fetchImpl = fetch,
}) {
  const k = failureKey(key || `${kind}-${ref || uid || now}`);
  const path = `${FAILURES_PATH}/${k}`;
  let recorded = false;
  let first = true;
  try {
    const t = await adminToken(env, token);
    const base = dbBase(env);
    const got = await fetchImpl(`${base}/${path}/firstAt.json`, {
      headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    first = got.ok ? (await got.json()) === null : true;
    const body = {
      [`${path}/rail`]: rail || null,
      [`${path}/kind`]: kind,
      [`${path}/summary`]: String(summary || '').slice(0, 2000),
      [`${path}/uid`]: uid,
      [`${path}/ref`]: ref,
      [`${path}/eventType`]: eventType,
      [`${path}/retryable`]: retryable === true,
      [`${path}/lastAt`]: now,
      [`${path}/count`]: { '.sv': { increment: 1 } },
      ...(first ? { [`${path}/firstAt`]: now, [`${path}/resolved`]: false } : {}),
    };
    const res = await fetchImpl(`${base}/.json`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    recorded = res.ok;
    if (!res.ok) console.error(`[money] failure record ${k} not written: HTTP ${res.status}`);
  } catch (e) {
    console.error(`[money] failure record ${k} not written:`, e?.message || e);
  }

  let emailed = false;
  if (first) {
    try {
      if (!env.RESEND_API_KEY || !env.MONEY_ALERT_EMAIL) {
        console.error(`[money] ALERT NOT EMAILED for ${k}: RESEND_API_KEY or MONEY_ALERT_EMAIL is not set`);
      } else {
        const { subject, text } = alertEmail({ key: k, rail, kind, summary, uid, ref, eventType, retryable });
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.MONEY_ALERT_FROM || env.FROM_EMAIL || 'Calvary Scribblings <noreply@calvaryscribblings.co.uk>',
            to: [env.MONEY_ALERT_EMAIL],
            subject,
            text,
          }),
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        emailed = res.ok;
        if (!res.ok) console.error(`[money] alert email for ${k} refused: HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`[money] alert email for ${k} failed:`, e?.message || e);
    }
  }
  console.error(`[money] ${retryable ? 'RETRYABLE' : 'REVIEW'} ${k}: ${summary}`);
  return { recorded, emailed };
}

async function readFlag(env, token, path, fetchImpl) {
  const t = await adminToken(env, token);
  const res = await fetchImpl(`${dbBase(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * TEST MODE ONLY — the forced handler failure the W3 proof needs. If ops/money_fault/{uid}
 * holds { until: <ms> } in the future, the grant for that reader throws a MoneyTransientError,
 * the webhook answers 500, and the provider retries; after `until`, the retry succeeds.
 * With a live key this function returns false WITHOUT READING anything.
 */
export async function faultArmed(env, token, uid, { now = Date.now(), fetchImpl = fetch } = {}) {
  if (!isTestEnv(env) || !uid) return false;
  try {
    const v = await readFlag(env, token, `${FAULT_PATH}/${uid}`, fetchImpl);
    return !!v && typeof v.until === 'number' && v.until > now;
  } catch { return false; }
}

/**
 * TEST MODE ONLY — may this reader open a membership checkout while MEMBERSHIPS_ON_SALE is
 * false? True only for a uid listed at ops/test_buyers/{uid} (admin-written; clients cannot
 * write ops/). With a live key this returns false WITHOUT READING anything, so the on-sale
 * gate is exactly what it was.
 */
export async function isTestBuyer(env, uid, { fetchImpl = fetch } = {}) {
  if (!isTestEnv(env) || !uid) return false;
  try {
    return (await readFlag(env, null, `${TEST_BUYERS_PATH}/${uid}`, fetchImpl)) === true;
  } catch { return false; }
}

/**
 * The webhook tail, shared by all three endpoints: turn a handler outcome into the response
 * and make sure a human hears about what needs one.
 *
 *   thrown          → record (retryable) → 500
 *   REVIEW verdict  → record (not retryable) → 200
 *   anything else   → 200
 */
export async function settleWebhook(env, { run, rail, eventType, eventKey, label, json }) {
  try {
    const result = await run();
    if (result && REVIEW_VERDICTS.has(result.verdict)) {
      await recordMoneyFailure(env, {
        key: `${eventKey}-${result.verdict}`, rail, kind: result.verdict, eventType,
        uid: result.uid || null, ref: result.ref || null,
        summary: result.why || `${label}: ${eventType} ended in '${result.verdict}' — nothing was written`,
      });
    }
    return json({ received: true, verdict: result?.verdict || 'ok' });
  } catch (e) {
    console.error(`[${label}] ${eventType} (${eventKey}) failed — answering 500 so it is retried:`, e?.message || e);
    await recordMoneyFailure(env, {
      key: `${eventKey}-failed`, rail, kind: 'handler_failed', eventType, retryable: true,
      summary: `${label}: ${eventType} failed and will be retried by the provider: ${e?.message || e}`,
    });
    return json({ received: false, retry: true }, 500);
  }
}
