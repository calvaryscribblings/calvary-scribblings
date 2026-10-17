// ONE READER, ONE READ — the claim both read counters share (W49).
//
// Underscore-prefixed, so Pages does not route it. Used by functions/api/hit.js (stories) and
// functions/api/series/read.js (instalments), and by scripts/series/seed-reads.mjs.
//
// THE RACE THIS CLOSES. The story counter used to READ the ledger entry and then WRITE the entry
// and the increment, so two hits from one reader that arrived together could both read "absent"
// and both count. A claim is now ONE conditional PUT: the entry is read with its ETag (RTDB hashes
// an absent value too) and written `if-match` that ETag. Of any number of simultaneous first reads,
// exactly one PUT succeeds; every other answers 412, which means "already counted". The increment
// runs only for the winner, so the count moves once.
//
// The one direction this can fail: the claim lands and the increment then fails. That reader is
// under-counted by one, and never over-counted. An undercount is cosmetic; a double count is the
// fault this exists to fix.

/**
 * Claim `url` (a full RTDB REST URL to one ledger entry, `….json`) for a first read.
 * Returns true when THIS call wrote the entry, false when it already existed or another writer won.
 * Throws on any other failure, so a caller can fail closed rather than guess.
 */
export async function claimOnce(url, headers, value = { '.sv': 'timestamp' }) {
  const seen = await fetch(url, { headers: { ...headers, 'X-Firebase-ETag': 'true' } });
  if (!seen.ok) throw new Error(`ledger read ${seen.status}`);
  const current = await seen.json();
  if (current !== null && current !== undefined) return false;
  const etag = seen.headers.get('ETag') || seen.headers.get('etag');
  if (!etag) throw new Error('ledger read carried no ETag');
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json', 'if-match': etag },
    body: JSON.stringify(value),
  });
  if (put.status === 412) return false;
  if (!put.ok) throw new Error(`ledger claim ${put.status}`);
  return true;
}

/** The Bearer token on a request, or ''. The header only — a body never carries identity. */
export function bearerOf(request) {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  return m ? m[1].trim() : '';
}

/** UTC day key, YYYY-MM-DD — the calvary-hit-counter Worker's utcDay(0), so the buckets agree. */
export const utcDayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
