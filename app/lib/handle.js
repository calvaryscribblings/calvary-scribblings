// A READER'S HANDLE — the rules, the check, and the shape the signup writes.
//
// THE SHAPE IS THE APP'S, derived from live records because the app's source is not in this
// repository (see CLAUDE.md). Every app password signup since 12 May 2026 — 45 records, the last
// on 23 Sep 20:42 — writes the handle three times under users/{uid}, all equal and lowercase:
//
//   users/{uid}/handle            'rebel'
//   users/{uid}/handleLowercased  'rebel'
//   users/{uid}/username          'rebel'      ← what the web has always read
//   usernames/{handle}            uid          ← the claim; the key is the lowercase handle
//   user_search/{uid}             { avatarUrl: '', displayName, isAuthor: false, username }
//
// plus uid and createdAt (ms) beside the profile. Web signup writes the same, so a handle made on
// either platform reads the same on both.
//
// THE RULES. All 101 keys under usernames/ match /^[a-z0-9_]{3,20}$/, which is also the rule the
// web profile has always enforced; every handle in users/ is 3–19 characters of [A-Za-z0-9_].
// Three app records from June keep capitals in `handle` (Ms07, mayaUGC, Mrice) with the lowercase
// copy in handleLowercased; nothing after 28 Jun does, so the current app lowercases. There is
// NO reserved-word list in the data — a reader holds 'facebook' — so none is invented here.
//
// THE CLAIM IS CREATE-ONLY at the database: usernames/$handle is writable only when absent or
// already this reader's (database.rules.json). The signup puts the claim in the SAME multi-path
// update as the profile, so a handle taken between the check and the submit fails the whole
// write, and app/lib/signup.js takes the account back out.
//
// No imports; every Firebase call is handed in, so tests/ci/handle.test.mjs drives it directly.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** What the reader typed, as it would be stored: no leading @, no spaces round it, lowercase. */
export function normaliseHandle(raw) {
  return String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Why a (normalised) handle is refused, or null when it is well-formed.
 * Only the FORMAT — whether it is free is checkHandle's question.
 */
export function handleProblem(handle) {
  if (!handle) return 'Choose a handle.';
  if (/[^a-z0-9_]/.test(handle)) return 'Letters, numbers and underscores only.';
  if (handle.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `No more than ${HANDLE_MAX} characters.`;
  return null;
}

// firebase get() never settles when the database is unreachable (see build-liveness, PL-12), so
// every read here runs against a deadline. A check that times out is UNKNOWN — never taken.
export const CHECK_DEADLINE_MS = 6000;

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('handle check timed out')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Is this handle free?
 * @param readOwner (handle) => Promise<string|null> — the uid at usernames/{handle}, or null.
 * @returns {Promise<{state: 'invalid'|'available'|'taken'|'unknown', handle, problem?, error?}>}
 *   'unknown' means the check itself failed (offline, timed out, refused). It is NEVER reported
 *   as taken: the claim at submit is the real arbiter, and it cannot be fooled by a bad network.
 */
export async function checkHandle(raw, readOwner, { deadlineMs = CHECK_DEADLINE_MS, uid = null } = {}) {
  const handle = normaliseHandle(raw);
  const problem = handleProblem(handle);
  if (problem) return { state: 'invalid', handle, problem };
  try {
    const owner = await withDeadline(Promise.resolve().then(() => readOwner(handle)), deadlineMs);
    if (owner == null || owner === '' || (uid && owner === uid)) return { state: 'available', handle };
    return { state: 'taken', handle };
  } catch (err) {
    return { state: 'unknown', handle, error: err?.message || String(err) };
  }
}

/**
 * The whole signup, as ONE root-relative multi-path update: profile, handle fields, the claim,
 * and the search row. The database applies all of it or none of it.
 */
export function signupUpdate(uid, { name, dob, handle, now }) {
  const h = normaliseHandle(handle);
  return {
    [`users/${uid}/displayName`]: name,
    [`users/${uid}/dob`]: dob,
    [`users/${uid}/joinDate`]: now,
    [`users/${uid}/createdAt`]: now,
    [`users/${uid}/uid`]: uid,
    [`users/${uid}/handle`]: h,
    [`users/${uid}/handleLowercased`]: h,
    [`users/${uid}/username`]: h,
    [`usernames/${h}`]: uid,
    [`user_search/${uid}`]: { avatarUrl: '', displayName: name, isAuthor: false, username: h },
  };
}

// THE FIELD'S WORDS. DRAFT for Ikenna — house voice, no copy here is approved yet.
export const HANDLE_COPY = {
  label: 'Handle',
  helper: 'How other readers find you and mention you on the island. 3 to 20 characters: lowercase letters, numbers and underscores.',
  checking: 'Checking…',
  available: (h) => `@${h} is yours if you want it.`,
  taken: (h) => `@${h} already belongs to another reader. Try another.`,
  unknown: 'We could not check that handle just now. We will check again when you create your account.',
  raceLost: (h) => `Another reader claimed @${h} a moment ago, so nothing was saved. Choose another handle and try again.`,
};

/** The line under the field for a checkHandle result (or null while nothing is typed). */
export function handleStatusLine(result) {
  if (!result) return null;
  switch (result.state) {
    case 'checking': return { tone: 'quiet', text: HANDLE_COPY.checking };
    case 'invalid': return { tone: 'bad', text: result.problem };
    case 'available': return { tone: 'good', text: HANDLE_COPY.available(result.handle) };
    case 'taken': return { tone: 'bad', text: HANDLE_COPY.taken(result.handle) };
    case 'unknown': return { tone: 'quiet', text: HANDLE_COPY.unknown };
    default: return null;
  }
}
