// W3b — FOUNDER COPIES: complimentary, outside sales.
//
//   node --test tests/bookstore/comps.test.mjs          (part of npm run test:purchases)
//
// Ikenna's ruling (25 Sep 2026): complimentary copies of the catalogue on his own account, so
// My Library's Books design can be walked with real books. Comps, never sales. This file holds
// the grant, its idempotence, every place a comp must NOT count, and the revoke.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  planGrant, planRevoke, compRecord, COMP_GRANT, IKENNA_UID,
} from '../../scripts/bookstore/founder-comps.mjs';
import { isComp, isSale, countsForReadership, COMP_SOURCE } from '../../app/lib/bookstore/purchaseSource.js';
import { readershipDelta, buildGrantPayload, shouldSkipGrant } from '../../functions/api/bookstore/_lib.js';
import { readershipFromPurchases } from '../../scripts/readership-source.mjs';
import { classifyRecord } from '../../scripts/clear-test-purchases.mjs';
import { DATA_CONTRACTS, SECTION_TYPES, TYPE_READERS_CHOICE, TYPE_TOP_OF_THE_SHELF } from '../../app/lib/bookstore/sections.js';
import { billingBackstop } from '../../scripts/account/scrub.mjs';

const SECOND_FOUNDER = 'GfXFIc0dThZ1cs2SBBQIFao4aSz1';
const NOW = 1790300000000;
const TITLES = {
  'mrs-dalloway': { status: 'published', slug: 'mrs-dalloway', title: 'Mrs Dalloway', author: 'Virginia Woolf', coverUrl: 'https://x/c.webp', prices: { gbp: 199 } },
  'the-awakening': { status: 'published', slug: 'the-awakening', title: 'The Awakening', author: 'Kate Chopin' },
  'a-draft': { status: 'draft', slug: 'a-draft', title: 'Draft' },
  'gone': { status: 'withdrawn', slug: 'gone', title: 'Gone' },
};
const SALE = { status: 'active', amount: 199, currency: 'gbp', stripeSessionId: 'cs_live_1', stripePaymentIntent: 'pi_1', purchasedAt: 1 };

describe('the grant', () => {
  test('every PUBLISHED title, and nothing else', () => {
    const { granted } = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: null, now: NOW });
    assert.deepEqual(granted, ['mrs-dalloway', 'the-awakening']);
  });

  test('THE SAME ENTITLEMENT a purchase is: status active on bookstore_purchases/{uid}/{titleId}, with the display fields', () => {
    const { update } = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: null, now: NOW });
    const rec = update[`bookstore_purchases/${IKENNA_UID}/mrs-dalloway`];
    assert.equal(rec.status, 'active', 'what stream.js and both shelves test, verbatim');
    assert.equal(rec.slug, 'mrs-dalloway');
    assert.equal(rec.title, 'Mrs Dalloway');
    assert.equal(rec.coverUrl, 'https://x/c.webp');
  });

  test('marked comp, and carries NO amount, NO currency and NO provider id (absent, not null)', () => {
    const rec = compRecord(TITLES['mrs-dalloway'], NOW);
    assert.equal(rec.source, COMP_SOURCE);
    assert.equal(rec.compGrant, COMP_GRANT);
    for (const k of ['amount', 'currency', 'stripeSessionId', 'stripePaymentIntent', 'paystackRef']) {
      assert.equal(k in rec, false, `${k} must be absent`);
    }
  });

  test('Ikenna\'s account only — the second founder is not covered without his word', () => {
    assert.throws(() => planGrant({ uid: SECOND_FOUNDER, titles: TITLES, mine: null, now: NOW }), /not an account the ruling covers/);
  });

  test('the grant writes ONLY purchase records — no readership, no ops, nothing else', () => {
    const { update } = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: null, now: NOW });
    for (const k of Object.keys(update)) assert.ok(k.startsWith(`bookstore_purchases/${IKENNA_UID}/`), k);
  });
});

describe('idempotence', () => {
  test('running it twice grants nothing new', () => {
    const first = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: null, now: NOW });
    const mine = Object.fromEntries(Object.entries(first.update).map(([p, v]) => [p.split('/').pop(), v]));
    const second = planGrant({ uid: IKENNA_UID, titles: TITLES, mine, now: NOW + 1 });
    assert.deepEqual(second.granted, []);
    assert.deepEqual(second.update, {});
  });

  test('a title he already BOUGHT (or had refunded) is left exactly as it is', () => {
    const r = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: { 'mrs-dalloway': SALE, 'the-awakening': { ...SALE, status: 'revoked' } }, now: NOW });
    assert.deepEqual(r.granted, []);
    assert.equal(r.skipped.length, 2);
  });
});

