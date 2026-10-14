// READERS' NOTES FOR THE SERIES — the contract, as code. W46, rulings 157–166.
//
// One module, imported by the Pages Function (functions/api/series/notes.js), by every web
// surface (the door on /series, the room at /series/{slug}/notes, the last-page sheet, the admin)
// and by `node --test`. It holds no I/O and imports nothing but the access policy's pure release
// check, so the endpoint and the screens cannot drift into two readings of one rule.
//
// The written form of this contract — the one the app builds against — is docs/series-notes.md.
// Change one, change the other.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THE WHOLE FEATURE STANDS ON (ruling 160)
//
// Nobody sees an instalment's notes until they have finished it. That is enforced by the RTDB
// rules, not by these screens: every gated node's `.read` asks for series_finished/{uid}/{inst},
// and the notes themselves additionally for series_room_members/{inst}/{uid}, which only the
// endpoint writes. A screen that forgot to check would get a permission_denied, not a spoiler.
// What is PUBLIC is exactly: the Sit with this question (spoiler-free by ruling 162) and the
// numbers in series_notes_summary — counts, timestamps and faces, never a word a reader wrote.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { isReleased } from './access.js';

// ── §0 THE FLAG ─────────────────────────────────────────────────────────────────────────────
//
// The platform's launch-flag pattern (BOOK_TRANSITION_SHIPPED, READERS_CHOICE_ENABLED): an
// exported constant, read by every surface and by the endpoint, flipped by one commit.
//
// What it gates: every READER surface (the door, the room, the last-page sheet, "This is my
// line") and every READER action on the endpoint. What it does not gate: the admin's
// "Readers' Notes" section and the founders' endpoint actions (draft-questions,
// publish-questions, review), because the questions are drafted before the doors open.
export const SERIES_NOTES_ENABLED = true;

/**
 * The flag as every surface and the endpoint ask it. Test builds may override the constant in
 * EITHER direction, so the off path stays provable after launch (a rollback is one edit, and the
 * flag-off suites must still be able to show what it would ship):
 *   · an endpoint test passes env.SERIES_NOTES_TEST = '1' (on) or '0' (off);
 *   · a local `next build` / `next dev` sets NEXT_PUBLIC_SERIES_NOTES_PREVIEW = '1' or '0'
 *     (inlined at build time).
 * Cloudflare's build and the Pages runtime set neither, so in production this is the constant.
 */
export function notesEnabled(env) {
  const forced = env && env.SERIES_NOTES_TEST;
  if (forced === '1') return true;
  if (forced === '0') return false;
  let preview = '';
  // try: workerd has no `process`; Next replaces the whole member expression at build time.
  try { preview = process.env.NEXT_PUBLIC_SERIES_NOTES_PREVIEW || ''; } catch { preview = ''; }
  if (preview === '1') return true;
  if (preview === '0') return false;
  return SERIES_NOTES_ENABLED;
}

// ── PATHS ───────────────────────────────────────────────────────────────────────────────────
export const NOTES_PATHS = Object.freeze({
  finished: 'series_finished',                 // /{uid}/{inst}: ms
  questionsPublic: 'series_questions_public',  // /{inst}: {sit, publishedAt}
  questions: 'series_questions',               // /{inst}: {sit, side, line, publishedAt}
  drafts: 'series_question_drafts',            // /{inst}: {sit, side, line, updatedAt, ...}
  members: 'series_room_members',              // /{inst}/{uid}: ms
  sides: 'series_sides',                       // /{inst}/{uid}: 'a'..'d'
  tallies: 'series_side_tallies',              // /{inst}: {a:n, ...}
  notes: 'series_notes',                       // /{inst}/{noteId}
  held: 'series_notes_held',                   // /{inst}/{noteId}
  replies: 'series_note_replies',              // /{inst}/{noteId}/{replyId}
  underlines: 'series_note_underlines',        // /{inst}/{noteId}/{uid}: true
  reports: 'series_note_reports',              // /{inst}/{noteId}/{uid}: {at, reason?}
  margin: 'series_margin',                     // /{uid}/{inst}: {text, cfi, epubVersion, savedAt}
  summary: 'series_notes_summary',             // /{sid}
});

