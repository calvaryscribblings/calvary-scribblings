// RULING 261 — THE EDITORS' ALERT SERVICE, and the duplicate payment that uses it first.
//
//   npm run test:store-webhook:emulator
//
// functions/api/_alerts.js claims ops/editor_alerts/{kind}/{key} on the RTDB emulator with a real
// ETag precondition, then "sends" through Resend — which the harness records and never delivers.
// The webhooks run unmodified on signed provider-shaped events (harness.mjs).
//
// The service is imported dynamically so that, on a build that predates it, its cases FAIL with
// the import's error rather than taking the whole file down — which is how this suite was shown
// red first on cd4605f6.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as stripeHook } from '../../functions/api/bookstore/stripe-webhook.js';
import { onRequestPost as paystackHook } from '../../functions/api/bookstore/paystack-webhook.js';
import { LAUNCH_RECIPIENT_DEFAULT } from '../../functions/api/ops/launch-email.js';
import {
  ENV, install, uninstall, wipe, get, set, sentMail, resendRefuses,
  stripe, paystack, stripeSessionCompleted, stripeChargeRefunded, paystackRef, paystackChargeSuccess,
} from './harness.mjs';

const service = () => import('../../functions/api/_alerts.js');

const UID = 'w261ReaderUid00000000000001';
const TITLE = 'harness-title-261';
const A = { session: 'cs_test_261_first', pi: 'pi_test_261_first' };
const B = { session: 'cs_test_261_second', pi: 'pi_test_261_second' };
const buy = (p, amount = 999) => stripe(stripeHook, stripeSessionCompleted({ uid: UID, titleId: TITLE, ...p, amount }));

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  await set(`bookstore_titles/${TITLE}`, { slug: TITLE, title: 'The Alert Title', author: 'A. Harness', status: 'published', prices: { gbp: 999, ngn: 750000 } });
});

describe('261 · the alert service', () => {
  test('once per kind and key: a second raise sends nothing, and the record says it was sent', async () => {
    const { raiseAlert } = await service();
    const a = await raiseAlert(ENV, { kind: 'test_kind', key: 'k1', subject: 'Hello', lines: ['one line'] });
    const b = await raiseAlert(ENV, { kind: 'test_kind', key: 'k1', subject: 'Hello', lines: ['one line'] });
    assert.deepEqual(a, { sent: true });
    assert.deepEqual(b, { sent: false, why: 'already raised' });
    assert.equal(sentMail.length, 1);
    const rec = await get('ops/editor_alerts/test_kind/k1');
    assert.equal(rec.sent, true);
    assert.equal(typeof rec.sentAt, 'number');
    // a different key, or the same key under another kind, is another alert
    await raiseAlert(ENV, { kind: 'test_kind', key: 'k2', subject: 'Hello', lines: ['x'] });
    await raiseAlert(ENV, { kind: 'other_kind', key: 'k1', subject: 'Hello', lines: ['x'] });
    assert.equal(sentMail.length, 3);
  });

  test('racing raises of one key send once', async () => {
    const { raiseAlert } = await service();
    const results = await Promise.all(Array.from({ length: 5 }, () => raiseAlert(ENV, { kind: 'test_kind', key: 'race', subject: 'S', lines: ['x'] })));
    assert.equal(results.filter((r) => r.sent).length, 1);
    assert.equal(sentMail.length, 1);
  });

  test('the recipient is fixed on the server: the launch-email recipient, never the caller\'s', async () => {
    const { raiseAlert } = await service();
    await raiseAlert(ENV, { kind: 'test_kind', key: 'r1', subject: 'S', lines: ['x'], to: 'someone@else.test' });
    assert.deepEqual(sentMail[0].to, [LAUNCH_RECIPIENT_DEFAULT]);
    await raiseAlert({ ...ENV, LAUNCH_ALERT_EMAIL: 'override@calvary.invalid' }, { kind: 'test_kind', key: 'r2', subject: 'S', lines: ['x'] });
    assert.deepEqual(sentMail[1].to, ['override@calvary.invalid'], 'the Pages variable, when set, as launch-email reads it');
    assert.equal(sentMail[0].from, `Calvary Scribblings <${ENV.FROM_EMAIL}>`);
    assert.match(sentMail[0].subject, /^\[alert\] /);
  });

  test('nothing personal: a message with an email address or a payment reference is refused, unsent', async () => {
    const { raiseAlert } = await service();
    const e = await raiseAlert(ENV, { kind: 'test_kind', key: 'p1', subject: 'S', lines: ['reader: someone@example.com'] });
    const s = await raiseAlert(ENV, { kind: 'test_kind', key: 'p2', subject: 'S', lines: [`paid on ${A.session}`] });
    const p = await raiseAlert(ENV, { kind: 'test_kind', key: 'p3', subject: 'S', lines: [`ref ${paystackRef(UID, TITLE, 'a1b2c3d4e5f6')}`] });
    for (const r of [e, s, p]) assert.equal(r.sent, false);
    assert.equal(sentMail.length, 0);
    assert.equal(await get('ops/editor_alerts/test_kind'), null, 'and nothing was claimed for them');
  });

  test('a failed send is logged and returned, never thrown — and is not retried by a second raise', async () => {
    const { raiseAlert } = await service();
    resendRefuses(true);
    const r = await raiseAlert(ENV, { kind: 'test_kind', key: 'f1', subject: 'S', lines: ['x'] });
    assert.deepEqual(r, { sent: false, why: 'resend 500' });
    resendRefuses(false);
    assert.equal((await raiseAlert(ENV, { kind: 'test_kind', key: 'f1', subject: 'S', lines: ['x'] })).sent, false);
    const rec = await get('ops/editor_alerts/test_kind/f1');
    assert.equal(rec.sent, false);
    assert.equal(rec.why, 'resend 500');
  });

  test('no mail configured: recorded, not sent, not thrown', async () => {
    const { raiseAlert } = await service();
    const r = await raiseAlert({ ...ENV, RESEND_API_KEY: '' }, { kind: 'test_kind', key: 'n1', subject: 'S', lines: ['x'] });
    assert.deepEqual(r, { sent: false, why: 'mail not configured' });
    assert.equal(sentMail.length, 0);
  });
});

