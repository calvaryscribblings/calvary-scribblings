'use client';
// THE resend path for email verification. One implementation, two call sites.
//
// ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────────────
// /settings has had a "Verify email" button since it was built. R9.4 adds a prompt banner
// that needs the same action, and the one thing that must not happen is a second
// implementation of "send the verification email" — two copies drift, and the copy that
// drifts is the one nobody is looking at. So the state machine moved here and BOTH callers
// consume it. app/settings/page.js no longer sends anything itself.
//
// ── WHICH SEND PATH THIS IS, AND WHICH IT IS NOT ─────────────────────────────────────────
// There are two verification senders in this codebase and they are NOT the same thing:
//
//   1. THIS ONE — firebase/auth's sendEmailVerification(). Fires from the browser using the
//      signed-in user's own credential. Firebase composes and sends the mail from its own
//      template and its own sender address. No secret, no Worker, no Pages function.
//
//   2. functions/api/auth/send-verification.js — a Pages proxy to the calvary-auth Worker,
//      which sends BRAND-STYLED mail. This is what AuthModal calls at signup.
//
// The banner was specified to reuse (1), the path /settings already had. Worth knowing, and
// written down here rather than discovered later: the mail a reader gets from the banner is
// therefore Firebase's default template, not the branded one they were meant to get when
// they joined. If that matters, this is the single line to change — swap the send below for
// a postAuthMail('send-verification', …) call and both callers move together.
//
// ── WHY THE COPY LIVES HERE ──────────────────────────────────────────────────────────────
// The success and failure strings are part of the path, not part of either surface. A
// caller that wanted its own wording would be re-deciding what "sent" means, which is how
// the two surfaces start disagreeing about whether the mail went out. Callers style the
// message; they do not author it.
import { useCallback, useState } from 'react';

// Firebase throttles verification sends per-account and per-IP. It is a distinct, EXPECTED
// outcome — not a fault — and it must not be reported as a generic failure: a reader told
// "something went wrong" after asking twice will assume the account is broken and stop,
// when in fact the first mail is already on its way to them.
const THROTTLED = 'auth/too-many-requests';

export const VERIFY_SENT_MESSAGE = 'Sent. Check your inbox.';
export const VERIFY_THROTTLED_MESSAGE =
  "One's already on its way — we can only send so often. Give it a few minutes, then try again.";
export const VERIFY_ERROR_MESSAGE = "That didn't send.";

// Pure, and exported so tests/ci/verify-email-messages.test.mjs can hold the throttle branch
// without booting React or firebase. The branch is the whole point: throttling is the most
// likely failure a reader will hit — they press the banner, then press it again — and
// reporting it as a generic error is what turns "your mail is already coming" into "this
// account is broken".
export function verificationMessageFor(error) {
  return error?.code === THROTTLED ? VERIFY_THROTTLED_MESSAGE : VERIFY_ERROR_MESSAGE;
}

// The raw send. Exported for a caller that wants to own its own state; everything in the app
// currently wants the hook below instead.
export async function sendVerificationEmail(user) {
  if (!user) throw new Error('sendVerificationEmail: no signed-in user');
  const { sendEmailVerification } = await import('firebase/auth');
  await sendEmailVerification(user);
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
      setState('error');
      setMessage(verificationMessageFor(e));
    }
  }, [user, state]);

  // Lets a surface offer "try again" after a failure without remounting.
  const reset = useCallback(() => { setState('idle'); setMessage(''); }, []);

  return { state, message, send, reset };
}
