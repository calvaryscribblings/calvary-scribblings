// CONTINUE READING — the pure half (CR-2): what is started, what is hidden, what a card says.
// No React, no Firebase, so node --test holds every rule here (tests/ci/continue-reading.test.mjs).
// The contract is docs/CONTINUE-READING.md.
import { formFor } from '../../../scripts/push/forms.mjs';
import { grantFor } from '../storyAccess.js';
import { grantForInstalment } from '../series/access.js';
import { readingMinutes } from '../series/format.js';
import {
  ROW_MAX, SAVE_MIN_STEP, SAVE_MIN_INTERVAL_MS, isStorySlug, isInstalmentId,
} from './schema.js';

export const clampFraction = (x) => (typeof x === 'number' && Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);

/**
 * The reading thread's own measure: 0 when the article's top meets the viewport's top, 1 when its
 * bottom meets the viewport's bottom. The story page's thread draws exactly this number, and the
 * saved position IS this number, so a card's bar and the page's thread agree.
 */
export function threadFraction({ top, height }, scrollY, vh) {
  const range = height - vh;
  const p = range <= 0 ? (scrollY + vh >= top + height ? 1 : 0) : (scrollY - top) / range;
  return clampFraction(p);
}

/** Where to scroll so the thread reads `fraction` again: the inverse of threadFraction. */
export function scrollForFraction({ top, height }, vh, fraction) {
  const range = height - vh;
  if (range <= 0) return Math.max(0, top);
  return Math.max(0, Math.round(top + clampFraction(fraction) * range));
}

/**
 * Should this fraction be written now? The first write once the visit has passed the thresholds
 * (`last` is null); after that only when it has moved SAVE_MIN_STEP or more AND SAVE_MIN_INTERVAL_MS
 * has passed. `force` is the best-effort write on hide or close: any change at all.
 */
