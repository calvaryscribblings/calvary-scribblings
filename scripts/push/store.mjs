// PUSH — the RTDB half. Every read and write the announcer makes, against an Admin SDK
// Database handed in by the caller (production, or the emulator in the suite).
//
// The Admin SDK bypasses rules, which is why push_announced, push_receipts and
// ops/push_announcer are `.write: false` in database.rules.json: no client may forge an
// "already announced" and silence a story, and only this code may write them.

export const ANNOUNCED = 'push_announced';
export const RECEIPTS = 'push_receipts';
export const TOKENS = 'push_tokens';
export const HEARTBEAT = 'ops/push_announcer';

const val = async (db, path) => (await db.ref(path).get()).val();

/**
 * What the scan reads. Stories come from cms_stories_index, not cms_stories: the index carries
 * every field the payload needs (title, author, category, subcategory, trailerQuote, publishAt)
 * at ~236 KB against 1.8 MB, and membership in it is exactly `published !== false`.
 */
export async function readWorld(db) {
  const [stories, instalments, series, announced] = await Promise.all([
    val(db, 'cms_stories_index'), val(db, 'series_instalments'), val(db, 'series'), val(db, ANNOUNCED),
  ]);
  return { stories: stories || {}, instalments: instalments || {}, series: series || {}, announced: announced || {} };
}

/** The seed reads the FULL story node, so a hidden story — absent from the index — is marked too. */
export async function readSeedWorld(db) {
  const [stories, instalments, series, announced] = await Promise.all([
    val(db, 'cms_stories'), val(db, 'series_instalments'), val(db, 'series'), val(db, ANNOUNCED),
  ]);
  return { stories: stories || {}, instalments: instalments || {}, series: series || {}, announced: announced || {} };
}

export const readInstalmentDetail = (db, id) => val(db, `series_instalments_detail/${id}`);
export const readHeartbeat = async (db) => (await val(db, HEARTBEAT)) || {};
export const writeHeartbeat = (db, patch) => db.ref(HEARTBEAT).update(patch);

/**
 * CLAIM BEFORE SENDING. A transaction that only succeeds when the item has no entry at all,
 * so two runs that overlap — a slow scheduled run and a manual dispatch, say — cannot both
 * announce the same story. Whoever commits first sends; the other sees the claim and moves on.
 */
export async function claim(db, kind, id, runId, now) {
  const { committed } = await db.ref(`${ANNOUNCED}/${kind}/${id}`).transaction((cur) => {
    if (cur !== null) return undefined; // abort: someone has it, in any state
    return { state: 'claimed', claimedAt: now, runId };
  }, undefined, false);
  return committed;
}

export const finish = (db, kind, id, patch) => db.ref(`${ANNOUNCED}/${kind}/${id}`).update(patch);

/** Give the item back — ONLY when nothing reached Expo, so the next run may try again. */
export const release = (db, kind, id) => db.ref(`${ANNOUNCED}/${kind}/${id}`).remove();

/** The seed: every mark in ONE multi-path update, plus the seededAt the sender checks for. */
export async function writeSeed(db, marks, now) {
  const patch = {};
  for (const { kind, id } of marks) patch[`${ANNOUNCED}/${kind}/${id}`] = { state: 'seeded', at: now };
  patch[`${HEARTBEAT}/seededAt`] = now;
  patch[`${HEARTBEAT}/seededCount`] = marks.length;
  await db.ref().update(patch);
}

export const readTokens = async (db) => (await val(db, TOKENS)) || {};

/** users/{uid}/storyNotifications for exactly the uids that hold tokens — never the whole node. */
export async function readPrefs(db, uids) {
  const out = {};
  await Promise.all(uids.map(async (uid) => {
    const v = await val(db, `users/${uid}/storyNotifications`);
    if (v !== null) out[uid] = v;
  }));
  return out;
}

export async function deleteTokens(db, rows) {
  if (!rows.length) return;
  const patch = {};
  for (const { uid, tokenKey } of rows) patch[`${TOKENS}/${uid}/${tokenKey}`] = null;
  await db.ref().update(patch);
}

export const readReceipts = async (db) => (await val(db, RECEIPTS)) || {};

export async function addReceipts(db, pending, now) {
  if (!pending.length) return;
  const patch = {};
  for (const { ticketId, ...rest } of pending) patch[`${RECEIPTS}/${ticketId}`] = { ...rest, at: now };
  await db.ref().update(patch);
}

export async function clearReceipts(db, ids) {
  if (!ids.length) return;
  const patch = {};
  for (const id of ids) patch[`${RECEIPTS}/${id}`] = null;
  await db.ref().update(patch);
}
