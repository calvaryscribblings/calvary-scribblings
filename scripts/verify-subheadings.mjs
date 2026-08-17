// ACCEPTANCE WALK for R12.5 — in-story subheadings, violet → house gold.
//
//   node scripts/verify-subheadings.mjs
//
// The brief's acceptance is a claim about RENDERED COLOUR on real published stories, so
// this walks real bodies pulled live from cms_stories, renders them into a real .prose
// container in a real browser with the REAL app/lib/proseCSS.js and app/lib/subheadTag.js,
// and reads computed styles back. Nothing here is a transcription of the modules; both are
// loaded from disk, exactly as tests/dropcap/dropcap.spec.mjs does, so this cannot pass
// while the shipped code regresses.
//
// What it asserts, per the brief:
//   1. subheadings render house gold ON LIGHT on the cream reading surface;
//   2. drop caps, .intro-note and blockquote pull-quotes are UNCHANGED;
//   3. run-in bold lead-ins are NOT gilded — the failure mode a CSS-only fix would have had.
//
// Three published stories, at least one older piece, and — per the tagger's bounds — one
// story in the <p><strong> form.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { HOUSE_GOLD_ON_DARK, HOUSE_GOLD_ON_LIGHT } from '../app/lib/houseGold.js';
import { proseCSS } from '../app/lib/proseCSS.js';
import { tagSubheads } from '../app/lib/subheadTag.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// The story page's cream reading surface — .story-body-wrap in page-client.js, .sr-page in
// my-library/read/page.js. The whole point of the derived tone is that it serves THIS.
const CREAM = '#f0ead8';
// The category accent the subheadings used to take, and which everything else still takes.
const ACCENT = '#6b46c1';

const hex2rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`;
};

// ── the walk ─────────────────────────────────────────────────────────────────────────────
// Chosen for coverage, not convenience:
const WALK = [
  { slug: 'odeluwa', why: 'OLDER PIECE — 29 Mar 2026, the oldest published story using <h3>', form: 'h3' },
  { slug: 'what-are-cookies-and-should-you-accept-them', why: 'older piece, <h3>, 7 Apr 2026', form: 'h3' },
  { slug: 'sim-swapping', why: '<p><strong>> form — six section titles the h3 rule cannot reach', form: 'p>strong' },
  { slug: 'the-most-dangerous-job-in-nigeria', why: '<p><strong> form alongside run-in lead-ins', form: 'p>strong' },
];

// Non-interference fixture. No published story pairs an <h3> with a blockquote or an
// .intro-note, so the "unchanged" half of the acceptance cannot be proved from the corpus
// alone — it is proved here, with all four elements in one container.
const FIXTURE = `
  <p class="intro-note">A content note, which is front matter and must stay violet.</p>
  <p>Ordinary opening prose that the drop cap should land on, gilded at 4.2em.</p>
  <h3>A Subheading In The H3 Form</h3>
  <p><strong>A Subheading In The Bold Paragraph Form</strong></p>
  <p><strong>Product:</strong> a run-in lead-in, which must NOT be gilded.</p>
  <blockquote><p>A pull quote, which must stay violet.</p></blockquote>
  <p>Closing prose.</p>