describe('261 · a duplicate payment emails Ikenna once', () => {
  test('a duplicate, delivered four times, raises exactly one alert — with the ruled wording', async () => {
    await buy(A);
    assert.equal(sentMail.length, 0, 'a first purchase raises nothing');
    for (let i = 0; i < 4; i++) assert.equal((await buy(B, 1099)).status, 200);
    assert.equal(sentMail.length, 1);
    const m = sentMail[0];
    assert.equal(m.subject, '[alert] Paid twice: “The Alert Title”');
    const lines = m.text.split('\n');
    assert.equal(lines[0], 'A reader paid again for a book already in their library.');
    assert.equal(lines[2], `Title:   The Alert Title (${TITLE})`);
    assert.equal(lines[3], 'Rail:    Stripe');
    assert.equal(lines[4], 'Amount:  £10.99');
    assert.match(lines[5], /^Time:    \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} London$/);
    assert.equal(lines[6], `Reader:  ${UID}`);
    assert.equal(lines.at(-1), 'Refund by hand in Stripe or Paystack.');
    assert.doesNotMatch(m.text + m.subject, /cs_test_|pi_test_|@/, 'no payment reference, no address');
  });

  test('across rails: a Paystack duplicate beside a Stripe copy raises one alert, in naira', async () => {
    await buy(A);
    const ref = paystackRef(UID, TITLE, '0f9e8d7c6b5a');
    await paystack(paystackHook, paystackChargeSuccess({ reference: ref }));
    await paystack(paystackHook, paystackChargeSuccess({ reference: ref }));
    assert.equal(sentMail.length, 1);
    assert.match(sentMail[0].text, /^Rail: {4}Paystack$/m);
    assert.match(sentMail[0].text, /^Amount: {2}₦7,500$/m);
    assert.doesNotMatch(sentMail[0].text, /cs\./);
  });

  test('a retry after the duplicate was refunded raises nothing more', async () => {
    await buy(A);
    await buy(B);
    await stripe(stripeHook, stripeChargeRefunded({ uid: UID, titleId: TITLE, pi: B.pi }));
    await buy(B);
    assert.equal(sentMail.length, 1);
  });

  test('when the email fails, the webhook\'s answer and the filing are exactly as without it', async () => {
    await buy(A);
    resendRefuses(true);
    const r = await buy(B);
    assert.equal(r.status, 200);
    assert.equal(r.body.verdict, 'duplicate');
    const dups = await get(`bookstore_duplicate_payments/${UID}/${TITLE}`);
    assert.equal(Object.values(dups)[0].status, 'open');
  });

  test('a normal purchase and refund raise nothing', async () => {
    await buy(A);
    await stripe(stripeHook, stripeChargeRefunded({ uid: UID, titleId: TITLE, pi: A.pi }));
    assert.equal(sentMail.length, 0);
  });
});
