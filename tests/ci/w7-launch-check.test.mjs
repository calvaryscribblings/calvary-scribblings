// W7 — the launch check's verdicts, forced green, red and not-yet-due, row by row; the schedule
// gate across BST/GMT; the service-signed token the ops endpoints accept; and the two endpoints'
// limits (booleans only; a fixed recipient).
//
//   node --test tests/ci/w7-launch-check.test.mjs          (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import {
  GREEN, RED, NYD, judgeFreeWeek, judgeRebuilt, judgeArchiveHtml, judgeSeries, judgeBookStore,
  judgeMemberships, judgeHeartbeat, judgeSignals, summarise, lastLondonMidnight, opsToken, renderText,
} from '../../scripts/launch-check.mjs';
import { shouldRun, SCHEDULES } from '../../scripts/launch-check-gate.mjs';
import { claimsOk, verifyServiceJwt, OPS_AUDIENCE } from '../../functions/api/ops/_opsAuth.js';
import { launchStatus } from '../../functions/api/ops/launch-status.js';
import { refusalFor, LAUNCH_RECIPIENT_DEFAULT } from '../../functions/api/ops/launch-email.js';
import { GATE_ON_MS } from '../../app/lib/storyAccess.js';

const BEFORE = Date.parse('2026-09-25T12:00:00Z');
const AFTER = GATE_ON_MS + 10 * 60_000;            // 30 Sept 00:10 London
const ok = (access, reason) => ({ status: 200, access, reason });

describe('W7 · FREE WEEK', () => {
  const pre = { archive: { slug: 'a', res: ok('full', 'gating_off') }, thisWeek: { slug: 'w', res: ok('full', 'gating_off') }, poem: { slug: 'p', res: ok('full', 'gating_off') } };
  const post = { archive: { slug: 'a', res: ok('preview', 'archive') }, thisWeek: { slug: 'w', res: ok('full', 'free_week') }, poem: { slug: 'p', res: ok('full', 'poetry') } };
  test('not yet due before the switch, with gating_off everywhere', () => assert.equal(judgeFreeWeek(pre, BEFORE).status, NYD));
  test('red before the switch if the gate is already on', () => assert.equal(judgeFreeWeek(post, BEFORE).status, RED));
  test('green after: archive preview/archive, this week full, poem full', () => assert.equal(judgeFreeWeek(post, AFTER).status, GREEN));
  test('red after if the archive story still reads in full', () => assert.equal(judgeFreeWeek(pre, AFTER).status, RED));
  test('red when an answer failed', () => assert.equal(judgeFreeWeek({ ...post, poem: { slug: 'p', res: { status: 502 } } }, AFTER).status, RED));
  test('no story this week is not a failure', () => assert.equal(judgeFreeWeek({ ...post, thisWeek: null }, AFTER).status, GREEN));
});

describe('W7 · STATIC PAGES', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');        // BST: midnight was 24 Sept 23:00Z
  test('London midnight, in BST and GMT', () => {
    assert.equal(new Date(lastLondonMidnight(now)).toISOString(), '2026-09-24T23:00:00.000Z');
    assert.equal(new Date(lastLondonMidnight(Date.parse('2026-11-02T09:30:00Z'))).toISOString(), '2026-11-02T00:00:00.000Z');
    assert.equal(new Date(lastLondonMidnight(Date.parse('2026-10-25T00:30:00Z'))).toISOString(), '2026-10-24T23:00:00.000Z', 'the night the clocks go back');
  });
  test('rebuilt: green after midnight, red before it, red with no build.json', () => {
    assert.equal(judgeRebuilt({ build: { builtAt: Date.parse('2026-09-25T06:00:00Z') } }, now).status, GREEN);
    assert.equal(judgeRebuilt({ build: { builtAt: Date.parse('2026-09-24T22:59:00Z') } }, now).status, RED);
    assert.equal(judgeRebuilt({ build: null }, now).status, RED);
  });
  test('archive HTML: not yet due before, green without the ending after, red with it', () => {
    assert.equal(judgeArchiveHtml({ slug: 'a', htmlStatus: 200, ending: 'and that was the end of it', found: true }, BEFORE).status, NYD);
    assert.equal(judgeArchiveHtml({ slug: 'a', htmlStatus: 200, ending: 'and that was the end of it', found: false }, AFTER).status, GREEN);
    assert.equal(judgeArchiveHtml({ slug: 'a', htmlStatus: 200, ending: 'and that was the end of it', found: true }, AFTER).status, RED);
    assert.equal(judgeArchiveHtml({ slug: 'a', htmlStatus: 404, ending: 'x', found: false }, AFTER).status, RED);
  });
});

