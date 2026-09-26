// W16 — THE FOUNDER SESSION AND THE WRITE FIREWALL, shared by the storybar harnesses. Extracted
// verbatim from W9's lock-shots.mjs. A signed-in story visit WRITES to the account (readStories,
// readCount, streak, points), so every harness that signs in as a founder proxies the Realtime
// Database socket and DROPS EVERY CLIENT WRITE, aborts /api/hit, and re-reads the account's
// records before and after (CLAUDE.md, "Probes that write to live data").
//
// Needs firebase-admin initialised by the caller (serviceAccountKey.json, git-ignored).
import { getAuth } from 'firebase-admin/auth';

export const API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
export const IKENNA = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
export const WATCH = [`users/${IKENNA}/readStories`, `users/${IKENNA}/readCount`, `points/${IKENNA}`, `userStreaks/${IKENNA}`, `founder_preview/${IKENNA}`, `library_notifications/${IKENNA}`];

export const firewallStats = { dropped: 0 };

export async function session() {
  const tok = await getAuth().createCustomToken(IKENNA);
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, returnSecureToken: true }) })).json();
  if (!r.idToken) throw new Error('custom-token sign-in failed');
  return r;
}
export const SIGNED_IN = ({ key, user }) => new Promise((resolve) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user });
    tx.oncomplete = () => resolve();
  };
});

const WRITE_ACTIONS = new Set(['p', 'm', 'o', 'om', 'oc', 'on']);
export async function firewall(page) {
  await page.route('**/api/hit**', (r) => r.abort());
  await page.routeWebSocket(/firebasedatabase\.app|firebaseio\.com/, (ws) => {
    const server = ws.connectToServer();
    let pending = 0, parts = [];
    const decide = (text) => {
      try {
        const f = JSON.parse(text);
        if (f?.t === 'd' && WRITE_ACTIONS.has(f?.d?.a)) { firewallStats.dropped++; return false; }
      } catch { /* not JSON: pass */ }
      return true;
    };
    ws.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString();
      // The SDK splits a large frame: first a bare count, then that many chunks.
      if (pending === 0 && /^\d+$/.test(text) && Number(text) > 1) { pending = Number(text); parts = []; return; }
      if (pending > 0) {
        parts.push(text); pending--;
        if (pending === 0) { const whole = parts.join(''); if (decide(whole)) { server.send(String(parts.length)); parts.forEach((p) => server.send(p)); } }
        return;
      }
      if (decide(text)) server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
}

