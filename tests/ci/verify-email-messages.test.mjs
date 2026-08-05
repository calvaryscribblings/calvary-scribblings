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
  test('a throttled send is reported as in-flight, not as a failure', () => {
    const msg = verificationMessageFor({ code: 'auth/too-many-requests' });
    assert.equal(msg, VERIFY_THROTTLED_MESSAGE);
    assert.notEqual(msg, VERIFY_ERROR_MESSAGE);
  });

  test('any other error falls back to the generic failure', () => {
    for (const e of [
      { code: 'auth/network-request-failed' },
      { code: 'auth/internal-error' },
      new Error('boom'),
      {},
      null,
      undefined,
    ]) {
      assert.equal(verificationMessageFor(e), VERIFY_ERROR_MESSAGE);
    }
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

  test('the throttle message tells them the mail is coming', () => {
    // Not just "wait" — the actionable fact is that one is already on its way, otherwise the
    // reader has no reason to go and look in their inbox.
    assert.match(VERIFY_THROTTLED_MESSAGE, /on its way|already/i);
  });
});
