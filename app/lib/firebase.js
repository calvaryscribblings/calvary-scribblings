import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// The RTDB origin, exported so callers that need the REST surface the JS SDK does
// not expose — chiefly `?shallow=true`, which returns a node's KEYS without their
// values — can reach it without re-typing the URL. The admin quiz picker uses it to
// learn which slugs have a quiz (4 KB) instead of downloading cms_quizzes (906 KB).
export const DB_URL = firebaseConfig.databaseURL;

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

// ── THE EMULATOR SWITCH — TEST HARNESSES ONLY, AND IT CANNOT FIRE IN PRODUCTION ──────────
//
// WHY IT EXISTS. tests/series/sponsor-logo.spec.mjs drives the real Series admin screen and
// watches a real file upload land as a real record write. There is no honest way to assert
// "the upload completes and both fields land together" without a backend that actually
// completes it, and the two candidates were both wrong: writing to PRODUCTION would put a
// fabricated sponsor credit on a released instalment's public page on every CI run, and
// stubbing the transport would prove only that a stub resolves. The Firebase emulators are
// already a dependency here — tests/rules/*.test.mjs runs the real rule files against them —
// so this points the app's own client at them instead.
//
// ── THE TWO CONDITIONS, AND THE SECOND ONE IS THE FENCE ─────────────────────────────────
//
// 1. NEXT_PUBLIC_FB_EMULATOR === '1'. Cloudflare Pages runs `npm run build` with no such
//    variable, so Next's browser `process.env` shim resolves it to undefined and the condition
//    is false.
//
//    ⚠ IT IS FALSE, NOT ABSENT. Measured on a real production build: the minified chunk still
//    contains `"1"===t.default.env.NEXT_PUBLIC_FB_EMULATOR&&("localhost"===window.location
//    .hostname||...)` verbatim. Next only substitutes NEXT_PUBLIC_* vars that are DEFINED at
//    build time; an undefined one is left as a runtime property read, so nothing here is
//    dead-code eliminated and it is wrong to reason as though it were. What ships is a live
//    branch whose first condition never holds — which is precisely why condition 2 is not
//    decoration.
//
// 2. THE PAGE IS ON localhost. A runtime check no build flag can override, evaluated in the
//    reader's own browser. calvary-scribblings.pages.dev and the custom domain both fail it,
//    so even a flag set by accident on a production build leaves every connection exactly
//    where it was. Given what condition 1 actually compiles to, THIS is the fence.
//
// tests/ci/series-access.test.mjs asserts both halves are present and that neither was
// loosened to one condition.
if (typeof window !== 'undefined'
    && process.env.NEXT_PUBLIC_FB_EMULATOR === '1'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  // Statically imported above, deliberately: a dynamic import here would put TOP-LEVEL AWAIT
  // in the module every client surface on the site imports, which makes each of them an async
  // module for the sake of a branch that never runs in production.
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  // The harness's way in. A browser test cannot reach this module's `auth` — it is inside a
  // bundle, not on window — and the alternative was forging Firebase's IndexedDB persistence
  // record by hand, which pins the suite to an internal storage format. One line behind the
  // same fence is the smaller thing to own. The token it takes is only ever an emulator
  // custom token, which the real Identity Toolkit would reject outright.
  window.__FB_EMULATOR_SIGNIN__ = (token) => signInWithCustomToken(auth, token);
  console.warn('[firebase] EMULATOR MODE — auth:9099 db:9000 storage:9199. Never production.');
}

export default app;