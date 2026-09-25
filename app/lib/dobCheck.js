// THE UNDER-18 CHECK — accounts that already exist, W5.
//
// Ruled by Ikenna (24–25 Sep 2026):
//   · an account whose stored date of birth is UNDER 18 or UNREADABLE must confirm it;
//   · an account CONFIRMED under 18 is deleted, through POST /api/account/delete (the reader's
//     own confirmation is the request — CLAUDE.md, "the reader's own request is the authority");
//   · the founders are exempt;
//   · a MISSING date of birth is left alone.
//
// The app's half is lib/dobCheck.ts (app commit a62f412). That repo is not visible from here, so
// this was built from the ruling above, not transcribed; the statuses and the cases in
// tests/ci/dob-check.test.mjs are the web's, and the app's harness should be run against them
// (docs/W5-SAFETY.md). Pure: the clock and the stored values are handed in.
//
// Signup (app/lib/age.js) already refuses an under-18 date before any account exists; this is
// for the accounts made before that rule, or by an app binary that did not enforce it.

import { ageOn, MIN_AGE } from './age.js';
import { FOUNDER_UIDS } from './founders.js';

export const DOB_STATUS = {
  EXEMPT: 'exempt',         // a founder — never asked
  MISSING: 'missing',       // nothing stored — left alone, by ruling
  OK: 'ok',                 // 18 or over
  UNDER_18: 'under_18',     // must confirm
  UNREADABLE: 'unreadable', // must confirm
};

/** The statuses that put the confirmation in front of the reader. */
export const MUST_CONFIRM = [DOB_STATUS.UNDER_18, DOB_STATUS.UNREADABLE];

/**
 * The date of birth the account holds. users_private/{uid}/dob is where it lives; an old app
 * binary may still write users/{uid}/dob, and the 15-minute sweep lets that public copy win, so it
 * wins here too. An empty string is nothing.
 */
export function storedDob({ publicDob, privateDob }) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  if (has(publicDob)) return publicDob;
  if (has(privateDob)) return privateDob;
  return null;
}

/** Where this account stands. `now` is a Date. */
export function dobStatus({ uid, dob, now }) {
  if (FOUNDER_UIDS.includes(uid)) return DOB_STATUS.EXEMPT;
  if (dob === undefined || dob === null || dob === '') return DOB_STATUS.MISSING;
  if (typeof dob !== 'string') return DOB_STATUS.UNREADABLE;
  const age = ageOn(dob, now);
  if (age === null) return DOB_STATUS.UNREADABLE;
  return age < MIN_AGE ? DOB_STATUS.UNDER_18 : DOB_STATUS.OK;
}

export const mustConfirm = (status) => MUST_CONFIRM.includes(status);

/**
 * What the reader's confirmed date means: 'ok' (write it and carry on), 'under_18' (the account
 * is deleted), or 'missing' / 'unreadable' (ask again — nothing happens to the account).
 */
export function confirmOutcome(entered, now) {
  if (!entered) return DOB_STATUS.MISSING;
  const age = ageOn(entered, now);
  if (age === null) return DOB_STATUS.UNREADABLE;
  return age < MIN_AGE ? DOB_STATUS.UNDER_18 : DOB_STATUS.OK;
}

/**
 * The one write for a confirmed adult date: the private copy, and the public copy REMOVED — the
 * sweep lets a public copy win, so leaving the old one there would put the old date back.
 */
export function confirmedDobUpdate(uid, dob) {
  return { [`users_private/${uid}/dob`]: dob, [`users/${uid}/dob`]: null };
}

// DRAFT for Ikenna — house voice. The app's DRAFT copy is in the app repo; see the note above.
export const DOB_COPY = {
  title: 'Please confirm your date of birth',
  body: 'Story Island is for readers aged 18 and over. The date of birth on your account needs checking, so please enter it again.',
  label: 'Date of birth',
  confirm: 'Confirm',
  signOut: 'Sign out',
  missing: 'Please enter your date of birth.',
  unreadable: 'Please check your date of birth.',
  failed: 'We couldn’t save that. Please try again.',
  underTitle: 'Story Island is for readers aged 18 and over',
  underBody: (dateText) => `You’ve told us you were born on ${dateText}. That means we can’t keep an account for you, so it will be deleted now, with everything in it. This can’t be undone.`,
  underDelete: 'Delete my account',
  underBack: 'I entered the wrong date',
  working: 'Deleting…',
  reauthTitle: 'Sign in again to continue',
  reauthBody: 'For your security, please sign in once more. Your account is deleted as soon as you do.',
};
