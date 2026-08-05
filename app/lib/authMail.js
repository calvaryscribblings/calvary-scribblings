'use client';
// THE client for branded auth mail: /api/auth/send-verification and /api/auth/welcome.
//
// ── PROVENANCE ───────────────────────────────────────────────────────────────────────────
// A MOVE out of app/components/AuthModal.js, where postAuthMail was defined privately. The
// function body is unchanged apart from one ADDITIVE change, described under STATUS below.
// AuthModal imports it now instead of declaring it.
//
// The move happened because R9.5 pointed the verification resend at this same endpoint (see
// app/lib/verifyEmail.js). Two copies of the fetch — one in the modal, one behind the resend
// — is the drift the resend path was consolidated to avoid in the first place, and it would
// have been a copy nobody looked at until branded mail stopped going out again.
//
// ── WHY THE ENDPOINT AND NOT THE WORKER ──────────────────────────────────────────────────
// Branded auth mail goes through our own Pages Functions, which verify the caller's ID token
// and add the Worker secret server-side (functions/api/auth/*). The browser used to call the
// Worker directly with `Bearer ${process.env.NEXT_PUBLIC_AUTH_SECRET}` — a var that is
// inlined into the bundle, and was unset, so every request carried the literal string
// "Bearer undefined" and was refused. Nothing checked the response, so signups silently went
// out without a verification email.
//
// ── STATUS: THE ONE ADDITION ─────────────────────────────────────────────────────────────
// The thrown Error now carries `status` (what /api/auth/* answered) and `upstream` (what the
// Worker answered, when the proxy passes it through). Nothing that existed before reads
// either — AuthModal uses err.message exactly as it did — but the resend needs them, because
// this path has no error CODES the way firebase/auth does. A rate limit arriving as
// `502 { upstream: 429 }` is indistinguishable from any other failure without them, and
// telling a rate-limited reader "that didn't send" is the specific thing R9.4 set out to
// stop doing.
//
// Throws on failure. Callers decide what that means: the register flow must NOT fail a
// signup over it — the account already exists in Firebase by then, and only the mail rides
// this path — so it reports the problem and points at Resend, while the resend button
// surfaces it directly.
export async function postAuthMail(path, user, firstName) {
  const idToken = await user.getIdToken();
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ firstName }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const err = new Error(detail.error || `Mail request failed (${res.status}).`);
    err.status = res.status;
    // functions/api/auth/send-verification.js collapses every non-OK Worker response into a
    // 502 and reports the Worker's own status here. It is the only view the browser gets of
    // what actually went wrong upstream.
    err.upstream = typeof detail.upstream === 'number' ? detail.upstream : null;
    throw err;
  }
  return res.json().catch(() => ({}));
}
