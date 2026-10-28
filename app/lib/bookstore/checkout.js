// Client half of the bookstore checkout. The endpoint is functions/api/bookstore/checkout.js.
//
// Deliberately thin: it mints a fresh ID token, posts, and hands back a URL. Every decision
// that matters — who the buyer is, what the book costs, whether it is even on sale — is made
// server-side, because none of it can be trusted from here.
//
// Note for anyone adding an offline path later: /api/ is in PASS_THROUGH_PATHS in
// public/sw.js, so the service worker never intercepts or replays this. That is correct and
// must stay that way; a replayed checkout is a second charge.

// ── R8.3: TWO RAILS, ONE FUNCTION ────────────────────────────────────────────────────────
// Stripe cannot settle naira, so naira has its own endpoint. Which one is called is decided
// HERE, from the EFFECTIVE currency — the one priceFor() returned after any fallback, never the
// one the reader happens to be browsing in. A reader in Lagos looking at a title with no NGN
// price is charged in pounds on the Stripe rail while the selector still reads NGN, and that is
// correct: the selector is a preference, the effective currency is a fact about the title.
//
// THE TWO ENDPOINTS HAVE DIFFERENT CONTRACTS, deliberately, and this is the seam:
//   /api/bookstore/checkout           { idToken, titleId, currency }  — gbp | usd
//   /api/bookstore/paystack-checkout  { idToken, titleId }            — NGN by construction
// The naira endpoint takes no currency parameter because the currency is a property of which
// endpoint you called. Do not "harmonise" them by adding one; the asymmetry is the design.
//
// NO AMOUNT CROSSES THIS BOUNDARY in either direction. Both endpoints read the price from
// bookstore_titles server-side. A client-supplied amount is a client-supplied discount.
const RAILS = {
  ngn: { url: '/api/bookstore/paystack-checkout', sendsCurrency: false },
  gbp: { url: '/api/bookstore/checkout', sendsCurrency: true },
  usd: { url: '/api/bookstore/checkout', sendsCurrency: true },
};

export const railFor = (currency) => RAILS[currency] || RAILS.gbp;

// getIdToken() returns a cached token until it is close to expiry, so this is cheap on the
// common path and refreshes itself on the uncommon one. The server verifies it either way.
export async function createCheckoutSession(user, titleId, currency = 'gbp') {
  if (!user) throw new Error('Sign in to buy this book.');
  if (!titleId) throw new Error('This title can’t be purchased yet.');

  let idToken;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const rail = railFor(currency);
  const body = rail.sendsCurrency
    ? { idToken, titleId, currency }
    : { idToken, titleId };

  let res;
  try {
    res = await fetch(rail.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Please check your network and try again.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    // The naira endpoint answers with its own copy that names the alternative — 409
    // not_priced_in_ngn says "buy it in pounds instead", 400 no_email says to add an address.
    // Preferring data.error keeps those in the reader's hands rather than replacing them with
    // this file's generic line.
    throw new Error(data?.error || 'Checkout couldn’t be opened. Please try again.');
  }
  return data.url;
}

// ── FREE-TITLES: THE CLAIM ───────────────────────────────────────────────────────────────
// A title free in the reader's currency is not checked out — Stripe and Paystack cannot take a
// zero charge. functions/api/bookstore/claim.js grants it instead, through the same write as a
// sale. The body carries the titleId and NOTHING ELSE: the server re-reads the title and decides
// "free for this reader" from the edge's country, never from a currency or a price sent here.
//
// Resolves { granted } or { already }; throws with the server's own sentence otherwise.
export async function claimFreeTitle(user, titleId) {
  if (!user) throw new Error('Sign in to add this book.');
  if (!titleId) throw new Error('This title can’t be added yet.');

  let idToken;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new Error('Your session has expired. Please sign in again.');
  }

  let res;
  try {
    res = await fetch('/api/bookstore/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ titleId }),
    });
  } catch {
    throw new Error('No connection. Please check your network and try again.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Couldn’t add this book just now. Please try again.');
  return { granted: !!data.granted, already: !!data.already };
}
