// W17 — PROOF THAT THE LIVE FIREWALL STOPS EVERY WRITE, THE LONG-POLLING FALLBACK INCLUDED.
//
//   node tests/live/firewall-proof.mjs [--site URL]          (needs serviceAccountKey.json)
//
// Signed in as the TEST READER (tests/live/test-reader.mjs), never a founder. A probe page served
// at the site's own origin loads Firebase 12.11.0 (the site's version) and writes one flag to
// the test reader's OWN record: users/{uid}/readStories/<nonce>. Owner-writable, created by this
// probe, removed by it (CLAUDE.md, probe rules 1 and 3).
//
//   CONTROL  the socket-only guard W9–W16 used, with the fallback FORCED (the SDK's own
//            previous_websocket_failure flag set, the database socket refused). The write should
//            LAND — which proves the fallback is real and that guard missed it. It is then removed.
//   P1       the W17 firewall, fallback forced, socket refused  → no ack, nothing lands.
//   P2       the W17 firewall, fallback forced, socket proxied  → no ack, nothing lands.
//   P3       the W17 firewall, ordinary socket                  → the database still READS, and the
//            write is stopped at the proxy; nothing lands.
//   P4       the real story page, fallback forced               → the test reader's records unchanged.
//   P5       the real story page, ordinary socket               → unchanged; the page's own writes
//            are counted as stopped.
// Then every record the test reader has is re-read and compared with the first read.
import { chromium } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from './test-reader.mjs';
import { installFirewall, newStats, statsLine, isWriteFrame } from './firewall.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const STORY = arg('--story', 'the-number-thirteen');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB_URL });
const adb = getDatabase();

const uid = await ensureTestReader();
const account = await testReaderSession(uid);
const WATCH = [...testReaderWatch(uid), ...[STORY].map((s) => `storyReads/${s}/${uid}`)];
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));
const before = await snapshot();

const PROBE_PATH = '/__w17-firewall-probe';
const PROBE_HTML = `<!doctype html><meta charset="utf-8"><title>w17 probe</title><script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getDatabase, ref, set, onValue } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js';
const app = initializeApp({ apiKey: '${account.idToken ? 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY' : ''}', authDomain: 'calvary-scribblings.firebaseapp.com', databaseURL: '${DB_URL}', projectId: 'calvary-scribblings' });
const auth = getAuth(app);
await new Promise((r) => onAuthStateChanged(auth, (u) => { if (u) r(); }));
const db = getDatabase(app);
window.__connected = false;
onValue(ref(db, '.info/connected'), (s) => { window.__connected = s.val() === true; });
window.__readOnce = (path, ms) => new Promise((r) => { const t = setTimeout(() => r('no-answer'), ms); onValue(ref(db, path), (s) => { clearTimeout(t); r(s.exists() ? 'read' : 'read-empty'); }, (e) => { clearTimeout(t); r('error:' + e.code); }, { onlyOnce: true }); });
window.__write = (path, value, ms) => Promise.race([set(ref(db, path), value).then(() => 'acked', (e) => 'error:' + (e.code || e.message)), new Promise((r) => setTimeout(() => r('no-ack'), ms))]);
window.__ready = true;
</script>`;

// The guard W9–W16 used, reproduced for the CONTROL only: it proxies the socket and drops write
// frames — and sees nothing else. `socket: 'refuse'` stands in for the socket failing once.
async function legacySocketOnly(ctx, { socket }) {
  const stats = { wsWritesStopped: 0 };
  await ctx.route('**/api/hit**', (r) => r.abort());
  await ctx.routeWebSocket(/firebasedatabase\.app|firebaseio\.com/, (ws) => {
    if (socket === 'refuse') { ws.close(); return; }
    const server = ws.connectToServer();
    ws.onMessage((m) => { let f; try { f = JSON.parse(String(m)); } catch { f = null; } if (isWriteFrame(f)) { stats.wsWritesStopped++; return; } server.send(m); });
    server.onMessage((m) => ws.send(m));
  });
  return stats;
}

