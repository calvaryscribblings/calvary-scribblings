// THE COMPLETION STEP — a signed-in reader with no identity chooses one before anything else.
//
// Ikenna's ruling (24 Sep 2026): Apple and Google sign-ins choose a handle, as email signup does —
// no handle is ever derived from an email address. On the web, Google's first sign-in used to
// write NOTHING to users/{uid}; 155 of 347 Auth accounts have no displayName, username or handle
// (138 Google), and 103 of those hold reading data in a node with no profile.
//
// KEYED ON IDENTITY, NOT ON WHETHER THE NODE EXISTS. A reader needs the step when their node has
// none of displayName, username, handle. A node full of readStories and readerScore still needs
// it; a node with any of the three does not (95 readers have a name and no handle: they skip,
// by ruling).
//
// NOTHING IS WRITTEN UNTIL THE READER SUBMITS, and then everything is written in one update
// (app/lib/handle.js completionUpdate). Signing out or leaving mid-step leaves the node exactly
// as it was, and the step comes back on the next sign-in.
//
// No Firebase imports; everything is handed in so tests/ci/completion.test.mjs drives it.

import { checkHandle, completionUpdate, HandleRefused } from './handle.js';
import { ageProblem, AgeRefused } from './age.js';

export const IDENTITY_FIELDS = ['displayName', 'username', 'handle'];

/** Does this users/{uid} identity (only the three fields are needed) lack every identity field? */
export function needsCompletion(identity) {
  return !IDENTITY_FIELDS.some((k) => typeof identity?.[k] === 'string' && identity[k].trim() !== '');
}

// EMAIL SIGNUP IN FLIGHT. createUserWithEmailAndPassword signs the reader in BEFORE the profile
// write; for that moment the account has no identity, and the completion step must not open over
// the signup that is about to give it one. AuthModal marks the flight; the step waits it out.
let inFlight = null;
export function markSignupInFlight() {
  let settle;
  const p = new Promise((r) => { settle = r; });
  inFlight = p;
  return () => { if (inFlight === p) inFlight = null; settle(); };
}
export function signupSettled() {
  return inFlight || Promise.resolve();
}

// DRAFT for Ikenna — house voice.
export const COMPLETION_COPY = {
  title: 'One last thing.',
  subtitle: 'Choose how the island knows you. This takes a moment, and you only do it once.',
  nameLabel: 'Full name',
  submit: 'Continue',
  signOut: 'Sign out instead',
  failed: 'We could not save your details, so nothing was changed. Please try again.',
};

/**
 * Validate, then write the whole identity in ONE update.
 * @param deps { readHandleOwner, writeUpdate(updates), now() }
 * @throws AgeRefused | HandleRefused before anything is written; the write's own error after
 *         (with err.handleTaken when someone claimed the handle in the meantime).
 */
export async function completeProfile(user, { name, dob, handle }, deps) {
  const displayName = String(name || '').trim();
  if (!displayName) throw new Error('Please enter your name.');
  const tooYoung = ageProblem(dob, new Date(deps.now()));
  if (tooYoung) throw new AgeRefused(tooYoung);
  const check = await checkHandle(handle, deps.readHandleOwner, { uid: user.uid });
  if (check.state !== 'available' && check.state !== 'unknown') throw new HandleRefused(check);
  const created = Date.parse(user.metadata?.creationTime || '');
  const since = Number.isFinite(created) ? created : deps.now();
  try {
    await deps.writeUpdate(completionUpdate(user.uid, { name: displayName, dob, handle: check.handle, since }));
  } catch (err) {
    const after = await checkHandle(check.handle, deps.readHandleOwner, { uid: user.uid });
    err.handleTaken = after.state === 'taken' || after.state === 'reserved';
    err.handle = check.handle;
    throw err;
  }
  return { handle: check.handle };
}
