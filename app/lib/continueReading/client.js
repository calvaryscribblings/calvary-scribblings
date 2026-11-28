// CONTINUE READING — the database half (CR-2): the reads the row makes, and the writes the story page
// and the ✕ make. Every path is built from an id that has passed its pattern first (LIVE-PATHS-1):
// the uid through app/lib/ids.js, a slug or instalment id through ./schema.js. A bad id reads
// nothing and writes nothing; it never throws into a page.
//
// EVERY WRITE FAILS QUIETLY. A refused or offline write resolves false and logs nothing a reader
// sees: the story page must read exactly as it did before this round, whatever the database says.
import { ref, get, set, remove, serverTimestamp } from 'firebase/database';
import { isId } from '../ids.js';
import { PROGRESS_PATH, INSTALMENTS_PATH, INSTALMENTS_DETAIL_PATH, SERIES_PATH } from '../series/schema.js';
import { POSITION_PATH, positionPath, hiddenPath, isStorySlug, isInstalmentId, ROW_MAX } from './schema.js';
import { mergeEntries } from './model.js';

const FINISHED_PATH = 'series_finished';
const val = (p) => p.then((s) => (s.exists() ? s.val() : null)).catch(() => null);

/** The reader's own three records, merged (finished and ✕'d dropped), newest first. */
export async function loadEntries(db, uid) {
  if (!isId('uid', uid)) return [];
  const [positions, seriesProgress, seriesFinished] = await Promise.all([
    val(get(ref(db, `${POSITION_PATH}/${uid}`))),
    val(get(ref(db, `${PROGRESS_PATH}/${uid}`))),
    val(get(ref(db, `${FINISHED_PATH}/${uid}`))),
  ]);
  return mergeEntries({ positions, seriesProgress, seriesFinished });
}

/**
 * For each started instalment, at most three reads: its row, its detail (refused before release,
 * which reads as null) and its series. Only the instalments that could still make the row
 * (the first ROW_MAX of them, newest first) are read at all.
 */
export async function loadInstalments(db, entries) {
  const ids = entries.filter((e) => e.kind === 'instalment' && isInstalmentId(e.id)).slice(0, ROW_MAX).map((e) => e.id);
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const [row, detail] = await Promise.all([
      val(get(ref(db, `${INSTALMENTS_PATH}/${id}`))),
      val(get(ref(db, `${INSTALMENTS_DETAIL_PATH}/${id}`))),
    ]);
    if (!row || !isInstalmentId(row.seriesId)) return;
    const series = await val(get(ref(db, `${SERIES_PATH}/${row.seriesId}`)));
    if (series) out[id] = { row, detail, series };
  }));
  return out;
}

/** The ✕: hidden at the server's time. A later saved position brings the card back. */
export async function hideCard(db, uid, kind, id) {
  if (!isId('uid', uid)) return false;
  if (kind === 'instalment' ? !isInstalmentId(id) : !isStorySlug(id)) return false;
  try { await set(ref(db, hiddenPath(uid, kind, id)), serverTimestamp()); return true; } catch { return false; }
}

/** The story page's write: { fraction, updatedAt: server time }. */
export async function savePosition(db, uid, slug, fraction) {
  if (!isId('uid', uid) || !isStorySlug(slug)) return false;
  try { await set(ref(db, positionPath(uid, slug)), { fraction, updatedAt: serverTimestamp() }); return true; } catch { return false; }
}

/** At the end-of-story marker: the record goes, not kept at 100%. */
export async function clearPosition(db, uid, slug) {
  if (!isId('uid', uid) || !isStorySlug(slug)) return false;
  try { await remove(ref(db, positionPath(uid, slug))); return true; } catch { return false; }
}

/** The reader's own saved place in one story, or null. */
export async function readPosition(db, uid, slug) {
  if (!isId('uid', uid) || !isStorySlug(slug)) return null;
  const rec = await val(get(ref(db, positionPath(uid, slug))));
  return rec && typeof rec.fraction === 'number' ? rec : null;
}
