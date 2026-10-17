'use client';
// READERS' NOTES — the room's PUBLIC reads, and the warm cache the door fills (W46, §4).
//
// Everything here is public by rule: the series record, its instalment rows, the released
// detail records (titles for the rail), the summary and the Sit with this questions. The door
// on /series calls warmRoom() when it scrolls into view, so by the time a reader steps inside
// the room's first paint needs no round trip. The cache lives for the page session and is
// keyed by slug; a stale entry is refreshed in the background on every room mount.
//
// W49 — each released instalment's read count, from series_reads/{inst} (public), read directly:
// the notes summary only changes when notes do, and a read is not a note.
//
// The one owner read here, readProgress(), is the reader's own place in an instalment, which
// the sealed room draws as the house progress rule. It is NOT gated notes data.
import { ref, get } from 'firebase/database';
import { db } from '../../lib/firebase';
import { getSeriesBySlug, getInstalments, getInstalmentDetail } from '../../lib/series/loader';
import { isReleased } from '../../lib/series/access';
import { readSummary, readPublicQuestions } from '../../lib/series/notesClient';
import { positionPath } from '../../lib/series/reading-position';
import { readsPath, readsOf } from '../../lib/series/reads';

const cache = new Map(); // slug -> { at, promise }
const FRESH_MS = 60_000;

async function loadPublicUncached(slug) {
  const series = await getSeriesBySlug(slug, { throwOnError: true });
  if (!series) return null;
  const now = Date.now();
  const [rows, summary] = await Promise.all([
    getInstalments(series.id, now, { throwOnError: true }),
    readSummary(series.id).catch(() => null),
  ]);
  const released = rows.filter((r) => isReleased(r, now));
  const [details, sitByInst, readCounts] = await Promise.all([
    Promise.all(released.map((r) => getInstalmentDetail(r.id))),
    readPublicQuestions(released.map((r) => r.id)),
    Promise.all(released.map((r) => get(ref(db, readsPath(r.id))).then((s) => (s.exists() ? s.val() : 0), () => null))),
  ]);
  // null when the read failed: the room then leaves the reads out rather than printing a 0.
  const reads = {};
  released.forEach((r, i) => { reads[r.id] = readCounts[i] === null ? null : readsOf(readCounts[i]); });
  const titles = {};
  released.forEach((r, i) => { if (details[i]?.title) titles[r.id] = details[i].title; });
  return { series, rows, summary, sitByInst, titles, reads, at: Date.now() };
}

/** The room's public data. Served warm from the door's prefetch when there is one. */
export function loadPublic(slug, { fresh = false } = {}) {
  const hit = cache.get(slug);
  if (!fresh && hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
  const promise = loadPublicUncached(slug);
  cache.set(slug, { at: Date.now(), promise });
  promise.catch(() => cache.delete(slug));
  return promise;
}

/** The door's prefetch: warm the public reads. Never throws. */
export function warmRoom(slug) {
  if (!slug) return;
  try { loadPublic(slug).catch(() => {}); } catch { /* best effort */ }
}

/** The reader's own place in an instalment, 0–1, or null. Owner-readable only. */
export async function readProgress(uid, inst) {
  if (!uid || !inst) return null;
  try {
    const snap = await get(ref(db, `${positionPath(uid, inst)}/fraction`));
    const v = snap.exists() ? Number(snap.val()) : null;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** Which instalments this reader has finished: { [inst]: ms }. Their own node; owner-readable. */
export async function readFinishedAll(uid) {
  if (!uid) return {};
  try {
    const snap = await get(ref(db, `series_finished/${uid}`));
    return snap.exists() && typeof snap.val() === 'object' ? snap.val() : {};
  } catch { return {}; }
}
