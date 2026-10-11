// THE SERIES ADMIN'S DECISIONS AND ITS WORDS — W38 (ruling 140). Pure: no database, no clock it
// was not handed, no React. The admin page renders what these return, and admin-writes.js asks
// the same needsFor() before it publishes, so the checklist an editor sees and the refusal the
// writer gives can never disagree.
//
// ── NOTHING HERE PRINTS A NUMBER A PERSON DID NOT CHOOSE TO READ ────────────────────────
// No epoch milliseconds, no instalment id, no raw status word. Times are London wall time
// (app/lib/londonTime.js), states are the four a reader would recognise, and an instalment is
// "instalment 3", never "beta-princess-i3".

import { PROVISIONAL_RELEASE_MS } from './schema.js';
import { readingMinutes } from './format.js';
import { londonShort, londonClock, londonLongDate, londonDaysUntil } from '../londonTime.js';

// ── STATES, AS READERS SEE THEM ──────────────────────────────────────────────────────────
//   Draft       status draft
//   Scheduled   published, release still ahead
//   Live        published and released
//   Taken down  unpublished
export const STATE_LABEL = { draft: 'Draft', scheduled: 'Scheduled', live: 'Live', 'taken-down': 'Taken down' };

export function instalmentState(row, now = Date.now()) {
  const r = row || {};
  if (r.status === 'unpublished') return 'taken-down';
  if (r.status !== 'published') return 'draft';
  return typeof r.releaseAtMs === 'number' && r.releaseAtMs > now ? 'scheduled' : 'live';
}

/** A series is Draft, Live or Taken down. */
export function seriesState(series) {
  const st = series?.status;
  if (st === 'published') return 'live';
  if (st === 'unpublished') return 'taken-down';
  return 'draft';
}
export const SERIES_CHIP = { draft: 'Draft', live: 'Live on the site', 'taken-down': 'Taken down' };
export const SERIES_LIST_CHIP = { draft: 'Draft', live: 'Live', 'taken-down': 'Taken down' };

const pendingOf = (detail) => (detail && detail.choicesPending) || {};
export const tierChosen = (detail) => !pendingOf(detail).freeForGold;

/** "Gold and Platinum", "Platinum only" or "Not chosen". */
export function tierLabel(row, detail) {
  if (!tierChosen(detail)) return 'Not chosen';
  return row?.freeForGold === true ? 'Gold and Platinum' : 'Platinum only';
}

/**
 * The editor's answer to "When it goes live", as it stands.
 *   { mode: null }                       not chosen (a new draft)
 *   { mode: 'publish' }                  as soon as I publish
 *   { mode: 'date', ms }                 on a date (London wall time, stored as epoch ms)
 * A record from before W38 carries no flags and its row holds a chosen date.
 */
export function releaseChoice(row, detail) {
  if (pendingOf(detail).releaseAtMs) return { mode: null };
  if (detail?.releaseWhen === 'publish') return { mode: 'publish' };
  const ms = row?.releaseAtMs;
  if (typeof ms !== 'number' || ms === PROVISIONAL_RELEASE_MS) return { mode: null };
  return { mode: 'date', ms };
}

export const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean)
  .map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const has = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * "Before it goes live" — the checklist, and whether the button may be pressed.
 *
 * `series` is the parent record. When it is still a draft, its poster and synopsis are needed
 * too, because the instalment's publish takes the series live in the same write.
 *
 *   → { needed: [item], optional: [item], left, mode, releaseMs, seriesGoesLive }
 *     item = { key, label, done, detail }
 */
export function needsFor({ series, row, detail, now = Date.now() }) {
  const d = detail || {};
  const choice = releaseChoice(row, d);
  const seriesGoesLive = seriesState(series) === 'draft';

  let when;
  if (choice.mode === 'publish') when = { done: true, detail: 'As soon as you publish' };
  else if (choice.mode === 'date' && choice.ms > now) when = { done: true, detail: `${londonShort(choice.ms)} London` };
  else if (choice.mode === 'date') when = { done: false, detail: 'That time has passed' };
  else when = { done: false, detail: 'Choose one' };

  const wordsLine = Number.isInteger(d.wordCount) && d.wordCount > 0 ? `${d.wordCount.toLocaleString('en-GB')} words` : 'Uploaded';
  const needed = [
    { key: 'title', label: 'Title', done: has(d.title), detail: has(d.title) ? d.title : 'Still needed' },
    { key: 'writer', label: 'Writer', done: has(d.author) && has(d.authorUid) && has(d.authorHandle), detail: has(d.author) ? d.author : 'Still needed' },
    { key: 'epub', label: 'EPUB', done: has(d.epubPath), detail: has(d.epubPath) ? wordsLine : 'Still needed' },
    { key: 'cover', label: 'Cover', done: has(d.coverUrl), detail: has(d.coverUrl) ? 'Added' : 'Still needed' },
    { key: 'tier', label: 'Who can read it', done: tierChosen(d), detail: tierChosen(d) ? tierLabel(row, d) : 'Choose one' },
    { key: 'when', label: 'When', ...when },
  ];
  if (seriesGoesLive) {
    needed.push(
      { key: 'poster', label: 'Series poster', done: has(series?.coverUrl), detail: has(series?.coverUrl) ? 'Added' : 'Still needed' },
      { key: 'seriesSynopsis', label: 'Series synopsis', done: has(series?.synopsis), detail: has(series?.synopsis) ? 'Added' : 'Still needed' },
    );
  }
  const optional = [
    { key: 'sponsor', label: 'Sponsor', done: has(d.sponsorName), detail: has(d.sponsorName) ? d.sponsorName : 'None' },
    { key: 'logline', label: 'Logline', done: has(d.logline), detail: has(d.logline) ? 'Added' : 'None' },
    { key: 'synopsis', label: 'Synopsis', done: has(d.synopsis), detail: has(d.synopsis) ? 'Added' : 'None' },
  ];
  const left = needed.filter((n) => !n.done).length;
  return {
    needed, optional, left, seriesGoesLive,
    mode: choice.mode, releaseMs: choice.mode === 'date' ? choice.ms : null,
  };
}

