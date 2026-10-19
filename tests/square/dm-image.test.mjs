// W55.2 — images in messages (ruling 222): the Function, and the pure pieces it shares with the web.
// npm run test:square.
//
//   · refused: no token, a reader without the grant, an outsider to the conversation, a block either
//     way, a non-image (by its bytes, whatever it declares), an oversize file (by its body and by a
//     declared length); nothing is uploaded for any of them
//   · accepted: a granted reader in the conversation, no block — one upload, into the conversation's
//     folder under the sender's name, and the address the dm_messages rules will accept
//   · the database or the upload failing fails closed
//
// The handler runs unmodified. Google is stood in for: `tok-<uid>` verifies as <uid>, the database is
// in memory, and the upload is captured. No request leaves the process.
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handleDmImage } from '../../functions/api/square/dm-image.js';
import {
  DM_IMAGE_MAX_BYTES, DM_IMAGE_COPY, dmImageUrlPrefix, otherInConversation, sniffImageType, sendDmImage,
  DM_IMAGE_TTL_MS, DM_IMAGE_EXPIRED, DM_IMAGE_PREVIEW_NOTE, DM_HELD_PREFIX, imageExpired, objectFromDmImageUrl, heldImageObject, reportImage,
} from '../../app/lib/dmImages.js';
import { foreignRules, WANTED } from '../../scripts/storage/lifecycle.mjs';
import { revealBy } from '../../app/lib/composerRail.js';
import { buildReport } from '../../app/lib/contentReports.js';

const A = 'w552-test-reader', B = 'w552-reader-b', OUT = 'w552-outsider';
const CONV = [A, B].sort().join('_');
const FAKE = 'https://w552.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_DATABASE_URL: FAKE };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = new TextEncoder().encode('GIF89a......');
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = new TextEncoder().encode('%PDF-1.7 not an image');

let store = {};
let uploads = [];
let failDb = false, failUpload = false;
const at = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), store);
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'owner' }), { status: 200 });
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const m = /^tok-(.+)$/.exec(JSON.parse(init.body || '{}').idToken || '');
      return m ? new Response(JSON.stringify({ users: [{ localId: m[1] }] }), { status: 200 }) : new Response('{}', { status: 400 });
    }
    if (url.startsWith(FAKE)) {
      if (failDb) return new Response('{}', { status: 500 });
      const path = decodeURIComponent(new URL(url).pathname.replace(/\.json$/, ''));
      return new Response(JSON.stringify(at(path) ?? null), { status: 200 });
    }
    if (url.startsWith('https://storage.googleapis.com/upload/storage/v1/b/')) {
      if (failUpload) return new Response('{}', { status: 503 });
      const body = new Uint8Array(init.body);
      const text = new TextDecoder('latin1').decode(body);
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(text)[1]);
      uploads.push({ url, meta, size: body.length, contentType: init.headers['Content-Type'] });
      return new Response(JSON.stringify({ name: meta.name }), { status: 200 });
    }
    throw new Error(`refused an outbound call to ${url}`);
  };
});
after(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  uploads = []; failDb = false; failUpload = false;
  store = { users: { [A]: { canPostImages: true }, [B]: {}, [OUT]: { canPostImages: true } } };
});

async function call({ uid = A, conv = CONV, bytes = PNG, type = 'image/png', length = null } = {}) {
  const headers = { 'Content-Type': type };
  if (uid) headers.Authorization = `Bearer tok-${uid}`;
  if (length != null) headers['Content-Length'] = String(length);
  const request = new Request(`https://calvaryscribblings.co.uk/api/square/dm-image?conv=${encodeURIComponent(conv)}`, { method: 'POST', headers, body: bytes });
  const res = await handleDmImage({ request, env: ENV });
  return { status: res.status, ...(await res.json()) };
}

