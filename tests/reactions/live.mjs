// W13 — THE REACTIONS ON THE REAL PAGES: the local static export (out/, from `next build`),
// reading the LIVE database, signed in as Ikenna, in WebKit and Chromium at 390, 820 and 1180.
//
//   node tests/reactions/live.mjs <outDir>          (needs out/ and serviceAccountKey.json)
//
// Surfaces: a story's responses (/stories/…), the Square (clock pinned to 21:00 London, when
// the room is open), and an Open Pages piece (its own heart, then its thread).
//
// NOTHING IS WRITTEN (CLAUDE.md, "Probes that write to live data"). The Realtime Database socket
// is proxied, and EVERY client write — the reaction, the count transaction, the page's own
// read-tracking — is answered by the proxy and never forwarded: "ok" when the proof wants a
// save to succeed, "permission_denied" when it forces a failure. The records the taps aim at
// are read before and after, and must match.
//
// Per page: the row measured, the words (Responses / Reply / Cancel), the ground behind the
// button against the colour the burst's hole is painted in, frames of a real tap, a forced
// failure, Reduce Motion, and nothing moving while the effect plays. Shots stay in <outDir>.
import { chromium, webkit } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { FAIL_COPY } from '../../app/components/conversation/Reaction.js';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tests/reactions/live.mjs <outDir>'); process.exit(2); }
if (!existsSync('out/square.html') && !existsSync('out/square/index.html')) { console.error('out/ is missing — run `npm run build` first'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';
const IKENNA = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const PORT = 4351;
const SITE = `http://127.0.0.1:${PORT}`;
const STORY = process.env.W13_STORY || '47-sessions';
const PIECE = process.env.W13_PIECE || '-Ow9RS35i31C0Ko30y4Y';
const SIZES = [[390, 844], [820, 1180], [1180, 820]];

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

// ── integrity: what a tap could touch, read before and after ────────────────
const WATCH = [`comments/${STORY}`, `comment_reactions/${STORY}/${IKENNA}`, 'square_reactions', `open_pages_reactions/${PIECE}`, `comment_likes/${PIECE}`, `comments/${PIECE}`];
const snapshot = async () => {
  const out = Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));
  const posts = (await adb.ref('square_posts').get()).val() || {};
  out['square_posts:counts'] = JSON.stringify(Object.fromEntries(Object.entries(posts).map(([k, v]) => [k, [v.likeCount, v.clapCount, v.fireCount]])));
  return out;
};

async function session() {
  const tok = await getAuth().createCustomToken(IKENNA);
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, returnSecureToken: true }) })).json();
  if (!r.idToken) throw new Error('custom-token sign-in failed');
  return r;
}
const SIGNED_IN = ({ key, user }) => new Promise((resolve) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user });
    tx.oncomplete = () => resolve();
  };
});

// The firewall: every write is ANSWERED here and never reaches the server.
const WRITE_ACTIONS = new Set(['p', 'm', 'o', 'om', 'oc', 'on']);
const wall = { mode: 'ok', answered: 0, forwarded: 0 };
async function firewall(page) {
  await page.route('**/api/hit**', (r) => r.abort());
  await page.routeWebSocket(/firebasedatabase\.app|firebaseio\.com/, (ws) => {
    const server = ws.connectToServer();
    let pending = 0, parts = [];
    const handle = (text, raw) => {
      let f; try { f = JSON.parse(text); } catch { f = null; }
      if (f?.t === 'd' && WRITE_ACTIONS.has(f?.d?.a)) {
        wall.answered++;
        const deny = wall.mode === 'deny' && (f.d.a === 'p' || f.d.a === 'm');
        // The server pushes an accepted write to every listener on its path BEFORE it acks, and
        // the SDK relies on that: on the ack it drops its local copy and shows the server's. So an
        // "ok" answered here must be preceded by that push, or the page falls back to the old value.
        if (!deny && (f.d.a === 'p' || f.d.a === 'm')) ws.send(JSON.stringify({ t: 'd', d: { a: f.d.a === 'p' ? 'd' : 'm', b: { p: f.d.b.p, d: f.d.b.d } } }));
        ws.send(JSON.stringify({ t: 'd', d: { r: f.d.r, b: deny ? { s: 'permission_denied', d: 'Permission denied' } : { s: 'ok', d: '' } } }));
        return;
      }
      if (raw !== undefined) server.send(raw); else { server.send(String(parts.length)); parts.forEach((p) => server.send(p)); }
    };
    ws.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString();
      if (pending === 0 && /^\d+$/.test(text) && Number(text) > 1) { pending = Number(text); parts = []; return; }
      if (pending > 0) { parts.push(text); pending--; if (pending === 0) handle(parts.join('')); return; }
      handle(text, m);
    });
    server.onMessage((m) => ws.send(m));
  });
}

