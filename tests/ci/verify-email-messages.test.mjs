// R9.4 — WHAT THE READER IS TOLD WHEN THE RESEND DOES NOT SEND.
//
//   node --test tests/ci/verify-email-messages.test.mjs      (npm run test:ci)
//
// The banner's whole premise is that these accounts were failed by us, not by their owners.
// That premise survives exactly as long as the failure copy does. The branch under test is
// the one a reader is most likely to hit: press "Send it now", nothing appears within a few
// seconds, press it again — and Firebase answers auth/too-many-requests, because the FIRST
// send worked and is already in flight.
//
// Reporting that as "that didn't send" is the specific regression this guards. It tells the
// reader the opposite of what happened, and it re-lands the blame in the place the banner
// exists to take it out of.
//
// Pure function, no React, no firebase, no network — app/lib/verifyEmail.js keeps the mapper
// separate from the hook precisely so this can be asserted for nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  verificationMessageFor,
  VERIFY_SENT_MESSAGE,
  VERIFY_THROTTLED_MESSAGE,
  VERIFY_ERROR_MESSAGE,
} from '../../app/lib/verifyEmail.js';

describe('verification resend messages', () => {
  // R9.5 swapped the sender from firebase/auth to the calvary-auth Worker, and the signal
  // changed shape with it: there is no auth/too-many-requests code on this path, only HTTP
  // status. The proxy answers 502 and reports the Worker's own status as `upstream`, so a
  // rate limit can arrive at either level — both must map to the throttle outcome.
  test('a rate limit is recognised whether it lands on the proxy or upstream', () => {
    assert.equal(verificationMessageFor({ status: 429 }), VERIFY_THROTTLED_MESSAGE);
    assert.equal(verificationMessageFor({ status: 502, upstream: 429 }), VERIFY_THROTTLED_MESSAGE);
  });

  test('any other failure falls back to the generic message', () => {
    for (const e of [
      { status: 500 },                    // AUTH_WORKER_SECRET unset in the Pages env
      { status: 502, upstream: 500 },     // the Worker itself failed
      { status: 502, upstream: null },    // Worker unreachable
      { status: 401 },                    // token expired
      { status: 400 },                    // account has no email address
      new Error('boom'),
      {},
      null,
      undefined,
    ]) {
      assert.equal(verificationMessageFor(e), VERIFY_ERROR_MESSAGE);
    }
  });

  test('the old firebase error code no longer smuggles in a throttle', () => {
    // Guards the swap itself. If someone restores the firebase/auth sender without restoring
    // its mapping — or maps the code out of habit while the path no longer produces it —
    // this is the assertion that notices. A code with no status is not a rate limit here.
    assert.equal(verificationMessageFor({ code: 'auth/too-many-requests' }), VERIFY_ERROR_MESSAGE);
  });

  test('no message blames the reader', () => {
    // The accounts this banner targets never received a verification email — AuthModal was
    // sending "Bearer undefined" to the auth Worker and the Worker answered 401 to every
    // request (see functions/api/auth/send-verification.js). Copy that implies the reader
    // ignored, forgot, missed or failed to do something is factually wrong here.
    const BLAMING = /\b(you (still )?(haven'?t|didn'?t|never)|forgot|ignored|missed|failed to|remember to|don'?t forget)\b/i;
    for (const msg of [VERIFY_SENT_MESSAGE, VERIFY_THROTTLED_MESSAGE, VERIFY_ERROR_MESSAGE]) {
      assert.ok(!BLAMING.test(msg), `copy puts the failure on the reader: ${JSON.stringify(msg)}`);
    }
  });

  test('the throttle message does not claim a mail is already in flight', () => {
    // It did under firebase/auth, where auth/too-many-requests meant an earlier send had
    // been ACCEPTED. On the Worker path a 429 is ambiguous — the Worker's own throttle (an
    // earlier send went out) or Resend refusing the Worker (nothing went out) — and the
    // Worker's source is not in this repo to settle it. Promising delivery we cannot confirm
    // would send a reader to an inbox that may never receive anything, which is the same
    // untraceable-mail problem R9.5 swapped senders to escape.
    assert.ok(!/on its way|already sent|is coming/i.test(VERIFY_THROTTLED_MESSAGE),
      `the throttle copy promises delivery this path cannot confirm: ${JSON.stringify(VERIFY_THROTTLED_MESSAGE)}`);
    // It must still say the limit is ours and that waiting is the action.
    assert.match(VERIFY_THROTTLED_MESSAGE, /we'?re|our/i);
    assert.match(VERIFY_THROTTLED_MESSAGE, /try again|minute|moment/i);
  });
});