// ── KINDS AND LIMITS ────────────────────────────────────────────────────────────────────────
// Ruling 159: one question of each kind. 'else' is the always-offered fourth card.
export const NOTE_KINDS = Object.freeze(['side', 'sit', 'line', 'else']);
export const QUESTION_KINDS = Object.freeze(['sit', 'side', 'line']); // the admin's slot order
export const SIDE_OPTIONS = Object.freeze(['a', 'b', 'c', 'd']);
export const SIDE_MIN = 2;
export const SIDE_MAX = 4;

export const NOTE_MAX = 500;
export const REPLY_MAX = 300;
export const LINE_MAX = 400;
export const QUESTION_MAX = 280;
export const OPTION_MAX = 60;
export const REPORT_REASON_MAX = 200;
export const CFI_MAX = 1024;
export const EPUB_VERSION_MAX = 128;

/** The counter shows only near the limit (§6). */
export const COUNTER_FROM = 0.8;
/** Long notes fold after six lines behind "Read more". */
export const NOTE_FOLD_LINES = 6;
/** Replies fold after two behind "View N more replies". */
export const REPLIES_SHOWN = 2;
/** Notes load twenty at a time. */
export const PAGE_SIZE = 20;
/** The door's faces. */
export const FACES_MAX = 4;
/** How many note timestamps the public summary keeps, for the door's "{n} new". */
export const LATEST_KEPT = 50;

// ── RATE LIMITS (§2) — chosen W46, charged through functions/api/_ratelimit.js ──────────────
//
// THE DERIVATION. A reader who has just finished an instalment answers three questions, maybe
// writes "anything else", and replies to a handful of notes: perhaps ten writes in a sitting.
// The per-minute cap is twice the fastest plausible human (one post every ~6s), the per-day cap
// several sittings over. The global caps are the cost ceiling: every note and reply is one Haiku
// screening call, every draft one Sonnet call over a whole instalment.
export const NOTES_CAPS = Object.freeze({
  post: { minute: 10, day: 80, globalDay: 5000 },     // note + reply, screened
  side: { minute: 20, day: 200 },                     // a tap, and "Choose again"
  remove: { minute: 30, day: 300 },
  draft: { globalDay: 40 },                           // founders, one model call each
});

// ── THE WORDS (all approved; copy exactly) ──────────────────────────────────────────────────
export function romanOf(n) {
  let x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < 1 || x > 3999) return String(n ?? '');
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) { while (x >= v) { out += s; x -= v; } }
  return out;
}
/** {N} in the approved copy: "Instalment IV". */
export const instName = (ordinal) => `Instalment ${romanOf(ordinal)}`;

export const QUESTION_LABEL = Object.freeze({
  side: 'Take a side',
  sit: 'Sit with this',
  line: 'The line',
  else: 'Anything else',
});

