// W55.2 — ruling 225: a reported image is held out of reach of the 24-hour clear-out until a
// moderator resolves the report. functions/api/square/report-image.js against the DATABASE and
// STORAGE EMULATORS.
//
//   npm run test:square:report-image:emulator
//
// The Function runs unmodified. Its database calls are REST calls to the database emulator, and its
// copy, list and delete are calls to the storage emulator (tests/square/dm-route.mjs maps Google's
// storage addresses there). Only Google's token services are stood in for: `tok-<uid>` verifies as
// <uid> (the W49 harness). Nothing leaves the machine.
//
//   · hold: the reporter's report gets a copy under dm_reported/{key}/, the report's imageUrl
//     points at it, the original is untouched; repeating it is harmless
//   · hold is refused for a report that isn't the caller's, a report with no image, an image that
//     isn't the message's, and an outsider; an already-cleared original answers 'gone'
//   · release: only a moderator, only once resolved; deletes dm_reported/{key}/ and nothing else —
//     not the original, not another report's copy
//   · the lifecycle rule (storage/lifecycle.json) cannot reach the held copy
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, uninstall, wipe, get, set, request, context, tokenFor } from '../reads/harness.mjs';
import { storageTarget, STORAGE } from './dm-route.mjs';
import { handleReportImage } from '../../functions/api/square/report-image.js';
import { BUCKET, DM_HELD_PREFIX, dmImageObject, dmImageUrl } from '../../app/lib/dmImages.js';
import { buildReport, contentKeyFor, convIdFor } from '../../app/lib/contentReports.js';

const A = 'w552-test-reader', C = 'w552-reader-c', MOD = 'w552-moderator', OUT = 'w552-outsider', D = 'w552-reader-d';
const CONV = convIdFor(A, C);
const KEY = contentKeyFor('dm', { convId: CONV });
const OTHER_KEY = contentKeyFor('dm', { convId: convIdFor(D, C) });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
const H = { Authorization: 'Bearer owner' };

// The W49 harness refuses anything not Google-or-database; storage goes to the emulator on top of it.
let harnessFetch;
function installStorage() {
  harnessFetch = globalThis.fetch;
  const real = globalThis.__realFetch || fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const st = storageTarget(url);
    if (st) { const { signal, ...rest } = init; return real(st, { ...rest, headers: { ...(init.headers || {}), ...H } }); }
    return harnessFetch(input, init);
  };
}
const realFetch = globalThis.fetch;
globalThis.__realFetch = realFetch;

