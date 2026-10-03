// W33 — AN AUTHOR'S COPY: the command's refusals, the record it writes, what revoke may touch,
// and the stream serving that record to its holder and nobody else.
//
//   node --test tests/bookstore/author-copy.test.mjs      (npm run test:purchases)
//
// Offline, generic fixtures. Nothing here names a real book: the repo is public, and the
// specifics live in a private handover outside it (see the script's header).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

import {
  AUTHOR_COPY_GRANT, EPUB_MAX_BYTES, COVER_MAX_BYTES,
  checkEpub, checkJpeg, checkHandover, grantRefusals, authorCopyRecord, planRevoke, isAuthorCopy,
  refuseInsideWorkTree, unsignedUrls, epubPath, coverPath,
} from '../../scripts/bookstore/author-copy.mjs';
import { ALLOWED_UIDS, COMP_GRANT as FOUNDER_COMP_GRANT } from '../../scripts/bookstore/founder-comps.mjs';
import { countsForReadership, isSale, holdsBook, isComp } from '../../app/lib/bookstore/purchaseSource.js';
import { onRequestPost } from '../../functions/api/bookstore/stream.js';

const OWNER = ALLOWED_UIDS[0];
const ID = 'held-book';
const OTHER_ID = 'another-held-book';
const HANDOVER = { titleId: ID, title: 'A Held Book', author: 'An Author' };
const NOW = 1_800_000_000_000;