export const NOTES_COPY = Object.freeze({
  kicker: 'READERS’ NOTES',
  stepInside: 'Step inside',
  elseCard: (N) => `Or tell us about anything else from ${N} that stayed with you.`,
  elseQuestion: (N) => `Something else from ${N} that stayed with them`,
  answers: (n) => `${n} ${n === 1 ? 'answer' : 'answers'}`,
  newSince: (n) => `${n} new`,
  opensOn: (label) => `Opens ${label}`,
  firstQuestions: (date) => `The first three questions arrive with instalment I, on ${date}.`,
  heroCounts: (n, m) => `${n} ${n === 1 ? 'note' : 'notes'} · ${m} ${m === 1 ? 'reader' : 'readers'}`,
  sealed: 'Sealed',
  partway: (N) => `You’re partway through ${N}.`,
  sealedBody: (n) => `The room opens on the last page, so nothing in here can spoil it. ${n} ${n === 1 ? 'note is' : 'notes are'} waiting for you.`,
  continueReading: (N) => `Continue reading ${N}`,
  theNotes: 'The notes',
  filters: Object.freeze({ all: 'All', side: 'Take a side', sit: 'Sit with this', line: 'The line', else: 'Anything else' }),
  sortUnderlined: 'Most underlined',
  sortNewest: 'Newest',
  tookASide: (side) => `TOOK A SIDE · ${String(side).toUpperCase()}`,
  readInPlace: 'Read it in its place',
  writerMark: 'WRITER',
  underline: (n) => `Underline · ${n}`,
  underlined: 'Underlined',
  reply: 'Reply',
  copyLink: 'Copy link',
  report: 'Report',
  delete: 'Delete',
  remove: 'Remove',
  replyingTo: (handle) => `Replying to @${handle}`,
  moreReplies: (n) => `View ${n} more ${n === 1 ? 'reply' : 'replies'}`,
  replyRemoved: 'This reply was removed.',
  notSent: 'Not sent.',
  tryAgain: 'Try again',
  composerBar: (N) => `Leave a note on ${N}…`,
  leaveNote: 'Leave a note',
  whyTheyChose: 'Why they chose',
  mostChosen: 'Most chosen',
  yourLine: 'Your line',
  newNotes: (n) => `${n} new ${n === 1 ? 'note' : 'notes'}`,
  readMore: 'Read more',
  // §5 — the last page
  endOf: (roman) => `END OF INSTALMENT ${roman}`,
  sideStep: 'TAKE A SIDE · 1 OF 3',
  chooseAndSee: (n) => `Choose, and see how ${n} ${n === 1 ? 'reader' : 'readers'} split.`,
  youreWith: (p, n) => `You’re with ${p}% of ${n} ${n === 1 ? 'reader' : 'readers'}.`,
  sayWhy: (side) => `Say why you chose ${side}`,
  stepInsideMore: (n) => `Step inside: two more questions, ${n} ${n === 1 ? 'note' : 'notes'}`,
  chooseAgain: 'Choose again',
  notNow: 'Not now',
  thisIsMyLine: 'This is my line',
  // §6 — writing
  whatAbout: 'What would you like to write about?',
  addLine: (N) => `Add a line from ${N}`,
  onlyFinishers: (N) => `Only readers who’ve finished ${N} will see this.`,
  post: 'Post',
  waitingReview: 'Waiting for a quick review',
  // §7 — the admin
  adminSection: 'Readers’ Notes',
  adminSit: 'Sit with this: spoiler-free, shows on the door',
  adminSide: 'Take a side: 2–4 sides',
  adminLine: 'The line',
  publishQuestions: 'Publish questions',
  draftFromText: 'Draft three from the text',
  checklist: (n) => `Questions: ${n} of 3 ready`,
});

/** "Freedom, 58 percent, your side" — the bars carry text (accessibility). */
export function barLabel(option, percent, mine) {
  return `${option}, ${percent} percent${mine ? ', your side' : ''}`;
}

// ── THE DOOR ────────────────────────────────────────────────────────────────────────────────
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The light under the door follows the room's lastAt (§3). */
export function doorLight(lastAt, now = Date.now()) {
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt) || lastAt <= 0) return 'none';
  const age = now - lastAt;
  if (age <= 6 * HOUR) return 'bright';
  if (age <= 48 * HOUR) return 'soft';
  return 'faint';
}
/** The light breathes only within an hour of a note (and never under reduced motion). */
export function doorBreathes(lastAt, now = Date.now()) {
  return typeof lastAt === 'number' && lastAt > 0 && now - lastAt <= HOUR && now >= lastAt;
}

/**
 * "Opens Friday", or the date if it's more than a week away. London weekday, because the
 * Series releases on the London calendar like every other date on the platform.
 */
export function opensLabel(releaseAtMs, now = Date.now()) {
  if (typeof releaseAtMs !== 'number' || !Number.isFinite(releaseAtMs)) return null;
  if (releaseAtMs - now > 7 * DAY) {
    return new Date(releaseAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });
  }
  return new Date(releaseAtMs).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
}

/** How many of the summary's note timestamps are newer than this device's last visit. */
export function newSince(latestNotes, lastVisitMs) {
  if (!Array.isArray(latestNotes)) return 0;
  if (typeof lastVisitMs !== 'number' || !(lastVisitMs > 0)) return 0;
  return latestNotes.filter((t) => typeof t === 'number' && t > lastVisitMs).length;
}

