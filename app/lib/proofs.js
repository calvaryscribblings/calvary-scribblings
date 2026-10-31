// PROOFS (rulings 249–258) — what a proof is, who may see it, and the words around it.
//
// Pure: imported by the /api/proofs Functions (server), /proofs (the writer's page) and
// /admin/proofs (the editors' queue), so the three can never disagree about any of it.
//
// ── WHAT IS A PROOF ─────────────────────────────────────────────────────────────────────
// A story that is SCHEDULED: not live (published === false), not hidden, with a go-live time
// still in the future — exactly storyStatus() === 'scheduled' (app/lib/storyState.js), the
// line the CMS itself prints. A story leaves Proofs the moment it goes live, because from that
// moment it is not 'scheduled' any more. Hidden, held-with-no-date, retired and draft stories
// are not proofs. A retired story always carries hiddenAt (W35), and the list also checks the
// retired marker itself.
//
// ── WHO SEES WHICH ──────────────────────────────────────────────────────────────────────
// A writer sees the proofs whose authorUid is their own uid, and nothing else (ruling 250).
// A founder sees every proof, grouped by writer (ruling 258), so Ikenna can check what each
// writer will see. While Proofs is closed (proofs_access/open !== true), a non-founder gets
// exactly what a reader with no proofs gets: nothing. The server decides all of this.
import { storyStatus } from './storyState.js';

/** The switch (ruling 258). Founder-read, founder-written; the server reads it on every call. */
export const PROOFS_ACCESS_PATH = 'proofs_access';
/** The reports. Server-written; founders may change the status; the report's writer reads it. */
export const PROOF_REPORTS_PATH = 'story_proof_reports';

export const SLUG_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** Is this record a proof right now? */
export const isProof = (rec, now = Date.now()) => !!rec && typeof rec === 'object' && storyStatus(rec, now) === 'scheduled';

/** The instant it goes live, in ms, or null. publishAt is an ISO string on the record. */
export function goLiveMs(rec) {
  const t = rec?.publishAt ? new Date(rec.publishAt).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/** May `uid` see this proof? (`founder` comes from the server's own check, never the client.) */
export const maySee = (rec, uid, { founder = false } = {}) =>
  !!uid && (founder || (typeof rec?.authorUid === 'string' && rec.authorUid !== '' && rec.authorUid === uid));

/**
 * The fields a proof list carries. Never the text: the list is titles and times; the text
 * comes one proof at a time.
 */
export function listEntry(slug, rec) {
  return {
    slug,
    title: typeof rec.title === 'string' ? rec.title : '',
    author: typeof rec.author === 'string' ? rec.author : '',
    authorUid: typeof rec.authorUid === 'string' ? rec.authorUid : null,
    category: rec.category || null,
    categoryName: rec.categoryName || null,
    subcategory: rec.subcategory || null,
    cover: rec.cover || null,
    coverSizes: rec.coverSizes || null,
    goLiveMs: goLiveMs(rec),
  };
}

/** Founders' view: proofs grouped by writer, each group and each list soonest first. */
export function groupByWriter(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.authorUid || '';
    if (!groups.has(key)) groups.set(key, { authorUid: e.authorUid, author: e.author, stories: [] });
    groups.get(key).stories.push(e);
  }
  const out = [...groups.values()];
  for (const g of out) g.stories.sort(bySoonest);
  out.sort((a, b) => bySoonest(a.stories[0], b.stories[0]));
  return out;
}
export const bySoonest = (a, b) => (a.goLiveMs ?? Infinity) - (b.goLiveMs ?? Infinity) || String(a.slug).localeCompare(String(b.slug));

