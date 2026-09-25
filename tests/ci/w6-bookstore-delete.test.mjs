// W6 (A) — THE BOOK STORE DELETE COUNTS EVERY HOLDER, COMPS INCLUDED. And (the load half) a
// Book Store that failed to load never reads as an empty catalogue.
//
//   node --test tests/ci/w6-bookstore-delete.test.mjs        (part of npm run test:ci)
//
// The hole: the admin's title delete decided whether anyone owned a book from
// bookstore_readership, the readers-who-BOUGHT counter, which excludes complimentary copies by
// the W3b ruling. A title held only as a comp read as unowned, and deletionPlan() queued its
// master EPUB for deletion — the file the comp opens through /api/bookstore/stream.
//
// Now the count is every active entitlement in bookstore_purchases, whatever its source
// (holdersOf in app/lib/bookstore/purchaseSource.js), read server-side by
// functions/api/bookstore/holders.js, and an unreadable count refuses the delete.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

import { holdersOf, holdsBook, countsForReadership, COMP_SOURCE } from '../../app/lib/bookstore/purchaseSource.js';
import {
  deletionPlan, ownersKnown, OWNERS_UNKNOWN, holderCountFrom, ownersSentence, confirmConsequence, masterPathFor,
} from '../../app/lib/bookstore/withdrawal.js';
import { onRequestGet } from '../../functions/api/bookstore/holders.js';

