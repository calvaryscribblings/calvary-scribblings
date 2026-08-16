// Client half of purchased-title streaming. The endpoint is functions/api/bookstore/stream.js.
//
// Thin by the same rule as ./checkout.js: who you are and whether you own the book are decided
// server-side, because neither can be trusted from here. What comes back is a signed URL with
// about five minutes on it, good for exactly one fetch by the Reading Room.
//
// The thrown error carries a `code` so the reader can say the right thing — 'not_purchased'
// invites a purchase, 'revoked' does not, 'signed_out' asks for a sign-in. A single opaque
// error message would collapse three different situations into one wrong sentence.
//
// /api/ is in PASS_THROUGH_PATHS in public/sw.js, so the service worker never caches or
// replays this. That matters here: a cached signed URL is a stale one.

export class StreamError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StreamError';
    this.code = code || null;
  }
}

export async function requestStreamUrl(user, titleId) {
  if (!user) throw new StreamError('Sign in to read this book.', 'signed_out');
  if (!titleId) throw new StreamError('This book cannot be opened yet.', 'unavailable');

  let idToken;
  try {
    // Forces a refresh when the cached token is near expiry; cheap otherwise.
    idToken = await user.getIdToken();
  } catch {
    throw new StreamError('Your session has expired. Please sign in again.', 'signed_out');
  }

  let res;
  try {
    res = await fetch('/api/bookstore/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, titleId }),
    });
  } catch {
    throw new StreamError('No connection. Please check your network and try again.', 'offline');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.url) {
    throw new StreamError(
      data?.error || 'Could not open your copy just now. Please try again.',
      data?.code || (res.status === 401 ? 'signed_out' : 'unavailable'),
    );
  }

  // R11.22 — `version` is carried out of here now instead of being dropped on the floor.
  // It is the Cloud Storage generation of master.epub (functions/api/bookstore/stream.js),
  // which changes when and ONLY when the object is replaced, and it is the SAME value the
  // native app already keys its on-device cache by. That makes it the one fact both surfaces
  // hold about which bytes they are reading, so it is what pins a stored CFI —
  // see docs/reading-position-pin.md.
  //
  // null is a stated fact and NOT an omission (the endpoint's own contract): the metadata read
  // failed, so nothing here knows which copy this is. The reader writes no pin in that case,
  // which lands a position back in the unpinned state that ships today — safe, and readable
  // by fraction alone. Guessing a version would be the one genuinely dangerous move.
  return {
    url: data.url,
    expiresAt: data.expiresAt || null,
    version: typeof data.version === 'string' && data.version ? data.version : null,
  };
}
