// THE WEB SIGNUP, IN ORDER — and what happens when a step fails.
//
// AuthModal's register branch used to run these steps inline, and a failure between creating the
// account and writing its profile left a HALF-ACCOUNT: a Firebase Auth user with no profile, the
// reader shown an error, and their next attempt refused with "An account with this email already
// exists". This module makes the order explicit and the failure clean.
//
//   0. check the handle is free         — taken or malformed → refused; NOTHING is created.
//                                         A check that could not run is not a refusal: the
//                                         claim in step 3 decides.
//   1. create the Auth account          — fails → nothing exists, nothing is sent
//   2. set its displayName              ┐ fails → the account is DELETED again, nothing is sent,
//   3. write the profile in ONE update  ┘         and the reader can simply try again. When the
//      — with the handle claim in it              handle was claimed by someone else between
//                                                 step 0 and here, err.handleTaken says so.
//   4. send the verification mail       — fails → the account is KEPT (it is complete); the
//                                         reader is told and can tap Resend
//
// The WELCOME is not sent here at all. It goes after verification, from AuthModal's poll, which
// only starts once this function has RETURNED — so on the web a welcome can only follow an
// account whose profile is written. functions/api/auth/welcome.js additionally refuses any
// account that is not verified.
//
// It was considered, and REJECTED, to also gate the endpoint on the profile existing. Measured
// on 23 Sep 2026: of 99 accounts created since 1 Jul, only 23 carry this signup's profile shape
// (displayName + joinDate). The rest — Google and Apple sign-ins, and password accounts the app
// created — write other fields. If the app calls /api/auth/welcome, a profile gate there would
// silently stop every app welcome. That cannot be checked from this repository.
//
// The profile is ONE multi-path update, rooted at the database, carrying the handle claim
// (usernames/{handle}) and the search row with it — the shape is app/lib/handle.js. An update is
// all-or-nothing at the database, and the claim is create-only in the rules, so a handle taken in
// the meantime refuses the WHOLE write: no profile without its handle, no claim without its
// account.
//
// Every Firebase call is handed in, so tests/ci/signup.test.mjs drives the real sequence with
// stand-ins and watches which steps run. The only import is the handle module, which has none.

import { checkHandle, signupUpdate } from './handle.js';

/** Thrown before anything is created, when the handle is malformed or already someone's. */
export class HandleRefused extends Error {
  constructor(check) {
    super(check.state === 'taken' ? `@${check.handle} is taken` : check.problem);
    this.name = 'HandleRefused';
    this.check = check;
  }
}

/**
 * @param deps {readHandleOwner, createUser, setDisplayName, writeProfile, deleteAccount,
 *              sendVerification, now}
 *   readHandleOwner(handle) → the uid at usernames/{handle}, or null
 *   writeProfile(updates)   → ONE root-relative multi-path update
 * @returns {Promise<{ user, mailError: string|null }>}
 * @throws the original error when the account could not be completed — after rolling it back.
 *         `err.rolledBack` says whether the rollback itself succeeded.
 */
export async function registerAccount({ email, password, name, dob, handle }, deps) {
  const displayName = name.trim();
  const check = await checkHandle(handle, deps.readHandleOwner);
  if (check.state === 'invalid' || check.state === 'taken') throw new HandleRefused(check);
  const cred = await deps.createUser(email, password);
  const user = cred.user;
  try {
    await deps.setDisplayName(user, displayName);
    await deps.writeProfile(signupUpdate(user.uid, { name: displayName, dob, handle: check.handle, now: deps.now() }));
  } catch (err) {
    // Nothing has been mailed yet. Take the account back out so the reader can start again with
    // the same address, and so no half-account is left for anything to send to.
    try {
      await deps.deleteAccount(user);
      err.rolledBack = true;
    } catch (rollbackErr) {
      err.rolledBack = false;
      err.rollbackError = rollbackErr;
    }
    // Was it the handle? The write is refused as a whole, so ask the index who holds it now —
    // after the rollback, so a slow read never holds a half-account open. A read that fails
    // leaves handleTaken false, and the reader gets the general message.
    const after = await checkHandle(check.handle, deps.readHandleOwner, { uid: user.uid });
    err.handleTaken = after.state === 'taken';
    err.handle = check.handle;
    throw err;
  }
  let mailError = null;
  try {
    await deps.sendVerification(user, displayName.split(' ')[0]);
  } catch (err) {
    mailError = err.message || 'unknown error';
  }
  return { user, mailError };
}