/** The device-kept "last stepped inside" key, per series. */
export const lastVisitKey = (seriesId) => `cs_notes_seen_${seriesId}`;

/**
 * The door's state for one series, from public data only.
 *   rows: the series' instalment rows (public), summary: series_notes_summary/{sid} or null,
 *   sitByInst: { [inst]: sit } from series_questions_public.
 * Returns { phase: 'closed', opensLabel, firstDate } | { phase: 'open', inst, ordinal, sit, answers, faces, lastAt, light, notes }
 */
export function doorState({ rows = [], summary = null, sitByInst = {}, now = Date.now() }) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.status === 'published');
  const released = list.filter((r) => isReleased(r, now)).sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  if (released.length === 0) {
    const first = list.slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0))[0] || null;
    const at = first && typeof first.releaseAtMs === 'number' ? first.releaseAtMs : null;
    return {
      phase: 'closed',
      opensLabel: at ? opensLabel(at, now) : null,
      firstDate: at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }) : null,
    };
  }
  // The latest released instalment WITH a published Sit question leads the door; failing
  // that, the latest released one, shown without a question (§3, "no published questions yet").
  const withQ = released.filter((r) => typeof sitByInst[r.id] === 'string' && sitByInst[r.id]);
  const lead = (withQ.length ? withQ : released)[(withQ.length ? withQ : released).length - 1];
  const byInst = (summary && summary.byInst) || {};
  const stats = byInst[lead.id] || {};
  const lastAt = typeof summary?.lastAt === 'number' ? summary.lastAt : null;
  return {
    phase: 'open',
    inst: lead.id,
    ordinal: lead.ordinal,
    sit: typeof sitByInst[lead.id] === 'string' && sitByInst[lead.id] ? sitByInst[lead.id] : null,
    answers: Number(stats.kinds?.sit) || 0,
    notes: Number(stats.notes) || 0,
    faces: Array.isArray(summary?.faces) ? summary.faces.slice(0, FACES_MAX) : [],
    lastAt,
    light: doorLight(lastAt, now),
    breathes: doorBreathes(lastAt, now),
  };
}

// ── QUESTIONS ───────────────────────────────────────────────────────────────────────────────
const isStr = (v) => typeof v === 'string';
const clean = (v) => (isStr(v) ? v.replace(/\s+/g, ' ').trim() : '');

/** The side's options in order, present ones only: [['a','Freedom'], ['b','Duty'], ...]. */
export function sideOptions(side) {
  const o = side && typeof side.options === 'object' && side.options ? side.options : {};
  return SIDE_OPTIONS.filter((k) => clean(o[k])).map((k) => [k, clean(o[k])]);
}

/** Per-slot readiness. A slot is ready when it would publish as written. */
export function slotReady(kind, q) {
  if (kind === 'sit' || kind === 'line') {
    const t = clean(q);
    return t.length > 0 && t.length <= QUESTION_MAX;
  }
  if (kind === 'side') {
    const t = clean(q?.text);
    if (!t || t.length > QUESTION_MAX) return false;
    const opts = sideOptions(q);
    // Options must be contiguous from 'a' — a,b,d is refused so a tally key never skips.
    const keys = opts.map(([k]) => k);
    if (keys.join('') !== SIDE_OPTIONS.slice(0, keys.length).join('')) return false;
    return opts.length >= SIDE_MIN && opts.length <= SIDE_MAX && opts.every(([, v]) => v.length <= OPTION_MAX);
  }
  return false;
}

/** "Questions: n of 3 ready". */
export function readyCount(draft) {
  if (!draft) return 0;
  return QUESTION_KINDS.filter((k) => slotReady(k, draft[k])).length;
}

/**
 * The publishable form of a draft, or { error }. All three, or nothing: a room that opened on
 * two questions would be a different product from the one ruled (159).
 */
