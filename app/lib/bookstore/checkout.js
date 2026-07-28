// Client half of the bookstore checkout. The endpoint is functions/api/bookstore/checkout.js.
//
// Deliberately thin: it mints a fresh ID token, posts, and hands back a URL. Every decision
// that matters — who the buyer is, what the book costs, whether it is even on sale — is made
// server-side, because none of it can be trusted from here.
//
// Note for anyone adding an offline path later: /api/ is in PASS_THROUGH_PATHS in
// public/sw.js, so the service worker never intercepts or replays this. That is correct and
// must stay that way; a replayed checkout is a second charge.

// getIdToken() returns a cached token until it is close to expiry, so this is cheap on the
// common path and refreshes itself on the uncommon one. The server verifies it either way.
export async function createCheckoutSession(user, titleId, currency = 'gbp') {
  if (!user) throw new Error('Sign in to buy this book.');
  if (!titleId) throw new Error('This title cannot be purchased yet.');

  let idToken;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new Error('Your session has expired. Please sign in again.');
  }

  let res;
  try {
    res = await fetch('/api/bookstore/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, titleId, currency }),
    });
  } catch {
    throw new Error('No connection. Please check your network and try again.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || 'Checkout could not be opened. Please try again.');
  }
  return data.url;
}
