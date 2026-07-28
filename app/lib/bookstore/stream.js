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

  return { url: data.url, expiresAt: data.expiresAt || null };
}