export function publishableQuestions(draft, now = Date.now()) {
  if (readyCount(draft) !== 3) return { error: 'All three questions must be ready.' };
  const options = Object.fromEntries(sideOptions(draft.side));
  return {
    questions: {
      sit: clean(draft.sit),
      side: { text: clean(draft.side.text), options },
      line: clean(draft.line),
      publishedAt: now,
    },
    public: { sit: clean(draft.sit), publishedAt: now },
  };
}

// ── NOTES ───────────────────────────────────────────────────────────────────────────────────
/** Strip control characters, normalise line endings, collapse runs of blank lines. */
export function normaliseText(v) {
  if (!isStr(v)) return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const lengthOf = (s) => Array.from(s).length;

/** The line a reader chose: { text ≤400, cfi, epubVersion } or an error. */
export function checkLine(line) {
  if (line == null) return { ok: true, line: null };
  if (typeof line !== 'object') return { ok: false, error: 'bad_line' };
  const text = clean(line.text);
  if (!text || lengthOf(text) > LINE_MAX) return { ok: false, error: 'bad_line' };
  if (!isStr(line.cfi) || !line.cfi || line.cfi.length > CFI_MAX) return { ok: false, error: 'bad_line' };
  const ev = line.epubVersion;
  if (!isStr(ev) || !ev || ev.length > EPUB_VERSION_MAX) return { ok: false, error: 'bad_line' };
  return { ok: true, line: { text, cfi: line.cfi, epubVersion: ev } };
}

/**
 * A note as the endpoint receives it. Returns { ok, note: {kind, text, side?, line?} } or
 * { ok:false, error }. `side` for a 'side' note is the reader's recorded side, passed in by the
 * endpoint (never trusted from the body).
 */
export function checkNoteInput({ kind, text, line } = {}, { recordedSide = null } = {}) {
  if (!NOTE_KINDS.includes(kind)) return { ok: false, error: 'bad_kind' };
  const t = normaliseText(text);
  const n = lengthOf(t);
  if (n < 1) return { ok: false, error: 'empty' };
  if (n > NOTE_MAX) return { ok: false, error: 'too_long' };
  const out = { kind, text: t };
  if (kind === 'side') {
    if (!SIDE_OPTIONS.includes(recordedSide)) return { ok: false, error: 'no_side' };
    out.side = recordedSide;
  }
  if (kind === 'line') {
    const l = checkLine(line);
    if (!l.ok || !l.line) return { ok: false, error: 'bad_line' };
    out.line = l.line;
  } else if (line != null) {
    // "Add a line from {N}" is offered on the line's composer only (§5).
    return { ok: false, error: 'bad_line' };
  }
  return { ok: true, note: out };
}

export function checkReplyInput({ text } = {}) {
  const t = normaliseText(text);
  const n = lengthOf(t);
  if (n < 1) return { ok: false, error: 'empty' };
  if (n > REPLY_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, text: t };
}

/** The author snapshot — the same identity the Square shows. */
export function authorSnapshot(profile, uid) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const name = clean(p.displayName || p.name) || 'Reader';
  const out = { name: name.slice(0, 80), handle: clean(p.handle || p.username).replace(/^@+/, '').slice(0, 40) };
  const photo = p.avatarUrl || p.photoURL;
  if (isStr(photo) && /^https:\/\//.test(photo)) out.photoURL = photo.slice(0, 1024);
  const reads = Number(p.readCount);
  if (Number.isFinite(reads) && reads >= 0) out.badge = Math.floor(reads);
  if (!out.handle) delete out.handle;
  return out;
}

const initialsOf = (name) => String(name || 'R').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'R';

/** A face for the door: picture or initials. Never a uid, never a name. */
export function faceOf(author) {
  return author?.photoURL ? { photoURL: author.photoURL } : { initials: initialsOf(author?.name) };
}

// ── THE SUMMARY ─────────────────────────────────────────────────────────────────────────────
//
// series_notes_summary/{sid} is RECOMPUTED for the instalment that changed, from the gated
// nodes the endpoint can read, rather than incremented — a counter that drifts is how the
// Square's badges came to disagree with themselves (squareIdentity.js). One instalment's notes
// are small enough to read whole.
export function instStats({ ordinal, notes = {}, members = {}, sides = {} }) {
  const list = Object.values(notes || {}).filter((n) => n && typeof n === 'object');
  const kinds = { side: 0, sit: 0, line: 0, else: 0 };
  for (const n of list) if (kinds[n.kind] != null) kinds[n.kind] += 1;
  // A tap on a side is an answer (ruling 161) — so Take a side counts its sides, not its notes.
  kinds.side = Math.max(kinds.side, Object.keys(sides || {}).length);
  const lastAt = list.reduce((m, n) => Math.max(m, Number(n.createdAt) || 0), 0) || null;
  return {
    ordinal: Number(ordinal) || 0,
    notes: list.length,
    readers: Object.keys(members || {}).length,
    kinds,
    lastAt,
  };
}

/**
 * Fold one instalment's fresh stats into the series summary. Pure; the endpoint does the
 * conditional write. `lead` is the instalment the door shows (the latest one with published
 * questions, or the one that changed when none has).
 */
export function foldSummary(prev, { inst, stats, notes = {}, sit = null, leadInst = null }) {
  const s = prev && typeof prev === 'object' ? { ...prev } : {};
  const byInst = { ...(s.byInst || {}) };
  byInst[inst] = stats;
  s.byInst = byInst;

  // latestNotes: the newest LATEST_KEPT timestamps across the series. Rebuilt from the kept
  // list minus this instalment's old stamps plus its current ones — byInst remembers which
  // stamps were whose through `stampsByInst`.
  const stampsByInst = { ...(s.stampsByInst || {}) };
  const mine = Object.values(notes || {}).map((n) => Number(n?.createdAt) || 0).filter((t) => t > 0)
    .sort((a, b) => b - a).slice(0, LATEST_KEPT);
  stampsByInst[inst] = mine;
  s.stampsByInst = stampsByInst;
  s.latestNotes = Object.values(stampsByInst).flat().sort((a, b) => b - a).slice(0, LATEST_KEPT);

  const lead = leadInst || s.inst || inst;
  const leadStats = byInst[lead] || stats;
  s.inst = lead;
  s.ordinal = leadStats.ordinal;
  if (lead === inst && sit != null) s.sit = sit;
  s.sitAnswers = Number(leadStats.kinds?.sit) || 0;
  s.notes = Number(leadStats.notes) || 0;
  s.readers = Number(leadStats.readers) || 0;
  const lasts = Object.values(byInst).map((b) => Number(b?.lastAt) || 0);
  s.lastAt = Math.max(0, ...lasts) || null;

  if (inst === lead) {
    const faces = [];
    const seen = new Set();
    const recent = Object.values(notes || {}).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const n of recent) {
      if (seen.has(n.uid)) continue;
      seen.add(n.uid);
      faces.push(faceOf(n.author));
      if (faces.length === FACES_MAX) break;
    }
    s.faces = faces;
  }
  return s;
}