describe('W55.2 · the image Function refuses', () => {
  test('no token: 401, nothing uploaded', async () => {
    const r = await call({ uid: null });
    assert.equal(r.status, 401); assert.equal(r.code, 'signed_out'); assert.equal(uploads.length, 0);
  });
  test('a reader without the grant: 403 no_grant — false, missing, and a truthy non-true value alike', async () => {
    for (const v of [undefined, false, 'true', 1]) {
      store.users[A].canPostImages = v;
      const r = await call();
      assert.equal(r.status, 403, String(v)); assert.equal(r.code, 'no_grant'); assert.equal(r.error, DM_IMAGE_COPY.no_grant);
    }
    assert.equal(uploads.length, 0);
  });
  test('an outsider (granted) sending into a conversation that is not theirs: 403', async () => {
    const r = await call({ uid: OUT });
    assert.equal(r.status, 403); assert.equal(r.code, 'not_in_conversation'); assert.equal(uploads.length, 0);
  });
  test('a conversation id that is not one: 403', async () => {
    for (const conv of ['', A, `${A}_${A}`, `${A}_`, `${A}_../x`, `x${A}_${B}`.replace(A, 'zz')]) {
      const r = await call({ conv });
      assert.equal(r.status, 403, conv); assert.equal(r.code, 'not_in_conversation');
    }
    assert.equal(uploads.length, 0);
  });
  test('a block either way: 403 blocked', async () => {
    store.blocked_users = { [A]: { [B]: true } };
    let r = await call();
    assert.equal(r.status, 403); assert.equal(r.code, 'blocked');
    store.blocked_users = { [B]: { [A]: true } };
    r = await call();
    assert.equal(r.status, 403); assert.equal(r.code, 'blocked');
    assert.equal(uploads.length, 0);
  });
  test('a non-image: 415, by its bytes whatever it declares', async () => {
    for (const [bytes, type] of [[PDF, 'application/pdf'], [PDF, 'image/png'], [PNG, 'image/svg+xml'], [PNG, 'image/jpeg'], [new Uint8Array(0), 'image/png']]) {
      const r = await call({ bytes, type });
      assert.equal(r.status, 415, type); assert.equal(r.code, 'not_image');
    }
    assert.equal(uploads.length, 0);
  });
  test('an oversize file: 413, by its body and by a declared length', async () => {
    const big = new Uint8Array(DM_IMAGE_MAX_BYTES + 1); big.set(PNG);
    let r = await call({ bytes: big });
    assert.equal(r.status, 413); assert.equal(r.code, 'too_large');
    r = await call({ bytes: PNG, length: DM_IMAGE_MAX_BYTES + 1 });
    assert.equal(r.status, 413);
    assert.equal(uploads.length, 0);
  });
  test('the database or the upload failing fails closed: 502', async () => {
    failDb = true;
    assert.equal((await call()).status, 502);
    failDb = false; failUpload = true;
    const r = await call();
    assert.equal(r.status, 502); assert.equal(r.code, 'unavailable'); assert.equal(r.url, undefined);
  });
});

describe('W55.2 · the image Function accepts', () => {
  test('a granted reader in the conversation: one upload, in its folder, and an address the rules accept', async () => {
    for (const [bytes, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [GIF, 'image/gif'], [WEBP, 'image/webp']]) {
      uploads = [];
      const r = await call({ bytes, type });
      assert.equal(r.status, 200, type); assert.equal(r.ok, true);
      assert.equal(uploads.length, 1);
      assert.match(uploads[0].meta.name, new RegExp(`^dm_images/${CONV}/${A}_[a-z0-9]+$`));
      assert.equal(uploads[0].meta.contentType, type);
      assert.match(uploads[0].meta.metadata.firebaseStorageDownloadTokens, /^[0-9a-f-]{36}$/);
      assert.ok(r.url.startsWith(dmImageUrlPrefix(CONV, A)), 'what the dm_messages rules check');
      assert.ok(r.url.endsWith(`token=${uploads[0].meta.metadata.firebaseStorageDownloadTokens}`));
      assert.match(uploads[0].url, /calvary-scribblings\.firebasestorage\.app\/o\?uploadType=multipart$/);
    }
  });
  test('exactly the cap passes', async () => {
    const edge = new Uint8Array(DM_IMAGE_MAX_BYTES); edge.set(PNG);
    assert.equal((await call({ bytes: edge })).status, 200);
  });
  test('the other reader of the conversation is the same: granted, it passes', async () => {
    store.users[B].canPostImages = true;
    assert.equal((await call({ uid: B })).status, 200);
  });
});

