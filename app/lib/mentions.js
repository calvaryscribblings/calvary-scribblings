import { db } from './firebase';

const MENTION_RE = /(^|\s)@([a-z0-9_]{3,20})\b/gi;

export function extractMentions(text) {
  if (!text) return [];
  const handles = new Set();
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    handles.add(m[2].toLowerCase());
  }
  return [...handles];
}

export async function resolveHandles(handles) {
  if (!handles || !handles.length) return {};
  const { ref, get } = await import('firebase/database');
  const results = await Promise.all(
    handles.map(h => get(ref(db, `usernames/${h}`)).then(s => ({ h, uid: s.exists() ? s.val() : null })))
  );
  const map = {};
  results.forEach(({ h, uid }) => { if (uid) map[h] = uid; });
  return map;
}

export async function notifyMentions({ text, slug, fromUid, fromName, excludeUid }) {
  const handles = extractMentions(text);
  if (!handles.length) return;
  const { ref, push } = await import('firebase/database');
  const map = await resolveHandles(handles);
  const targets = Object.values(map).filter(uid => uid && uid !== excludeUid);
  if (!targets.length) return;
  const snippet = (text || '').slice(0, 140);
  await Promise.all(targets.map(uid => push(ref(db, `library_notifications/${uid}`), {
    type: 'mention', fromUid, fromName,
    slug, commentText: snippet, read: false, createdAt: Date.now(),
  })));
}

export async function searchUsernames(prefix, limit = 5) {
  const p = (prefix || '').toLowerCase().trim();
  if (!p) return [];
  const { ref, get } = await import('firebase/database');
  const snap = await get(ref(db, 'usernames'));
  if (!snap.exists()) return [];
  const all = snap.val();
  const matches = Object.keys(all).filter(u => u.startsWith(p)).slice(0, limit);
  if (!matches.length) return [];
  const users = await Promise.all(matches.map(async u => {
    const uid = all[u];
    const userSnap = await get(ref(db, `users/${uid}`));
    return userSnap.exists() ? { username: u, uid, ...userSnap.val() } : null;
  }));
  return users.filter(Boolean);
}

export function renderWithMentions(text, options = {}) {
  if (!text) return [text];
  const parts = [];
  let last = 0;
  let m;
  const re = /(^|\s)@([a-z0-9_]{3,20})\b/gi;
  while ((m = re.exec(text)) !== null) {
    const [full, pre, handle] = m;
    const start = m.index + pre.length;
    const end = start + 1 + handle.length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ type: 'mention', handle });
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
