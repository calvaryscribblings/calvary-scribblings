'use client';
// THE resend path for email verification. One implementation, two call sites.
//
// ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────────────
// /settings has had a "Verify email" button since it was built. R9.4 added a prompt banner
// that needs the same action, and the one thing that must not happen is a second
// implementation of "send the verification email" — two copies drift, and the copy that
// drifts is the one nobody is looking at. So the state machine lives here and BOTH callers
// consume it. app/settings/page.js sends nothing itself.
//
// ── R9.5: WHICH SENDER, AND WHY IT CHANGED ───────────────────────────────────────────────
// This module used to call firebase/auth's sendEmailVerification() — the browser asking
// Firebase to compose and send from its own template. It no longer does. It posts to
// /api/auth/send-verification, the Pages proxy in front of the calvary-auth Worker, which is
// what AuthModal has always used at signup.
//
// THE REASON IS NOT PREFERENCE. Firebase Auth's SMTP is disabled on this project (confirmed
// in the console). The native path therefore sent an unbranded firebaseapp.com email that
// never appeared in Resend and could not be traced — mail that may or may not have arrived,
// with no log to settle the question. The Worker path is branded and has a confirmed
// Delivered in the Resend log. A send you cannot see is not a send you can support, and this
// banner exists precisely because unverifiable mail was the original failure.
//
// R9.4's header said the swap would be one line and both callers would move together. It
// was, and they did: the change is confined to sendVerificationEmail() and the failure
// mapping below, and /settings picked it up without being edited.
//
// ── WHY THE COPY LIVES HERE ──────────────────────────────────────────────────────────────
// The success and failure strings are part of the path, not part of either surface. A caller
// that wanted its own wording would be re-deciding what "sent" means, which is how the two
// surfaces start disagreeing about whether the mail went out. Callers style the message;
// they do not author it.
import { useCallback, useState } from 'react';
// Explicit .js: this module is imported directly by tests/ci/verify-email-messages.test.mjs,
// and node's ESM resolver does not do webpack's extensionless lookup. Elsewhere in app/ the
// extensionless form is the convention and stays that way — only modules a node test reaches
// need this.
import { postAuthMail } from './authMail.js';

export const VERIFY_SENT_MESSAGE = 'Sent. Check your inbox.';
export const VERIFY_THROTTLED_MESSAGE =
  "We're sending too many at once — give it a minute, then try again.";
export const VERIFY_ERROR_MESSAGE = "That didn't send.";

// ── THE THROTTLE OUTCOME, AND WHY ITS COPY CHANGED WITH THE SENDER ───────────────────────
// Under firebase/auth this was a documented error CODE, auth/too-many-requests, with known
// semantics: Firebase had accepted an earlier send and was refusing a further one. "One's
// already on its way" was true, and worth saying — it is the sentence that sends a reader to
// look in their inbox instead of concluding the account is broken.
//
// NONE OF THAT SURVIVES THE SWAP, and the copy had to move with it:
//
//   · There are no error codes on this path. /api/auth/send-verification collapses every
//     non-OK Worker response into 502 and reports the Worker's status as `upstream`. Status
//     numbers are all the browser gets, which is why app/lib/authMail.js attaches them.
//
//   · A 429 here is AMBIGUOUS in a way Firebase's code was not. It may be the Worker's own
//     throttle, in which case an earlier send did go out — or Resend refusing the Worker, in
//     which case THIS send did not happen and nothing is on its way. The two readings point
//     a reader in opposite directions.
//
//   · Which one it is cannot be settled from this repo. The calvary-auth Worker's source
//     lives elsewhere; only stripe-webhook and calvary-newsletter are here. Probed directly,
//     the Worker checks its secret first and answers 401 to unauthenticated repeats with no
//     sign of a pre-auth limit, so its post-auth behaviour is simply not observable from
//     here.
//
// So the message no longer claims a mail is in flight. It says the limit is OURS and asks
// them to wait — true under both readings, and it still keeps the failure off the reader,
// which is the property that matters most on this banner. If the Worker's throttle semantics
// are ever confirmed, this is the string to sharpen.
const THROTTLED_STATUSES = new Set([429]);

// Pure, and exported so tests/ci/verify-email-messages.test.mjs can hold the throttle branch
// without booting React or the network. The branch is the whole point: throttling is a
// likely failure for a reader who presses the button, sees nothing, and presses again, and
// reporting it as a generic error is what turns a wait into "this account is broken".
export function verificationMessageFor(error) {
  const throttled =
    THROTTLED_STATUSES.has(error?.status) || THROTTLED_STATUSES.has(error?.upstream);
  return throttled ? VERIFY_THROTTLED_MESSAGE : VERIFY_ERROR_MESSAGE;
}

// The raw send. Exported for a caller that wants to own its own state; everything in the app
// currently wants the hook below instead.
//
// firstName is cosmetic — it only greets the reader — and the proxy prefers the account's own
// displayName over anything sent from here, so a wrong guess cannot reach the mail.
export async function sendVerificationEmail(user) {
  if (!user) throw new Error('sendVerificationEmail: no signed-in user');
  const firstName = (user.displayName || '').trim().split(' ')[0];
  await postAuthMail('send-verification', user, firstName);
}

// idle → sending → sent, or → error. `state` drives the button; `message` is the line
// underneath it. A caller decides where the message goes and what, if anything, to offer
// alongside it — the banner adds a link to /settings on error, /settings obviously does not.
export function useVerificationResend(user) {
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');

  const send = useCallback(async () => {
    if (!user || state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      await sendVerificationEmail(user);
      setState('sent');
      setMessage(VERIFY_SENT_MESSAGE);
    } catch (e) {
      // The endpoint's own failures are worth having in the console: a 500 here means
      // AUTH_WORKER_SECRET is unset in the Pages environment, which is the exact
      // configuration that once made signups silently mail-less. The reader sees a plain
      // message; whoever is debugging gets the status.
      console.error('[verifyEmail] resend failed:', e?.status ?? '—', e?.upstream ?? '—', e?.message);
      setState('error');
      setMessage(verificationMessageFor(e));
    }
  }, [user, state]);

  // Lets a surface offer "try again" after a failure without remounting.
  const reset = useCallback(() => { setState('idle'); setMessage(''); }, []);

  return { state, message, send, reset };
}
