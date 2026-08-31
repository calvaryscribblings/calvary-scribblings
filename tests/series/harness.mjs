// Shared harness for the Series admin browser suite.
//
// HERMETIC. Everything below talks to the Firebase emulators, never to production. The admin
// SDK reaches them through the two *_EMULATOR_HOST variables, which it honours in place of any
// credential — so this file needs no service account and runs on a CI runner with no secrets,
// exactly as tests/rules/helpers.mjs does.
//
// THE PROJECT ID IS THE REAL ONE, and that is forced rather than chosen. app/lib/firebase.js
// hardcodes `projectId: 'calvary-scribblings'` and a databaseURL whose namespace is
// `calvary-scribblings-default-rtdb`; the browser under test sends both. firebase.json sets
// `singleProjectMode`, so the emulator must be started with the same id or it rejects the
// traffic — and the RTDB namespace has to match too, or the rules in database.rules.json are
// not the rules being applied. Using a `demo-` id here would produce a suite that passed
// against an unruled namespace.
//
// Nothing about that reaches production: emulator hosts are set, no credential is loaded, and
// GOOGLE_APPLICATION_CREDENTIALS is deliberately cleared below in case a developer has one
// exported in their shell.

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

export const PROJECT_ID = 'calvary-scribblings';
export const DB_NAMESPACE = 'calvary-scribblings-default-rtdb';
export const FOUNDER_A = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

// The fixture. A series and one instalment, both DRAFT: this suite is about the admin screen,
// and a draft is what an editor is actually looking at when they fill these fields in. It also
// means the fixture could never be mistaken for something a reader surface would render.
export const SERIES_ID = 'harness-series';
export const INSTALMENT_ID = 'harness-series-i1';

export function envForEmulators() {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

export function adminApp(name = 'series-harness') {
  envForEmulators();
  return initializeApp({
    projectId: PROJECT_ID,
    databaseURL: `http://127.0.0.1:9000?ns=${DB_NAMESPACE}`,
    storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  }, name);
}

export const closeApp = (app) => deleteApp(app);

/**
 * Wipe the two series nodes and write the fixture.
 *
 * The admin SDK bypasses rules, which is correct for a fixture: nothing a test needs to
 * already exist should depend on the rule the test is about. Same posture as
 * tests/rules/helpers.mjs:seed().
 */
export async function seedFixture(app) {
  const db = getDatabase(app);
  await db.ref('series').set(null);
  await db.ref('series_instalments').set(null);
  await db.ref('series_instalments_detail').set(null);
  // R31 — the burn survives a reseed unless it is cleared, and a burned ordinal makes the very
  // next create fail. A suite that left one behind would fail in its NEXT run, not this one.
  await db.ref('series_instalments_deleted').set(null);

  const now = Date.now();
  await db.ref().update({
    [`series/${SERIES_ID}`]: {
      schemaVersion: 1,
      slug: SERIES_ID,
      title: 'Harness Series',
      synopsis: 'A fixture, not a book.',
      coverUrl: null,
      status: 'draft',
      addedAt: now,
      updatedAt: now,
    },
    [`series_instalments/${INSTALMENT_ID}`]: {
      schemaVersion: 1,
      seriesId: SERIES_ID,
      ordinal: 1,
      // Future, so the fixture is also an UNRELEASED instalment — the admin screen must work
      // on one, and this is the case the release rule denies to everyone else.
      releaseAtMs: now + 30 * 24 * 3600 * 1000,
      freeForGold: false,
      status: 'draft',
      addedAt: now,
      updatedAt: now,
    },
    // No sponsorName and no sponsorLogoUrl — the state every live instalment was in, and the
    // state in which the button was dead.
    [`series_instalments_detail/${INSTALMENT_ID}`]: {
      schemaVersion: 1,
      title: 'Harness Instalment',
      synopsis: null,
      logline: null,
      author: 'Fixture Author',
      authorUid: 'fixture-uid',
      authorHandle: 'fixture',
      coverUrl: null,
      epubPath: null,
      sponsorName: null,
      sponsorLogoUrl: null,
      wordCount: null,
      updatedAt: now,
    },
  });
}

/** A custom token for an admin UID. Unsigned — the Auth emulator does not check signatures,
 *  and the real Identity Toolkit would refuse this outright, which is the point. */
export function adminToken(app, uid = FOUNDER_A) {
  return getAuth(app).createCustomToken(uid);
}

export const detailRef = (app) => getDatabase(app).ref(`series_instalments_detail/${INSTALMENT_ID}`);
export const rowRef = (app, id = INSTALMENT_ID) => getDatabase(app).ref(`series_instalments/${id}`);
export const tombstoneRef = (app, id = INSTALMENT_ID) => getDatabase(app).ref(`series_instalments_deleted/${id}`);
export const seriesRef = (app) => getDatabase(app).ref(`series/${SERIES_ID}`);

/**
 * R31 — a SECOND instalment, RELEASED and PUBLISHED, with artefacts on it.
 *
 * The base fixture is a single unreleased draft, which is the right shape for the sponsor
 * suite and the wrong one for this round's two claims. A tier edit only changes who may read
 * something that is READABLE, and a delete is only interesting when there is something to
 * take with it — so this seeds an instalment a reader could actually open, with an EPUB and a
 * cover in the bucket, and asserts nothing about it that the base fixture already covers.
 *
 * Ordinal 2, so the pair also exercises the gap: deleting 2 must not renumber 1, and must not
 * hand ordinal 2 back to the next create.
 */
export const RELEASED_ID = 'harness-series-i2';

export async function seedReleased(app, { freeForGold = false } = {}) {
  const db = getDatabase(app);
  const now = Date.now();
  await db.ref().update({
    [`series_instalments/${RELEASED_ID}`]: {
      schemaVersion: 1,
      seriesId: SERIES_ID,
      ordinal: 2,
      releaseAtMs: now - 60_000,
      freeForGold,
      status: 'published',
      addedAt: now,
      updatedAt: now,
    },
    [`series_instalments_detail/${RELEASED_ID}`]: {
      schemaVersion: 1,
      title: 'Released Instalment',
      synopsis: null,
      logline: null,
      author: 'Fixture Author',
      authorUid: 'fixture-uid',
      authorHandle: 'fixture',
      coverUrl: null,
      // Required to be published — validateInstalmentDetail refuses a published instalment
      // with no epubPath, which is the refusal that produced beta-princess-i3.
      epubPath: `series_epubs/${RELEASED_ID}/master.epub`,
      sponsorName: null,
      sponsorLogoUrl: null,
      wordCount: null,
      updatedAt: now,
    },
  });
}

/** Put real bytes at an object path, through the admin SDK (which bypasses rules — correct for
 *  a fixture: what a test needs to already exist must not depend on the rule under test). */
export async function putObject(app, objectPath, buffer, contentType) {
  const { getStorage } = await import('firebase-admin/storage');
  const bucket = getStorage(app).bucket(`${PROJECT_ID}.firebasestorage.app`);
  await bucket.file(objectPath).save(buffer, { contentType, resumable: false });
}

export async function objectExists(app, objectPath) {
  const { getStorage } = await import('firebase-admin/storage');
  const bucket = getStorage(app).bucket(`${PROJECT_ID}.firebasestorage.app`);
  const [exists] = await bucket.file(objectPath).exists();
  return exists;
}

export async function listPrefix(app, prefix) {
  const { getStorage } = await import('firebase-admin/storage');
  const bucket = getStorage(app).bucket(`${PROJECT_ID}.firebasestorage.app`);
  const [files] = await bucket.getFiles({ prefix });
  return files.map((f) => f.name);
}
