// THE LAUNCH DATE. One place, and the only place a launch date may be written.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
//
// R34 (3 Sept 2026) found the launch date typed out in nine files and recorded the inventory
// at OPENING_DATE in app/bookstore/components/LaunchGate.js, on Ikenna's instruction to note
// it once rather than have it found twice. R9 audited that inventory and found two more sites
// the note had missed — and they were the two that mattered most:
//
//     app/components/Gateway.js:32     const LAUNCH = { y: 2026, m: 9, d: 30 };
//     app/my-library/page.js:42        const LAUNCH = { y: 2026, m: 9, d: 30 };
//                                      // "Mirrors app/components/Gateway.js"
//
// A grep for "September" cannot see either of them, and they are not decoration: both feed a
// daysUntilLaunch() — itself duplicated byte for byte — that renders a LIVE COUNTDOWN on the
// homepage and in My Library. A visible counter fed by a hand-copied constant, in the file
// that says it is a copy, is the highest-consequence launch-date site on the platform and it
// was invisible to every search that found the other nine.
//
// So the shape of the fix is not "sweep the prose". It is: ONE machine-readable date, every
// label derived from it, and a test that fails if anyone types a launch date anywhere else.
// See tests/build/launch-literals.test.mjs — the assertion that would have caught the two
// {y,m,d} objects on the day they were written.
//
// ── R34's NOTE WAS WRONG ABOUT THE CONFLICT, AND THE CORRECTION MATTERS ──────────────────
//
// That note says OPENING_DATE and LAUNCH_DATE_LABEL are "already exported constants pulling
// in opposite directions", and that the sweep's real job is "deciding which one wins". They
// were not in conflict. Verified at R9, 5 Sept 2026:
//
//     OPENING_DATE      '30 September 2026'
//     LAUNCH_DATE_LABEL '30 September'
//     LAUNCH_NOTICE     'Memberships open on 30 September.'
//
// All three agreed on the date. They differed only in FORM — whether the year is printed, and
// whether it is a label or a sentence — which is not a conflict to resolve but a vocabulary to
// name. A round that went looking for the disagreement would have found nothing and either
// invented one or reported the sweep unnecessary. The correction is left standing at the
// original site as well as here.
//
// ── WHAT IS NOT DERIVED, AND WHY ─────────────────────────────────────────────────────────
//
// The MONTH NAME is a lookup table, not Intl.DateTimeFormat. This module is imported by
// Cloudflare Pages Functions on workerd and by the static export at build time, and a label
// that renders through a locale-aware formatter can differ between those two — which would
// show up as hydration text that does not match, on a string nobody would think to suspect.
// Twelve English month names cost nothing and cannot drift.
//
// The date itself is NOT a Date object. `new Date('2026-09-30')` is UTC midnight, and every
// consumer here is asking a London question; keeping it as three integers means the timezone
// is decided at the point of use, by daysUntilLaunch(), rather than baked in here wrongly.

/** ⭑ THE DATE. Change it HERE and nowhere else. Everything below is derived. */
export const LAUNCH = { y: 2026, m: 9, d: 30 };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ⚠ A SECOND TABLE, NOT A slice() OF THE FIRST. English month abbreviations are irregular —
// eleven are three letters and September is four — and May, June and July are not abbreviated
// at all. The first draft of this file derived it as `slice(0, 4) + 't'` for long names and
// rendered "30 Septt" on the link-in-bio and the My Library switch. It was caught by printing
// the values rather than by reading the expression, which is the only way this class of bug is
// ever caught. Type the twelve.
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
];

/** 'September' */
export const LAUNCH_MONTH = MONTHS[LAUNCH.m - 1];

/** 'Sept' — the abbreviation the link-in-bio and the My Library switch use. */
export const LAUNCH_MONTH_SHORT = MONTHS_SHORT[LAUNCH.m - 1];

/** 'September 2026' — month and year, for copy that names no day. */
export const LAUNCH_MONTH_YEAR = `${LAUNCH_MONTH} ${LAUNCH.y}`;

/** '30 September' — the everyday form. Most prose wants this one. */
export const LAUNCH_DATE_LABEL = `${LAUNCH.d} ${LAUNCH_MONTH}`;

/** '30 Sept' — where the line is tight. */
export const LAUNCH_DATE_SHORT = `${LAUNCH.d} ${LAUNCH_MONTH_SHORT}`;

/** '30 September 2026' — the full form, used where the date stands alone with nothing around it. */
export const OPENING_DATE = `${LAUNCH_DATE_LABEL} ${LAUNCH.y}`;

/** 'Opens 30 September' — the server-rendered / no-JS / post-launch fallback under a countdown. */
export const LAUNCH_TEXT = `Opens ${LAUNCH_DATE_LABEL}`;

/** 'opens 30 Sept' — the switch pill and the link-in-bio suffix. */
export const OPENS_SHORT = `opens ${LAUNCH_DATE_SHORT}`;

/** 'Memberships open on 30 September.' — both membership rails answer 409 with this. */
export const LAUNCH_NOTICE = `Memberships open on ${LAUNCH_DATE_LABEL}.`;

/** 'The Book Store opens 30 September.' — the metadata descriptions and the SEO prose. */
export const BOOKSTORE_OPENS = `The Book Store opens ${LAUNCH_DATE_LABEL}.`;

/**
 * Whole days from today to launch, both read in London.
 *
 * Date-only on both sides, so it ticks over at London midnight rather than on a rolling 24h
 * boundary from whenever the page happened to load. Returns null if Intl is unavailable or
 * throws — every caller treats null as "show the static label", which is the safe direction:
 * a missing countdown is a page that reads correctly, a wrong one is a page that lies.
 *
 * NEGATIVE AFTER LAUNCH, and deliberately not clamped here. The callers decide what a past
 * date means to them; Gateway and My Library both fall back to LAUNCH_TEXT at n <= 0.
 *
 * ⚠ THIS FUNCTION WAS DUPLICATED BYTE FOR BYTE in app/components/Gateway.js and
 * app/my-library/page.js, each over its own copy of LAUNCH. Both now import it.
 */
export function daysUntilLaunch() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const today = Date.UTC(get('year'), get('month') - 1, get('day'));
    const target = Date.UTC(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d);
    return Math.round((target - today) / 86400000);
  } catch {
    return null;
  }
}
