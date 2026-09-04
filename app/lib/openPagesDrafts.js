// Open Pages — DRAFTS. The shared contract (R37).
//
// Open Pages had no drafts at all: no autosave, no local persistence, no unload
// handler anywhere in the repo. A writer who closed the tab lost the piece, which
// silently limited the surface to work that can be finished in one sitting. Every
// serious piece is written across days.
//
// THIS FILE IS THE CONTRACT, NOT THE WEB FEATURE. The React Native composer needs the
// same node, the same slot names, the same caps and — above all — the same conflict
// resolution, or two devices will disagree about whose words survive. Everything here
// is pure: no React, no firebase import, no DOM. CLAUDE.md's direction of travel is
// "web → app for systems", and this is the systems side, so the app transcribes it.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// DEVICE FIRST, SYNCED WHEN SIGNED IN
// ═══════════════════════════════════════════════════════════════════════════════════
// A keystroke never waits on a network. The device copy is written on a short debounce
// and is the thing that survives a dropped connection or a closed tab; the synced copy
// is written lazily and is what lets someone start on a laptop and finish on a phone.
// They have different right answers and different cadences — see CADENCE below.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// WHERE IT LIVES, AND WHY NOT UNDER users/
// ═══════════════════════════════════════════════════════════════════════════════════
// `open_pages_drafts/{uid}/{slot}` — a TOP-LEVEL node, owner-scoped both ways.
//
// ⚠ NOT under users/{uid}, and this was measured rather than assumed. `users/$uid`
// carries `".read": true`. RTDB read rules CASCADE and cannot be tightened deeper: a
// `.read: false` on a child of a readable parent is ignored. So every child of
// users/{uid} is world-readable — which is exactly why users/{uid}/readerProgress is
// public — and anything filed there would be too. Unfinished writing must be readable
// by its author and by nobody else, NOT EVEN A FOUNDER, so the rule is a bare
// `auth.uid === $uid` with no founder clause. It is the only node in the tree the
// founders cannot read, and that is deliberate.

export const DRAFTS_NODE = 'open_pages_drafts';

// ═══════════════════════════════════════════════════════════════════════════════════
// THE CAP, AND IT IS ENFORCED IN THE RULES RATHER THAN ASKED FOR POLITELY
// ═══════════════════════════════════════════════════════════════════════════════════
// A draft node with no bound is an unmetered write surface on a database whose oldest
// backup is 30 days old. RTDB rules cannot COUNT children — there is no numChildren()
// — so the usual answer would be "the client enforces it", which is not enforcement.
//
// Instead the draft key is not a push-id: it is one of twenty fixed SLOTS, d0…d19, and
// the rule matches the key against a regex. Twenty is then a hard ceiling that a
// hostile client cannot exceed, because there is no twenty-first name to write to.
// (Verified against the emulator before this design was settled: d0/d7/d19 accepted,
// d20/d99/a push-id/an arbitrary key all refused.)
//
// SIZED FROM THE LIVE CORPUS (4 Sep 2026). The seven published bodies run 1,121–10,172
// characters, median 4,143; as stored records, 1,477–10,584 bytes (bytes exceed chars
// because the corpus is full of curly quotes, em dashes and emoji). So twenty slots at
// the live median is ~93 KiB per author and at the live maximum ~212 KiB. Across all
// 307 accounts, if every one of them filled every slot at the median, ~28 MiB — against
// a database that is 19 MB today. That is the realistic ceiling and it is affordable.
//
// The abuse ceiling is different and is what the per-draft cap is for: twenty slots at
// the 50,000-character publish limit is 0.96 MiB per account. Deliberate, detectable,
// and bounded.
export const MAX_DRAFTS = 20;
export const SLOT_RE = /^d([0-9]|1[0-9])$/;
export const slotName = (i) => `d${i}`;
export const isSlot = (k) => typeof k === 'string' && SLOT_RE.test(k);

// The body cap is the PUBLISH cap, deliberately. A draft you cannot publish is a trap,
// so the composer's limit and the draft's limit are the same number.
export const DRAFT_TITLE_MAX = 200;
export const DRAFT_BODY_MAX = 50000;
export const DRAFT_COVER_MAX = 2000;

