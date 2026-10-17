// W51 — FINDING A READER BY HANDLE IN THE SQUARE, WITHOUT THE `users` ROOT.
//
// The users ROOT is founder-only (it holds email and date of birth); only users/{uid} is public.
// Three Square paths read the root anyway, and for every reader who is not a founder each read
// threw: the @mention fallback in sendNotifications (which threw AFTER the post had saved, so the
// box never cleared and a second press posted a duplicate — W50 §2), the mention autocomplete,
// and the "+ New" message search. The same defect /search had until R46.
//
// So:
//   · a mention resolves through `usernames/{handle}`, the index, which is LOWERCASE — "@Bee"
//     looks up usernames/bee. A handle that does not resolve notifies nobody. There is no
//     fallback, because the only fallback there ever was is a read readers may not make.
//   · autocomplete and the message search match against `user_search` (world-readable). It is a
//     stored copy, so it is used to FIND; see app/search/page.js for that rule at length.
//
// Plain functions, no React and no Firebase import, so node --test runs them directly.

/** Every distinct handle mentioned in `text`, lowercased, in order of first appearance. */
export function mentionHandles(text) {
  const seen = new Set();
  for (const m of String(text || '').matchAll(/@(\w+)/g)) seen.add(m[1].toLowerCase());
  return [...seen];
}

/** The uid a handle belongs to, or null. `readIndex(handle)` returns usernames/{handle}'s value. */
export async function resolveHandle(handle, readIndex) {
  const key = String(handle || '').toLowerCase();
  if (!key) return null;
  const uid = await readIndex(key);
  return typeof uid === 'string' && uid ? uid : null;
}

/**
 * Rows of user_search that match `query`, as [{ uid, username, displayName, avatarUrl }].
 * `fields` chooses what is matched: the autocomplete matches handles only, the message search
 * names too.
 */
export function matchReaders(index, query, { fields = ['username'], exclude = null, limit = 5 } = {}) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const out = [];
  for (const [uid, u] of Object.entries(index || {})) {
    if (!u || typeof u !== 'object' || uid === exclude) continue;
    if (!fields.some((f) => String(u[f] || '').toLowerCase().includes(q))) continue;
    out.push({ uid, username: u.username || '', displayName: u.displayName || '', avatarUrl: u.avatarUrl || '' });
    if (out.length >= limit) break;
  }
  return out;
}

/** The interim reply-on-a-reply prefill (W51 §3): "@handle " — or nothing when there is no handle. */
export function replyPrefill(handle) {
  const h = String(handle || '').replace(/^@/, '').trim();
  return h ? `@${h} ` : '';
}