// ── London time ────────────────────────────────────────────────────────────────────────
// "Saturday 1 November at 06:30" — the London calendar date and 24-hour time. The page always
// adds "London time" after it, so a writer abroad is never left to guess the zone.
export function londonWhen(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date.replace(',', '')} at ${time}`;
}

// ── Reports ────────────────────────────────────────────────────────────────────────────
export const REPORT_STATUSES = Object.freeze(['received', 'fixed', 'left']);
export const REPORT_MIN = 10;
export const REPORT_MAX = 2000;

/** Pure. Why a report may not be filed, as a code, or null. */
export function reportFault({ slug, message } = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return 'bad_request';
  if (typeof message !== 'string') return 'too_short';
  const m = message.trim();
  if (m.length < REPORT_MIN) return 'too_short';
  if (m.length > REPORT_MAX) return 'too_long';
  return null;
}

/** The caps (the limiter's buckets). Far above what a writer checking a proof ever does. */
export const reportBuckets = (uid) => [
  { scope: 'proofrep', period: 'minute', id: uid, limit: 3 },
  { scope: 'proofrep', period: 'day', id: uid, limit: 20 },
  { scope: 'proofrep', period: 'day', limit: 300 },
];

// ── THE WORDS ──────────────────────────────────────────────────────────────────────────
// Every line a writer or an editor reads, in one place. DRAFTS for Ikenna's ruling: words are
// his call. Change them here and nowhere else.
export const PROOFS_COPY = Object.freeze({
  pageTitle: 'Proofs',
  intro: 'Your stories that are scheduled but not yet live, exactly as they will publish.',
  founderIntro: 'Every scheduled story, grouped by writer. Each writer sees only their own.',
  signedOut: 'Sign in to see your proofs.',
  signIn: 'Sign in',
  loading: 'Opening your proofs…',
  empty: 'You have no stories waiting to go live. When one is scheduled, its proof will be here until it publishes.',
  failed: 'Your proofs couldn’t be opened just now. Please try again.',
  retry: 'Try again',
  goesLive: (when) => `Goes live ${when}, London time`,
  proofLabel: 'Proof',
  back: 'All proofs',
  notFound: 'This proof isn’t available. It may have gone live, or been moved.',
  reportButton: 'Report a discrepancy',
  reportHeading: 'Report a discrepancy',
  reportHelp: 'Tell us what doesn’t match your story: a word, a line break, the title, the cover. Your story still goes live on time; the editors will look before then if they can.',
  reportPlaceholder: 'What’s wrong, and where?',
  reportSend: 'Send to the editors',
  reportCancel: 'Cancel',
  reportSending: 'Sending…',
  reportSent: 'Sent. The editors have it, and you’ll see its status here.',
  reportTooShort: 'Please say a little more, so the editors can find it.',
  reportTooLong: `Please keep it under ${REPORT_MAX} characters.`,
  reportRateLimited: 'That’s a lot of reports at once. Please wait a minute and try again.',
  reportFailed: 'Your report couldn’t be sent. Please try again.',
  yourReports: 'Your reports on this story',
  status: { received: 'Received', fixed: 'Fixed', left: 'Left as it is' },
  // The editors' email (through _alerts.js: "[alert] " is prefixed to the subject).
  emailSubject: 'A writer reported a discrepancy in a proof',
  emailLines: ({ slug, when, reportId }) => [
    'A writer has reported a discrepancy in the proof of a scheduled story.',
    '',
    `Story: ${slug}`,
    `Goes live: ${when}, London time`,
    `Report: ${reportId}`,
    '',
    'Read it and set its status in the queue: https://calvaryscribblings.co.uk/admin/proofs',
    'The story is not held back. It goes live on time unless you change its schedule.',
  ],
  // /admin
  adminTitle: 'Proofs',
  adminIntro: 'Discrepancies writers have reported in their proofs, newest first. A report never holds a story back.',
  adminSwitchOpen: 'Proofs is open to writers.',
  adminSwitchClosed: 'Proofs is open to the founders only.',
  adminOpen: 'Open Proofs to writers',
  adminClose: 'Close Proofs to writers',
  adminEmpty: 'No reports yet.',
});
