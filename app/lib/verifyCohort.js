// WHO THE "THAT ONE IS ON US" BANNER IS FOR — and nobody else.
//
// app/components/VerifyEmailBanner.js apologises: "the email we owed you when you joined never
// went out". That sentence is true for ONE cohort and false for everyone else. Until this module
// existed the banner asked only "is this account unverified?", so a reader who signed up seconds
// earlier — with the verification email already in their inbox — was told we had failed them, and
// "Send it now" sent them a second one.
//
// ── THE INCIDENT WINDOW, AND THE EVIDENCE FOR EACH END ───────────────────────────────────────
//
// OPENS 2026-04-04T11:37:43Z — commit 2cdb2f43 "Remove sendEmailVerification, send branded
// verification email via Worker". Before it, Firebase's own sendEmailVerification() sent the
// mail. From it, AuthModal called the calvary-auth Worker with
// `Bearer ${process.env.NEXT_PUBLIC_AUTH_SECRET}`, a variable that was never set, so every request
// carried "Bearer undefined", the Worker answered 401, and nothing checked the response.
// Measured on the live Auth export (23 Sep 2026): zero password accounts exist before this
// instant, so the lower bound excludes nobody who could have been affected.
//
// CLOSES 2026-08-05T18:58:13Z — commit 18997510 (R9.5), the first point in the history that
// records branded verification mail "with a confirmed Delivered in the log". The repair itself
// is fcf787e4 (2026-08-02T15:59:38Z), but its own message says mail would NOT flow until
// AUTH_WORKER_SECRET was set in the Pages environment AND the site redeployed, and nothing in
// the repository records when that happened. So the true end lies somewhere in
// [2 Aug 15:59, 5 Aug 18:58], and this takes the LATER bound: it is the first moment delivery is
// PROVEN. Inside that gap sit five password accounts, two of them unverified (both 4 Aug); if
// Resend shows their verification mail went out, the bound can move earlier.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
// Not a reminder for new unverified readers. Whether they should get one, in what words, is
// Ikenna's question and has not been ruled. Until it is, an account created after the window
// sees NOTHING — deliberately, not by omission.
//
// Pure, no imports, so `node --test` can hold it: tests/ci/verify-cohort.test.mjs.

export const INCIDENT_OPENS_MS = Date.parse('2026-04-04T11:37:43Z');
export const INCIDENT_CLOSES_MS = Date.parse('2026-08-05T18:58:13Z');

/**
 * When the account was created, in epoch ms, from a Firebase User — or null when it cannot be
 * read. `metadata.creationTime` is an RFC 1123 string ("Tue, 04 Aug 2026 16:41:09 GMT").
 */
export function createdAtMsOf(user) {
  const t = Date.parse(user?.metadata?.creationTime ?? '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Should this account see the apology?
 *
 * Only when it was created INSIDE the incident window AND is still unverified. An account whose
 * creation time cannot be read gets false: the apology is a specific admission, and making it to
 * someone we cannot place in the window would be the same false statement this module exists to
 * stop.
 */
export function showsVerifyApology({ createdAtMs, verified }) {
  if (verified !== false) return false;
  if (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs)) return false;
  return createdAtMs >= INCIDENT_OPENS_MS && createdAtMs < INCIDENT_CLOSES_MS;
}
