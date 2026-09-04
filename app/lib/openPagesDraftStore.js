// Open Pages — draft persistence (R37). The device half and the network half.
//
// Split from openPagesDrafts.js (the pure contract) so the mechanics can be driven by
// tests with a fake storage and a fake database, and so the app can replace BOTH halves
// while keeping the contract identical.
//
// ⚠ NOTHING HERE EVER CALLS THE MODERATION FUNCTION. A draft is not published, so it is
// never screened, never counted by R36's rate limiter, and never costs an Anthropic
// token. Screening happens at publish and only at publish. tests/openpages/draft-cost
// stubs fetch and requires zero requests to the Anthropic endpoint across fifty saves.

import {
  DRAFTS_NODE, MAX_DRAFTS, isSlot, slotName, localKey,
  DRAFT_BODY_MAX, DRAFT_TITLE_MAX,
  buildDraft, draftIsEmpty, firstFreeSlot, reconcile, sameContent,
} from './openPagesDrafts.js';

const DEVICE_KEY = 'cs_op_device';

// ---------------------------------------------------------------------------
// THE DEVICE HALF. Synchronous, never fails loudly, and is the guarantee.
// ---------------------------------------------------------------------------

/** Safe accessor — private mode and blocked site data both throw on access, not on use. */
function store(storage) {
  return storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
}

export function deviceId(storage) {
  const s = store(storage);
  if (!s) return 'nodevice';
  try {
    let id = s.getItem(DEVICE_KEY);
    if (!id) {
      id = `d${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
      s.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return 'nodevice'; }
}

/** Every draft this device holds for `uid`, as { slot: draft }. Never throws. */
export function readLocal(uid, storage) {
  const s = store(storage);
  if (!s) return {};
  try {
    const raw = s.getItem(localKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Drop anything that is not a real slot, so a corrupted or hand-edited store cannot
    // produce a draft the database would refuse and the writer could never sync.
    const out = {};
    for (const [k, v] of Object.entries(parsed)) if (isSlot(k) && v && typeof v === 'object') out[k] = v;
    return out;
  } catch { return {}; }
}

/**
 * Write the whole set. Returns true when it landed.
 *
 * ⚠ A FAILED LOCAL WRITE IS THE ONE FAILURE THAT MATTERS, because the device copy is
 * what the whole design leans on. It is reported rather than swallowed so the composer
 * can tell the writer their browser is not storing anything — private mode, or site
 * data blocked. Silently pretending to save is how a writer loses an evening.
 */
export function writeLocal(uid, drafts, storage) {
  const s = store(storage);
  if (!s) return false;
  try { s.setItem(localKey(uid), JSON.stringify(drafts)); return true; }
  catch { return false; }
}

/** The rev this device last agreed on with the database, per slot. */
export function readSyncedRevs(uid, storage) {
  const s = store(storage);
  if (!s) return {};
  try { return JSON.parse(s.getItem(`${localKey(uid)}_sync`) || '{}') || {}; }
  catch { return {}; }
}
export function writeSyncedRevs(uid, revs, storage) {
  const s = store(storage);
  if (!s) return false;
  try { s.setItem(`${localKey(uid)}_sync`, JSON.stringify(revs)); return true; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// SIZE
// ---------------------------------------------------------------------------

/** null when it will sync; a reason string when the network copy must refuse it. */
export function oversizeReason(draft) {
  if (String(draft?.body || '').length > DRAFT_BODY_MAX) return 'body';
  if (String(draft?.title || '').length > DRAFT_TITLE_MAX) return 'title';
  return null;
}

// ---------------------------------------------------------------------------
// THE NETWORK HALF. `db` is an object of three functions so tests can drive it and so
// the app can hand in its own client.
//   db.readAll(uid)            -> { slot: draft }
//   db.write(uid, slot, draft) -> void   (throws on refusal)
//   db.remove(uid, slot)       -> void
// ---------------------------------------------------------------------------

export const draftPath = (uid, slot) => `${DRAFTS_NODE}/${uid}/${slot}`;

/**
 * Bring the device and the database into agreement WITHOUT LOSING WORDS.
 *
 * Every slot present on either side is reconciled independently. A slot that diverged
 * is forked into a free slot rather than resolved — see reconcile() for why prose is
 * never auto-merged. Forks are reported so the composer can tell the writer; they are
 * never applied silently.
 *
 * @returns {{ merged: object, forks: Array<{from: string, to: string, draft: object}>,
 *             pushed: string[], pulled: string[], revs: object, capReached: boolean }}
 */
export function planSync(localDrafts, remoteDrafts, syncedRevs) {
  const merged = {};
  const forks = [];
  const pushed = [];
  const pulled = [];
  const revs = { ...(syncedRevs || {}) };
  let capReached = false;

  const slots = new Set([...Object.keys(localDrafts || {}), ...Object.keys(remoteDrafts || {})]);
  for (const slot of [...slots].sort()) {
    const local = localDrafts?.[slot] || null;
    const remote = remoteDrafts?.[slot] || null;
    const r = reconcile(local, remote, revs[slot]);

    if (r.action === 'none') continue;
    merged[slot] = r.live;
    if (r.action === 'pull') { pulled.push(slot); revs[slot] = r.live.rev || 0; }
    else if (r.action === 'push') { pushed.push(slot); }
    else if (r.action === 'converged') { revs[slot] = r.live.rev || 0; }
    else if (r.action === 'fork') {
      // The loser needs a home. If there is none, the fork is NOT dropped — the sync is
      // left alone for that slot and the writer is told the cap is in the way, because
      // "we could not keep it so we deleted it" is the one outcome this design exists
      // to prevent.
      const free = firstFreeSlot({ ...merged, ...localDrafts, ...remoteDrafts });
      if (!free) { capReached = true; merged[slot] = r.live; continue; }
      merged[free] = { ...r.fork, forkedFrom: slot };
      forks.push({ from: slot, to: free, draft: merged[free] });
      pushed.push(slot, free);
    }
  }
  return { merged, forks, pushed, pulled, revs, capReached };
}

/** Allocate a slot for a new draft, or null at the cap. Never evicts. */
export function allocateSlot(drafts) {
  return firstFreeSlot(drafts || {});
}

/** Drop empty drafts — an untouched composer must not leave a row in the list. */
export function pruneEmpty(drafts) {
  const out = {};
  for (const [k, v] of Object.entries(drafts || {})) if (!draftIsEmpty(v)) out[k] = v;
  return out;
}

export { MAX_DRAFTS, slotName, buildDraft, draftIsEmpty, sameContent };