async function open(browser, [w, h], account, { reduce = false, squareOpen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: w < 1000 && browser.browserType().name() === 'chromium', serviceWorkers: 'block', reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  if (squareOpen) await page.clock.setFixedTime(new Date('2026-09-26T20:00:00Z')); // 21:00 London (BST)
  await firewall(page);
  await page.goto(SITE + '/terms', { waitUntil: 'domcontentloaded' });
  await page.evaluate(SIGNED_IN, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user: {
    uid: IKENNA, email: null, emailVerified: true, isAnonymous: false, providerData: [], displayName: 'Ikenna Okpara',
    stsTokenManager: { refreshToken: account.refreshToken, accessToken: account.idToken, expirationTime: Date.now() + 3500e3 },
    createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
  } });
  return { ctx, page };
}

// The pixel actually painted at (x, y) of the viewport — decoded in the page from a screenshot.
async function pixel(page, x, y) {
  const png = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  }, png);
}
const rgbOf = (s) => (s?.match(/\d+/g) || []).slice(0, 3).map(Number);

async function surface(browser, size, account, spec, tag) {
  const { ctx, page } = await open(browser, size, account, { squareOpen: spec.squareOpen });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  wall.mode = 'ok';
  await page.goto(SITE + spec.path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('.rx:not([data-inert])').length >= n, spec.minButtons, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const row = page.locator(spec.row).first();
  await row.scrollIntoViewIfNeeded();
  await page.evaluate((sel) => { const r = document.querySelector(sel); window.scrollBy(0, r.getBoundingClientRect().top - window.innerHeight / 2); }, spec.row);
  await page.waitForTimeout(400);

  // The row, measured.
  const m = await page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('.rx')].map((b) => {
    const r = b.getBoundingClientRect(), i = b.querySelector('.rx-icon').getBoundingClientRect(), c = b.querySelector('.rx-count').getBoundingClientRect();
    const cs = getComputedStyle(b.querySelector('.rx-count'));
    return { kind: b.dataset.kind, pressed: b.getAttribute('aria-pressed'), w: +r.width.toFixed(2), h: r.height, icon: i.width, gap: +(c.left - i.right).toFixed(2), fs: cs.fontSize, fvn: cs.fontVariantNumeric, n: b.querySelector('.rx-count').textContent };
  }), spec.row);
  check(`${tag}: kinds ${spec.kinds}`, m.map((x) => x.kind).join() === spec.kinds, m.map((x) => x.kind).join());
  check(`${tag}: slots`, m.every((x) => x.h === 44 && (x.w === 44 || (Number(x.n) >= 100 && x.w > 44)) && x.icon === spec.icon && Math.abs(x.gap - 5) < 0.01 && x.fs === '14px' && /tabular-nums/.test(x.fvn)),
    m.map((x) => `${x.kind} ${x.w}×${x.h} icon ${x.icon} gap ${x.gap} "${x.n}"`).join('; '));

  // The words.
  if (spec.words) {
    const wds = await page.evaluate(spec.words);
    for (const [k, v, ok] of wds) check(`${tag}: ${k}`, ok, v);
  }

  // The probe: the row's first reaction, turned off first (quietly, answered at the proxy) if
  // Ikenna had already reacted, so every tap below is a real ON.
  await page.evaluate(async (sel) => {
    const b = document.querySelector(sel).querySelector('.rx');
    b.setAttribute('data-w13-probe', '');
    if (b.getAttribute('aria-pressed') === 'true') {
      b.click(); await new Promise((r) => setTimeout(r, 600));
      for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
    }
    b.scrollIntoView({ block: 'center' });
  }, spec.row);
  await page.waitForTimeout(300);
  const target = '.rx[data-w13-probe]';
  const tb = await page.locator(target).boundingBox();
  const painted = await pixel(page, Math.round(tb.x + tb.width - 3), Math.round(tb.y + 3));
  await page.screenshot({ path: join(OUT, `${tag}-rest.png`), clip: { x: Math.max(0, tb.x - 40), y: tb.y - 30, width: Math.min(360, size[0] - Math.max(0, tb.x - 40)), height: 104 } });

  // A real tap, frozen.
  const kind = await page.locator(target).getAttribute('data-kind');
  const frames = [];
  for (const t of [120, 300, 600]) {
    const hole = await page.evaluate(async ({ target, t }) => {
      const b = document.querySelector(target);
      if (b.getAttribute('aria-pressed') === 'true') { b.click(); await new Promise((r) => setTimeout(r, 400)); }
      b.click(); await new Promise((r) => setTimeout(r, 0));
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
      const circles = b.querySelectorAll('.rx-fx > circle');
      return { hole: circles[1]?.getAttribute('fill') || null, masked: !!b.querySelector('.rx-fx mask') };
    }, { target, t });
    const bb = await page.locator('.rx[data-w13-probe]').boundingBox();
    const shot = join(OUT, `${tag}-${kind}-${t}ms.png`);
    await page.screenshot({ path: shot, clip: { x: Math.max(0, bb.x - 40), y: bb.y - 30, width: Math.min(360, size[0] - Math.max(0, bb.x - 40)), height: 104 } });
    frames.push(hole);
    await page.evaluate(() => { for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
  }
  const hole = frames[0];
  if (kind === 'heart' || kind === 'like') {
    const hc = rgbOf(hole.hole);
    check(`${tag}: the hole is painted in the exact ground`, !hole.masked && hc.length === 3 && hc.every((v, i) => Math.abs(v - painted[i]) <= 1), `hole ${hole.hole}, painted rgb(${painted.join(', ')})`);
  }

  // Nothing moves while an effect plays; no long task.
  let cdp = null;
  if (process.env.W13_PROFILE && browser.browserType().name() === 'chromium') {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  }
  const stab = await page.evaluate(async () => {
    const b = document.querySelector('.rx[data-w13-probe]');
    const scope = b.closest('.rx-row').parentElement.parentElement;
    const nodes = [...scope.querySelectorAll('*')].filter((n) => !n.closest('.rx-icon') && !n.closest('.rx-count'));
    const snap = () => nodes.map((n) => { const r = n.getBoundingClientRect(); return `${r.left},${r.top},${r.width},${r.height}`; }).join('|');
    const out = { longtasks: 0, moved: 0, frames: 0, maxGap: 0 };
    try { new PerformanceObserver((l) => { out.longtasks += l.getEntries().length; }).observe({ type: 'longtask' }); } catch {}
    // Turn it off quietly first so the tap below is an ON.
    if (b.getAttribute('aria-pressed') === 'true') { b.click(); await new Promise((r) => setTimeout(r, 400)); for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); }
    const base = snap();
    out.n0 = Number(b.querySelector('.rx-count .n:last-child')?.textContent || 0);
    b.click();
    const t0 = performance.now(); let last = t0;
    while (performance.now() - t0 < 1300) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now(); out.maxGap = Math.max(out.maxGap, now - last); last = now; out.frames++;
      if (snap() !== base) out.moved++;
    }
    out.nodes = nodes.length;
    return out;
  });
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
    console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `    ${v.toFixed(1)}ms ${k}`).join('\n'));
  }
  const stuck = await page.evaluate(() => { const b = document.querySelector('.rx[data-w13-probe]'); return { pressed: b.getAttribute('aria-pressed'), n: b.querySelector('.rx-count .n:last-child')?.textContent }; });
  check(`${tag}: a saved tap stays on, its count with it`, stuck.pressed === 'true' && Number(stuck.n) === stab.n0 + 1, `${JSON.stringify(stuck)} from ${stab.n0}`);
  check(`${tag}: nothing around the row moves while it plays`, stab.moved === 0, `${stab.nodes} boxes over ${stab.frames} frames`);
  check(`${tag}: no long task`, stab.longtasks === 0, `max frame gap ${stab.maxGap.toFixed(1)}ms`);

  // A forced failure, through the page's own toggle and the database's own refusal.
  wall.mode = 'deny';
  const fail = await page.evaluate(async () => {
    const b = document.querySelector('.rx[data-w13-probe]');
    const n0 = b.querySelector('.rx-count').textContent;
    const was = b.getAttribute('aria-pressed');
    b.click();
    const note = b.closest('.rx-row').parentElement.querySelector('.rx-note');
    let shake = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 20));
      const a = b.querySelector('.rx-icon').getAnimations()[0];
      if (a && !shake) shake = { d: a.effect.getTiming().duration, xs: a.effect.getKeyframes().map((k) => k.transform).join('|') };
      if (note?.textContent) break;
    }
    return { was, now: b.getAttribute('aria-pressed'), n0, n1: b.querySelector('.rx-count .n:last-child')?.textContent, note: note?.textContent, shake };
  });
  await page.waitForTimeout(80);
  const fb = await page.locator('.rx[data-w13-probe]').boundingBox();
  await page.screenshot({ path: join(OUT, `${tag}-failure.png`), clip: { x: Math.max(0, fb.x - 40), y: fb.y - 30, width: Math.min(360, size[0] - Math.max(0, fb.x - 40)), height: 130 } });
  check(`${tag}: a refused save turns back, shakes and says so`, fail.now === fail.was && fail.n1 === fail.n0 && fail.note === FAIL_COPY && fail.shake?.d === 300 && /-3px/.test(fail.shake?.xs), JSON.stringify(fail));
  wall.mode = 'ok';
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function reduceRun(browser, account, spec, tag) {
  const { ctx, page } = await open(browser, [390, 844], account, { reduce: true, squareOpen: spec.squareOpen });
  await page.goto(SITE + spec.path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('.rx:not([data-inert])').length >= n, spec.minButtons, { timeout: 60000 });
  // The page's own listeners must hold their first snapshot before the tap. The proxy answers
  // writes itself, so the server never has them: a snapshot arriving AFTER a tap carries the
  // old value and overwrites the optimistic state. In life the server holds the write and the
  // snapshot agrees. Waiting until the row's counts stop changing takes that artefact out.
  await page.waitForFunction((row) => {
    const t = [...document.querySelectorAll(row + ' .rx-count')].map((c) => c.textContent).join();
    const w = (window.__w13settle ||= { t, since: performance.now() });
    if (w.t !== t) { w.t = t; w.since = performance.now(); }
    return performance.now() - w.since > 3000;
  }, spec.row, { timeout: 30000, polling: 250 });
  const r = await page.evaluate(async (row) => {
    const b = document.querySelector(row + ' .rx:not([aria-pressed="true"])');
    b.scrollIntoView({ block: 'center' });
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
    b.click(); await new Promise((r) => setTimeout(r, 0));
    const mine = document.getAnimations().filter((a) => a.effect?.target && (a.effect.target.closest?.('.rx') || a.effect.target.ownerSVGElement?.closest?.('.rx')));
    await new Promise((r) => setTimeout(r, 50));
    const later = await new Promise((r) => setTimeout(() => r({ p: b.getAttribute('aria-pressed'), n: b.querySelector('.rx-count').textContent, connected: b.isConnected, same: b === document.querySelector(row + ' .rx') }), 1500));
    return { later, anims: mine.length, fx: b.querySelector('.rx-fx').childNodes.length, pressed: b.getAttribute('aria-pressed'), ns: b.querySelectorAll('.rx-count .n').length, kind: b.dataset.kind, inReply: !!b.closest('.cs-reply') };
  }, spec.row);
  check(`${tag}: Reduce Motion — at once, no burst, no slide`, r.anims === 0 && r.fx === 0 && r.pressed === 'true' && r.ns === 1, JSON.stringify(r));
  await ctx.close();
}

