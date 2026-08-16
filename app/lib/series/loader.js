// SERIES LOADER — every public read. Never throws: failures log and return null or [].
//
// Same posture as app/lib/bookstore/loader.js. What differs is that this file reads TWO
// nodes with two different visibilities, and the split is the release gate:
//
//   series/{seriesId}                  public. Always readable.
//   series_instalments/{id}            public. The ROW. Always readable, released or not —
//                                      it is what a locked card prints.
//   series_instalments_detail/{id}     DENIED BY RULE until releaseAtMs. Readable only for
//                                      instalments that have actually arrived.
//
// A PERMISSION-DENIED ON THE DETAIL NODE IS NOT AN ERROR HERE. It is the gate working. So
// getInstalmentDetail() logs at debug volume and returns null, and every caller renders the
// locked state from the ROW alone. If that read started throwing loudly, the console on the
// landing page would fill with denials for every unreleased instalment on the site, and the
// one genuine failure would be invisible in the noise.
//
// WHAT THIS FILE MUST NEVER DO is decide entitlement. It reads what the rules let it read;
// app/lib/series/access.js decides what that means, and functions/api/series/stream.js is the
// only thing whose decision can hand over bytes.

import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { db } from '../firebase';
import { SCHEMA_VERSION, SERIES_PATH, INSTALMENTS_PATH, INSTALMENTS_DETAIL_PATH } from './schema';
import { instalmentsOf, isReleased, releasedCount } from './access';

/**
 * Schema migration hook, present from v1 on purpose.
 *
 * The bookstore learned this the expensive way — migrateTitle() had to be retrofitted to
 * promote v1 empty-string assets to v2 nulls across live records. Having the hook from the
 * first write means a future bump is a branch here rather than a sweep over call sites.
 */
export function migrateSeries(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  return doc.schemaVersion ? doc : { ...doc, schemaVersion: SCHEMA_VERSION };
}

function snapToRows(snap) {
  if (!snap.exists()) return [];
  const out = [];
  snap.forEach((child) => {
    out.push({ id: child.key, ...(child.val() || {}) });
    return false;
  });
  return out;
}

/** Every published series, newest-first by addedAt. The /series landing page's whole input. */
export async function getPublishedSeries() {
  try {
    const snap = await get(query(ref(db, SERIES_PATH), orderByChild('status'), equalTo('published')));
    return snapToRows(snap)
      .map((s) => ({ ...migrateSeries(s) }))
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } catch (err) {
    console.error('[series.loader] getPublishedSeries failed', err);
    return [];
  }
}

/**
 * EVERY series, drafts and withdrawn ones included. ADMIN SURFACES ONLY.
 *
 * Deliberately separate from getPublishedSeries() rather than a boolean on it, and for the
 * reason app/lib/bookstore/loader.js gives for keeping getTitlesByPublisher outside its
 * publisher-status filter: a reader-facing caller that reaches for the wrong function should
 * have to name it. `getAllSeries` in a public page is visible in review; `getPublishedSeries(
 * { includeDrafts: true })` is a flag someone flips while debugging and forgets.
 *
 * The series node is `.read: true`, so this exposes nothing a curl could not already see —
 * which is exactly why the sensitive half of an instalment lives in the detail node instead.
 */
export async function getAllSeries() {
  try {
    const snap = await get(ref(db, SERIES_PATH));
    return snapToRows(snap)
      .map((s) => ({ ...migrateSeries(s) }))
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } catch (err) {
    console.error('[series.loader] getAllSeries failed', err);
    return [];
  }
}

/** One series by its slug. The record's key IS its slug — see the schema note — so this is a
 *  direct read rather than an indexed query, unlike the bookstore's getTitleBySlug(). */
export async function getSeriesBySlug(slug) {
  if (!slug) return null;
  try {
    const snap = await get(ref(db, `${SERIES_PATH}/${slug}`));
    if (!snap.exists()) return null;
    const doc = migrateSeries(snap.val());
    if (doc?.status !== 'published') return null;
    return { id: slug, ...doc };
  } catch (err) {
    console.error(`[series.loader] getSeriesBySlug failed for ${slug}`, err);
    return null;
  }
}

/**
 * The public rows for one series, in ordinal order, each tagged `released`.
 *
 * Drafts are filtered out by instalmentsOf() — a draft is not a locked instalment, it is one
 * that does not exist yet, and printing "instalment 6, date to be confirmed" for a row an
 * editor is still drafting would promise a thing nobody has committed to.
 */