describe('W7 · SERIES, BOOK STORE, MEMBERSHIPS', () => {
  test('series: open before (not yet due), refused after (green), open after (red), refused before (red)', () => {
    assert.equal(judgeSeries({ instalmentId: 'i2', res: { status: 200, url: true } }, BEFORE).status, NYD);
    assert.equal(judgeSeries({ instalmentId: 'i2', res: { status: 401, code: 'signed_out' } }, AFTER).status, GREEN);
    assert.equal(judgeSeries({ instalmentId: 'i2', res: { status: 200, url: true } }, AFTER).status, RED);
    assert.equal(judgeSeries({ instalmentId: 'i2', res: { status: 401 } }, BEFORE).status, RED);
  });
  test('book store: not yet due before; green with a page and titles after; red without', () => {
    assert.equal(judgeBookStore({ pageStatus: 200, publishedTitles: 22 }, BEFORE).status, NYD);
    assert.equal(judgeBookStore({ pageStatus: 200, publishedTitles: 22 }, AFTER).status, GREEN);
    assert.equal(judgeBookStore({ pageStatus: 200, publishedTitles: 0 }, AFTER).status, RED);
  });
  const all = { saleFlagOn: true, stripe: { liveKey: true, livePricesConfigured: true, membershipWebhookSecretSet: true }, paystack: { liveKey: true, livePlansConfigured: true, webhookSecretSet: true } };
  test('memberships: not yet due before; green only when every switch is on after', () => {
    assert.equal(judgeMemberships({ status: { ...all, saleFlagOn: false } }, BEFORE).status, NYD);
    assert.equal(judgeMemberships({ status: all }, AFTER).status, GREEN);
    assert.equal(judgeMemberships({ status: { ...all, paystack: { ...all.paystack, liveKey: false } } }, AFTER).status, RED);
    assert.equal(judgeMemberships({ status: null, httpStatus: 403 }, BEFORE).status, RED, 'an unreadable status is red at any time');
  });
});

describe('W7 · JOBS and SIGNALS', () => {
  const now = BEFORE;
  test('a heartbeat: green when recent, red when stale or never, not yet due when not armed', () => {
    assert.equal(judgeHeartbeat('j', { lastAt: now - 10 * 60_000, staleMs: 40 * 60_000 }, now).status, GREEN);
    assert.equal(judgeHeartbeat('j', { lastAt: now - 60 * 60_000, staleMs: 40 * 60_000 }, now).status, RED);
    assert.equal(judgeHeartbeat('j', { lastAt: NaN, staleMs: 40 * 60_000 }, now).status, RED);
    assert.equal(judgeHeartbeat('j', { lastAt: NaN, staleMs: 40 * 60_000, armed: false }, now).status, NYD);
  });
  test('signals: red only for NEW, UNRESOLVED failures and new skips since the last check', () => {
    const since = now - 3600_000;
    assert.equal(judgeSignals({ moneyFailures: { old: { lastAt: since - 1 }, fixed: { lastAt: now, resolved: true } }, publishSkips: null, since }).status, GREEN);
    assert.equal(judgeSignals({ moneyFailures: { fresh: { lastAt: now - 60_000 } }, publishSkips: null, since }).status, RED);
    assert.equal(judgeSignals({ moneyFailures: {}, publishSkips: { phantom: { at: now - 60_000 } }, since }).status, RED);
  });
  test('the subject counts the reds', () => {
    assert.equal(summarise([{ status: GREEN }, { status: NYD }]).subject, '[launch] all green');
    assert.equal(summarise([{ status: RED }, { status: GREEN }, { status: RED }]).subject, '[launch] 2 red');
  });
  test('every row prints its evidence', () => {
    const text = renderText([{ name: 'Free week', status: NYD, evidence: 'gating_off everywhere' }], now);
    assert.match(text, /not yet due\s+Free week\s+gating_off everywhere/);
  });
});