const STORY_WORDS = async () => {
  const reply = document.querySelector('.cs-reply-btn');
  const cs = getComputedStyle(reply);
  const title = document.querySelector('.cs-title')?.textContent, count = document.querySelector('.cs-count')?.textContent;
  const ph = document.querySelector('.cs-compose textarea')?.getAttribute('placeholder');
  const tick = () => new Promise((r) => setTimeout(r, 50));
  reply.click(); await tick();
  const open = reply.textContent; reply.click(); await tick();
  const closed = reply.textContent;
  return [
    ['section says Responses', title, title === 'Responses'],
    ['count says responses', count, /^\d+ responses?$/.test(count || '')],
    ['placeholder', ph, ph === 'Add a response…'],
    ['Reply is a word: Cormorant 500 15px #9062DA', `${cs.fontFamily} ${cs.fontWeight} ${cs.fontSize} ${cs.color} ${cs.textTransform}`, /Cormorant/.test(cs.fontFamily) && cs.fontWeight === '500' && cs.fontSize === '15px' && cs.color === 'rgb(144, 98, 218)' && cs.textTransform === 'none'],
    ['Reply reads Cancel while open', `${open} / ${closed}`, open === 'Cancel' && closed === 'Reply'],
  ];
};
const OPEN_WORDS = async () => {
  const reply = document.querySelector('.op-reply-btn');
  const cs = getComputedStyle(reply);
  const tick = () => new Promise((r) => setTimeout(r, 50));
  reply.click(); await tick(); const open = reply.textContent; reply.click(); await tick(); const closed = reply.textContent;
  const piece = document.querySelector('.rx .rx-icon').getBoundingClientRect().width;
  const thread = [...document.querySelectorAll('.rx')].slice(1).map((b) => b.querySelector('.rx-icon').getBoundingClientRect().width);
  return [
    ["the piece's own heart keeps its 18px", piece, piece === 18],
    ['thread hearts are 16px', thread.join(','), thread.length > 0 && thread.every((x) => x === 16)],
    ['Reply is a word: Cormorant 500 15px #9062DA', `${cs.fontFamily} ${cs.fontWeight} ${cs.fontSize} ${cs.color} ${cs.textTransform}`, /Cormorant/.test(cs.fontFamily) && cs.fontWeight === '500' && cs.fontSize === '15px' && cs.color === 'rgb(144, 98, 218)' && cs.textTransform === 'none'],
    ['Reply reads Cancel while open', `${open} / ${closed}`, open === 'Cancel' && closed === 'Reply'],
  ];
};