describe('W55.2 · the pure pieces', () => {
  test('otherInConversation', () => {
    assert.equal(otherInConversation(CONV, A), B);
    assert.equal(otherInConversation(CONV, B), A);
    assert.equal(otherInConversation(CONV, OUT), null);
    assert.equal(otherInConversation('a/b_c', 'c'), null);
    assert.equal(otherInConversation(null, A), null);
  });
  test('sniffImageType', () => {
    assert.equal(sniffImageType(PNG), 'image/png');
    assert.equal(sniffImageType(JPEG), 'image/jpeg');
    assert.equal(sniffImageType(GIF), 'image/gif');
    assert.equal(sniffImageType(WEBP), 'image/webp');
    assert.equal(sniffImageType(PDF), null);
    assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns=')), null);
  });
  test('sendDmImage: the token in the header, the conversation in the query; the reader-actionable words only', async () => {
    const user = { getIdToken: async () => 'tok-x' };
    let seen;
    const url = await sendDmImage(user, CONV, new Blob([PNG], { type: 'image/png' }), {
      fetchImpl: async (u, init) => { seen = { u, init }; return new Response(JSON.stringify({ ok: true, url: 'https://x/y' })); },
    });
    assert.equal(url, 'https://x/y');
    assert.equal(seen.u, `/api/square/dm-image?conv=${encodeURIComponent(CONV)}`);
    assert.equal(seen.init.headers.Authorization, 'Bearer tok-x');
    const refuse = (code, error) => sendDmImage(user, CONV, new Blob([PNG], { type: 'image/png' }), { fetchImpl: async () => new Response(JSON.stringify({ ok: false, code, error }), { status: 403 }) });
    await assert.rejects(refuse('no_grant', DM_IMAGE_COPY.no_grant), (e) => e.code === 'no_grant' && e.shown === DM_IMAGE_COPY.no_grant);
    await assert.rejects(refuse('blocked', DM_IMAGE_COPY.blocked), (e) => e.code === 'blocked' && e.shown === null);
    await assert.rejects(refuse('unavailable', 'x'), (e) => e.shown === null);
  });
  test('a reported image is filed with its message (a DM only)', () => {
    const base = { kind: 'dm', reason: 'abuse', reporterUid: A, offenderUid: B, contextPath: `dm_messages/${CONV}/m1`, text: '', now: 1 };
    assert.equal(buildReport({ ...base, imageUrl: 'https://img' }).imageUrl, 'https://img');
    assert.equal('imageUrl' in buildReport(base), false);
    assert.equal('imageUrl' in buildReport({ ...base, kind: 'comment', contextPath: 'comments/s/c', imageUrl: 'https://img' }), false);
  });
});

describe('W55.2 · revealBy — a field in the page kept above the keyboard', () => {
  test('a field under the keyboard comes up until its foot clears it by the margin', () => {
    // glass 0–400 (a 844 screen with the keyboard up), field 500–580
    assert.equal(revealBy({ fieldTop: 500, fieldBottom: 580, vvTop: 0, vvHeight: 400 }), 192);
  });
  test('a field already above the keyboard is left alone', () => {
    assert.equal(revealBy({ fieldTop: 200, fieldBottom: 300, vvTop: 0, vvHeight: 400 }), 0);
    assert.equal(revealBy({ fieldTop: 200, fieldBottom: 388, vvTop: 0, vvHeight: 400 }), 0);
  });
  test('the visual viewport panned down the layout viewport (offsetTop) counts', () => {
    assert.equal(revealBy({ fieldTop: 500, fieldBottom: 580, vvTop: 300, vvHeight: 400 }), 0);
    assert.equal(revealBy({ fieldTop: 700, fieldBottom: 780, vvTop: 300, vvHeight: 400 }), 92);
  });
  test('a field taller than the glass stops at its top reaching the top', () => {
    assert.equal(revealBy({ fieldTop: 300, fieldBottom: 1200, vvTop: 0, vvHeight: 400 }), 288);
    assert.equal(revealBy({ fieldTop: -50, fieldBottom: 1200, vvTop: 0, vvHeight: 400 }), 0);
  });
  test('missing numbers never move the page', () => {
    assert.equal(revealBy({}), 0);
    assert.equal(revealBy({ fieldTop: 1, fieldBottom: NaN, vvTop: 0, vvHeight: 400 }), 0);
  });
});