// ═══════════════════════════════════════════════════════════════════════════════════
// CADENCE
// ═══════════════════════════════════════════════════════════════════════════════════
// Local is near-continuous because it is free and because it is the guarantee: a
// localStorage write of a 10 KB string is well under a millisecond and never touches
// the network. Remote is lazy because it is the shared resource.
//
// LOCAL_DEBOUNCE_MS  — after typing stops. Half a second: the device copy is never
//                      more than that far behind the textarea.
// REMOTE_DEBOUNCE_MS — after typing stops. Ten seconds: a writer who pauses to think
//                      has already synced by the time they look up.
// REMOTE_MAX_WAIT_MS — a writer typing continuously for an hour would otherwise never
//                      sync, so the remote write is forced every sixty seconds.
//
// Both are additionally flushed on blur and on pagehide/visibilitychange — NOT on
// `beforeunload`, which is unreliable on mobile and is the reason a naive
// implementation loses exactly the work a phone writer does. On the way out the local
// write is synchronous and guaranteed; the remote write is best-effort, which is what
// device-first means when the tab is closing.
export const LOCAL_DEBOUNCE_MS = 500;
export const REMOTE_DEBOUNCE_MS = 10000;
export const REMOTE_MAX_WAIT_MS = 60000;

/** localStorage key for one author's drafts. Namespaced by uid so two accounts on one
 *  browser never see each other's unfinished work. */
export const localKey = (uid) => `cs_op_drafts_${uid || 'anon'}`;

// ═══════════════════════════════════════════════════════════════════════════════════
// THE RECORD
// ═══════════════════════════════════════════════════════════════════════════════════
//   { title, body, genre, coverImage, createdAt, updatedAt, rev, deviceId, forkedFrom? }
//
// `rev` counts SAVES, not time, and is what makes conflict detection honest — see
// reconcile(). `deviceId` is a random per-browser string, used only to tell a writer
// where a conflicting copy came from. Neither is ever shown to another reader, because
// no other reader can read this node.

/** A stable per-device id. Pure given its inputs so the app can implement it the same. */
export function makeDeviceId(random = Math.random) {
  return `d${Math.floor(random() * 1e9).toString(36)}${Date.now().toString(36)}`;
}

export function buildDraft(content, meta) {
  const { title = '', body = '', genre = null, coverImage = null } = content || {};
  const { now, deviceId, rev = 1, createdAt = now, forkedFrom = null } = meta || {};
  const d = {
    title: String(title).slice(0, DRAFT_TITLE_MAX),
    body: String(body).slice(0, DRAFT_BODY_MAX),
    createdAt,
    updatedAt: now,
    rev,
    deviceId,
  };
  if (genre) d.genre = genre;
  if (coverImage) d.coverImage = coverImage;
  if (forkedFrom) d.forkedFrom = forkedFrom;
  return d;
}

/** True when there is nothing worth keeping. An empty draft is deleted, not stored. */
export function draftIsEmpty(d) {
  return !d || (!String(d.title || '').trim() && !String(d.body || '').trim());
}

/**
 * What the list row calls this draft: the title, or failing that the first non-empty
 * line of the body. A writer who has not titled anything yet still has to be able to
 * tell twenty rows apart, and the first line is what they would recognise.
 */
