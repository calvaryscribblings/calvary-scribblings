// LONDON WALL TIME ↔ UTC — W6 (ADM-22).
//
// The newsletter's "Schedule" field is an <input type="datetime-local">: a zoneless string such as
// "2026-10-01T09:00". Before W6 the admin sent it as typed and the Worker read it as UTC, so every
// issue scheduled during British Summer Time went out an hour late. The person typing means London
// time, so it is converted HERE, to a UTC ISO instant, before it leaves the browser — whatever zone
// the device happens to be in.
//
// The Worker carries a copy (londonWallToUtcMs in workers-external/calvary-newsletter.worker.js)
// for drafts saved before W6; tests/ci/w6-worker.test.mjs holds both to the same cases, across both
// clock changes.

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function londonParts(ms) {
  return Object.fromEntries(PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
}

/** London's offset from UTC at instant `ms`, in ms (0 in GMT, 3 600 000 in BST). */
function offsetAt(ms) {
  const p = londonParts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** "2026-10-01T09:00" (London) → epoch ms. NaN for anything that is not a datetime-local value. */
export function londonWallToUtcMs(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(wall || '').trim());
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

/** "2026-10-01T09:00" (London) → "2026-10-01T08:00:00.000Z", or null. */
export function londonWallToUtcIso(wall) {
  const ms = londonWallToUtcMs(wall);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** An instant → the datetime-local string that shows it in London ("2026-10-01T09:00"). */
export function utcToLondonWall(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) {
    // A pre-W6 draft stored the zoneless string itself: it already IS London wall time.
    const v = String(value || '');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : '';
  }
  const p = londonParts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Any stored scheduledAt (UTC ISO, or a pre-W6 zoneless London string) → epoch ms. */
export function scheduledMs(value) {
  const v = String(value || '').trim();
  if (!v) return NaN;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) return Date.parse(v);
  return londonWallToUtcMs(v);
}

/** "Thu 1 Oct, 09:00 (London)" — how the admin names a scheduled instant. */
export function formatLondon(value) {
  const ms = scheduledMs(value);
  if (!Number.isFinite(ms)) return '';
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms));
  return `${s} (London)`;
}

// ── W38 — THE SERIES ADMIN'S WORDS FOR AN INSTANT ─────────────────────────────────────────
// Built from formatToParts rather than from a formatted string, so the punctuation is ours and
// not whatever a browser's en-GB data happens to put between the parts.
const LONG = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23', weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit',
});
const SHORT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23', weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit',
});
const partsOf = (fmt, ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));

/** "08:00" — the London clock at `ms`. */
export function londonClock(ms) {
  const p = londonParts(ms);
  return `${p.hour}:${p.minute}`;
}

/** "Wed 14 Oct, 08:00" */
export function londonShort(ms) {
  const p = partsOf(SHORT, ms);
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** "Wednesday 14 October" */
export function londonLongDate(ms) {
  const p = partsOf(LONG, ms);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Wednesday 14 October, 08:00" */
export function londonLongDateTime(ms) {
  return `${londonLongDate(ms)}, ${londonClock(ms)}`;
}

/** The two halves of a London wall time, for a date field and a time field: ["2026-10-14", "08:00"]. */
export function londonFields(ms) {
  const wall = utcToLondonWall(ms);
  return wall ? [wall.slice(0, 10), wall.slice(11, 16)] : ['', ''];
}

/** A date field and a time field, read as London wall time → epoch ms (NaN if incomplete). */
export function londonFieldsToMs(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return NaN;
  return londonWallToUtcMs(`${date}T${time}`);
}

/** Whole London calendar days from `now` to `ms` (0 = the same London date). */
export function londonDaysUntil(ms, now = Date.now()) {
  const day = (t) => { const p = londonParts(t); return Date.UTC(+p.year, +p.month - 1, +p.day); };
  return Math.round((day(ms) - day(now)) / 86400000);
}