const browser = await chromium.launch();
async function run({ guard, forceFallback, socket, target = 'probe' }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const seen = { lp: 0, lpCarryingFrames: 0, sockets: 0 };
  ctx.on('request', (req) => { const u = req.url(); if (/firebasedatabase\.app\/\.lp/.test(u)) { seen.lp++; if (/[?&]d0=|[?&]seg0=/.test(u)) seen.lpCarryingFrames++; } });
  const stats = guard === 'legacy' ? await legacySocketOnly(ctx, { socket }) : await installFirewall(ctx, { site: SITE, socket, stats: newStats() });
  const page = await ctx.newPage();
  page.on('websocket', () => { seen.sockets++; });
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ } });
  if (forceFallback) await page.addInitScript(() => { try { localStorage.setItem('firebase:previous_websocket_failure', 'true'); } catch { /* private */ } });
  await signInPage(page, SITE, account);
  let result = {};
  if (target === 'probe') {
    await page.route(SITE + PROBE_PATH, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PROBE_HTML }));
    await page.goto(SITE + PROBE_PATH);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    const key = `w17-firewall-probe-${Date.now()}`;
    result.read = await page.evaluate(() => window.__readOnce('cms_stories_index', 12000));
    result.write = await page.evaluate(([p]) => window.__write(p, true, 12000), [`users/${uid}/readStories/${key}`]);
    await page.waitForTimeout(3000);
    result.landed = (await adb.ref(`users/${uid}/readStories/${key}`).get()).exists();
    result.key = key;
  } else {
    await page.goto(`${SITE}/stories/${target}`, { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.evaluate(async () => { for (let y = 0; y < document.scrollingElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
    await page.waitForTimeout(6000);
  }
  await ctx.close();
  return { ...result, seen, stats };
}

let failed = 0;
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// CONTROL — twice. C1: the SDK's own flag set, as after any earlier failure. C2: no flag at all,
// the socket simply fails — the SDK records the failure itself and falls back.
for (const [name, forceFallback] of [['C1 (flag set)', true], ['C2 (socket fails, no flag)', false]]) {
  const c = await run({ guard: 'legacy', forceFallback, socket: 'refuse' });
  expect(c.seen.lp > 0 && c.seen.lpCarryingFrames > 0, `CONTROL ${name}: the SDK used long-polling (${c.seen.lp} .lp requests, ${c.seen.lpCarryingFrames} carrying frames)`);
  expect(c.write === 'acked' && c.landed, `CONTROL ${name}: under the W9–W16 socket-only guard the write LANDED (${c.write}) — the gap is real`);
  if (c.landed) await adb.ref(`users/${uid}/readStories/${c.key}`).remove();
  expect(!(await adb.ref(`users/${uid}/readStories/${c.key}`).get()).exists(), `CONTROL ${name}: the probe's own flag removed again`);
}

const p1 = await run({ guard: 'w17', forceFallback: true, socket: 'refuse' });
expect(p1.stats.lpAborted > 0 && p1.write === 'no-ack' && !p1.landed, `P1 fallback forced, socket refused: write ${p1.write}, landed ${p1.landed} · ${statsLine(p1.stats)}`);
const p2 = await run({ guard: 'w17', forceFallback: true, socket: 'proxy' });
expect(p2.write !== 'acked' && !p2.landed, `P2 fallback forced, socket proxied: write ${p2.write}, landed ${p2.landed} · ${statsLine(p2.stats)}`);
const p3 = await run({ guard: 'w17', forceFallback: false, socket: 'proxy' });
expect(p3.read === 'read', `P3 ordinary socket: the database still reads (${p3.read})`);
expect(p3.stats.wsWritesStopped > 0 && p3.write === 'no-ack' && !p3.landed, `P3 ordinary socket: write ${p3.write}, landed ${p3.landed} · ${statsLine(p3.stats)}`);
const p4 = await run({ guard: 'w17', forceFallback: true, socket: 'refuse', target: STORY });
expect(p4.stats.lpAborted > 0, `P4 the story page, fallback forced: ${statsLine(p4.stats)}`);
const p5 = await run({ guard: 'w17', forceFallback: false, socket: 'proxy', target: STORY });
console.log(`      P5 the story page, ordinary socket: ${statsLine(p5.stats)}`);
await browser.close();

const after = await snapshot();
const changed = WATCH.filter((p) => before[p] !== after[p]).map((p) => p.replace(uid, '{test reader}'));
expect(changed.length === 0, `every test-reader record re-read: ${changed.length ? 'CHANGED ' + changed.join(', ') : 'unchanged'}`);
console.log(failed ? `\nFAIL: ${failed}` : '\nPASS');
process.exit(failed ? 1 : 0);
