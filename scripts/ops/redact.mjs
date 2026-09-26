// W12 — NOTHING THAT NAMES A READER GOES INTO A PUBLIC LOG.
//
// This repository is public, and so are its GitHub Actions logs (kept 90 days). Until W12 the
// 15-minute account scrub printed each deleted reader's account ID — for an account deleted on
// the under-18 path, the worst thing it could have printed — and the push announcer printed
// uid/tokenKey pairs on a failed ticket. Every job that runs on GitHub now keeps to one rule:
//
//   COUNTS ONLY. No account ID, push token or token key, email, handle or name — and no provider
//   reference (Stripe/Paystack subscription, Expo ticket), which names the reader just as well
//   in the provider's dashboard. Where a run must point at one record, it prints a REFERENCE
//   that means nothing outside the database (deletionRef below).
//
// Two layers, so a slip in one is caught by the other:
//   1. the scripts print counts (tests/ci/w12-log-privacy.test.mjs drives them with identifier-
//      shaped fixtures and runs their output through `findIdentifiers`);
//   2. every scheduled step pipes its output through scripts/ops/log-guard.mjs, which masks
//      anything identifier-SHAPED before it reaches the log and fails the run if it saw one.
//
// No imports beyond node:crypto; pure apart from randomRef.

import { randomBytes } from 'node:crypto';

// A Firebase Auth uid: 28 characters of [A-Za-z0-9], mixed case. Requiring BOTH cases keeps
// lowercase-hex digests (git shas, cover hashes, build ids) and slugs out of it.
const UID = /(?<![A-Za-z0-9_])(?=[A-Za-z0-9]{28}(?![A-Za-z0-9_]))(?=[a-z0-9]*[A-Z])(?=[A-Z0-9]*[a-z])[A-Za-z0-9]{28}/g;
// Push tokens: Expo's, and a raw FCM registration token (":APA91…"). An APNs device token is 64
// hex characters — but so is a sha256, which the covers job prints by design, so a 64-hex run is
// NOT treated as a token; the app registers Expo tokens, never raw APNs ones.
const EXPO = /Expo(?:nent)?PushToken\[[^\]\s]{1,200}\]/g;
const FCM = /[A-Za-z0-9_-]{11,}:APA91[A-Za-z0-9_-]{30,}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// A 28-letter camelCase WORD is not a uid: `notificationsInOthersInboxes` is one of the scrub's own
// count names. A random uid is letters and digits in no pattern; the chance that one reads as
// lowercase-run-then-Capitalised-runs is negligible.
const WORDY = /^(?:[a-z]+|[A-Z][a-z]+)(?:[A-Z][a-z]+)+$/;

export const SHAPES = [
  ['account ID', UID, (m) => !WORDY.test(m)],
  ['push token', EXPO],
  ['push token', FCM],
  ['email', EMAIL],
];

/** Every identifier-shaped string in `text`: [{ kind, at }]. The values are NOT returned. */
export function findIdentifiers(text) {
  const s = String(text ?? '');
  const out = [];
  for (const [kind, re, keep = () => true] of SHAPES) {
    for (const m of s.matchAll(re)) if (keep(m[0])) out.push({ kind, at: m.index });
  }
  return out;
}

/** `text` with each identifier-shaped string replaced by ‹kind›. */
export function mask(text) {
  let s = String(text ?? '');
  for (const [kind, re, keep = () => true] of SHAPES) s = s.replace(re, (m) => (keep(m) ? `‹${kind}›` : m));
  return s;
}

// ── THE PER-RECORD REFERENCE ─────────────────────────────────────────────────────────────
// A random tag stored ON the record (deletions/{uid}/logRef), so the only way from a log line
// back to a reader is to hold the database and look the tag up. Random rather than derived:
// a hash of the uid could be recomputed by anyone holding a list of uids, and the uids are in
// the public logs of the runs W12 cleans up.
export const LOG_REF_RE = /^del-[0-9a-f]{8}$/;
export const randomRef = () => `del-${randomBytes(4).toString('hex')}`;
