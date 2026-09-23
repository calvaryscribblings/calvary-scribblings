// THE WEB SIGNUP, IN ORDER — and what happens when a step fails.
//
// AuthModal's register branch used to run these steps inline, and a failure between creating the
// account and writing its profile left a HALF-ACCOUNT: a Firebase Auth user with no profile, the
// reader shown an error, and their next attempt refused with "An account with this email already
// exists". This module makes the order explicit and the failure clean.
//
//   1. create the Auth account          — fails → nothing exists, nothing is sent
//   2. set its displayName              ┐ fails → the account is DELETED again, nothing is sent,
//   3. write the profile in ONE update  ┘         and the reader can simply try again
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
// The profile is ONE multi-path update rather than three set() calls: an update is all-or-nothing
// at the database, so there is no state where dob landed and joinDate did not.
//
// Every Firebase call is handed in, so tests/ci/signup.test.mjs drives the real sequence with
// stand-ins and watches which steps run. No imports.

/** The profile fields a web signup writes, as a users/{uid}-relative update. */
export function profileUpdate({ name, dob, now }) {
  return { displayName: name, dob, joinDate: now };
}

/**
 * @param deps {createUser, setDisplayName, writeProfile, deleteAccount, sendVerification, now}
 * @returns {Promise<{ user, mailError: string|null }>}
 * @throws the original error when the account could not be completed — after rolling it back.
 *         `err.rolledBack` says whether the rollback itself succeeded.
 */
export async function registerAccount({ email, password, name, dob }, deps) {
  const displayName = name.trim();
  const cred = await deps.createUser(email, password);
  const user = cred.user;
  try {
    await deps.setDisplayName(user, displayName);
    await deps.writeProfile(user.uid, profileUpdate({ name, dob, now: deps.now() }));
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