/** "Publish now", "Schedule for Wed 14 Oct, 08:00", "3 things left", "1 thing left". */
export function publishButtonLabel(needs) {
  if (needs.left > 0) return needs.left === 1 ? '1 thing left' : `${needs.left} things left`;
  if (needs.mode === 'date') return `Schedule for ${londonShort(needs.releaseMs)}`;
  return 'Publish now';
}

/** The "Pressing it" lines under the button. */
export function pressingIt(needs, ordinal) {
  if (needs.mode === 'date') {
    return [
      `Saves instalment ${ordinal} as scheduled.`,
      'Builds its page on the site, in about two minutes.',
      `Opens it to readers at ${londonClock(needs.releaseMs)} London on ${londonLongDate(needs.releaseMs)}.`,
    ];
  }
  return [
    `Publishes instalment ${ordinal}.`,
    'Builds its page on the site, in about two minutes.',
    'Checks the page opens, then tells you.',
  ];
}

/** "Goes live in 3 days, at 08:00 London time." — today and tomorrow are said as words. */
export function goesLiveLine(ms, now = Date.now()) {
  const n = londonDaysUntil(ms, now);
  const when = n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  return `Goes live ${when}, at ${londonClock(ms)} London time.`;
}

const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The one plain line under a series on the list.
 *   "2 instalments live · instalment 3 in draft"
 *   "Not on the site · needs its poster and a first instalment"
 * `items` is [{ row, detail }] for the series' instalments.
 */
export function seriesSummary(series, items, now = Date.now()) {
  const st = seriesState(series);
  const rows = (items || []).map((x) => x.row).filter(Boolean).sort((a, b) => a.ordinal - b.ordinal);
  const by = (s) => rows.filter((r) => instalmentState(r, now) === s);
  const parts = [];
  if (st === 'draft') {
    const needs = [];
    if (!has(series?.coverUrl)) needs.push('its poster');
    if (!has(series?.synopsis)) needs.push('its synopsis');
    if (!rows.length) needs.push('a first instalment');
    parts.push('Not on the site');
    if (needs.length) parts.push(`needs ${joinAnd(needs)}`);
  } else if (st === 'taken-down') {
    parts.push('Off the site');
  }
  const live = by('live').length;
  if (live) parts.push(`${live} ${live === 1 ? 'instalment' : 'instalments'} live`);
  for (const r of by('scheduled')) parts.push(`instalment ${r.ordinal} scheduled for ${londonShort(r.releaseAtMs)}`);
  for (const r of by('draft')) parts.push(`instalment ${r.ordinal} in draft`);
  for (const r of by('taken-down')) parts.push(`instalment ${r.ordinal} taken down`);
  if (!parts.length) parts.push('No instalments yet');
  return parts.join(' · ');
}

/** The sub-line on an instalment row: reading time and sponsor, or what a draft still needs. */
export function rowSubline({ series, row, detail, now = Date.now() }) {
  if (instalmentState(row, now) === 'draft') {
    const n = needsFor({ series, row, detail, now });
    const missing = n.needed.filter((x) => !x.done).map((x) => x.label.toLowerCase());
    if (missing.length) return { text: `Still needed: ${missing.join(', ')}`, amber: true };
    return { text: 'Ready to publish', amber: false };
  }
  const parts = [];
  const m = readingMinutes(detail?.wordCount);
  if (m) parts.push(`About ${m} min`);
  if (has(detail?.sponsorName)) parts.push(`Sponsored by ${detail.sponsorName}`);
  return { text: parts.join(' · '), amber: false };
}

/** The live panel's audience line. */
export const audienceLine = (row) => (row?.freeForGold === true
  ? 'Gold and Platinum members can read it.'
  : 'Platinum members can read it.');