// ── THE ROOM ────────────────────────────────────────────────────────────────────────────────
/**
 * Top-level order: the writer's notes pinned first (ruling 163), then Most underlined (the
 * default) or Newest. Ties fall to newest, so the order is total and stable.
 */
export function sortNotes(notes, { by = 'underlined', counts = {} } = {}) {
  const list = (Array.isArray(notes) ? notes : []).slice();
  const c = (n) => Number(counts[n.id]) || 0;
  list.sort((a, b) => {
    if (!!b.writer !== !!a.writer) return b.writer ? 1 : -1;
    if (by === 'underlined' && c(b) !== c(a)) return c(b) - c(a);
    return (b.createdAt || 0) - (a.createdAt || 0) || String(a.id).localeCompare(String(b.id));
  });
  return list;
}

/** Replies stay oldest first, so a thread reads in order. */
export function orderReplies(replies) {
  return (Array.isArray(replies) ? replies : []).slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
}

/** { shown, hidden } — folded after two behind "View N more replies". */
export function foldReplies(replies, expanded = false) {
  const ordered = orderReplies(replies);
  if (expanded || ordered.length <= REPLIES_SHOWN) return { shown: ordered, hidden: 0 };
  return { shown: ordered.slice(0, REPLIES_SHOWN), hidden: ordered.length - REPLIES_SHOWN };
}

