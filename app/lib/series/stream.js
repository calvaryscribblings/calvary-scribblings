// Client half of instalment streaming. The endpoint is functions/api/series/stream.js.
//
// Thin, by the same rule as app/lib/bookstore/stream.js: who you are, whether the instalment
// has released and whether your membership covers it are all decided server-side, because
// none of the three can be trusted from here. What comes back is a signed URL with about
// five minutes on it, good for one fetch by the Reading Room.
//
// The thrown error carries a `code` so the surface can say the right thing. Four states, four
// sentences — 'not_released' is a date, 'tier_too_low' is an upgrade, 'signed_out' is a
// sign-in, 'unavailable' is a retry. Collapsing them into one message would tell a Platinum
// member that next month's instalment is not for their tier.
//
// /api/ is in PASS_THROUGH_PATHS in public/sw.js, so the service worker never caches or
// replays this. A cached signed URL is a stale one.

export class SeriesStreamError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'SeriesStreamError';
    this.code = code || null;
    // Carried so a caller can render the actual date on a not_released refusal, and the
    // actual tier on a tier_too_low one, rather than a generic line.
    this.releaseAtMs = typeof extra.releaseAtMs === 'number' ? extra.releaseAtMs : null;
    this.requiredTier = typeof extra.requiredTier === 'string' ? extra.requiredTier : null;
    this.reason = typeof extra.reason === 'string' ? extra.reason : null;
  }
}

export async function requestInstalmentUrl(user, instalmentId) {
  if (!instalmentId) throw new SeriesStreamError('This instalment cannot be opened yet.', 'unavailable');

  // NOT short-circuited on a missing user. The endpoint answers not_released BEFORE it looks
  // at identity, so a signed-out reader tapping a future instalment gets the date rather than
  // a sign-in prompt that would not have helped. Signing in is only ever asked for something
  // signing in can actually reach.
  let idToken = null;
  if (user) {
    try {
      idToken = await user.getIdToken();
    } catch {
      throw new SeriesStreamError('Your session has expired. Please sign in again.', 'signed_out');
    }
  }

  let res;
  try {
    res = await fetch('/api/series/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(idToken ? { idToken, instalmentId } : { instalmentId }),
    });
  } catch {
    throw new SeriesStreamError('No connection. Please check your network and try again.', 'offline');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.url) {
    throw new SeriesStreamError(
      data?.error || 'Could not open this instalment just now. Please try again.',
      data?.code || (res.status === 401 ? 'signed_out' : 'unavailable'),
      data || {},
    );
  }

  // `version` is the Cloud Storage generation of this instalment's master.epub. Same field,
  // same meaning and same contract as the bookstore's: it is the one fact both surfaces hold
  // about WHICH BYTES they are reading, so it is what pins a stored CFI. null is a stated
  // fact and not an omission — the metadata read failed, nothing knows which copy this is,
  // and the reader writes no pin, which lands the position back in the unpinned state that
  // reads by fraction alone. See docs/reading-position-pin.md.
  return {
    url: data.url,
    expiresAt: data.expiresAt || null,
    version: typeof data.version === 'string' && data.version ? data.version : null,
    // Which grant opened it — 'platinum' or 'gold_taste'. A surface can honestly label a
    // Gold reader's one free instalment without guessing from freeForGold itself.
    reason: typeof data.reason === 'string' ? data.reason : null,
  };
}
