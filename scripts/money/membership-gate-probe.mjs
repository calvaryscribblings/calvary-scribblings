#!/usr/bin/env node
// W25 — IS THE MEMBERSHIP STORE OPEN ON THE LIVE SITE? Read-only, no account, no money.
//
//   node scripts/money/membership-gate-probe.mjs                   report
//   node scripts/money/membership-gate-probe.mjs --expect closed   exit 1 unless all four are closed
//   node scripts/money/membership-gate-probe.mjs --expect open     exit 1 unless all four are open
//
// WHY NOT "401 SIGNED OUT"? Every checkout checks for a token BEFORE the sale gate, so a request
// with no token answers 401 signed_out whether the store is open or shut — it proves nothing about
// the switch. (Measured 28 Sep, store shut: all four 401.) So each checkout is asked twice:
//
//   1. no token            → 401 signed_out in BOTH states (the signed-out reader's answer)
//   2. a PLACEHOLDER token → the gate decides:
//        CLOSED  409 not_configured, before any identity work
//        OPEN    past the gate; the placeholder fails verification → 401 signed_out ("expired")
//
// The placeholder is the literal string below: not a credential, never valid, and it never
// reaches Stripe, Paystack or the database — a closed gate answers first, and an open one stops
// at identity (Firebase's accounts:lookup refuses it). Nothing is written anywhere.

const SITE = process.env.SITE_ORIGIN || 'https://calvaryscribblings.co.uk';
const PLACEHOLDER = 'gate-probe-not-a-token';
export const CHECKOUTS = [
  { path: 'checkout', body: { tier: 'gold', interval: 'monthly', currency: 'gbp' } },
  { path: 'paystack-checkout', body: { tier: 'gold', interval: 'monthly' } },
  { path: 'pass-checkout', body: { kind: 'day', currency: 'gbp' } },
  { path: 'paystack-pass-checkout', body: { kind: 'day' } },
];

async function ask(path, body, token) {
  const r = await fetch(`${SITE}/api/membership/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code || null };
}

/** The verdict for one checkout from its two answers. Pure, so it can be tested. */
export function verdict(noToken, placeholder) {
  if (noToken.status !== 401) return 'UNEXPECTED';
  if (placeholder.status === 409 && placeholder.code === 'not_configured') return 'closed';
  if (placeholder.status === 401 && placeholder.code === 'signed_out') return 'open';
  return 'UNEXPECTED';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--expect');
  const expect = i >= 0 ? process.argv[i + 1] : null;
  const build = await fetch(`${SITE}/build.json?t=${Date.now()}`).then((r) => r.json()).catch(() => ({}));
  console.log(`${SITE} · live build ${build.commit || '?'}\n`);
  const verdicts = [];
  for (const c of CHECKOUTS) {
    const a = await ask(c.path, c.body, null);
    const b = await ask(c.path, c.body, PLACEHOLDER);
    const v = verdict(a, b);
    verdicts.push(v);
    console.log(`  /api/membership/${c.path.padEnd(22)} no token → ${a.status} ${a.code}   placeholder → ${b.status} ${b.code}   ${v.toUpperCase()}`);
  }
  const all = verdicts.every((v) => v === verdicts[0]) ? verdicts[0] : 'MIXED';
  console.log(`\nthe store is ${all.toUpperCase()}`);
  process.exit(expect && all !== expect ? 1 : 0);
}
