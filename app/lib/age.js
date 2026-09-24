// THE MINIMUM AGE — 18, as the platform publishes it.
//
//   app/terms/page.js    "You must be 18 years of age or older to create an account"
//   app/privacy/page.js  "Story Island is intended for adults aged 18 and over"
//
// Ikenna's ruling (24 Sep 2026): the web enforces it at signup, as the app does. It is applied to
// the date of birth the form already collects, BEFORE any account is created; only a reader who
// passes writes ageConfirmed: true. Existing accounts are left as they are.
//
// No imports; the clock is handed in, so tests/ci/age.test.mjs can stand on any day.

export const MIN_AGE = 18;

// DRAFT for Ikenna — house voice.
export const AGE_COPY = {
  label: 'Date of birth',
  hint: 'Story Island is for readers aged 18 and over.',
  under: 'Story Island is for readers aged 18 and over, so we cannot open an account for you.',
  // The completion step: the reader signed in with Google, so the account already exists.
  underSignedIn: 'Story Island is for readers aged 18 and over, so we cannot finish setting up your account. We will sign you out now.',
  missing: 'Please enter your date of birth.',
  unreadable: 'Please check your date of birth.',
};

/** Whole years between a YYYY-MM-DD date of birth and `now` (a Date), or null if unreadable. */
export function ageOn(dob, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;
  // The reader's own calendar day, not UTC's: a birthday counts from the local midnight.
  const ny = now.getFullYear(), nm = now.getMonth() + 1, nd = now.getDate();
  let age = ny - y;
  if (nm < mo || (nm === mo && nd < d)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

/** Why this date of birth cannot open an account, or null when it can. */
export function ageProblem(dob, now) {
  if (!dob) return AGE_COPY.missing;
  const age = ageOn(dob, now);
  if (age === null) return AGE_COPY.unreadable;
  if (age < MIN_AGE) return AGE_COPY.under;
  return null;
}

/** Thrown before anything is created or written, when the date of birth cannot open an account. */
export class AgeRefused extends Error {
  constructor(problem) {
    super(problem);
    this.name = 'AgeRefused';
  }
}