describe('W55.2 · 224 · an image lasts 24 hours', () => {
  const H24 = 24 * 60 * 60 * 1000;
  const SENT = Date.UTC(2026, 9, 19, 20, 0, 0);
  test('the cut-off is 24 hours to the millisecond', () => assert.equal(DM_IMAGE_TTL_MS, H24));
  test('before the mark, and AT it, the image is shown', () => {
    assert.equal(imageExpired(SENT, SENT), false);
    assert.equal(imageExpired(SENT, SENT + 60 * 60 * 1000), false);
    assert.equal(imageExpired(SENT, SENT + H24 - 1), false);
    assert.equal(imageExpired(SENT, SENT + H24), false, 'exactly 24 hours is not MORE than 24 hours');
  });
  test('past the mark it has expired', () => {
    assert.equal(imageExpired(SENT, SENT + H24 + 1), true);
    assert.equal(imageExpired(SENT, SENT + 3 * H24), true);
  });
  test('a message with no readable time is treated as expired — an address of unknown age is never asked for', () => {
    for (const bad of [undefined, null, '2026-10-19', NaN, Infinity]) assert.equal(imageExpired(bad, SENT), true, String(bad));
  });
  test('a message from the near future (a fast clock) is shown', () => assert.equal(imageExpired(SENT + 30000, SENT), false));
  test('the words, as ruled', () => {
    assert.equal(DM_IMAGE_EXPIRED, 'This image has expired.');
    assert.equal(DM_IMAGE_PREVIEW_NOTE, 'Images disappear after 24 hours.');
  });
});

describe('W55.2 · 225 · the held copy’s names', () => {
  test('an image address back to its object, for dm_images/ only', () => {
    const name = `dm_images/${CONV}/${B}_abc`;
    assert.equal(objectFromDmImageUrl(`${dmImageUrlPrefix(CONV, B)}abc?alt=media&token=t`), name);
    assert.equal(objectFromDmImageUrl(`https://firebasestorage.googleapis.com/v0/b/${'calvary-scribblings.firebasestorage.app'}/o/${encodeURIComponent('avatars/x')}?alt=media`), null);
    assert.equal(objectFromDmImageUrl(`https://firebasestorage.googleapis.com/v0/b/other-bucket/o/${encodeURIComponent(name)}`), null);
    assert.equal(objectFromDmImageUrl(`${dmImageUrlPrefix(CONV, B)}..%2F..%2Fx`), null);
    assert.equal(objectFromDmImageUrl(null), null);
  });
  test('the copy lives under dm_reported/{key}/{reporter}_{file}, which the clear-out does not match', () => {
    const held = heldImageObject(`dm_${CONV}`, A, `dm_images/${CONV}/${B}_abc`);
    assert.equal(held, `${DM_HELD_PREFIX}dm_${CONV}/${A}_${B}_abc`);
    assert.ok(!held.startsWith('dm_images/'));
  });
  test('reportImage sends the action and key with the token in the header, and carries a refusal’s code', async () => {
    const user = { getIdToken: async () => 'tok-x' };
    let seen;
    const ok = await reportImage(user, 'hold', 'dm_k', { fetchImpl: async (u, init) => { seen = { u, init }; return new Response(JSON.stringify({ ok: true, held: true })); } });
    assert.equal(ok.held, true);
    assert.equal(seen.u, '/api/square/report-image');
    assert.equal(seen.init.headers.Authorization, 'Bearer tok-x');
    assert.deepEqual(JSON.parse(seen.init.body), { action: 'hold', contentKey: 'dm_k' });
    await assert.rejects(reportImage(user, 'hold', 'dm_k', { fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: 'gone' }), { status: 410 }) }), (e) => e.code === 'gone');
    await assert.rejects(reportImage(user, 'hold', 'dm_k', { fetchImpl: async () => { throw new Error('offline'); } }), (e) => e.code === 'network');
  });
});

describe('W55.2 · 224 · the lifecycle script never replaces a rule it does not carry', () => {
  test('the bucket as it is today (no rules), and with ours set: nothing foreign', () => {
    assert.deepEqual(foreignRules([]), []);
    assert.deepEqual(foreignRules(WANTED), []);
    assert.deepEqual(foreignRules([{ condition: { matchesPrefix: ['dm_images/'], age: 1 }, action: { type: 'Delete' } }]), [], 'key order does not matter');
  });
  test('a hand-added rule is foreign, so --apply refuses', () => {
    const extra = { action: { type: 'Delete' }, condition: { age: 30, matchesPrefix: ['tmp/'] } };
    assert.deepEqual(foreignRules([...WANTED, extra]), [extra]);
  });
});
