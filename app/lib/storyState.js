// A STORY'S STATE, AND WHAT A CMS ACTION DOES TO IT — W6 (ADM-04, 05, 06, 07). Pure, so the rules
// are tested apart from the 1,300-line page that applies them.
//
// ONE status per story, derived from the record, and every surface of the CMS says the same one:
//
//   live            published (published !== false). A past publishAt is history, not a schedule.
//   scheduled       not published, publishAt in the future, not hidden
//   waiting_cover   held for its generated cover (coverHold) and not yet scheduled ahead
//   hidden          taken down by an editor (hiddenAt), or unpublished with no schedule ahead
//
// ADM-07: before W6 the editor treated ANY publishAt as a schedule, so a live story that had once
// been scheduled opened with "Schedule for later" ticked and a Schedule Story button, and the list
// badged it Scheduled and removed its View link. 48 live stories carry a past publishAt.

export const GENERATED_COVER_RE = /covers-typographic/;
export const hasGeneratedCover = (cover) => GENERATED_COVER_RE.test(String(cover || ''));

/** A story with no cover yet may not be scheduled sooner than this: covers take ~15 minutes. */
export const MIN_SCHEDULE_LEAD_WITHOUT_COVER_MS = 30 * 60 * 1000;

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

export function storyStatus(rec, now = Date.now()) {
  const r = rec || {};
  if (r.published !== false) return 'live';
  const at = ms(r.publishAt);
  if (r.hiddenAt) return 'hidden';
  if (at !== null && at > now) return 'scheduled';
  if (r.coverHold === true) return 'waiting_cover';
  return 'hidden';
}

const fmt = (v) => new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' });

/** The one line the editor and the list both show. */
export function statusLine(rec, now = Date.now()) {
  const r = rec || {};
  switch (storyStatus(r, now)) {
    case 'live': {
      const since = ms(r.publishAt) ?? (Number.isFinite(r.publishedAtMs) ? r.publishedAtMs : null);
      return since !== null && since <= now ? `Live since ${fmt(since)}` : 'Live';
    }
    case 'scheduled':
      return `Scheduled for ${fmt(r.publishAt)}${r.coverHold === true ? ' · waiting for its cover' : ''}`;
    case 'waiting_cover':
      return 'Waiting for its cover — publishes itself when the cover lands';
    default:
      return r.hiddenAt ? `Hidden since ${fmt(r.hiddenAt)}` : 'Hidden';
  }
}

/**
 * THE SCHEDULE REFUSAL (ADM-05, ruled 25 Sep: refuse a too-soon schedule). A story whose cover
 * has not been generated cannot be scheduled less than 30 minutes ahead: the cover is made
 * off-site, usually within fifteen minutes, and a schedule inside that window would reach its
 * time coverless. (If one does anyway — the cover worker late or red — the scheduled-publish
 * Worker skips it and raises an alert, rather than publishing it bare.)
 *
 * @returns {string|null} the refusal, or null when the schedule may stand
 */
export function scheduleRefusal({ publishAtMs, cover, now = Date.now() }) {
  if (!Number.isFinite(publishAtMs) || publishAtMs <= now) return null;
  if (hasGeneratedCover(cover)) return null;
  if (publishAtMs - now >= MIN_SCHEDULE_LEAD_WITHOUT_COVER_MS) return null;
  const earliest = new Date(now + MIN_SCHEDULE_LEAD_WITHOUT_COVER_MS)
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `✗ Not scheduled — this story has no cover yet. Covers are made off-site and usually take about fifteen minutes, `
    + `so a story without one can't be scheduled less than 30 minutes ahead. Choose ${earliest} (London) or later.`;
}

/**
 * UN-SCHEDULING (ADM-06). Unticking the schedule on a story that is SCHEDULED used to save it
 * hidden and report "✓ Story updated." It now needs a choice, and says which one it made.
 *
 * @param {'publish'|'hide'|null} choice
 * @returns {{ refusal: string|null, published: boolean|null, hide: boolean }}
 */
export function unscheduleDecision(choice) {
  if (choice === 'publish') return { refusal: null, published: true, hide: false };
  if (choice === 'hide') return { refusal: null, published: false, hide: true };
  return {
    refusal: '✗ Not saved — you removed this story\'s schedule. Choose what should happen instead: publish it now, or keep it hidden.',
    published: null, hide: false,
  };
}

/**
 * HIDE (ADM-04). Hide writes hiddenAt beside published:false. The scheduled-publish Worker skips
 * any story carrying hiddenAt, and the build does not prerender one, so a Hide lasts until an
 * editor unhides the story — not until the next fifteen-minute tick.
 */
export function hidePaths(id, now = Date.now()) {
  return {
    [`cms_stories/${id}/published`]: false,
    [`cms_stories/${id}/hiddenAt`]: now,
    [`cms_stories_index/${id}`]: null,
  };
}

/**
 * UNHIDE. Nothing goes live coverless: a story with a generated cover goes live now (the caller
 * adds its index entry); one without is HELD instead — coverHold, no hiddenAt — so the cover
 * reconciler gives it a cover and publishes it in the same patch.
 *
 * @returns {{ paths: object, live: boolean }}
 */
export function unhidePlan(id, rec) {
  const base = { [`cms_stories/${id}/hiddenAt`]: null };
  if (hasGeneratedCover(rec?.cover)) {
    return { live: true, paths: { ...base, [`cms_stories/${id}/published`]: true, [`cms_stories/${id}/coverHold`]: null } };
  }
  return { live: false, paths: { ...base, [`cms_stories/${id}/published`]: false, [`cms_stories/${id}/coverHold`]: true } };
}
