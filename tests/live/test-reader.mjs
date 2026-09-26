// W17 — THE LIVE TEST READER. Every harness that signs in against the LIVE site signs in as this
// account, and never as a founder (CLAUDE.md, "Probes that write to live data").
//
// Why: the founder uids hold node-level .write on most of the database. A founder session in a
// harness is an admin session, so a guard that misses a single write path (W15 found one: the
// SDK's long-polling fallback) can write anywhere. The test reader is an ordinary reader:
//   · not in FOUNDER_UIDS, no custom claims, no handle, no search row, not an author;
//   · a displayName (so the profile-completion modal stays away) and an adult date of birth in
//     users_private (so the under-18 check stays away);
//   · NO founder_preview flag. The flag only ever works for a founder uid — /api/story and the page
//     both check isFounder() first — so giving it to this account would do nothing. A test that
//     needs the gate on runs after the 30 Sept switch, or uses the page clock (lock-shots does).
//
// NO CREDENTIAL EXISTS. The session is minted from a custom token signed by the service account
// (serviceAccountKey.json, git-ignored). There is no password, and the uid is not in this repo:
// it lives at ops/live_test_reader, which only the Admin SDK can read. Never print it — a harness
// says "the test reader", nothing more. Actions logs are public (W12).
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

export const API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
export const TEST_READER_REF = 'ops/live_test_reader';
export const TEST_READER_NAME = 'Live test reader';
const ADULT_DOB = '1990-01-01';

/** The test reader's uid — created on first use. Refuses anything that could be an admin. */
export async function ensureTestReader() {
  const db = getDatabase();
  const auth = getAuth();
  let uid = (await db.ref(`${TEST_READER_REF}/uid`).get()).val();
  let user = null;
  if (uid) user = await auth.getUser(uid).catch(() => null);
  if (!user) {
    user = await auth.createUser({ displayName: TEST_READER_NAME });
    uid = user.uid;
    await db.ref().update({
      [`users/${uid}`]: { displayName: TEST_READER_NAME, createdAt: Date.now() },
      [`users_private/${uid}/dob`]: ADULT_DOB,
      [TEST_READER_REF]: { uid, createdAt: Date.now() },
    });
  }
  if (FOUNDER_UIDS.includes(uid)) throw new Error('the test reader must never be a founder');
  if (user.customClaims && Object.keys(user.customClaims).length) throw new Error('the test reader must carry no custom claims');
  if (user.email || user.providerData?.length) throw new Error('the test reader must have no sign-in method but a custom token');
  if ((await db.ref(`founder_preview/${uid}`).get()).exists()) throw new Error('the test reader must carry no founder_preview flag');
  return uid;
}

/** A fresh ID token + refresh token for the test reader. */
export async function testReaderSession(uid) {
  const tok = await getAuth().createCustomToken(uid);
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, returnSecureToken: true }),
  })).json();
  if (!r.idToken) throw new Error('custom-token sign-in failed for the test reader');
  return { uid, idToken: r.idToken, refreshToken: r.refreshToken };
}

// Firebase's own persistence record, written in the page so it boots signed in.
export const SIGNED_IN = ({ key, user }) => new Promise((resolve) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user });
    tx.oncomplete = () => resolve();
  };
});

/** Sign `page` in as the test reader: visit `landing` on the site, write the persistence record. */
export async function signInPage(page, site, account, landing = '/terms') {
  await page.goto(site + landing, { waitUntil: 'domcontentloaded' });
  await page.evaluate(SIGNED_IN, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user: {
    uid: account.uid, email: null, emailVerified: false, isAnonymous: false, providerData: [], displayName: TEST_READER_NAME,
    stsTokenManager: { refreshToken: account.refreshToken, accessToken: account.idToken, expirationTime: Date.now() + 3500e3 },
    createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
  } });
}

/** The test reader's own records a page visit could touch — for the before/after read. */
export const testReaderWatch = (uid) => [`users/${uid}`, `users_private/${uid}`, `points/${uid}`, `userStreaks/${uid}`,
  `library_notifications/${uid}`, `notifications/${uid}`, `readerBookmarks/${uid}`, `bookstore_reading_progress/${uid}`,
  `leaderboard/${uid}`, `presence/${uid}`, `founder_preview/${uid}`];
