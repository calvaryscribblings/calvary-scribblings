// W18 — EVERY TEXT FIELD'S COMPUTED FONT SIZE, AT 390, ON A PHONE.
//
//   node tests/typography/field-census.mjs [--site URL] [--json out.json]     (needs serviceAccountKey.json)
//
// iOS Safari zooms the page whenever a focused field's text is under 16px, and the zoom outlasts
// the keyboard (W16: that zoom is what put the story bar mid-screen). This opens every surface a
// reader can reach — signed out, and signed in as the W17 TEST READER behind tests/live/firewall.mjs
// — at 390×844 with a touch screen and a coarse pointer, opens the boxes that only appear on a tap
// (Reply, the sign-in modal, Edit profile, the Square's messages…), and records each field.
//
// Not reachable here, and said so in the output: /admin (founders only — live tests never sign in
// as one, W17). The admin fields are covered by the same global rule; see app/globals.css.
import { chromium } from '@playwright/test';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync } from 'node:fs';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from '../live/test-reader.mjs';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
const adb = getDatabase();
const READER = await ensureTestReader();
const WATCH = testReaderWatch(READER);
const snapshot = async () => Object.fromEntries(await Promise.all(WATCH.map(async (p) => [p, JSON.stringify((await adb.ref(p).get()).val())])));

// A story with responses to reply to; an Open Pages piece; both read from the live index.
const idx = (await adb.ref('cms_stories_index').get()).val() || {};
const comments = (await adb.ref('comments').get()).val() || {};
const STORY = arg('--story', Object.keys(idx).find((s) => idx[s]?.published !== false && Object.values(comments[s] || {}).some((c) => c?.text && !c.parentId)) || 'the-number-thirteen');
const pieces = (await adb.ref('open_pages').get()).val() || {};
const PIECE = Object.entries(pieces).filter(([, p]) => p?.status === 'published').map(([k]) => k).find((k) => comments[k]) || Object.keys(pieces)[0];

const COLLECT = () => {
  const skip = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'submit', 'button', 'hidden', 'image', 'reset']);
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    if (el.tagName === 'INPUT' && skip.has((el.type || 'text').toLowerCase())) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '');
    out.push({ tag: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? `[${el.type}]` : ''), name: String(name).slice(0, 48), px: parseFloat(cs.fontSize), large: el.hasAttribute('data-field-large') });
  }
  return out;
};

const SQUARE_OPEN = new Date('2026-09-26T20:00:00Z'); // 21:00 London — the room is open
const click = async (page, locator) => { try { await locator.first().click({ timeout: 6000 }); await page.waitForTimeout(900); return true; } catch { return false; } };

const SCENARIOS = [
  { id: 'public-library', path: '/public-library' },
  { id: 'search', path: '/search' },
  { id: 'story (signed out, end of story)', path: `/stories/${STORY}`, run: async (p) => { await p.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await p.waitForTimeout(2500); } },
  { id: 'sign in', path: '/square', clock: SQUARE_OPEN, run: async (p) => { await click(p, p.getByRole('button', { name: /^sign in$/i })); } },
  { id: 'create account', path: '/square', clock: SQUARE_OPEN, run: async (p) => { await click(p, p.getByRole('button', { name: /^sign in$/i })); await click(p, p.getByRole('button', { name: /create one/i })); } },
  { id: 'forgot password', path: '/square', clock: SQUARE_OPEN, run: async (p) => { await click(p, p.getByRole('button', { name: /^sign in$/i })); await click(p, p.getByRole('button', { name: /forgot password/i })); } },
  { id: 'bookstore', path: '/bookstore' },
  { id: 'story: response + reply', path: `/stories/${STORY}`, signedIn: true, run: async (p) => { await p.locator('.cs-section').first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(2500); await click(p, p.locator('.cs-reply-btn')); } },
  { id: 'square: composer + reply', path: '/square', signedIn: true, clock: SQUARE_OPEN, run: async (p) => { await p.waitForTimeout(3000); await click(p, p.getByRole('button', { name: /^reply$/i })); } },
  { id: 'square: messages', path: '/square', signedIn: true, clock: SQUARE_OPEN, run: async (p) => { await p.waitForTimeout(3000); await click(p, p.getByRole('button', { name: 'Messages' })); await click(p, p.getByRole('button', { name: /\+ New/ })); } },
  { id: 'open pages: new piece', path: '/open-pages/new', signedIn: true },
  { id: 'open pages: comment + reply', path: `/open-pages/${PIECE}`, signedIn: true, run: async (p) => { await p.waitForTimeout(2500); await click(p, p.locator('.op-reply-btn')); } },
  { id: 'profile: edit', path: '/profile', signedIn: true, run: async (p) => { await p.waitForTimeout(2500); await click(p, p.locator('.pf-banner-edit-btn')); } },
  { id: 'settings', path: '/settings', signedIn: true },
  { id: 'settings: delete account', path: '/settings', signedIn: true, run: async (p) => { await p.waitForTimeout(2500); await click(p, p.getByRole('button', { name: /delete (my )?account/i })); } },
  { id: 'quizzes', path: '/quizzes', signedIn: true },
];

const fw = newStats();
const before = await snapshot();
const account = await testReaderSession(READER);
const browser = await chromium.launch();
const rows = [];
const ONLY = arg('--only', null);
for (const s of SCENARIOS.filter((x) => !ONLY || x.id.includes(ONLY))) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await installFirewall(ctx, { site: SITE, stats: fw });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem('cs_bookstore_gate_v1', '1'); } catch { /* private */ } });
  if (s.clock) await page.clock.setFixedTime(s.clock);
  try {
    if (s.signedIn) await signInPage(page, SITE, account);
    await page.goto(SITE + s.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    if (s.run) await s.run(page);
    const coarse = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
    const fields = await page.evaluate(COLLECT);
    for (const f of fields) rows.push({ scenario: s.id, ...f });
    console.log(`${s.id.padEnd(34)} ${String(fields.length).padStart(2)} field(s)${coarse ? '' : '  ⚠ not a coarse pointer'}`);
  } catch (e) {
    console.log(`${s.id.padEnd(34)} could not run: ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
}
await browser.close();
const after = await snapshot();
const changed = WATCH.filter((p) => before[p] !== after[p]).length;

// One row per distinct field (a field seen on several scenarios is listed once, by its first).
const seen = new Map();
for (const r of rows) { const k = `${r.tag}|${r.name}|${r.px}`; if (!seen.has(k)) seen.set(k, r); }
const list = [...seen.values()].sort((a, b) => a.px - b.px);
console.log('\n px     field');
for (const r of list) console.log(`${String(r.px).padStart(5)}  ${r.px < 16 ? '✗' : ' '} ${r.tag.padEnd(16)} ${r.name.padEnd(48)} ${r.scenario}${r.large ? '  (large)' : ''}`);
const under = list.filter((r) => r.px < 16);
console.log(`\n${list.length} distinct fields · ${under.length} under 16px · ${statsLine(fw)} · test-reader records changed: ${changed || 'none'}`);
const json = arg('--json', null);
if (json) writeFileSync(json, JSON.stringify({ site: SITE, rows, list }, null, 2));
process.exit(changed ? 2 : 0);