async function putObject(name, bytes, token) {
  const boundary = 'w552';
  const meta = JSON.stringify({ name, contentType: 'image/jpeg', metadata: { firebaseStorageDownloadTokens: token } });
  const te = new TextEncoder();
  const head = te.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`);
  const tail = te.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const r = await realFetch(`${STORAGE}/upload/storage/v1/b/${BUCKET}/o?uploadType=multipart`, { method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!r.ok) throw new Error(`emulator upload ${r.status}`);
}
async function names(prefix) {
  const r = await realFetch(`${STORAGE}/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}`, { headers: H });
  const d = await r.json();
  return (d.items || []).map((i) => i.name).sort();
}
async function wipeStorage() {
  for (const n of [...await names('dm_images/'), ...await names(DM_HELD_PREFIX)]) {
    await realFetch(`${STORAGE}/b/${BUCKET}/o/${encodeURIComponent(n)}`, { method: 'DELETE', headers: H });
  }
}
async function bytesAt(url) {
  const r = await realFetch(storageTarget(url));
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

async function call(body, uid) {
  const { ctx } = context(request('/api/square/report-image', { body, token: tokenFor(uid) }));
  const res = await handleReportImage(ctx);
  return { status: res.status, ...(await res.json()) };
}

const ORIGINAL = dmImageObject(CONV, C, 'img1');
const ORIGINAL_URL = dmImageUrl(ORIGINAL, 'tok-original');

async function seed({ report = true, imageUrl = ORIGINAL_URL } = {}) {
  await set('', {
    users: { [MOD]: { canRemovePosts: true }, [A]: { displayName: 'Ay' } },
    dm_messages: { [CONV]: { m1: { text: 'look', senderUid: C, createdAt: Date.now() - 1000, imageUrl: ORIGINAL_URL } } },
  });
  await putObject(ORIGINAL, JPEG, 'tok-original');
  if (report) {
    const rec = buildReport({ kind: 'dm', reason: 'abuse', reporterUid: A, offenderUid: C, contextPath: `dm_messages/${CONV}/m1`, text: 'look', imageUrl, now: Date.now() });
    await set(`content_reports/${KEY}/${A}`, rec);
  }
}

before(() => { install(); installStorage(); });
after(() => { uninstall(); globalThis.fetch = realFetch; });
beforeEach(async () => { await wipe(); await wipeStorage(); });

describe('W55.2 · 225 · hold', () => {
  test('the reporter’s hold copies the image under dm_reported/ and points the report at the copy', async () => {
    await seed();
    const r = await call({ action: 'hold', contentKey: KEY }, A);
    assert.equal(r.status, 200, JSON.stringify(r));
    const held = await names(DM_HELD_PREFIX);
    assert.deepEqual(held, [`${DM_HELD_PREFIX}${KEY}/${A}_${ORIGINAL.split('/').pop()}`]);
    const rec = await get(`content_reports/${KEY}/${A}`);
    assert.ok(rec.imageUrl.startsWith(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`${DM_HELD_PREFIX}${KEY}/`)}`), 'the report points at the held copy');
    assert.notEqual(rec.imageUrl, ORIGINAL_URL);
    assert.deepEqual(await bytesAt(rec.imageUrl), JPEG, 'the copy is the image, readable through its own token');
    assert.deepEqual(await names('dm_images/'), [ORIGINAL], 'the original is untouched');
    // the rest of the record is as the reporter filed it
    assert.equal(rec.snapshot, 'look'); assert.equal(rec.reporterUid, A); assert.equal(rec.offenderUid, C);
    // again: harmless, still one copy
    const again = await call({ action: 'hold', contentKey: KEY }, A);
    assert.equal(again.status, 200);
    assert.equal((await names(DM_HELD_PREFIX)).length, 1);
    assert.equal((await get(`content_reports/${KEY}/${A}`)).imageUrl, rec.imageUrl);
  });

  test('refused: no report of the caller’s, an outsider, a report with no image, an image not the message’s', async () => {
    await seed({ report: false });
    assert.equal((await call({ action: 'hold', contentKey: KEY }, A)).code, 'no_report');
    assert.equal((await call({ action: 'hold', contentKey: KEY }, OUT)).code, 'not_in_conversation');
    await seed({ imageUrl: null });
    assert.equal((await call({ action: 'hold', contentKey: KEY }, A)).code, 'no_image');
    await seed({ imageUrl: dmImageUrl(dmImageObject(CONV, C, 'other'), 'x') });
    assert.equal((await call({ action: 'hold', contentKey: KEY }, A)).code, 'no_image');
    assert.deepEqual(await names(DM_HELD_PREFIX), [], 'nothing was copied');
    assert.equal((await call({ action: 'hold', contentKey: 'dm_../../x' }, A)).code, 'not_in_conversation');
    assert.equal((await call({ action: 'hold' }, A)).code, 'not_in_conversation');
  });

  test('an original the clear-out already took answers gone, and the report stays as filed', async () => {
    await seed();
    await realFetch(`${STORAGE}/b/${BUCKET}/o/${encodeURIComponent(ORIGINAL)}`, { method: 'DELETE', headers: H });
    const r = await call({ action: 'hold', contentKey: KEY }, A);
    assert.equal(r.status, 410); assert.equal(r.code, 'gone');
    assert.equal((await get(`content_reports/${KEY}/${A}`)).imageUrl, ORIGINAL_URL);
  });
});

describe('W55.2 · 225 · release', () => {
  test('only a moderator, only once resolved; deletes the held copy and nothing else', async () => {
    await seed();
    await call({ action: 'hold', contentKey: KEY }, A);
    // another conversation's held copy, and an unrelated image, must survive
    await putObject(`${DM_HELD_PREFIX}${OTHER_KEY}/${D}_keep`, JPEG, 't2');
    await putObject(dmImageObject(convIdFor(D, C), C, 'keep'), JPEG, 't3');

    assert.equal((await call({ action: 'release', contentKey: KEY }, A)).code, 'not_moderator', 'the reporter cannot');
    assert.equal((await call({ action: 'release', contentKey: KEY }, MOD)).code, 'open', 'not before it is resolved');
    assert.equal((await names(`${DM_HELD_PREFIX}${KEY}/`)).length, 1);

    await set(`content_reports/${KEY}/resolved`, true);
    const r = await call({ action: 'release', contentKey: KEY }, MOD);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.deleted, 1);
    assert.deepEqual(await names(`${DM_HELD_PREFIX}${KEY}/`), []);
    assert.deepEqual(await names(DM_HELD_PREFIX), [`${DM_HELD_PREFIX}${OTHER_KEY}/${D}_keep`]);
    assert.deepEqual(await names('dm_images/'), [dmImageObject(convIdFor(D, C), C, 'keep'), ORIGINAL].sort());
    assert.equal((await get(`content_reports/${KEY}/${A}`)).reason, 'abuse', 'the report itself stays');
    // again: nothing left, nothing else touched
    assert.equal((await call({ action: 'release', contentKey: KEY }, MOD)).deleted, 0);
  });
});

describe('W55.2 · 224 · the lifecycle rule', () => {
  test('matches dm_images/ alone, a day old, and never the held prefix', () => {
    const { lifecycle } = JSON.parse(readFileSync(new URL('../../storage/lifecycle.json', import.meta.url), 'utf8'));
    assert.deepEqual(lifecycle.rule, [{ action: { type: 'Delete' }, condition: { age: 1, matchesPrefix: ['dm_images/'] } }]);
    for (const p of lifecycle.rule[0].condition.matchesPrefix) assert.ok(!`${DM_HELD_PREFIX}${KEY}/x`.startsWith(p));
  });
});