describe('W7 · the schedule, in London time', () => {
  test('launch day 00:10 and 08:05 London fire from their BST crons, even when GitHub is late', () => {
    const MIN = 60_000;
    assert.equal(shouldRun('10 23 29 9 *', GATE_ON_MS + 10 * MIN), true);
    assert.equal(shouldRun('10 23 29 9 *', GATE_ON_MS + 48 * MIN), true, '38 minutes late');
    assert.equal(shouldRun('5 7 30 9 *', GATE_ON_MS + (8 * 60 + 5) * MIN), true);
    assert.equal(shouldRun('10 23 29 9 *', GATE_ON_MS + 365 * 24 * 60 * MIN + 10 * MIN), false, 'not again next year');
    assert.equal(shouldRun('10 23 29 9 *', GATE_ON_MS - 24 * 60 * MIN + 10 * MIN), false, 'not the day before');
  });
  test('Monday 00:10: the BST cron in summer, the GMT cron in winter — never both', () => {
    const bstSun = Date.parse('2026-10-18T23:10:00Z');     // Mon 19 Oct 00:10 BST
    const bstMon = Date.parse('2026-10-19T00:10:00Z');     // Mon 01:10 BST
    assert.equal(shouldRun('10 23 * * 0', bstSun), true);
    assert.equal(shouldRun('10 0 * * 1', bstMon), false);
    const gmtSun = Date.parse('2026-11-01T23:10:00Z');     // Sun 23:10 GMT
    const gmtMon = Date.parse('2026-11-02T00:10:00Z');     // Mon 00:10 GMT
    assert.equal(shouldRun('10 23 * * 0', gmtSun), false);
    assert.equal(shouldRun('10 0 * * 1', gmtMon), true);
  });
  test('a manual dispatch always runs; an unknown cron never does', () => {
    assert.equal(shouldRun(''), true);
    assert.equal(shouldRun('0 0 * * *'), false);
  });
  test('the workflow carries exactly the gate\'s crons', () => {
    const yml = readFileSync('.github/workflows/launch-check.yml', 'utf8');
    const crons = [...yml.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(crons, Object.keys(SCHEDULES).sort());
    assert.match(yml, /launch-check-gate\.mjs "\$\{\{ github\.event\.schedule \}\}"/);
    assert.match(yml, /node scripts\/launch-check\.mjs --email/);
  });
});

describe('W7 · the ops endpoints', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'sa@proj.iam.gserviceaccount.com', private_key_id: 'kid1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'kid1', alg: 'RS256' };
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }));
  const env = { FIREBASE_CLIENT_EMAIL: sa.client_email };
  const nowS = Math.floor(BEFORE / 1000);

  test('the launch check\'s token verifies under the account\'s published key', async () => {
    assert.equal(await verifyServiceJwt(opsToken(sa, nowS), env, { fetchImpl, nowS }), true);
  });
  test('refused: another account, a stale token, a tampered one, an unknown key', async () => {
    assert.equal(await verifyServiceJwt(opsToken(sa, nowS), { FIREBASE_CLIENT_EMAIL: 'other@x' }, { fetchImpl, nowS }), false);
    assert.equal(await verifyServiceJwt(opsToken(sa, nowS - 3600), env, { fetchImpl, nowS }), false);
    const t = opsToken(sa, nowS).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(t[1], 'base64url')), exp: nowS + 99999 })).toString('base64url');
    assert.equal(await verifyServiceJwt(`${t[0]}.${forged}.${t[2]}`, env, { fetchImpl, nowS }), false);
    assert.equal(await verifyServiceJwt(opsToken({ ...sa, private_key_id: 'nope' }, nowS), env, { fetchImpl, nowS }), false);
  });
  test('claims: audience, lifetime', () => {
    const base = { iss: 'e', sub: 'e', aud: OPS_AUDIENCE, iat: nowS, exp: nowS + 300 };
    assert.equal(claimsOk(base, { email: 'e', nowS }), true);
    assert.equal(claimsOk({ ...base, aud: 'x' }, { email: 'e', nowS }), false);
    assert.equal(claimsOk({ ...base, exp: nowS + 3600 }, { email: 'e', nowS }), false);
  });
  test('launch-status answers booleans ONLY — never a key, never a value', () => {
    const s = launchStatus({ STRIPE_SECRET_KEY: 'sk_live_abc', PAYSTACK_SECRET_KEY: 'sk_test_x', STRIPE_MEMBERSHIP_WEBHOOK_SECRET: 'whsec_1', RESEND_API_KEY: 're_1', MONEY_ALERT_EMAIL: 'a@b' });
    const leaves = [];
    const walk = (o) => { for (const v of Object.values(o)) (v && typeof v === 'object') ? walk(v) : leaves.push(v); };
    walk(s);
    assert.ok(leaves.length >= 9);
    assert.ok(leaves.every((v) => typeof v === 'boolean'), JSON.stringify(s));
    assert.equal(JSON.stringify(s).includes('sk_'), false);
    assert.equal(s.stripe.liveKey, true);
    assert.equal(s.paystack.liveKey, false);
  });
  test('launch-email: a fixed recipient, a [launch] subject, a text body', () => {
    assert.equal(LAUNCH_RECIPIENT_DEFAULT, 'Ikennaworksfromhome@gmail.com');
    assert.equal(refusalFor({ subject: '[launch] all green', text: 'x' }), null);
    assert.match(refusalFor({ subject: 'hello', text: 'x' }), /must begin "\[launch\] "/);
    assert.match(refusalFor({ subject: '[launch] x' }), /text body/);
    const src = readFileSync('functions/api/ops/launch-email.js', 'utf8');
    assert.doesNotMatch(src, /body\.to\b/, 'the recipient is never taken from the request');
  });
});
