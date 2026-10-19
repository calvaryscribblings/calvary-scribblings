// W55.2 — images in messages (ruling 222), in the rules.
//
//   npm run test:rules   (emulator: database + storage)
//
//   · dm_messages: an imageUrl only from a reader with the image grant (users/{uid}/canPostImages
//     === true), only pointing at that reader's own upload in that conversation's folder — the
//     address functions/api/square/dm-image.js returns. Words alone are unchanged.
//   · storage: no client writes to dm_images/, founders included; a signed-in read only by the
//     conversation's two readers.
//   · content_reports: a DM report may carry the message's imageUrl, and only exactly that.

import { test, before, after, beforeEach, describe } from 'node:test';
import { ref as sRef, uploadBytes, getBytes } from 'firebase/storage';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, OTHER, FOUNDER_A, convIdFor } from './helpers.mjs';
import { dmImageUrlPrefix } from '../../app/lib/dmImages.js';
import { buildReport, contentKeyFor } from '../../app/lib/contentReports.js';

const A = OWNER, B = STRANGER, C = OTHER;
const CONV = convIdFor(A, B);
const OTHER_CONV = convIdFor(A, C);
const url = (conv, uid, tail = 'abc123?alt=media&token=t') => `${dmImageUrlPrefix(conv, uid)}${tail}`;
const msg = (from, extra = {}) => ({ text: '', senderUid: from, createdAt: Date.now(), ...extra });

let env, a, b, c;
before(async () => {
  env = await makeEnv();
  a = env.authenticatedContext(A);
  b = env.authenticatedContext(B);
  c = env.authenticatedContext(C);
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('W55.2 · dm_messages imageUrl', () => {
  test('a granted reader: their own upload in this conversation is accepted, with or without words', async () => {
    await seed(env, { [`users/${A}/canPostImages`]: true });
    await assertSucceeds(a.database().ref(`dm_messages/${CONV}/m1`).set(msg(A, { imageUrl: url(CONV, A) })));
    await assertSucceeds(a.database().ref(`dm_messages/${CONV}/m2`).set(msg(A, { text: 'look', imageUrl: url(CONV, A) })));
  });
  test('a reader without the grant is refused an imageUrl (missing, false, or a truthy string)', async () => {
    for (const v of [null, false, 'true']) {
      await env.clearDatabase();
      if (v !== null) await seed(env, { [`users/${A}/canPostImages`]: v });
      await assertFails(a.database().ref(`dm_messages/${CONV}/m1`).set(msg(A, { imageUrl: url(CONV, A) })));
    }
  });
  test('…but their words still send', async () => {
    await assertSucceeds(a.database().ref(`dm_messages/${CONV}/m1`).set(msg(A, { text: 'hello' })));
  });
  test('a granted reader is refused any address outside their own upload in this conversation', async () => {
    await seed(env, { [`users/${A}/canPostImages`]: true });
    for (const bad of [
      url(OTHER_CONV, A),                                  // another conversation's folder
      url(CONV, B),                                        // the other reader's upload
      'https://example.com/x.png',                         // anywhere else
      `https://firebasestorage.googleapis.com/v0/b/calvary-scribblings.firebasestorage.app/o/avatars%2F${A}?alt=media`,
      `https://firebasestorage.googleapis.com/v0/b/another-bucket/o/dm_images%2F${CONV}%2F${A}_x`,
    ]) {
      await assertFails(a.database().ref(`dm_messages/${CONV}/m1`).set(msg(A, { imageUrl: bad })));
    }
  });
  test('the grant cannot be given to oneself', async () => {
    await assertFails(a.database().ref(`users/${A}/canPostImages`).set(true));
  });
  test('a block still stops an image message either way', async () => {
    await seed(env, { [`users/${A}/canPostImages`]: true, [`blocked_users/${B}/${A}`]: true });
    await assertFails(a.database().ref(`dm_messages/${CONV}/m1`).set(msg(A, { imageUrl: url(CONV, A) })));
  });
});

describe('W55.2 · storage dm_images/', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  test('no client writes, granted or not, founders included', async () => {
    await seed(env, { [`users/${A}/canPostImages`]: true });
    for (const ctx of [a, b, c, env.authenticatedContext(FOUNDER_A), env.unauthenticatedContext()]) {
      await assertFails(uploadBytes(sRef(ctx.storage(), `dm_images/${CONV}/${A}_x`), PNG, { contentType: 'image/png' }));
    }
  });
  test('a signed-in read: the two readers only', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(sRef(ctx.storage(), `dm_images/${CONV}/${A}_x`), PNG, { contentType: 'image/png' });
    });
    await assertSucceeds(getBytes(sRef(a.storage(), `dm_images/${CONV}/${A}_x`)));
    await assertSucceeds(getBytes(sRef(b.storage(), `dm_images/${CONV}/${A}_x`)));
    await assertFails(getBytes(sRef(c.storage(), `dm_images/${CONV}/${A}_x`)));
    await assertFails(getBytes(sRef(env.unauthenticatedContext().storage(), `dm_images/${CONV}/${A}_x`)));
  });
});

describe('W55.2 · a reported image is filed with its message', () => {
  const IMG = url(CONV, B);
  const report = (extra = {}) => ({
    ...buildReport({ kind: 'dm', reason: 'abuse', reporterUid: A, offenderUid: B, contextPath: `dm_messages/${CONV}/m1`, text: '', now: Date.now() }),
    ...extra,
  });
  const at = `content_reports/${contentKeyFor('dm', { convId: CONV })}/${A}`;
  test('the message’s own imageUrl is accepted', async () => {
    await seed(env, { [`dm_messages/${CONV}/m1`]: msg(B, { imageUrl: IMG }) });
    await assertSucceeds(a.database().ref(at).set(report({ imageUrl: IMG })));
  });
  test('any other address is refused', async () => {
    await seed(env, { [`dm_messages/${CONV}/m1`]: msg(B, { imageUrl: IMG }) });
    await assertFails(a.database().ref(at).set(report({ imageUrl: 'https://example.com/other.png' })));
  });
  test('a message with no image cannot be filed with one', async () => {
    await seed(env, { [`dm_messages/${CONV}/m1`]: msg(B, { text: 'words' }) });
    await assertFails(a.database().ref(at).set({ ...report({ imageUrl: IMG }), snapshot: 'words' }));
    await assertSucceeds(a.database().ref(at).set({ ...report(), snapshot: 'words' }));
  });
});

describe('W55.2 · 225 · storage dm_reported/ — the held copies', () => {
  const HELD = `dm_reported/dm_${CONV}/${A}_${B}_x`;
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  test('no client writes, the two readers and founders included', async () => {
    for (const ctx of [a, b, c, env.authenticatedContext(FOUNDER_A)]) {
      await assertFails(uploadBytes(sRef(ctx.storage(), HELD), PNG, { contentType: 'image/png' }));
    }
  });
  test('no client reads either — the moderator sees it through the report’s token address', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(sRef(ctx.storage(), HELD), PNG, { contentType: 'image/png' });
    });
    for (const ctx of [a, b, c, env.authenticatedContext(FOUNDER_A), env.unauthenticatedContext()]) {
      await assertFails(getBytes(sRef(ctx.storage(), HELD)));
    }
  });
});