// ── a tiny zip writer, so every EPUB defect can be built on purpose ──────────────────────────
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data, deflate = false } of entries) {
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    locals.push(h, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}
const MIMETYPE = { name: 'mimetype', data: 'application/epub+zip' };
const CONTAINER = { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container/>' };
const GOOD_EPUB = zip([MIMETYPE, CONTAINER, { name: 'OEBPS/content.opf', data: '<package/>' }]);
const GOOD_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);

describe('W33 · the files are checked before anything is read or written', () => {
  test('a well-formed EPUB passes', () => assert.deepEqual(checkEpub(GOOD_EPUB), []));
  test('mimetype not first → refused', () => {
    assert.match(checkEpub(zip([CONTAINER, MIMETYPE])).join(' '), /first entry/);
  });
  test('mimetype compressed → refused', () => {
    assert.match(checkEpub(zip([{ ...MIMETYPE, deflate: true }, CONTAINER])).join(' '), /compressed/);
  });
  test('mimetype reading anything else → refused', () => {
    assert.match(checkEpub(zip([{ name: 'mimetype', data: 'application/zip' }, CONTAINER])).join(' '), /not application\/epub\+zip/);
  });
  test('no META-INF/container.xml → refused', () => {
    assert.match(checkEpub(zip([MIMETYPE])).join(' '), /container\.xml/);
  });
  test('over 50 MB → refused', () => {
    const big = zip([MIMETYPE, CONTAINER, { name: 'pad.bin', data: Buffer.alloc(EPUB_MAX_BYTES) }]);
    assert.match(checkEpub(big).join(' '), /larger than 50 MB/);
  });
  test('not a zip → refused', () => assert.match(checkEpub(Buffer.from('%PDF-1.7 not a book at all')).join(' '), /not a zip/));

  test('a JPEG passes; anything else, a truncated one, or one over 5 MB is refused', () => {
    assert.deepEqual(checkJpeg(GOOD_JPEG), []);
    assert.match(checkJpeg(Buffer.from('\x89PNG\r\n\x1a\n0000')).join(' '), /SOI/);
    assert.match(checkJpeg(GOOD_JPEG.subarray(0, 40)).join(' '), /EOI/);
    const big = Buffer.concat([GOOD_JPEG.subarray(0, 4), Buffer.alloc(COVER_MAX_BYTES), Buffer.from([0xff, 0xd9])]);
    assert.match(checkJpeg(big).join(' '), /larger than 5 MB/);
  });

  test('the handover must name this titleId, a title and an author', () => {
    assert.deepEqual(checkHandover(HANDOVER, ID), []);
    assert.match(checkHandover({ ...HANDOVER, titleId: OTHER_ID }, ID).join(' '), /different titleId/);
    assert.match(checkHandover({ titleId: ID, title: ' ' }, ID).join(' '), /no title.*no author/);
  });
});

describe('W33 · every refusal', () => {
  const clear = { uid: OWNER, titleId: ID, titleDoc: null, tombstone: null, mine: null, epubExists: false, coverExists: false };
  test('the clear case proceeds', () => assert.deepEqual(grantRefusals(clear), []));
  const cases = [
    ['a uid not in ALLOWED_UIDS', { uid: 'some-other-reader' }, /not an account the ruling covers/],
    ['bookstore_titles/<id> exists — even as a draft', { titleDoc: { status: 'draft' } }, /bookstore_titles has a record/],
    ['…or withdrawn', { titleDoc: { status: 'withdrawn' } }, /bookstore_titles has a record/],
    ['a slug reserved for a room', { titleId: 'search' }, /reserved for a Book Store room/],
    ['a slug a deleted title left a tombstone at', { tombstone: { titleId: ID } }, /tombstone/],
    ['not a kebab-case slug', { titleId: '../escape' }, /kebab-case/],
    ['the account holds an ACTIVE record for it', { mine: { [ID]: { status: 'active' } } }, /already holds a record/],
    ['…or a REVOKED one', { mine: { [ID]: { status: 'revoked' } } }, /already holds a record/],
    ['…or a comp', { mine: { [ID]: { status: 'active', source: 'comp', compGrant: FOUNDER_COMP_GRANT } } }, /already holds a record/],
    ['an object at the master.epub path', { epubExists: true }, /master\.epub path/],
    ['an object at the cover.jpg path', { coverExists: true }, /cover\.jpg path/],
  ];
  for (const [name, change, re] of cases) {
    test(name, () => {
      const why = grantRefusals({ ...clear, ...change });
      assert.equal(why.length, 1, `exactly one refusal for ${name}: ${why.join('; ')}`);
      assert.match(why[0], re);
    });
  }
  test('a record for ANOTHER title does not block this one', () => {
    assert.deepEqual(grantRefusals({ ...clear, mine: { [OTHER_ID]: { status: 'active' } } }), []);
  });
});

describe('W33 · the record', () => {
  const rec = authorCopyRecord({ titleId: ID, handover: HANDOVER, coverUrl: 'https://example.invalid/cover?token=t', now: NOW });
  test('the exact shape: an active comp, compGrant author-copy, the display fields, and nothing else', () => {
    assert.deepEqual(Object.keys(rec).sort(), ['author', 'compGrant', 'compGrantedAt', 'coverUrl', 'purchasedAt', 'slug', 'source', 'status', 'title']);
    assert.equal(rec.status, 'active');
    assert.equal(rec.source, 'comp');
    assert.equal(rec.compGrant, AUTHOR_COPY_GRANT);
    assert.equal(rec.slug, ID);
  });
  test('no money and no provider key — absent, not null', () => {
    for (const k of ['amount', 'currency', 'stripeSessionId', 'stripePaymentIntent', 'paystackRef', 'provider']) assert.ok(!(k in rec), k);
  });
  test('countsForReadership false, isSale false, holdsBook true', () => {
    assert.equal(countsForReadership(rec), false);
    assert.equal(isSale(rec), false);
    assert.equal(holdsBook(rec), true);
    assert.equal(isComp(rec), true);
  });
});

describe('W33 · revoke removes the author copy and nothing else', () => {
  const copy = authorCopyRecord({ titleId: ID, handover: HANDOVER, coverUrl: 'u', now: NOW });
  const otherCopy = authorCopyRecord({ titleId: OTHER_ID, handover: { ...HANDOVER, titleId: OTHER_ID }, coverUrl: 'u', now: NOW });
  const sale = { status: 'active', amount: 999, currency: 'gbp', stripeSessionId: 'cs_test_x', purchasedAt: NOW };
  const founderComp = { status: 'active', source: 'comp', compGrant: FOUNDER_COMP_GRANT, purchasedAt: NOW };

  test('the author copy, sole holder, no catalogue record → the record and both files', () => {
    const p = planRevoke({ uid: OWNER, titleId: ID, purchases: { [OWNER]: { [ID]: copy, [OTHER_ID]: otherCopy } }, titleDoc: null });
    assert.deepEqual(p.refusals, []);
    assert.deepEqual(p.update, { [`bookstore_purchases/${OWNER}/${ID}`]: null }, 'only this title\'s path');
    assert.equal(p.deleteFiles, true);
  });
  test('it spares a SALE of the title', () => {
    const p = planRevoke({ uid: OWNER, titleId: ID, purchases: { [OWNER]: { [ID]: sale } }, titleDoc: null });
    assert.equal(p.refusals.length, 1); assert.deepEqual(p.update, {}); assert.equal(p.deleteFiles, false);
  });
  test('it spares a FOUNDER COMP of the title', () => {
    const p = planRevoke({ uid: OWNER, titleId: ID, purchases: { [OWNER]: { [ID]: founderComp } }, titleDoc: null });
    assert.equal(p.refusals.length, 1); assert.deepEqual(p.update, {});
    assert.equal(isAuthorCopy(founderComp), false);
  });
  test('it spares ANOTHER title\'s author copy', () => {
    const p = planRevoke({ uid: OWNER, titleId: ID, purchases: { [OWNER]: { [ID]: copy, [OTHER_ID]: otherCopy } }, titleDoc: null });
    assert.ok(!Object.keys(p.update).some((k) => k.endsWith(OTHER_ID)));
  });
  test('the files stay while anyone else holds the title — a sale or a comp', () => {
    for (const held of [sale, founderComp]) {
      const p = planRevoke({ uid: OWNER, titleId: ID, purchases: { [OWNER]: { [ID]: copy }, 'reader-2': { [ID]: held } }, titleDoc: null });
      assert.equal(p.deleteFiles, false); assert.equal(p.holdersAfter.count, 1);
    }
  });
  test('the files stay when a catalogue record exists, and with --keep-files', () => {
    const purchases = { [OWNER]: { [ID]: copy } };
    assert.equal(planRevoke({ uid: OWNER, titleId: ID, purchases, titleDoc: { status: 'withdrawn' } }).deleteFiles, false);
    assert.equal(planRevoke({ uid: OWNER, titleId: ID, purchases, titleDoc: null, keepFiles: true }).deleteFiles, false);
  });
  test('nothing held → refused, nothing removed', () => {
    const p = planRevoke({ uid: OWNER, titleId: ID, purchases: {}, titleDoc: null });
    assert.equal(p.refusals.length, 1); assert.deepEqual(p.update, {});
  });
});

describe('W33 · the private paths and the object addresses', () => {
  test('a path inside this repo is refused; one outside every work tree is not', () => {
    assert.match(refuseInsideWorkTree(join(process.cwd(), 'private', ID), 'the private folder'), /inside the work tree/);
    assert.equal(refuseInsideWorkTree(join(tmpdir(), 'w33-not-a-repo', ID), 'x'), null);
  });
  test('both objects sit under bookstore_epubs/<id>/, never bookstore_covers/', () => {
    assert.equal(epubPath(ID), `bookstore_epubs/${ID}/master.epub`);
    assert.equal(coverPath(ID), `bookstore_epubs/${ID}/cover.jpg`);
  });
  test('the unsigned addresses carry no token', () => {
    for (const u of [...unsignedUrls(epubPath(ID)), ...unsignedUrls(coverPath(ID))]) assert.doesNotMatch(u, /token=/);
  });
});

// ── stream.js, offline: the author-copy record is served to its holder and to nobody else ─────
describe('W33 · stream.js serves an author-copy record to its uid only', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey };
  const copy = authorCopyRecord({ titleId: ID, handover: HANDOVER, coverUrl: 'u', now: NOW });
  // The whole node as the stub database holds it: the owner's copy, plus other readers who hold
  // OTHER things — a sale of another title, a founder comp of another — so "every other uid"
  // includes readers with records of their own, not only empty accounts.
  const NODE = {
    [OWNER]: { [ID]: copy },
    'reader-with-a-sale': { 'some-sold-title': { status: 'active', stripeSessionId: 'cs_test_y' } },
    'reader-with-a-comp': { 'some-comped-title': { status: 'active', source: 'comp', compGrant: FOUNDER_COMP_GRANT } },
    'reader-with-nothing': null,
  };
  const withHost = async (fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('identitytoolkit.googleapis.com')) return ok({ users: [{ localId: JSON.parse(opts.body).idToken.replace(/^tok:/, '') }] });
      if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'stub' });
      if (u.includes('storage.googleapis.com/storage/v1/')) return ok({ generation: '1', md5Hash: 'x' });
      const m = /bookstore_purchases\/([^/]+)\/([^/.]+)\.json/.exec(decodeURIComponent(u));
      if (m) return ok(NODE[m[1]]?.[m[2]] ?? null);
      throw new Error(`unstubbed ${u}`);
    };
    try { return await fn(); } finally { globalThis.fetch = real; }
  };
  const ask = (uid, titleId) => onRequestPost({ env: ENV, request: new Request('https://calvaryscribblings.co.uk/api/bookstore/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer tok:${uid}` }, body: JSON.stringify({ titleId }),
  }) });

  test('its holder gets a signed URL to bookstore_epubs/<id>/master.epub', () => withHost(async () => {
    const r = await ask(OWNER, ID);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.match(b.url, new RegExp(`/bookstore_epubs/${ID}/master\\.epub\\?`));
  }));
  test('every other uid is refused — and the refusal is byte-identical to the one for an id that does not exist', () => withHost(async () => {
    const ghost = await ask('reader-with-nothing', 'an-invented-id-that-does-not-exist');
    const ghostBody = await ghost.text();
    assert.equal(ghost.status, 403);
    for (const uid of Object.keys(NODE).filter((u) => u !== OWNER)) {
      const r = await ask(uid, ID);
      assert.equal(r.status, 403, uid);
      assert.equal(await r.text(), ghostBody, `${uid} learns nothing the ghost id does not tell`);
    }
  }));
});
