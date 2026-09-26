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

// RESERVED NAMES (ruling, 24 Sep 2026). Anything starting calvary, storyisland or story_island,
// plus the exact words below. Founders are exempt; a reader who already holds one keeps it
// (calvaryscribblings, calvaryfilms and calvaryradio were claimed before the ruling). The SAME
// list is in database.rules.json, at usernames/$handle and on the three handle fields —
// tests/rules/database.test.mjs refuses each word there, so the two cannot drift.
export const RESERVED_PREFIXES = ['calvary', 'storyisland', 'story_island'];
export const RESERVED_WORDS = [
  'admin', 'administrator', 'support', 'help', 'official', 'staff', 'team', 'editor', 'editors',
  'moderator', 'mod', 'system', 'root', 'security', 'founder',
];
export function isReserved(handle) {
  const h = String(handle || '').toLowerCase();
  return RESERVED_PREFIXES.some((p) => h.startsWith(p)) || RESERVED_WORDS.includes(h);
}

// The two founder uids the rules hardcode. Exempt from the reserved list.
export const FOUNDER_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

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
  // Short fragments under the field, so no full stop; "Choose a handle." is a sentence (rule 13).
  if (/[^a-z0-9_]/.test(handle)) return 'Letters, numbers and underscores only';
  if (handle.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters`;
  if (handle.length > HANDLE_MAX) return `No more than ${HANDLE_MAX} characters`;
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
 * @param uid  the reader asking, when signed in: a handle they already hold is available to them
 *              (and a reserved one they hold is theirs to keep); a founder uid skips the reserved list.
 * @returns {Promise<{state: 'invalid'|'reserved'|'available'|'taken'|'unknown', handle, problem?, error?}>}
 *   'unknown' means the check itself failed (offline, timed out, refused). It is NEVER reported
 *   as taken: the claim at submit is the real arbiter, and it cannot be fooled by a bad network.
 *   'reserved' needs no network, except to learn whether this reader is its current holder.
 */
export async function checkHandle(raw, readOwner, { deadlineMs = CHECK_DEADLINE_MS, uid = null } = {}) {
  const handle = normaliseHandle(raw);
  const problem = handleProblem(handle);
  if (problem) return { state: 'invalid', handle, problem };
  const reserved = isReserved(handle) && !FOUNDER_UIDS.includes(uid);
  if (reserved && !uid) return { state: 'reserved', handle };
  try {
    const owner = await withDeadline(Promise.resolve().then(() => readOwner(handle)), deadlineMs);
    if (uid && owner === uid) return { state: 'available', handle };
    if (reserved) return { state: 'reserved', handle };
    if (owner == null || owner === '') return { state: 'available', handle };
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
    // PRIVATE. users/{uid} is world-readable and a child of a readable node cannot be made
    // private, so the date of birth lives at users_private/{uid} — owner and founders only.
    // See scripts/account/private-fields.mjs.
    [`users_private/${uid}/dob`]: dob,
    // Written only by a caller that has ALREADY passed the age check (app/lib/age.js), so it
    // now tells the truth, as the app's does.
    [`users/${uid}/ageConfirmed`]: true,
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

/**
 * THE COMPLETION STEP's write — a signed-in reader with no identity (Google first sign-in, or a
 * profile-less node from the census). The same shape as signup, as ONE update of named leaves:
 * readStories, readCount, readerScore and anything else already in the node are not named, so
 * they are not touched. `since` is the Auth account's creation time, not the moment of
 * completion — that is when this reader actually joined.
 */
export function completionUpdate(uid, { name, dob, handle, since }) {
  return signupUpdate(uid, { name, dob, handle, now: since });
}

/** Thrown before anything is written, when a handle is malformed, reserved or already someone's. */
export class HandleRefused extends Error {
  constructor(check) {
    super(check.state === 'taken' ? `@${check.handle} is taken`
      : check.state === 'reserved' ? `@${check.handle} is reserved` : check.problem);
    this.name = 'HandleRefused';
    this.check = check;
  }
}

/**
 * A RENAME, as ONE update: the three handle fields, the search row's copy, the new claim and the
 * release of the old one. The new claim is create-only in the rules, so a handle taken in the
 * meantime refuses ALL of it and nothing changes.
 *
 * `oldClaimOwner` is who holds usernames/{old} now. The old claim is released only when this
 * reader holds it: releasing a claim someone else holds is refused by the rules and would sink
 * the whole rename (live case: an app record shows `lizbest` while another reader holds it).
 */
export function renameUpdate(uid, { from, to, oldClaimOwner }) {
  const next = normaliseHandle(to);
  const prev = normaliseHandle(from);
  const u = {
    [`users/${uid}/handle`]: next,
    [`users/${uid}/handleLowercased`]: next,
    [`users/${uid}/username`]: next,
    [`user_search/${uid}/username`]: next,
    [`usernames/${next}`]: uid,
  };
  if (prev && prev !== next && oldClaimOwner === uid) u[`usernames/${prev}`] = null;
  return u;
}

// THE FIELD'S WORDS. RULED (Ikenna, 26 Sep 2026, 01:53): approved, in house style — docs/COPY-RULINGS.md.
export const HANDLE_COPY = {
  label: 'Handle',
  helper: 'How other readers find you and mention you on the island. 3 to 20 characters: lowercase letters, numbers and underscores.',
  checking: 'Checking…',
  available: (h) => `@${h} is yours if you want it.`,
  taken: (h) => `@${h} already belongs to another reader. Try another.`,
  unknown: 'We couldn’t check that handle just now. It’ll be checked again when you continue.',
  reserved: (h) => `@${h} is reserved for the island's own use. Choose another.`,
  renameLost: (h) => `Another reader claimed @${h} a moment ago, so nothing was changed. Choose another handle.`,
  required: 'Your handle can be changed, but not removed.',
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
    case 'reserved': return { tone: 'bad', text: HANDLE_COPY.reserved(result.handle) };
    case 'unknown': return { tone: 'quiet', text: HANDLE_COPY.unknown };
    default: return null;
  }
}

/**
 * Run a rename, with whatever else the same save changes (`extra`, root-relative paths) in the SAME
 * update — the profile editor saves name, bio and pictures alongside. When the handle is unchanged,
 * only `extra` is written.
 * @param deps { readHandleOwner, writeUpdate(updates) }
 * @throws HandleRefused before anything is written; the write's own error after, with
 *         err.handleTaken when the handle went to someone else in the meantime.
 */
export async function renameHandle(uid, { from, to, extra = {} }, deps) {
  const prev = normaliseHandle(from);
  const next = normaliseHandle(to);
  if (next === prev) { await deps.writeUpdate({ ...extra }); return { handle: prev, changed: false }; }
  const check = await checkHandle(next, deps.readHandleOwner, { uid });
  if (check.state !== 'available' && check.state !== 'unknown') throw new HandleRefused(check);
  let oldClaimOwner = null;
  if (prev) {
    // Unreadable → null → the old claim is left in place rather than risking the whole rename.
    try { oldClaimOwner = await withDeadline(Promise.resolve().then(() => deps.readHandleOwner(prev)), CHECK_DEADLINE_MS); } catch { oldClaimOwner = null; }
  }
  try {
    await deps.writeUpdate({ ...extra, ...renameUpdate(uid, { from: prev, to: next, oldClaimOwner }) });
  } catch (err) {
    const after = await checkHandle(next, deps.readHandleOwner, { uid });
    err.handleTaken = after.state === 'taken' || after.state === 'reserved';
    err.handle = next;
    throw err;
  }
  return { handle: next, changed: true, released: oldClaimOwner === uid };
}
