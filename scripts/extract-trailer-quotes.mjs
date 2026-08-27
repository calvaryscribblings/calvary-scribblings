// SCRIPT A — Trailer-quote extraction (READ-ONLY: writes nothing to Firebase).
//
// Reads all published cms_stories that have no trailerQuote, strips CMS markup
// to plain text, and asks Claude (claude-sonnet-4-6) to select one verbatim
// pull-quote per story. Each returned quote is validated as an exact substring
// of the story text (whitespace-normalised); one retry on validation failure.
//
// Output: scripts/trailer-quotes-report.json + a human-readable table on stdout.
// Review the report, then apply approved quotes with scripts/write-trailer-quotes.mjs.
//
// Usage: ANTHROPIC_API_KEY=... node scripts/extract-trailer-quotes.mjs
//
// Firebase read uses the public REST endpoint (same pattern as
// scripts/generate-redirects.mjs) — no SDK socket, exits cleanly.

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const MODEL = 'claude-sonnet-4-6';
const DELAY_MS = 1500; // polite pacing between API calls

const SYSTEM_PROMPT = `You select trailer quotes for a literary platform — like pull-quotes on a film poster. Given a story, return the single most arresting passage, quoted VERBATIM from the text. Rules: 8–20 words; must be an exact contiguous substring of the story text; choose from the FIRST 60% of the story only (never spoil endings); it must intrigue a reader who knows nothing about the story; prefer lines with voice, image, or tension over summary. For poetry, a striking line or two is fine. If no passage meets the bar, reply exactly SKIP. Reply with ONLY the quote (no quotation marks, no commentary) or SKIP.`;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Export it and re-run.');
  process.exit(1);
}
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CMS markup → plain text ─────────────────────────────────────────
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function htmlToPlainText(html) {
  return decodeEntities(
    html
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ') // captions aren't story prose
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote|\/div|\/figure)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const normWs = text => text.replace(/\s+/g, ' ').trim();
const wordCount = text => normWs(text).split(' ').filter(Boolean).length;

// ── model call + validation ─────────────────────────────────────────
async function askForQuote(story, plainText, retryNote) {
  const messages = [{
    role: 'user',
    content: `Title: ${story.title}\nCategory: ${story.categoryName || story.category}\n\n${plainText}`,
  }];
  if (retryNote) {
    messages.push(
      { role: 'assistant', content: retryNote.previous },
      { role: 'user', content: 'That was not an exact contiguous substring of the story text. Reply again with a passage copied VERBATIM, character for character, from the text above — or SKIP.' },
    );
  }
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages,
  });
  const text = response.content.find(b => b.type === 'text')?.text ?? '';
  // Defensive: strip wrapping quotation marks the model was told not to add.
  return normWs(text).replace(/^["'“‘]+|["'”’.]+$/g, '').trim();
}

async function extractQuote(story, plainText) {
  let attempt = await askForQuote(story, plainText);
  for (let round = 0; round < 2; round++) {
    if (attempt === 'SKIP' || attempt.toUpperCase() === 'SKIP') {
      return { status: 'skip', quote: '', reason: 'model returned SKIP' };
    }
    if (normWs(plainText).includes(attempt)) {
      return { status: 'ok', quote: attempt };
    }
    if (round === 0) {
      await sleep(DELAY_MS);
      attempt = await askForQuote(story, plainText, { previous: attempt });
    }
  }
  return { status: 'skip', quote: attempt, reason: 'validation failed' };
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  const res = await fetch(`${FB_DB}/cms_stories.json`);
  if (!res.ok) throw new Error(`cms_stories fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== 'object') throw new Error('cms_stories is empty');

  const candidates = Object.entries(data)
    .filter(([, s]) => s?.published !== false && !s?.trailerQuote)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(`${Object.keys(data).length} stories in CMS · ${candidates.length} published without a trailerQuote\n`);

  const rows = [];
  for (const [id, story] of candidates) {
    // content is the canonical body; EPUB-only stories keep prose in extractedText.
    const source = story.content?.trim() ? story.content : (story.extractedText || '');
    const plainText = htmlToPlainText(source);
    if (!plainText) {
      rows.push({ id, title: story.title, category: story.categoryName || story.category, quote: '', wordCount: 0, status: 'skip', reason: 'no body text' });
      continue;
    }
    process.stderr.write(`extracting: ${id} … `);
    try {
      const result = await extractQuote(story, plainText);
      rows.push({
        id, title: story.title, category: story.categoryName || story.category,
        quote: result.status === 'ok' ? result.quote : (result.quote || ''),
        wordCount: result.status === 'ok' ? wordCount(result.quote) : 0,
        status: result.status, ...(result.reason ? { reason: result.reason } : {}),
      });
      process.stderr.write(`${result.status}\n`);
    } catch (e) {
      rows.push({ id, title: story.title, category: story.categoryName || story.category, quote: '', wordCount: 0, status: 'failed', reason: e.message });
      process.stderr.write(`failed (${e.message})\n`);
    }
    await sleep(DELAY_MS);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const reportPath = resolve(here, 'trailer-quotes-report.json');
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, rows }, null, 2), 'utf8');

  // ── human-readable table ──────────────────────────────────────────
  const pad = (v, n) => String(v ?? '').slice(0, n).padEnd(n);
  console.log('\n' + pad('id', 34) + ' | ' + pad('title', 30) + ' | ' + pad('category', 14) + ' | ' + pad('proposed quote', 72) + ' | ' + pad('wc', 3) + ' | status');
  console.log('-'.repeat(34 + 30 + 14 + 72 + 3 + 9 + 15));
  for (const r of rows) {
    console.log(pad(r.id, 34) + ' | ' + pad(r.title, 30) + ' | ' + pad(r.category, 14) + ' | ' + pad(r.quote, 72) + ' | ' + pad(r.wordCount || '', 3) + ' | ' + r.status + (r.reason ? ` (${r.reason})` : ''));
  }

  const counts = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  console.log(`\nTotals: extracted ${counts.ok || 0} / skipped ${counts.skip || 0} / failed ${counts.failed || 0}`);
  console.log(`Report written to ${reportPath}`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