export function shouldSave(fraction, last, nowMs, { force = false } = {}) {
  if (!last) return true;
  const moved = Math.abs(fraction - last.fraction);
  if (force) return moved > 0;
  return moved >= SAVE_MIN_STEP - 1e-9 && nowMs - last.at >= SAVE_MIN_INTERVAL_MS;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * THE MERGE. Every started piece, newest first: the reader's story positions and their instalment
 * progress, less what is finished and what they ✕'d. A ✕ hides a card only until a LATER saved
 * position: hidden at or after the position's updatedAt hides it; a position saved after brings it
 * back (ruling, 28 Nov 2026). Nothing about liveness here: that needs the records (resolveCards).
 *
 *   positions       reading_position/{uid}          { stories: {slug: {fraction, updatedAt}}, hidden: {...} }
 *   seriesProgress  series_reading_progress/{uid}   { id: {fraction, updatedAt, cfi?, epubVersion?} }
 *   seriesFinished  series_finished/{uid}           { id: time }
 */
export function mergeEntries({ positions, seriesProgress, seriesFinished } = {}) {
  const hidden = positions?.hidden || {};
  const isHidden = (kind, id, updatedAt) => {
    const at = num((kind === 'story' ? hidden.stories : hidden.instalments)?.[id]);
    return at !== null && at >= updatedAt;
  };
  const out = [];
  for (const [id, rec] of Object.entries(positions?.stories || {})) {
    const updatedAt = num(rec?.updatedAt);
    if (!isStorySlug(id) || updatedAt === null || num(rec?.fraction) === null) continue;
    if (isHidden('story', id, updatedAt)) continue;
    out.push({ kind: 'story', id, fraction: clampFraction(rec.fraction), updatedAt });
  }
  const finished = seriesFinished || {};
  for (const [id, rec] of Object.entries(seriesProgress || {})) {
    const updatedAt = num(rec?.updatedAt);
    if (!isInstalmentId(id) || updatedAt === null || num(rec?.fraction) === null) continue;
    if (finished[id]) continue;
    if (isHidden('instalment', id, updatedAt)) continue;
    out.push({ kind: 'instalment', id, fraction: clampFraction(rec.fraction), updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** "N minutes left", "1 minute left"; null when there is no reading time to work from. */
export function minutesLeft(totalMinutes, fraction) {
  if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  return Math.max(1, Math.ceil(totalMinutes * (1 - clampFraction(fraction)) - 1e-9));
}
export const minutesLine = (n) => (n === 1 ? '1 minute left' : `${n} minutes left`);

/** The kind line: a story's form name (the push table, shared with the bell), or the Series' line. */
export function kindLine(entry) {
  if (entry.kind === 'instalment') return `The Series · Instalment ${entry.ordinal}`;
  return formFor(entry.category || '', entry.subcategory || '');
}

/**
 * A story's card state. 'open' (full access: the minutes), 'locked' (the archive preview: the
 * lock and "Members", still linking to /stories/{slug}).
 */
export function storyState(story, { tier = 'free', now = Date.now() } = {}) {
  return grantFor(story, { tier, now }).access === 'preview' ? 'locked' : 'open';
}

/**
 * An instalment's card state. 'open', 'locked' (a lapsed membership: tier_too_low, or its pass
 * twin, gets the same lock and "Members" as an archived story, ruling 28 Nov 2026), or null: not
 * released, unpublished or otherwise not a card at all, which drops silently.
 */
export function instalmentState(row, { subscriptionTier = 'free', effectiveTier = null, now = Date.now() } = {}) {
  const g = grantForInstalment(row, { subscriptionTier, effectiveTier, signedIn: true, now });
  if (g.access === 'granted') return 'open';
  if (g.code === 'tier_too_low' || g.code === 'pass_excluded') return 'locked';
  return null;
}

/**
 * The cards, from the merged entries and the records behind them. A story is a card only while it
 * is in `liveStories` (the index the homepage already holds, so a story that is unpublished,
 * hidden or retired has simply gone from it). An instalment is a card only when its row, its
 * series and its state say so; `instalments[id]` is { row, detail, series } or absent.
 * Kept to ROW_MAX, newest first.
 */
export function resolveCards(entries, { liveStories, instalments = {}, tier = 'free', subscriptionTier = 'free', now = Date.now() } = {}) {
  const byId = liveStories instanceof Map ? liveStories : new Map((liveStories || []).map((s) => [s.id, s]));
  const cards = [];
  for (const e of entries) {
    if (cards.length >= ROW_MAX) break;
    if (e.kind === 'story') {
      const s = byId.get(e.id);
      if (!s) continue;
      const state = storyState(s, { tier, now });
      const mins = minutesLeft(num(s.readTime), e.fraction);
      cards.push({
        key: `story:${e.id}`, kind: 'story', id: e.id, fraction: e.fraction, updatedAt: e.updatedAt,
        state, kindLine: kindLine({ kind: 'story', category: s.category, subcategory: s.subcategory }),
        title: s.title || '', writer: s.author || '',
        cover: s.cover || '', coverSizes: s.coverSizes, coverHash: s.coverHash,
        minutes: state === 'open' ? mins : null,
        href: `/stories/${e.id}`,
      });
      continue;
    }
    const rec = instalments[e.id];
    const row = rec?.row, series = rec?.series, detail = rec?.detail || null;
    if (!row || !series || row.status !== 'published' || series.status !== 'published') continue;
    const state = instalmentState(row, { subscriptionTier, effectiveTier: tier, now });
    if (!state) continue;
    const mins = minutesLeft(readingMinutes(detail?.wordCount), e.fraction);
    cards.push({
      key: `instalment:${e.id}`, kind: 'instalment', id: e.id, fraction: e.fraction, updatedAt: e.updatedAt,
      state, kindLine: kindLine({ kind: 'instalment', ordinal: row.ordinal }),
      title: series.title || '', writer: detail?.author || series.author || '',
      // An instalment with no cover of its own shows its series poster (ruling, 28 Nov 2026).
      cover: detail?.coverUrl || series.coverUrl || '',
      minutes: state === 'open' ? mins : null,
      // Open: straight into the Series reader, which resumes from series_reading_progress itself.
      // Locked: the instalment's page, which says what it takes to read it.
      href: state === 'open' ? `/series/read/${e.id}` : `/series/instalment/${e.id}`,
    });
  }
  return cards;
}