describe('comps never count as sales', () => {
  const comp = compRecord(TITLES['mrs-dalloway'], NOW);

  test('the predicate: a comp is not a sale and not a reader\'s purchase', () => {
    assert.equal(isComp(comp), true);
    assert.equal(isSale(comp), false);
    assert.equal(countsForReadership(comp), false);
    assert.equal(isSale(SALE), true);
    assert.equal(countsForReadership(SALE), true);
  });

  test('POPULARITY — the public readership count: a comp moves it by nothing', () => {
    assert.equal(readershipDelta(null, comp), 0);
    assert.equal(readershipDelta(comp, { status: 'revoked' }), 0, 'and removing one moves it by nothing');
  });

  test('…and the reconciler (readership report, the clear script, verify-live-purchase) does not count it', () => {
    const counts = readershipFromPurchases({ [IKENNA_UID]: { 'mrs-dalloway': comp }, reader: { 'mrs-dalloway': SALE } });
    assert.equal(counts.get('mrs-dalloway'), 1, 'the sale, and only the sale');
  });

  test('a REAL purchase over a comp is a sale: it grants, counts +1, and loses the comp marks', () => {
    assert.equal(shouldSkipGrant(comp, 'stripeSessionId', 'cs_live_9'), false);
    const payload = buildGrantPayload({ amount: 199, currency: 'gbp', refField: 'stripeSessionId', refValue: 'cs_live_9' });
    assert.equal(readershipDelta(comp, payload), 1);
    assert.equal(payload.source, null, 'null deletes the comp mark in the PATCH');
    assert.equal(payload.compGrant, null);
  });

  test('BESTSELLER SIGNALS — Readers\' Choice\'s library adds exclude comps; Top of the Shelf reads no data at all', () => {
    assert.deepEqual(DATA_CONTRACTS[TYPE_READERS_CHOICE].excludesSources, ['comp']);
    assert.equal(SECTION_TYPES[TYPE_TOP_OF_THE_SHELF].dataDriven, false, 'curator-ordered: no purchase can move it');
  });

  test('MONEY ALERTS and the SCRUB BACKSTOP: a comp reaches neither', () => {
    const src = readFileSync('scripts/bookstore/founder-comps.mjs', 'utf8');
    assert.doesNotMatch(src, /_money|money_failures|resend/i, 'the grant has no path to a money alert');
    // The backstop reads a reader's MEMBERSHIP record, never their books.
    assert.equal(billingBackstop(IKENNA_UID, null), null);
    const scrub = readFileSync('scripts/account/scrub.mjs', 'utf8');
    assert.match(scrub, /billingBackstop\(uid, \(await db\.ref\(`memberships\/\$\{uid\}`\)\.get\(\)\)\.val\(\)\)/);
  });

  test('the test-purchase clear never takes a comp (it is not a purchase to clear)', () => {
    const c = classifyRecord(comp);
    assert.equal(c.removable, false);
    assert.match(c.refusal, /complimentary copy/);
  });

  // REVENUE, SALES FIGURES, PUBLISHER AND ROYALTY STATEMENTS, ADMIN REPORTS. None of these
  // computes anything from bookstore_purchases today (the admin shows the readership counter,
  // and /admin/publishers stores only a sales split). So the proof is a guard on the tree: every
  // file that reads the WHOLE node — the only way to aggregate it — must go through the
  // predicate, or be a backup that copies bytes and reports nothing.
  test('every aggregation of bookstore_purchases in the tree goes through the comp predicate', () => {
    const walk = (d) => readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      if (/node_modules|\.next|^out$/.test(f)) return [];
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const BACKUPS = new Set(['scripts/backup/export.mjs', 'scripts/backup/restore-drill.mjs', 'scripts/backup/assess.mjs']);
    const offenders = [];
    for (const f of [...walk('app'), ...walk('functions'), ...walk('scripts')].filter((p) => /\.(m?js)$/.test(p))) {
      if (BACKUPS.has(f)) continue;
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      const wholeNode = /ref\(\s*(db\s*,\s*)?['"`]bookstore_purchases['"`]\s*\)|['"`]bookstore_purchases\.json|PURCHASES_PATH\}\.json/.test(code);
      if (!wholeNode) continue;
      if (!/purchaseSource|readership-source/.test(code)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], 'a report over purchases that does not ask isSale / countsForReadership would count comps');
  });
});

describe('the revoke', () => {
  test('removes EXACTLY this batch\'s comps, and nothing else', () => {
    const mine = {
      'mrs-dalloway': compRecord(TITLES['mrs-dalloway'], NOW),
      'the-awakening': compRecord(TITLES['the-awakening'], NOW),
      bought: SALE,
      refunded: { ...SALE, status: 'revoked' },
      'another-batch': { ...compRecord(TITLES['mrs-dalloway'], NOW), compGrant: 'someone-else' },
      // a comp he later BOUGHT: the purchase cleared the marks, so it is a sale now
      'bought-over-comp': { ...SALE, source: undefined },
    };
    const { update, removed, kept } = planRevoke({ uid: IKENNA_UID, mine });
    assert.deepEqual(removed.sort(), ['mrs-dalloway', 'the-awakening']);
    assert.deepEqual(Object.values(update), [null, null]);
    assert.deepEqual(kept.sort(), ['another-batch', 'bought', 'bought-over-comp', 'refunded']);
  });

  test('grant then revoke leaves the account as it was', () => {
    const before = { bought: SALE };
    const g = planGrant({ uid: IKENNA_UID, titles: TITLES, mine: before, now: NOW });
    const after = { ...before, ...Object.fromEntries(Object.entries(g.update).map(([p, v]) => [p.split('/').pop(), v])) };
    const r = planRevoke({ uid: IKENNA_UID, mine: after });
    const final = { ...after };
    for (const p of Object.keys(r.update)) delete final[p.split('/').pop()];
    assert.deepEqual(final, before);
  });
});