`;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
};

console.log('R12.5 ACCEPTANCE — in-story subheadings, violet → house gold');
console.log(`  surface ${CREAM} · on-light tone ${HOUSE_GOLD_ON_LIGHT} · on-dark tone ${HOUSE_GOLD_ON_DARK} (unchanged)`);

const res = await fetch(`${DB}/cms_stories.json`);
if (!res.ok) { console.error(`cms_stories read failed: ${res.status}`); process.exit(1); }
const all = await res.json();

const dropcapSrc = readFileSync(join(ROOT, 'app/lib/dropcap.js'), 'utf8');
const predicateSrc = readFileSync(join(ROOT, 'app/lib/prosePredicate.js'), 'utf8');
const asClassic = (src) => src
  .replace(/^'use client';\s*$/m, '')
  .replace(/^import\s+[\s\S]*?from\s+'[^']+';\s*$/gm, '')
  .replace(/^export (const|function|class) /gm, '$1 ');
const DROPCAP_JS = `${asClassic(predicateSrc)}\n${asClassic(dropcapSrc)}\nwindow.tagDropcap = tagDropcap;`;

// Same container facts tests/dropcap/playwright.config.mjs records: /dev/shm is 64 MB in
// this devcontainer and the editor server holds most of the RAM. Without these the renderer
// dies with "Target crashed" on the first addScriptTag.
const browser = await chromium.launch({
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
});
const page = await browser.newPage();

async function render(html) {
  await page.setContent(
    `<!doctype html><html><body style="background:${CREAM}">` +
    `<style>${proseCSS(ACCENT)}</style>` +
    // The .prose container is wrapped in an <article> because tagDropcap takes the ARTICLE
    // and does article.querySelector('.prose.has-dropcap') itself — handing it the prose
    // container directly finds nothing and silently tags no cap. Mirrors the story page,
    // where .prose sits inside <article class="story-body">.
    `<article id="story-article"><div class="prose has-dropcap" id="story-content">${tagSubheads(html)}</div></article>` +
    `</body></html>`,
  );
  await page.addScriptTag({ content: DROPCAP_JS });
  await page.evaluate(() => window.tagDropcap(document.getElementById('story-article')));
}

// ── 1. the corpus walk ───────────────────────────────────────────────────────────────────
for (const { slug, why, form } of WALK) {
  const story = all[slug];
  console.log(`\n${slug}  [${form}]  ${why}`);
  if (!story) { ok('story exists in cms_stories', false, 'not found'); continue; }
  if (story.published === false) { ok('story is published', false); continue; }

  await render(story.content || '');

  const r = await page.evaluate(() => {
    const root = document.getElementById('story-content');
    const heads = [...root.querySelectorAll('h3, p.prose-subhead > strong')];
    const cap = root.querySelector('p.dropcap-target');
    // A run-in lead-in: a <strong> whose paragraph is NOT tagged as a subheading.
    const runIns = [...root.querySelectorAll('p:not(.prose-subhead) > strong')];
    return {
      heads: heads.map((h) => ({ text: (h.textContent || '').trim().slice(0, 44), color: getComputedStyle(h).color })),
      capColor: cap ? getComputedStyle(cap, '::first-letter').color : null,
      capSize: cap ? getComputedStyle(cap, '::first-letter').fontSize : null,
      runIns: runIns.map((s) => ({ text: (s.textContent || '').trim().slice(0, 30), color: getComputedStyle(s).color })),
    };
  });

  ok(`${r.heads.length} subheading(s) found`, r.heads.length > 0);
  const wrong = r.heads.filter((h) => h.color !== hex2rgb(HOUSE_GOLD_ON_LIGHT));
  ok(`every subheading is ${HOUSE_GOLD_ON_LIGHT}`, wrong.length === 0,
    wrong.map((w) => `"${w.text}" = ${w.color}`).join('; '));
  const stillViolet = r.heads.filter((h) => h.color === hex2rgb(ACCENT));
  ok('no subheading is still the category violet', stillViolet.length === 0);

  if (r.capColor) {
    ok(`drop cap UNCHANGED at ${HOUSE_GOLD_ON_DARK}`, r.capColor === hex2rgb(HOUSE_GOLD_ON_DARK), `got ${r.capColor}`);
    ok('drop cap still 4.2em', parseFloat(r.capSize) > 60, `got ${r.capSize}`);
  } else {
    console.log('    · no drop cap on this story (front matter only) — skipped');
  }

  const gildedRunIns = r.runIns.filter((s) => s.color === hex2rgb(HOUSE_GOLD_ON_LIGHT));
  ok(`${r.runIns.length} run-in lead-in(s) left ungilded`, gildedRunIns.length === 0,
    gildedRunIns.map((g) => `"${g.text}"`).join('; '));
}

// ── 2. non-interference ──────────────────────────────────────────────────────────────────
console.log('\nNON-INTERFERENCE FIXTURE — all four elements in one container');
await render(FIXTURE);
const f = await page.evaluate(() => {
  const root = document.getElementById('story-content');
  const g = (sel) => { const e = root.querySelector(sel); return e ? getComputedStyle(e).color : null; };
  const cap = root.querySelector('p.dropcap-target');
  return {
    h3: g('h3'),
    pStrong: g('p.prose-subhead > strong'),
    runIn: g('p:not(.prose-subhead) > strong'),
    introNote: g('.intro-note'),
    blockquote: g('blockquote p'),
    capColor: cap ? getComputedStyle(cap, '::first-letter').color : null,
    capText: cap ? (cap.textContent || '').trim().slice(0, 30) : null,
  };
});
ok('h3 subheading is house gold on light', f.h3 === hex2rgb(HOUSE_GOLD_ON_LIGHT), `got ${f.h3}`);
ok('p>strong subheading is house gold on light', f.pStrong === hex2rgb(HOUSE_GOLD_ON_LIGHT), `got ${f.pStrong}`);
ok('run-in lead-in is NOT gilded', f.runIn !== hex2rgb(HOUSE_GOLD_ON_LIGHT), `got ${f.runIn}`);
ok('.intro-note UNCHANGED (still accent violet)', f.introNote === hex2rgb(ACCENT), `got ${f.introNote}`);
ok('blockquote pull-quote UNCHANGED (still accent violet)', f.blockquote === hex2rgb(ACCENT), `got ${f.blockquote}`);
ok('drop cap UNCHANGED (still #c9a84c)', f.capColor === hex2rgb(HOUSE_GOLD_ON_DARK), `got ${f.capColor}`);
ok('drop cap landed on prose, not on the intro-note', f.capText?.startsWith('Ordinary opening prose'), `got "${f.capText}"`);

await browser.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