/** Whole-number shares that sum to 100 (largest remainder). Pass the question's option keys. */
export function tallyShares(tallies, keys = SIDE_OPTIONS) {
  const t = tallies && typeof tallies === 'object' ? tallies : {};
  const present = Array.isArray(keys) && keys.length ? keys : SIDE_OPTIONS;
  const counts = present.map((k) => Math.max(0, Number(t[k]) || 0));
  const total = counts.reduce((a, b) => a + b, 0);
  const out = { total };
  if (total === 0) { present.forEach((k) => { out[k] = 0; }); return out; }
  const raw = counts.map((c) => (c * 100) / total);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; floor[i] += 1; left -= 1; }
  present.forEach((k, i) => { out[k] = floor[i]; });
  return out;
}

/** The tally after a reader moves from `from` to `to` (either may be null). Never negative. */
export function moveTally(tally, from, to) {
  const t = { ...(tally && typeof tally === 'object' ? tally : {}) };
  if (from && from !== to) t[from] = Math.max(0, (Number(t[from]) || 0) - 1);
  if (to && from !== to) t[to] = (Number(t[to]) || 0) + 1;
  return t;
}

/** Lines ranked by how many readers chose them. Same words = same line. */
export const lineKey = (text) => clean(text).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}' ]/gu, '');
export function rankLines(lineNotes, myUid = null) {
  const groups = new Map();
  for (const n of Array.isArray(lineNotes) ? lineNotes : []) {
    if (!n?.line?.text) continue;
    const k = lineKey(n.line.text);
    if (!groups.has(k)) groups.set(k, { key: k, line: n.line, notes: [], readers: new Set(), firstAt: n.createdAt || 0 });
    const g = groups.get(k);
    g.notes.push(n);
    g.readers.add(n.uid);
    g.firstAt = Math.min(g.firstAt, n.createdAt || 0);
  }
  const ranked = [...groups.values()]
    .map((g) => ({ key: g.key, line: g.line, notes: g.notes, count: g.readers.size, mine: !!myUid && g.readers.has(myUid) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (ranked.length && ranked[0].count > 1) ranked[0].mostChosen = true;
  return ranked;
}

/** The room's URL. The instalment travels in the query, so one static page serves every one. */
export const roomHref = (slug, inst, extra = {}) => {
  const q = new URLSearchParams({ i: inst, ...extra });
  return `/series/${slug}/notes?${q.toString()}`;
};
/** "Read it in its place": the reader, opened at the line. */
export const lineHref = (inst, line) => `/series/read/${encodeURIComponent(inst)}?at=${encodeURIComponent(line?.cfi || '')}${line?.epubVersion ? `&v=${encodeURIComponent(line.epubVersion)}` : ''}`;

// ── ENDPOINT ERRORS → WORDS ─────────────────────────────────────────────────────────────────
export const NOTES_ERRORS = Object.freeze({
  not_enabled: 'Readers’ Notes aren’t open yet.',
  not_finished: 'The room opens on the last page.',
  not_released: 'This instalment hasn’t arrived yet.',
  no_access: 'This instalment isn’t part of your membership.',
  empty: 'Write something first.',
  too_long: 'That’s a little long — trim it and try again.',
  bad_kind: 'Choose a question to write about.',
  no_side: 'Take a side first.',
  bad_line: 'That line couldn’t be attached.',
  no_questions: 'The questions for this instalment aren’t out yet.',
  not_found: 'That note has gone.',
  forbidden: 'You can’t do that.',
  limit: 'You’ve written a lot just now. Try again in a minute.',
  unavailable: 'We couldn’t reach the room just now. Try again in a moment.',
  // W46 §2 — the endpoint's four remaining codes, so every refusal it can send has its words
  // here (docs/series-notes.md: "Words for every refusal are in NOTES_ERRORS").
  signed_out: 'Sign in to join the room.',
  limiter_unavailable: 'We couldn’t check this just now. Please try again in a moment.',
  bad_request: 'Something about that didn’t look right. Please try again.',
  not_ready: 'All three questions must be ready.',
});