export function draftLabel(d, max = 60) {
  const t = String(d?.title || '').trim();
  if (t) return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  const firstLine = String(d?.body || '')
    .split('\n').map((l) => l.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').trim())
    .find(Boolean) || '';
  if (!firstLine) return 'Untitled';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/** Length in WORDS. Writers think in words; characters are a database unit. */
export function draftWords(d) {
  const b = String(d?.body || '').trim();
  return b ? b.split(/\s+/).filter(Boolean).length : 0;
}

/** True when the content a writer can see differs. Metadata is deliberately ignored. */
export function sameContent(a, b) {
  if (!a || !b) return false;
  return String(a.title || '') === String(b.title || '')
    && String(a.body || '') === String(b.body || '')
    && String(a.genre || '') === String(b.genre || '')
    && String(a.coverImage || '') === String(b.coverImage || '');
}

/** The lowest free slot, or null when all twenty are taken. */
export function firstFreeSlot(existing) {
  const taken = new Set(Object.keys(existing || {}));
  for (let i = 0; i < MAX_DRAFTS; i++) if (!taken.has(slotName(i))) return slotName(i);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE CONFLICT. THIS IS THE HARD PART, NOT THE SAVE.
// ═══════════════════════════════════════════════════════════════════════════════════
// Two devices, both holding a copy, both edited. Last-write-wins on a timestamp is the
// usual answer and it FAILS the only test that matters here: it silently destroys words
// the writer could still see a moment ago. On a writing platform that is the worst
// thing the software can do, and it is invisible — the loser never learns what was in
// the copy that lost.
//
// So: last-write-wins for WHICH COPY IS OPEN, and never for which copy EXISTS.
//
// When both sides have moved on from their last common revision, the newer copy stays
// as the draft the writer is editing, and THE OLDER ONE IS FORKED INTO ITS OWN SLOT
// rather than overwritten. Nothing is discarded. The writer gets two rows in the list
// and merges them by hand, which is the only merge that is ever right for prose — an
// automatic three-way merge of two versions of a paragraph produces something neither
// person wrote.
//
// This is also why a skewed device clock is survivable here and would not be under
// plain LWW: picking the "newer" copy wrongly only decides which one opens first, and
// the other is sitting in the list. Divergence itself is detected with `rev`, a save
// counter, not with the clock.
//
// The writer is TOLD, in the composer and on the list row: "Also edited on another
// device. That version is saved separately as …". Never resolved silently.
//
// @param local   the device copy, or null
// @param remote  the database copy, or null
// @param syncedRev  the rev this device last successfully pushed or pulled; null if never
// @returns {{action:'pull'|'push'|'converged'|'fork'|'none', live:object|null, fork:object|null, reason:string}}
export function reconcile(local, remote, syncedRev) {
  if (!local && !remote) return { action: 'none', live: null, fork: null, reason: 'nothing on either side' };
  if (!local) return { action: 'pull', live: remote, fork: null, reason: 'only the database has it' };
  if (!remote) return { action: 'push', live: local, fork: null, reason: 'only this device has it' };

  // Identical text is not a conflict however the revisions look. Forking here would
  // hand the writer two identical rows and teach them to ignore the warning.
  if (sameContent(local, remote)) {
    return {
      action: 'converged',
      live: (remote.rev || 0) >= (local.rev || 0) ? remote : local,
      fork: null,
      reason: 'both copies hold the same words',
    };
  }

  const base = typeof syncedRev === 'number' ? syncedRev : -1;
  const localMoved = (local.rev || 0) > base;
  const remoteMoved = (remote.rev || 0) > base;

  if (remoteMoved && !localMoved) {
    return { action: 'pull', live: remote, fork: null, reason: 'another device edited it; this one did not' };
  }
  if (localMoved && !remoteMoved) {
    return { action: 'push', live: local, fork: null, reason: 'this device edited it; the database did not' };
  }

  // Both moved — or neither did while the words differ, which means a sync was lost and
  // is treated the same way, because the safe direction is always "keep both".
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  return {
    action: 'fork',
    live: localNewer ? local : remote,
    fork: localNewer ? remote : local,
    reason: 'both copies changed since they last agreed — keeping both',
  };
}

/** The sentence the writer is shown when a fork happens. Never a silent resolution. */
export function forkNotice(forkLabel) {
  return `This draft was also edited on another device. Both versions are kept — the other one is saved separately as “${forkLabel}”.`;
}

/** The sentence shown when all twenty slots are taken. Refuse, never evict. */
export function capNotice() {
  return `You have ${MAX_DRAFTS} drafts, which is the limit. Publish or delete one to start another — nothing has been thrown away.`;
}

/** The sentence shown when a draft is too long to sync. The device copy still has it. */
export function oversizeNotice() {
  return `This draft is longer than ${DRAFT_BODY_MAX.toLocaleString()} characters, so it is saved on this device only until it is shorter. Nothing has been cut.`;
}