export async function getInstalments(seriesId, now = Date.now()) {
  if (!seriesId) return [];
  try {
    const snap = await get(query(ref(db, INSTALMENTS_PATH), orderByChild('seriesId'), equalTo(seriesId)));
    return instalmentsOf(snapToRows(snap), seriesId, now);
  } catch (err) {
    console.error(`[series.loader] getInstalments failed for ${seriesId}`, err);
    return [];
  }
}

/**
 * The detail record — title, author, cover — for a RELEASED instalment.
 *
 * Returns null when the rule denies it, which is the normal, expected answer for anything
 * unreleased. Callers must render from the row when this is null and must never treat null
 * as a failure. See the file header.
 */
export async function getInstalmentDetail(instalmentId) {
  if (!instalmentId) return null;
  try {
    const snap = await get(ref(db, `${INSTALMENTS_DETAIL_PATH}/${instalmentId}`));
    if (!snap.exists()) return null;
    return { id: instalmentId, ...(snap.val() || {}) };
  } catch (err) {
    // Deliberately quiet. A denial here is the release gate doing its job, and a landing page
    // listing eight unreleased instalments would otherwise print eight console errors.
    console.debug(`[series.loader] detail unavailable for ${instalmentId} (unreleased or denied)`);
    return null;
  }
}

/**
 * A series plus its rows plus its released detail, assembled for a detail page.
 *
 * The detail reads run in parallel and are individually allowed to fail — one denied row
 * must not blank the other seven. Deliberately fires only for rows that pass isReleased(),
 * so an unreleased instalment costs no request at all rather than costing a denial.
 */
export async function getSeriesPage(slug, now = Date.now()) {
  const series = await getSeriesBySlug(slug);
  if (!series) return null;

  const rows = await getInstalments(series.id, now);
  const details = await Promise.all(
    rows.map((r) => (isReleased(r, now) ? getInstalmentDetail(r.id) : Promise.resolve(null))),
  );

  return {
    series,
    releasedCount: releasedCount(rows, now),
    instalments: rows.map((r, i) => ({ ...r, detail: details[i] })),
  };
}

/** One public row by id. Direct read — the node is `.read: true` and the key is the id. */
export async function getInstalmentRow(instalmentId) {
  if (!instalmentId) return null;
  try {
    const snap = await get(ref(db, `${INSTALMENTS_PATH}/${instalmentId}`));
    if (!snap.exists()) return null;
    return { id: instalmentId, ...(snap.val() || {}) };
  } catch (err) {
    console.error(`[series.loader] getInstalmentRow failed for ${instalmentId}`, err);
    return null;
  }
}

/**
 * One instalment, its parent series, and its detail — the whole input to an instalment page.
 *
 * ── THE detail READ IS SKIPPED, NOT ATTEMPTED-AND-CAUGHT, WHEN UNRELEASED ────────────────
 *
 * Same construction as getSeriesPage() above and for a sharper reason here. This page's entire
 * upper half — logline, sponsor credit, cover, title — comes from `detail`. Firing the read
 * and letting the rule refuse it would work, but it would put the gate's correctness on the
 * far side of a network call: the page would be right because the server said no. Gating the
 * CALL on isReleased() means an unreleased instalment's page has no code path that so much as
 * asks for a logline, and the rule is the second of two independent refusals rather than the
 * only one.
 *
 * `released` is returned alongside rather than left to the caller to recompute, so the page
 * and the read agree about which clock they used.
 *
 * A row whose series is missing or unpublished resolves to null — the whole page, not a page
 * with a blank eyebrow. An instalment of a withdrawn series is not a thing to show.
 */
export async function getInstalmentPage(instalmentId, now = Date.now()) {
  const row = await getInstalmentRow(instalmentId);
  if (!row || row.status !== 'published') return null;

  const series = await getSeriesBySlug(row.seriesId);
  if (!series) return null;

  const released = isReleased(row, now);
  const detail = released ? await getInstalmentDetail(instalmentId) : null;

  return { row, series, detail, released };
}

/**
 * EVERY instalment row of a series, drafts and withdrawn ones included, in ordinal order.
 * ADMIN SURFACES ONLY — same split, same reason, as getAllSeries above.
 *
 * Note it does NOT tag `released`: an admin screen wants the raw status and the raw
 * releaseAtMs, and a derived boolean beside them invites reading the boolean instead of the
 * number that actually decides.
 */
export async function getAllInstalments(seriesId) {
  if (!seriesId) return [];
  try {
    const snap = await get(query(ref(db, INSTALMENTS_PATH), orderByChild('seriesId'), equalTo(seriesId)));
    return snapToRows(snap).sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  } catch (err) {
    console.error(`[series.loader] getAllInstalments failed for ${seriesId}`, err);
    return [];
  }
}
