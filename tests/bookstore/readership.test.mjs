// R14 — READERSHIP, asserted. `npm run test:purchases`.
//
// The count is a public number derived from private records by a write that must never happen
// twice. Every failure mode here is silent: a webhook replayed by Stripe's 72-hour retry
// schedule, a refund that decrements a book nobody refunded, a "1 readers" that reads as a
// typo. None of them throw. They all produce a plausible wrong sentence on a shop page.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  READERSHIP_PATH,
  READERSHIP_MIN,
  READERSHIP_REGISTER,
  READERSHIP_PLATFORMS,
  REGISTER_READERSHIP,
  REGISTER_SALES,
  groupThousands,
  readershipCountOf,
  readershipLine,
  readershipAllowedOn,
  readershipFor,
} from '../../app/lib/bookstore/readership.js';
import {
  readershipDelta,
  patchPurchase,
  PURCHASE_UNKNOWN,
  READERSHIP_PATH as LIB_READERSHIP_PATH,
  PURCHASES_PATH,
  buildGrantPayload,
  buildRevokePayload,
  shouldSkipGrant,
} from '../../functions/api/bookstore/_lib.js';
import { readershipFromPurchases, reconcile } from '../../scripts/readership-source.mjs';
import { formatPrice } from '../../app/bookstore/components/fields.js';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');

