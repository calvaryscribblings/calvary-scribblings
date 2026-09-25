// W7 — GET /api/ops/launch-status: are the membership switches set? BOOLEANS ONLY.
//
// For scripts/launch-check.mjs (and a founder by hand). It answers whether each thing is SET and
// in which MODE — never a value. No key, no secret, no price id, no email address, not even a
// prefix or a length leaves this function; a test (tests/ci/w7-launch-check.test.mjs) asserts
// that every leaf of the answer is a boolean.
//
// Auth: functions/api/ops/_opsAuth.js (a founder, or the launch check's service-signed token).

import { json } from '../bookstore/_lib.js';
import { authoriseOps } from './_opsAuth.js';
import { MEMBERSHIPS_ON_SALE } from '../../../app/lib/membershipPrices.js';
import { isConfigured as stripeConfigured, modeOf as stripeModeOf } from '../membership/prices.js';
import { isConfigured as paystackConfigured, modeOf as paystackModeOf } from '../membership/paystack-plans.js';

const set = (v) => typeof v === 'string' && v.trim().length > 0;

/** Pure, so the test can hold it to "booleans only". */
export function launchStatus(env) {
  return {
    saleFlagOn: MEMBERSHIPS_ON_SALE === true,
    stripe: {
      liveKey: stripeModeOf(env.STRIPE_SECRET_KEY) === 'live',
      livePricesConfigured: stripeConfigured('live') === true,
      membershipWebhookSecretSet: set(env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET),
      bookstoreWebhookSecretSet: set(env.STRIPE_WEBHOOK_SECRET),
    },
    paystack: {
      liveKey: paystackModeOf(env.PAYSTACK_SECRET_KEY) === 'live',
      livePlansConfigured: paystackConfigured('live') === true,
      // Paystack signs its webhooks with the secret key itself; there is no separate secret.
      webhookSecretSet: set(env.PAYSTACK_SECRET_KEY),
    },
    alerts: {
      moneyAlertEmailSet: set(env.MONEY_ALERT_EMAIL),
      resendSet: set(env.RESEND_API_KEY),
    },
  };
}

export async function onRequestGet({ request, env }) {
  const who = await authoriseOps(request, env);
  if (!who.ok) return json({ error: 'Not authorised.' }, who.status);
  const res = json({ ok: true, ...launchStatus(env) });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
