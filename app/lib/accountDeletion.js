// ACCOUNT DELETION, THE WEB HALF — the copy and the flow behind DeleteAccountModal.
//
// Ruled by Ikenna, 23 Sep 2026: NO grace period. Deletion is immediate and permanent. The
// server does all of it (functions/api/account/delete.js); this file is what the reader is told
// and the order the browser does things in. Pure — every Firebase and network call is handed
// in — so tests/account/web-flow.test.mjs drives the real sequence with stand-ins.
//
// THE COPY DESCRIBES EXACTLY WHAT THE ENDPOINT DOES, NOTHING MORE. If the endpoint changes what
// it removes, this list changes in the same commit.

export const DELETE_ENDPOINT = '/api/account/delete';

export const COPY = {
  title: 'Delete your account',
  intro: 'This happens straight away and can’t be undone. There’s no waiting period, and nothing we can restore afterwards.',
  goesLabel: 'What goes',
  goes: [
    'your account, profile and @handle',
    'your reading history, badges, points and places on the boards',
    'your comments and replies',
    'your Square posts and Open Pages pieces',
    'your followers and the people you follow',
    'the messages you’ve sent',
  ],
  confirmLabel: 'Type your username to confirm',
  cancel: 'Cancel',
  confirm: 'Delete account',
  working: 'Deleting…',
  reauthTitle: 'Sign in again to continue',
  reauthBody: 'For your security, please sign in once more. Your account is deleted as soon as you do.',
  reauthPassword: 'Your password',
  reauthPasswordButton: 'Sign in and delete',
  reauthGoogleButton: 'Continue with Google',
  reauthAppleButton: 'Continue with Apple',
  reauthFailed: 'We couldn’t confirm it’s you, so nothing has been deleted. Please try again.',
  failed: 'We couldn’t finish deleting your account, so you’re still signed in. Please try again — it picks up where it stopped. If it keeps failing, email contact@calvaryscribblings.co.uk.',
  signoff: 'We’re sorry to see you go.',
  // Settings → danger zone, above the button that opens the modal.
  settingsPanel: 'Deletion is immediate and permanent. Your account, profile and everything you’ve written here go straight away, and we can’t restore them.',
  // /account/deleted, after success.
  doneKicker: 'Account deleted',
  doneTitle: 'Your account has been deleted.',
  doneBody: 'Your profile and handle are gone, and you’ve been signed out. Your comments, posts and the rest of your activity are cleared from the site within the hour.',
};

// ── THE TWO CONDITIONAL LINES ─────────────────────────────────────────────────────────────
// The membership line is RULED (Ikenna, 24 Sep 2026, W3): deleting an account does not refund
// unused time, and the confirmation says so. The endpoint cancels every subscription the
// providers hold for the reader (functions/api/account/_deletion.js) and refunds nothing.
// Kept together, here and nowhere else, so either can change in a single edit. Each shows only
// to the reader it is true for.
export const CONDITIONAL_LINES = {
  // Shown when the reader holds a paid tier right now — a subscription OR a live pass. The
  // endpoint cancels a subscription with no refund; a pass simply ends with the account.
  membership: 'Your membership ends now, and the time left on it isn’t refunded.',
  // Shown only to readers with users/{uid}/isAuthor. The endpoint never touches cms_stories.
  author: 'The stories you’ve published with Calvary Scribblings stay published.',
};

/** The conditional lines this reader should see, in order. */
export function conditionalLines({ hasPaidMembership, isAuthor }) {
  const out = [];
  if (hasPaidMembership === true) out.push(CONDITIONAL_LINES.membership);
  if (isAuthor === true) out.push(CONDITIONAL_LINES.author);
  return out;
}

/** A tier other than free is a paid membership, whether a subscription or a pass holds it up. */
export const hasPaidMembership = (membership) => !!membership && (
  (typeof membership.tier === 'string' && membership.tier !== 'free')
  // W3: a live billing record counts even while the tier reads free (a grant still in flight).
  || membership.status === 'active' || membership.status === 'past_due'
);

/**
 * The flow. Confirm → call → (sign in again → call ONCE more) → sign out.
 *
 * @param deps.getIdToken(force)  → string          the current user's ID token
 * @param deps.call(token)        → {status, body}  POST to the endpoint
 * @param deps.reauthenticate()   → Promise         resolves when the reader has signed in again;
 *                                                   rejects if they could not, or cancelled
 * @param deps.signOut()          → Promise
 * @returns {Promise<{ok:true} | {ok:false, stage:'reauth'|'endpoint', message}>}
 *
 * The one rule: a failed deletion never looks like success. signOut runs on a 200 with
 * deleted:true and on nothing else.
 */
export async function runDeleteFlow(deps) {
  let res = await attempt(deps, false);
  if (needsRecentLogin(res)) {
    try {
      await deps.reauthenticate();
    } catch {
      return { ok: false, stage: 'reauth', message: COPY.reauthFailed };
    }
    res = await attempt(deps, true);
  }
  if (res.status === 200 && res.body?.deleted === true) {
    await deps.signOut();
    return { ok: true };
  }
  return { ok: false, stage: 'endpoint', message: messageFor(res) };
}

async function attempt(deps, force) {
  try {
    const token = await deps.getIdToken(force);
    return await deps.call(token);
  } catch {
    return { status: 0, body: null };
  }
}

const needsRecentLogin = (res) => res.status === 401 && res.body?.code === 'requires_recent_login';

function messageFor(res) {
  // The limiter's sentence says WHEN to come back, which ours cannot.
  if ((res.status === 429 || res.status === 503) && typeof res.body?.error === 'string') {
    return `${res.body.error} You’re still signed in.`;
  }
  return COPY.failed;
}

/** The browser's call. Separate so the flow above stays network-free under test. */
export async function callDeleteEndpoint(token) {
  const r = await fetch(DELETE_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  let body = null;
  try { body = await r.json(); } catch { /* a non-JSON answer is a failure; status says so */ }
  return { status: r.status, body };
}