const active = (over = {}) => ({ status: 'active', purchasedAt: 1, ...over });
const revoked = (over = {}) => ({ status: 'revoked', purchasedAt: 1, revokedAt: 2, ...over });

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE WORDING — readership, never sales, and never "1 readers"', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('⭑ absent below one — null, not a zero and not a placeholder', () => {
    assert.equal(readershipLine(0), null);
    assert.equal(READERSHIP_MIN, 1);
    // Everything that is not a usable count reaches the same answer, so no call site has to
    // test for any of them.
    for (const bad of [null, undefined, -1, -0.5, 1.5, NaN, Infinity, '3', {}, []]) {
      assert.equal(readershipLine(bad), null, `${JSON.stringify(bad)} must render nothing`);
    }
  });

  test('⭑ present at one, and the singular is a whole sentence', () => {
    assert.equal(readershipLine(1), "In one reader's library");
    // The three failures the ruling named, each impossible now.
    assert.equal(/\b1 readers/.test(readershipLine(1)), false, 'never "1 readers"');
    assert.equal(readershipLine(1).includes("readers'"), false, 'the apostrophe moves with the noun');
    assert.equal(readershipLine(1).includes('1'), false, 'at one the shop is talking about a person, not a quantity');
  });

  test('plural from two up, with the apostrophe after the s', () => {
    assert.equal(readershipLine(2), "In 2 readers' libraries");
    assert.equal(readershipLine(12), "In 12 readers' libraries");
    assert.equal(readershipLine(100), "In 100 readers' libraries");
    for (const n of [2, 3, 11, 21, 101]) {
      assert.ok(readershipLine(n).includes("readers' libraries"), `plural wrong at ${n}`);
    }
  });

  test('grouped above a thousand, identically in every locale', () => {
    assert.equal(readershipLine(1204), "In 1,204 readers' libraries");
    assert.equal(readershipLine(1000000), "In 1,000,000 readers' libraries");
    assert.equal(groupThousands(999), '999');
    assert.equal(groupThousands(1000), '1,000');
  });

  test('ONE grouping implementation — the money module imports it, it does not own one', () => {
    // The function moved to the money-free side so the readership module could use it without
    // importing money. This asserts the move actually happened rather than being duplicated:
    // formatPrice still groups, and fields.js no longer defines a grouper.
    assert.equal(formatPrice('ngn', 450000), '₦4,500');
    assert.equal(formatPrice('usd', 123456789), '$1,234,567.89');
    const fields = src('app/bookstore/components/fields.js');
    assert.equal(/^\s*function group/m.test(fields), false, 'fields.js still defines its own grouper');
    assert.ok(/import \{ groupThousands \} from/.test(fields), 'fields.js does not import the shared one');
  });

  test('it is not shouting — casing is CSS’s job, as it is for every other small-caps line', () => {
    const line = readershipLine(12);
    assert.notEqual(line, line.toUpperCase(), 'a pre-shouted string cannot be reused quietly');
    assert.ok(line.startsWith('In '));
  });

  test('no money vocabulary in the module, and none at all in the COPY', () => {
    // Two checks, because 'sales' legitimately appears in this file exactly once as a
    // thing — the name of the register that is switched off — and nowhere as a word the shop
    // says. The first check therefore exempts the register identifiers by name; the second
    // reads the actual sentences and exempts nothing.
    const body = src('app/lib/bookstore/readership.js')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      .replaceAll('REGISTER_SALES', '').replaceAll("'sales'", '');
    for (const w of ['price', 'buy', 'purchase', 'checkout', 'currency', 'sold', 'sale']) {
      assert.equal(new RegExp(`\\b${w}`, 'i').test(body), false, `readership.js contains "${w}"`);
    }
    // '$' is deliberately absent: it is template-literal syntax on the very line that builds
    // the sentence, so it cannot discriminate. The dollar-then-digit pattern is what an
    // actual price tag looks like — same reasoning as tests/bookstore/sections.test.mjs.
    for (const sym of ['£', '₦', '€']) assert.equal(body.includes(sym), false);
    assert.equal(/\$\s?\d/.test(body), false, 'the module prints a dollar amount');

    // THE COPY. Every string this module can put on a screen, checked with no exemptions.
    for (const n of [1, 2, 3, 12, 999, 1204, 1000000]) {
      const line = readershipLine(n);
      for (const w of ['price', 'buy', 'purchase', 'sold', 'sale', 'copies', 'bought']) {
        assert.equal(new RegExp(`\\b${w}`, 'i').test(line), false, `the line at ${n} says "${w}": ${line}`);
      }
      assert.ok(/librar(y|ies)/.test(line), `the line at ${n} does not say library: ${line}`);
    }
    assert.equal(READERSHIP_REGISTER, REGISTER_READERSHIP);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE NODE — what a browser reads, and what it does with nonsense', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the two modules name the same node', () => {
    assert.equal(READERSHIP_PATH, 'bookstore_readership');
    assert.equal(LIB_READERSHIP_PATH, READERSHIP_PATH,
      'the writer and the reader must not disagree about which node this is');
  });

  test('count is read out of the object, and a bare integer is tolerated', () => {
    assert.equal(readershipCountOf({ count: 7 }), 7);
    assert.equal(readershipCountOf(7), 7);
    assert.equal(readershipCountOf(0), 0);
  });

  test('a NEGATIVE never renders — it is a reconciliation problem, not a fact about readers', () => {
    assert.equal(readershipCountOf({ count: -3 }), 0);
    assert.equal(readershipLine(readershipCountOf({ count: -3 })), null);
  });

  test('absent, null and hand-edited junk all mean "print nothing"', () => {
    for (const node of [null, undefined, {}, { count: '12' }, { count: 1.5 }, 'twelve', []]) {
      assert.equal(readershipFor(node), null, `${JSON.stringify(node)} rendered something`);
    }
  });

  test('a title’s line appearing needs no code change — only the number moving', () => {
    // The whole of "populates once a title has at least one purchase", as one assertion: the
    // same call site, the same arguments, a different stored number.
    assert.equal(readershipFor({ count: 0 }), null);
    assert.equal(readershipFor({ count: 1 }), "In one reader's library");
    assert.equal(readershipFor({ count: 2 }), "In 2 readers' libraries");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE LEDGER — the delta rides the purchase, once per live entitlement', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const grant = () => buildGrantPayload({ amount: 199, currency: 'gbp', refField: 'stripeSessionId', refValue: 'cs_1', fields: null });

  test('a new purchase is +1', () => {
    assert.equal(readershipDelta(null, grant()), 1);
  });

  test('⭑ a DOUBLE-FIRED WEBHOOK does not move it twice', () => {
    // Two halves, because the guard and the arithmetic are separate defences and either alone
    // would be enough to break.
    //
    // 1. The replay never reaches a write at all — the reference already on the record is the
    //    one arriving, so the whole handler returns before patchPurchase.
    const stored = { ...active(), stripeSessionId: 'cs_1' };
    assert.equal(shouldSkipGrant(stored, 'stripeSessionId', 'cs_1'), true);
    // 2. And if it somehow did reach the write — a future edit removing the guard, a rail
    //    whose guard is bypassed — the delta is still 0, because the record was already
    //    active and this write leaves it active. The count is a DIFFERENCE, not an increment.
    assert.equal(readershipDelta(stored, grant()), 0);
  });

  test('⭑ MUTATION: with shouldSkipGrant defeated, the count still does not move twice', async () => {
    // The mutation the brief asked for, run for real rather than described: a fake RTDB that
    // records every request, driven through patchPurchase twice with the SAME session, with
    // the idempotency guard deliberately not consulted. The count must be +1 in total.
    const calls = [];
    const env = { FIREBASE_DATABASE_URL: 'https://fake.example' };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    try {
      // First delivery: no record yet.
      const a = await patchPurchase(env, 't', 'uid1', 'basil', grant(), null);
      // Second delivery of the SAME event. The record now exists and is active — which is
      // exactly what the first write left behind.
      const b = await patchPurchase(env, 't', 'uid1', 'basil', grant(), { ...active(), stripeSessionId: 'cs_1' });
      assert.equal(a.delta, 1);
      assert.equal(b.delta, 0, 'the second delivery moved the public count');

      const counterKey = `${LIB_READERSHIP_PATH}/basil/count`;
      const withCounter = calls.filter((c) => counterKey in c.body);
      assert.equal(withCounter.length, 1, 'the counter was written on more than one delivery');
      assert.deepEqual(withCounter[0].body[counterKey], { '.sv': { increment: 1 } });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('⭑ the write is ONE atomic operation carrying both', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    try {
      await patchPurchase({ FIREBASE_DATABASE_URL: 'https://fake.example' }, 't', 'uid1', 'basil', grant(), null);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(calls.length, 1, 'grant and count must not be two requests — they could drift between them');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, 'https://fake.example/.json', 'a multi-path update is written at the root');
    const keys = Object.keys(calls[0].body);
    assert.ok(keys.some((k) => k.startsWith(`${PURCHASES_PATH}/uid1/basil/`)), 'no purchase fields in the write');
    assert.ok(keys.includes(`${LIB_READERSHIP_PATH}/basil/count`), 'no counter in the write');
  });

  test('⚠ it is still a PATCH — sibling fields are named individually, never the record', async () => {
    // A multi-path update REPLACES each path it names. Naming the record itself would be a
    // set() and would erase a fulfilment note or a refund trail a later flow added.
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{}' }; };
    try {
      await patchPurchase({ FIREBASE_DATABASE_URL: 'https://fake.example' }, 't', 'uid1', 'basil', buildRevokePayload('refunded'), active());
    } finally { globalThis.fetch = realFetch; }
    const keys = Object.keys(calls[0]);
    assert.equal(keys.includes(`${PURCHASES_PATH}/uid1/basil`), false, 'the record itself was named — that is a set()');
    assert.deepEqual(
      keys.filter((k) => k.startsWith(`${PURCHASES_PATH}/`)).sort(),
      [`${PURCHASES_PATH}/uid1/basil/revokedAt`, `${PURCHASES_PATH}/uid1/basil/revokedReason`, `${PURCHASES_PATH}/uid1/basil/status`],
    );
  });

  test('a refund decrements, and a replayed refund does not decrement again', () => {
    assert.equal(readershipDelta(active(), buildRevokePayload('refunded')), -1);
    assert.equal(readershipDelta(revoked(), buildRevokePayload('refunded')), 0);
    assert.equal(readershipDelta(revoked(), buildRevokePayload('disputed')), 0,
      'a dispute arriving after a refund is a second revocation of one entitlement');
  });

  test('a repurchase after a refund counts once — and only once per live entitlement', () => {
    assert.equal(readershipDelta(revoked(), grant()), 1);
    // The case that makes this a difference rather than an increment: granted twice with no
    // revocation between. One reader, one library, counted once.
    assert.equal(readershipDelta(active(), grant()), 0);
  });

  test('a revocation of a purchase that was never recorded moves nothing', () => {
    assert.equal(readershipDelta(null, buildRevokePayload('refunded')), 0);
  });

  test('a payload that says nothing about entitlement moves nothing', () => {
    assert.equal(readershipDelta(active(), { fulfilmentNote: 'resent' }), 0);
    assert.equal(readershipDelta(active(), {}), 0);
    assert.equal(readershipDelta(active(), null), 0);
  });

  test('⚠ a FAILED READ moves nothing — the count fails closed, downward', () => {
    // The grant still falls through to the write (a duplicate grant beats a reader with no
    // book); the count declines to guess, because a guess that lands on an already-active
    // record overstates a public number forever. Under-counting is what the reconciler is for.
    assert.equal(readershipDelta(PURCHASE_UNKNOWN, grant()), 0);
    assert.equal(readershipDelta(PURCHASE_UNKNOWN, buildRevokePayload('refunded')), 0);
    // …and the sentinel must not fool the idempotency guard into skipping a real grant.
    assert.equal(shouldSkipGrant(PURCHASE_UNKNOWN, 'stripeSessionId', 'cs_1'), false);
  });

  test('a status that is not exactly ‘active’ is not a library', () => {
    for (const status of ['ACTIVE', 'Active', 'pending', '', undefined, null]) {
      assert.equal(readershipDelta(null, { status }), 0, `status ${JSON.stringify(status)} counted`);
    }
  });

  test('an unsafe path segment is refused rather than written', async () => {
    await assert.rejects(
      () => patchPurchase({}, 't', 'uid.1', 'basil', { status: 'active' }, null),
      /unsafe RTDB path segment/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('BOTH RAILS GO THROUGH THE ONE WRITE', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const stripe = src('functions/api/bookstore/stripe-webhook.js');
  const paystack = src('functions/api/bookstore/paystack-webhook.js');
  const lib = src('functions/api/bookstore/_lib.js');

  test('neither webhook writes the readership node itself', () => {
    for (const [name, body] of [['stripe', stripe], ['paystack', paystack]]) {
      assert.equal(body.includes(READERSHIP_PATH), false,
        `${name} names the readership node directly — the counter must ride patchPurchase`);
    }
    assert.ok(lib.includes(READERSHIP_PATH));
  });

  test('every patchPurchase call passes the record it read', () => {
    for (const [name, body] of [['stripe', stripe], ['paystack', paystack]]) {
      const calls = body.match(/patchPurchase\([^;]*?\);/gs) || [];
      assert.ok(calls.length >= 2, `${name} has fewer patchPurchase calls than expected`);
      for (const c of calls) {
        assert.ok(/,\s*existing\s*\)/.test(c.replace(/\s+/g, ' ')),
          `${name}: a patchPurchase call does not pass \`existing\` — its delta would be a guess:\n${c.slice(0, 160)}`);
      }
    }
  });

  test('both rails initialise the idempotency read to PURCHASE_UNKNOWN, not null', () => {
    for (const [name, body] of [['stripe', stripe], ['paystack', paystack]]) {
      assert.ok(/let existing = PURCHASE_UNKNOWN;/.test(body),
        `${name} still initialises \`existing\` to null — a failed read would over-count`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('RECONCILIATION — recomputed from source, over a refund and a repurchase', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  // THE SYNTHETIC SET the brief asked for. Six readers, three titles, and the two awkward
  // histories that make an incremental counter and a recomputed one disagree if either is
  // wrong.
  const PURCHASES = {
    // Straightforward owners.
    reader1: { basil: active(), 'the-rescue': active() },
    reader2: { basil: active() },
    // A REFUND. One record, revoked. Not in anybody's library.
    reader3: { basil: revoked({ revokedReason: 'refunded' }) },
    // A REPURCHASE AFTER A REFUND. The node holds ONE record per (uid, titleId), so the
    // second purchase overwrote the first: status is active, and the stored reference is the
    // new one. It counts once, which is what "once per live entitlement" means.
    reader4: { basil: active({ stripeSessionId: 'cs_second' }) },
    // A DISPUTE.
    reader5: { 'the-rescue': revoked({ revokedReason: 'disputed' }) },
    // A record with no status at all — pre-R9 shape, or a partial write. Not counted.
    reader6: { 'after-the-fact': { purchasedAt: 1 } },
  };

  test('⭑ the recomputed truth', () => {
    const computed = readershipFromPurchases(PURCHASES);
    assert.equal(computed.get('basil'), 3, 'reader1, reader2 and the repurchasing reader4');
    assert.equal(computed.get('the-rescue'), 1, 'reader5 disputed theirs');
    assert.equal(computed.has('after-the-fact'), false,
      'a title with no ACTIVE record is absent from the map, not present with 0 — absent is absent');
  });

  test('the incremental ledger arrives at the same numbers', () => {
    // Replay the same six histories as deltas, the way the webhooks would have produced them,
    // and check the running totals match the recomputation. This is what makes the reconciler
    // meaningful: two independent routes to one number.
    const totals = {};
    const bump = (titleId, d) => { totals[titleId] = (totals[titleId] || 0) + d; };
    const g = { status: 'active' };
    const r = { status: 'revoked' };

    bump('basil', readershipDelta(null, g));                 // reader1 buys
    bump('the-rescue', readershipDelta(null, g));            // reader1 buys
    bump('basil', readershipDelta(null, g));                 // reader2 buys
    bump('basil', readershipDelta(null, g));                 // reader3 buys
    bump('basil', readershipDelta(active(), r));             // reader3 refunds
    bump('basil', readershipDelta(null, g));                 // reader4 buys
    bump('basil', readershipDelta(active(), r));             // reader4 refunds
    bump('basil', readershipDelta(revoked(), g));            // reader4 buys AGAIN
    bump('the-rescue', readershipDelta(null, g));            // reader5 buys
    bump('the-rescue', readershipDelta(active(), r));        // reader5 disputes
    bump('the-rescue', readershipDelta(revoked(), r));       // the dispute is delivered twice

    const computed = readershipFromPurchases(PURCHASES);
    assert.equal(totals.basil, computed.get('basil'));
    assert.equal(totals['the-rescue'], computed.get('the-rescue'));
    assert.equal(totals.basil, 3);
    assert.equal(totals['the-rescue'], 1);
  });

  test('it REPORTS drift and never repairs it', () => {
    const computed = readershipFromPurchases(PURCHASES);
    const { rows, drift } = reconcile(computed, { basil: { count: 3 }, 'the-rescue': { count: 9 } });
    assert.equal(drift.length, 1);
    assert.deepEqual(drift[0], { titleId: 'the-rescue', want: 1, have: 9, ok: false });
    // The stored object is untouched — reconcile is pure and takes no writer.
    assert.equal(rows.find((x) => x.titleId === 'basil').ok, true);
    const source = src('scripts/readership.mjs');
    const reportBlock = source.slice(source.indexOf("if (verb === 'report')"), source.indexOf('// backfill'));
    assert.equal(/rtdb\('(PUT|PATCH|POST|DELETE)'/.test(reportBlock), false,
      'the report path writes — it must only ever read');
  });

  test('an absent stored node reads as agreement when nothing has been bought', () => {
    const { drift } = reconcile(readershipFromPurchases({}), {});
    assert.equal(drift.length, 0);
  });

  test('a stored count for a title with no active purchase is DRIFT, not silence', () => {
    const { drift } = reconcile(readershipFromPurchases(PURCHASES), { basil: { count: 3 }, 'the-rescue': { count: 1 }, 'after-the-fact': { count: 4 } });
    assert.deepEqual(drift.map((d) => d.titleId), ['after-the-fact']);
  });

  test('the backfill writes nothing for a title nobody has bought', () => {
    const computed = readershipFromPurchases(PURCHASES);
    const payload = {};
    for (const [titleId, count] of computed) payload[titleId] = { count };
    assert.deepEqual(Object.keys(payload).sort(), ['basil', 'the-rescue']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE PLATFORM GATE — one constant, and today it is open everywhere', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('readership is not money language, so every platform may render it', () => {
    assert.equal(READERSHIP_REGISTER, 'readership');
    for (const p of ['web', 'ios', 'android']) {
      assert.equal(readershipAllowedOn(p), true, `${p} is gated for no reason`);
      assert.equal(readershipFor({ count: 3 }, p), "In 3 readers' libraries");
    }
  });

  test('flipping ONE constant to the sales register gates it to the web — no call site changes', () => {
    // Asserted by passing the register rather than editing the file, the pattern
    // app/lib/series/access.js established with TIER_GATE_OFF.
    assert.equal(readershipAllowedOn('web', REGISTER_SALES), true);
    assert.equal(readershipAllowedOn('ios', REGISTER_SALES), false);
    assert.equal(readershipAllowedOn('android', REGISTER_SALES), false);
    assert.equal(readershipFor({ count: 3 }, 'ios', REGISTER_SALES), null);
    // …and the same call still works on the web, which is what "not a rewrite" means.
    assert.equal(readershipFor({ count: 3 }, 'web', REGISTER_SALES), "In 3 readers' libraries");
  });

  test('an unknown platform is refused in both registers — the gate fails closed', () => {
    for (const reg of [REGISTER_READERSHIP, REGISTER_SALES]) {
      assert.equal(readershipAllowedOn('windows-phone', reg), false);
      // The default platform is 'web', which is allowed in BOTH registers — the sales gate
      // shuts the app out, not the shop.
      assert.equal(readershipAllowedOn(undefined, reg), true);
    }
    assert.equal(readershipAllowedOn('web', 'invented-register'), false);
  });

  test('the platform table names every platform exactly once per register', () => {
    for (const [reg, list] of Object.entries(READERSHIP_PLATFORMS)) {
      assert.equal(new Set(list).size, list.length, `${reg} repeats a platform`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('IT IS PUBLIC DATA — a signed-out guest reads the same number', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the node is .read: true, and bookstore_purchases stays private', () => {
    const rules = JSON.parse(src('database.rules.json')).rules;
    assert.equal(rules[READERSHIP_PATH]['.read'], true,
      'the storefront is anonymous; a gated count could not be rendered at all');
    assert.match(rules[READERSHIP_PATH]['.write'], /auth != null/);
    // The private half must NOT have been loosened to make this easier.
    assert.equal(rules.bookstore_purchases['.read'], undefined,
      'bookstore_purchases must have no node-level read grant');
    assert.match(rules.bookstore_purchases.$uid['.read'], /auth\.uid == \$uid/);
  });

  test('the loader reads the public node and never the private one', () => {
    const loader = src('app/lib/bookstore/loader.js');
    // The path comes from the shared constant, not a literal — asserted, because a literal
    // here would be a second name for the node and the reader and writer could drift.
    assert.ok(/import \{[^}]*READERSHIP_PATH[^}]*\} from '\.\/readership'/.test(loader),
      'the loader does not import the shared path constant');
    const fn = loader.slice(loader.indexOf('export async function getReadership'));
    assert.ok(fn.includes('${READERSHIP_PATH}'), 'getReadership does not read the shared constant');
    assert.equal(fn.includes('bookstore_readership'), false, 'the node name is written out a second time');
    assert.equal(fn.includes('bookstore_purchases'), false,
      'the count must never be derived client-side from the per-reader node');
    assert.equal(/\buser\b|\buid\b|currentUser/.test(fn.slice(0, fn.indexOf('\n}'))), false,
      'no signed-in state may gate a public read');
  });

  test('the detail page renders the line with no auth condition on it', () => {
    const page = src('app/bookstore/[slug]/page-detail.js');
    assert.ok(page.includes('data-testid="readership-line"'));
    const block = page.slice(page.indexOf('{readershipLine && ('), page.indexOf('data-testid="readership-line"'));
    assert.equal(/user|uid|purchased|signedIn/.test(block), false,
      'the readership line is gated on something other than the count');
  });
});