const ONLY = process.env.W13_ONLY || '';
const SPECS_ALL = [
  { name: 'story', path: `/stories/${STORY}`, row: '.cs-comment .rx-row', kinds: 'heart,fire', icon: 16, minButtons: 2, words: STORY_WORDS },
  { name: 'square', path: '/square', row: '.rx-row', kinds: 'heart,like,fire', icon: 16, minButtons: 3, squareOpen: true },
  { name: 'openpages-piece', path: `/open-pages/${PIECE}`, row: '.rx-row', kinds: 'heart', icon: 18, minButtons: 2, words: OPEN_WORDS },
  { name: 'openpages-thread', path: `/open-pages/${PIECE}`, row: '[data-thread-row]', kinds: 'heart', icon: 16, minButtons: 2 },
];
const SPECS = SPECS_ALL.filter((x) => !ONLY || ONLY.split(',').includes(x.name));

const server = spawn(process.execPath, [new URL('../reader/app-server.mjs', import.meta.url).pathname], { env: { ...process.env, APP_PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const before = await snapshot();
const account = await session();
try {
  for (const [ename, engine] of [['webkit', webkit], ['chromium', chromium]]) {
    const browser = await engine.launch();
    for (const spec of SPECS) {
      for (const size of SIZES) {
        const tag = `${ename}-${size[0]}-${spec.name}`;
        console.log(`— ${tag}`);
        try { await surface(browser, size, account, spec, tag); } catch (e) { check(`${tag}: ran`, false, e.message.split('\n')[0]); }
      }
      try { await reduceRun(browser, account, spec, `${ename}-reduce-${spec.name}`); } catch (e) { check(`${ename}-reduce-${spec.name}: ran`, false, e.message.split('\n')[0]); }
    }
    await browser.close();
  }
} finally {
  server.kill();
}
const after = await snapshot();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('live records unchanged (every write answered at the proxy, none forwarded)', changed.length === 0, changed.length ? `changed: ${changed.join(', ')}` : `${Object.keys(before).length} records re-read; ${wall.answered} writes answered locally`);
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);