const src = (p) => readFileSync(p, 'utf8');
// Comment lines stripped: these files ARGUE with the old code by name, in their comments.
const code = (p) => src(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n');
const IKENNA = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const comp = { status: 'active', source: COMP_SOURCE, compGrant: 'founder-2026-09' };
const sale = { status: 'active', amount: 199, currency: 'gbp', stripeSessionId: 'cs_1' };
const refunded = { ...sale, status: 'revoked' };

// A comp-only title, a mixed title, a title whose only record was refunded.
const PURCHASES = {
  [IKENNA]: { 'comp-only': comp, mixed: comp, refunded: comp },
  readerA: { mixed: sale, refunded },
  readerB: { mixed: sale },
  readerC: { other: sale },
};
const TITLE = { title: 'Comp Only', slug: 'comp-only', coverUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/bookstore_covers%2Fcomp-only.jpg?alt=media' };

describe('the holder count', () => {
  test('A COMP-ONLY TITLE HAS A HOLDER. The readership predicate says nobody; holdersOf says one', () => {
    const readership = Object.values(PURCHASES).filter((shelf) => countsForReadership(shelf['comp-only'])).length;
    assert.equal(readership, 0, 'the old count — the hole');
    assert.deepEqual(holdersOf(PURCHASES, 'comp-only'), { count: 1, comps: 1 });
  });

  test('sales and comps together; comps is a subset of count, never added to it', () => {
    assert.deepEqual(holdersOf(PURCHASES, 'mixed'), { count: 3, comps: 1 });
  });

  test('a revoked record holds nothing — the same test stream.js makes (status === active)', () => {
    assert.equal(holdsBook(refunded), false);
    assert.deepEqual(holdersOf(PURCHASES, 'refunded'), { count: 1, comps: 1 }, 'only the comp');
    assert.deepEqual(holdersOf(PURCHASES, 'nobody'), { count: 0, comps: 0 });
    assert.deepEqual(holdersOf(null, 'x'), { count: 0, comps: 0 });
    assert.deepEqual(holdersOf({ u: null, v: 'junk', w: { x: [1] } }, 'x'), { count: 0, comps: 0 });
  });

  test('THE MASTER OF A COMP-ONLY TITLE IS HELD, not deleted', () => {
    const { count, comps } = holdersOf(PURCHASES, 'comp-only');
    const plan = deletionPlan({ titleId: 'comp-only', title: TITLE, owners: ownersKnown(count, comps) });
    assert.equal(plan.ok, true, 'deletion is still allowed — ruling 1');
    assert.ok(plan.held.includes(masterPathFor('comp-only')));
    assert.equal(plan.delete.includes(masterPathFor('comp-only')), false);
    assert.ok(plan.held.includes('bookstore_covers/comp-only.jpg'), 'and the cover the shelf renders');
  });

  test('the confirm step names the complimentary copies, and keeps its old wording without them', () => {
    assert.equal(ownersSentence(3, 1), 'Three readers hold this book (one complimentary copy).');
    assert.equal(ownersSentence(1, 1), 'One reader holds this book (a complimentary copy).');
    assert.equal(ownersSentence(22, 22), '22 readers hold this book (all complimentary copies).');
    assert.equal(ownersSentence(9, 0), 'Nine readers own this book.');
    assert.match(confirmConsequence(3, 1), /^Three readers hold this book \(one complimentary copy\)\. They keep it/);
  });
});

describe('an unreadable count refuses the delete (fail closed)', () => {
  test('the endpoint answer is a count only when it is a 200 with two sane integers', () => {
    assert.deepEqual(holderCountFrom(200, { ok: true, count: 3, comps: 1 }), ownersKnown(3, 1));
    for (const [status, body] of [
      [500, { ok: true, count: 0, comps: 0 }], [403, { error: 'Not authorised.' }], [200, null],
      [200, { ok: true, count: '3', comps: 0 }], [200, { ok: true, count: 3 }], [200, { ok: true, count: 1, comps: 2 }],
      [200, { count: 0, comps: 0 }], [200, { ok: true, count: -1, comps: 0 }],
    ]) {
      assert.equal(holderCountFrom(status, body).ok, false, `${status} ${JSON.stringify(body)} must be unknown`);
    }
    assert.equal(deletionPlan({ titleId: 't', title: TITLE, owners: OWNERS_UNKNOWN }).delete.length, 0);
  });

  test('deleteTitle and deletionPreview read the HOLDER count and refuse on unknown, with the retry wording', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    assert.match(admin, /export const HOLDERS_UNREAD = "Couldn't check who holds this book, so nothing was deleted\. Retry\.";/);
    const reader = admin.slice(admin.indexOf('export async function readHolderCount'), admin.indexOf('export const HOLDERS_UNREAD'));
    assert.match(reader, /holderCountFrom\(res\.status, body\)/);
    assert.match(reader, /catch \(err\)[\s\S]*return OWNERS_UNKNOWN;/, 'a thrown read is unknown, never zero');
    assert.doesNotMatch(reader, /ownersKnown\(0/, 'no silent zero');
    for (const fn of ['export async function deletionPreview', 'export async function deleteTitle']) {
      const body = admin.slice(admin.indexOf(fn), admin.indexOf('\n}\n', admin.indexOf(fn)));
      assert.match(body, /const owners = await readHolderCount\(titleId\);\s*if \(!owners\.ok\) return \{ ok: false, retry: true, errors: \[HOLDERS_UNREAD\] \};/, fn);
      assert.doesNotMatch(body, /READERSHIP_PATH|readOwnerCount/, `${fn} must not fall back to the readership counter`);
    }
    // And the panel says it with a Retry, not in an alert().
    const page = code('app/admin/bookstore/page.js');
    const open = page.slice(page.indexOf('async function openDelete'), page.indexOf('async function confirmWithdraw'));
    assert.doesNotMatch(open, /alert\(/);
    assert.match(open, /retry: preview\.retry \? \{ kind: 'count', title \} : null/);
  });
});

describe('/api/bookstore/holders', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'a@b.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey };
  async function call({ uid = IKENNA, purchases = PURCHASES, dbStatus = 200, titleId = 'comp-only' } = {}) {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      const ok = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('identitytoolkit')) return ok({ users: [{ localId: uid }] });
      if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 't' });
      if (u.endsWith('/bookstore_purchases.json')) return ok(dbStatus === 200 ? purchases : { error: 'x' }, dbStatus);
      throw new Error(`unstubbed: ${u}`);
    };
    try {
      const res = await onRequestGet({
        env: ENV,
        request: new Request(`https://x/api/bookstore/holders?titleId=${titleId}`, { headers: { Authorization: 'Bearer tok' } }),
      });
      return { res, body: await res.json(), calls };
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  test('a founder gets the two integers — and nothing that names a reader', async () => {
    const { res, body, calls } = await call();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, titleId: 'comp-only', count: 1, comps: 1 });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(body).includes(IKENNA), false);
    assert.ok(calls.some((u) => u.endsWith('/bookstore_purchases.json')), 'counted from the purchases node itself');
  });

  test('anyone else is refused, and a failed read is a failure, never a zero', async () => {
    assert.equal((await call({ uid: 'someone-else' })).res.status, 403);
    const failed = await call({ dbStatus: 500 });
    assert.equal(failed.res.status, 502);
    assert.equal(holderCountFrom(failed.res.status, failed.body).ok, false);
    assert.equal((await call({ titleId: '../x' })).res.status, 400);
  });

  test('an absent purchases node is zero holders (the node\'s contract)', async () => {
    const { body } = await call({ purchases: null });
    assert.deepEqual(body, { ok: true, titleId: 'comp-only', count: 0, comps: 0 });
  });

  test('the tree guard is satisfied honestly: the endpoint counts through holdersOf', () => {
    const fn = code('functions/api/bookstore/holders.js');
    assert.match(fn, /import \{ holdersOf \} from '..\/..\/..\/app\/lib\/bookstore\/purchaseSource\.js';/);
    assert.match(fn, /holdersOf\(purchases \|\| \{\}, titleId\)/);
    assert.doesNotMatch(fn, /countsForReadership|isSale/, 'a holder count, not a readership or sales figure');
  });
});

describe('the Book Store load: a failure is never "No titles yet"', () => {
  const page = src('app/admin/bookstore/page.js');
  test('the load reads under a deadline and records the failure kind', () => {
    const load = page.slice(page.indexOf('async function loadAll()'), page.indexOf('function showToast('));
    assert.match(load, /readWithDeadline\(/);
    assert.match(load, /setLoadFailure\(classifyFailure\(e\)\)/);
    assert.doesNotMatch(load, /getAllPublishers\(/, 'its [] on failure would draw "Add a publisher first"');
  });
  test('the failure panel is drawn BEFORE the empty state can be reached', () => {
    const i = page.indexOf('<Unavailable kind={loadFailure} onRetry={loadAll}');
    const empty = page.indexOf('>No titles yet.</div>');
    assert.ok(i > 0 && i < empty, 'Unavailable must come first in the chain');
    assert.match(page.slice(i - 200, i), /loadFailure && !loadedOnce/);
  });
});
