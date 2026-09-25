#!/usr/bin/env node
// THE BUILT-HTML CHECK — W4. Does any static story page carry an archive story's body?
//
//   node scripts/check-built-gate.mjs [--now <ISO|ms>] [--out out]
//
// For every published prose story with a built page, this decides — with the SAME policy the
// endpoint uses (app/lib/storyAccess.js) — whether a signed-out reader at `--now` gets the full
// story or its preview, and then looks for the story's ENDING (a run of its last words, taken
// from the full body in cms_stories) in out/stories/<slug>.html and .txt (the RSC payload,
// which carries the same inlined story). An archive story whose ending is in either file is a
// failure. Exit 1 on any.
//
// To check a build made AFTER the switch before the switch arrives:
//   FAKE_NOW=2026-10-01T12:00:00Z NODE_OPTIONS="--import ./tests/build/fake-clock.mjs" npx next build
//   node scripts/check-built-gate.mjs --now 2026-10-01T12:00:00Z

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { grantFor } from '../app/lib/storyAccess.js';
import { cutPreview } from '../app/lib/previewCut.js';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const nowRaw = opt('--now', String(Date.now()));
const now = /^\d+$/.test(nowRaw) ? Number(nowRaw) : Date.parse(nowRaw);
const OUT = opt('--out', 'out');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Public metadata a card or unfurl shows ON PURPOSE. A trailer quote is often the story's last
// line; its presence is editorial, not a leak of the body. The ending sampled is one these do
// not contain.
const PUBLIC_FIELDS = ['trailerQuote', 'excerpt', 'description', 'subtitle', 'opening', 'dek'];
const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** A run of the story's last words that survives HTML escaping and no public field carries. */
export function endingOf(html, rec = {}) {
  const text = plain(html);
  // Only text BEYOND the preview counts: the preview is allowed on the page by rule.
  let preview = '';
  try { preview = plain(cutPreview(html).html); } catch { preview = ''; }
  const beyond = text.slice(preview.length);
  // …and a sample the preview does not also contain (a story that ends on its first line).
  const pub = [preview, ...PUBLIC_FIELDS.map((k) => plain(rec[k]))].filter(Boolean).join(' | ');
  const runs = (beyond.slice(-1500).match(/[A-Za-z0-9][A-Za-z0-9 ]{24,}[A-Za-z0-9]/g) || []).map((r) => r.slice(-40));
  for (let i = runs.length - 1; i >= 0; i--) if (!pub.includes(runs[i])) return runs[i];
  return null;
}

async function main() {
  const stories = await (await fetch(`${DB}/cms_stories.json`)).json();
  let archive = 0; let free = 0; let leaks = 0; let skipped = 0;
  for (const [slug, rec] of Object.entries(stories || {})) {
    if (!rec || rec.published === false) continue;
    const html = join(OUT, 'stories', `${slug}.html`);
    if (!existsSync(html)) { skipped++; continue; }
    const g = grantFor(rec, { tier: 'free', now });
    if (g.access === 'reader' || g.reason === 'poetry') { skipped++; continue; }
    const ending = endingOf(rec.content, rec);
    if (!ending) { skipped++; continue; }
    const txt = join(OUT, 'stories', `${slug}.txt`);
    const inHtml = readFileSync(html, 'utf8').includes(ending);
    const inTxt = existsSync(txt) && readFileSync(txt, 'utf8').includes(ending);
    if (g.access === 'preview') {
      archive++;
      if (inHtml || inTxt) { leaks++; console.log(`LEAK  ${slug}  ending in ${[inHtml && 'html', inTxt && 'txt'].filter(Boolean).join('+')}`); }
    } else free++;
  }
  console.log(`at ${new Date(now).toISOString()}: ${archive} archive pages checked, ${leaks} carry their ending; ${free} free pages; ${skipped} skipped (poetry, reader-mode, no page).`);
  process.exit(leaks ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
