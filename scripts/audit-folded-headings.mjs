// READ-ONLY AUDIT: chapter headings folded into body text, in every Book Store EPUB.
//
//   node scripts/audit-folded-headings.mjs --out ~/calvary-private/audits/folded-headings-<date>.md
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// All Shadows Are Black shipped with chapters 32–37 folded into chapter 31. Its converter
// recognised a heading only when the Word file had it centred or bold, and the last six were
// plain left-aligned lines, so they were set as ordinary <p>s — "CHAPTER THIRTY-TWO" sits
// mid-chapter as an indented paragraph. The build's own checks shared the blind spot. This
// reads every master and every sample that has a bookstore_titles record and looks for
// paragraphs that are really headings, gaps in the opener numbering, and chapters long enough
// to be two (or seven) chapters at once.
//
// ── WHAT IT TOUCHES ──────────────────────────────────────────────────────────
// Reads bookstore_titles and the two Storage objects each record names (epubPath, samplePath)
// with the service account, the way scripts/fetch-master-epub.mjs does. Nothing else under
// bookstore_epubs/ is listed or opened. Writes nothing to the database or the bucket.
// Downloads land in a fresh OS temp folder and are deleted before exit, success or not.
//
// ── THE REPORT NEVER GOES IN THE REPO ────────────────────────────────────────
// The draft list names unannounced partner titles and every flag quotes a line of a partner's
// book. --out is REQUIRED and is refused if it resolves inside the work tree. Stdout carries
// slugs and counts only, never a quoted line.
//
// ── DEPENDENCIES ─────────────────────────────────────────────────────────────
// None new. The ZIP reader and OPF parser are the ones in scripts/make-sample-epub.mjs.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, parseEpub } from './make-sample-epub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

// A chapter longer than this many times the book's median chapter is flagged.
export const OVERSIZE_FACTOR = 2.5;
// With no openers, a document this long or longer counts as a chapter (see analyseEpub).
export const FALLBACK_MIN_WORDS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Numbers: words (one to ninety-nine), digits, Roman numerals
// ─────────────────────────────────────────────────────────────────────────────

const UNITS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ONES = UNITS.slice(0, 9);

const WORD_NUM = `(?:(?:${TENS.join('|')})(?:[ -](?:${ONES.join('|')}))?|${UNITS.join('|')})`;
const DIGITS = '\\d{1,4}';
// Non-empty Roman numeral up to MMMM; the lookahead stops the all-optional body matching "".
const ROMAN = '(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
const NUM = `(?:${WORD_NUM}|${DIGITS}|${ROMAN})`;
const KEYWORD = '(?:chapter|part|book|act|section)';
const NAMED = '(?:prologue|epilogue|interlude|afterword|foreword|introduction)';

// Test 1: ≤ 40 chars, the WHOLE text (less a trailing . or :) is a heading.
const WHOLE_HEADING = new RegExp(`^(?:(?:${KEYWORD}\\s+)?${NUM}|${NAMED})$`, 'i');
// Test 2: ≤ 60 chars, STARTS with keyword + number, then : . - – — and a title.
const TITLED_HEADING = new RegExp(`^${KEYWORD}\\s+${NUM}\\s*[:.\\-–—]\\s*\\S`, 'i');

/** Integer value of a number in any of the three forms, or null. */
export function parseNumber(s) {
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const w = new RegExp(`^${WORD_NUM}$`).exec(t);
  if (w) {
    const [a, b] = t.split(/[ -]/);
    const ti = TENS.indexOf(a);
    if (ti >= 0) return (ti + 2) * 10 + (b ? ONES.indexOf(b) + 1 : 0);
    return UNITS.indexOf(a) + 1;
  }
  if (new RegExp(`^${ROMAN}$`).test(t)) {
    const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    let n = 0;
    for (let i = 0; i < t.length; i++) n += v[t[i]] < (v[t[i + 1]] || 0) ? -v[t[i]] : v[t[i]];
    return n;
  }
  return null;
}

/** Does this paragraph text look like a heading set as body? Returns the test that fired, or null. */
export function headingTest(text) {
  if (text.length <= 40 && WHOLE_HEADING.test(text.replace(/[.:]$/, ''))) return 'whole';
  if (text.length <= 60 && TITLED_HEADING.test(text)) return 'titled';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// XHTML helpers
// ─────────────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const plain = (html) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Remove every <div> whose class list contains `cls`, balancing nested divs so an inner
 * </div> doesn't end the block early. Returns { html, removed: [innerHtml…] }.
 */
function cutDivs(html, cls) {
  const removed = [];
  const open = new RegExp(`<div\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`, 'i');
  for (;;) {
    const m = open.exec(html);
    if (!m) break;
    const tag = /<\/?div\b[^>]*>/gi;
    tag.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    let t;
    while ((t = tag.exec(html))) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    removed.push(html.slice(m.index + m[0].length, end - (depth === 0 ? 6 : 0)));
    html = html.slice(0, m.index) + html.slice(end);
  }
  return { html, removed };
}

/** Is this spine document one the audit skips? Returns the reason, or null. */
export function skipReason(item, html) {
  if (/\bnav\b/.test(item.properties)) return 'nav';
  if (/epub:type\s*=\s*["'][^"']*\btitlepage\b/i.test(html) || /class\s*=\s*["'][^"']*\btitlepage\b/i.test(html)) return 'title page';
  const ids = [...html.matchAll(/<section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  // Standard Ebooks call their copyright page the imprint.
  if (ids.includes('copyright') || ids.includes('imprint')
    || /epub:type\s*=\s*["'][^"']*\b(?:copyright-page|imprint)\b/i.test(html)) return 'copyright';
  if (ids.includes('contents') || ids.includes('toc')) return 'contents';
  if (ids.includes('colophon') || /epub:type\s*=\s*["'][^"']*\bcolophon\b/i.test(html)) return 'colophon';
  return null;
}

const countWords = (text) => (text ? text.split(/\s+/).filter(Boolean).length : 0);

/**
 * The chapter number a heading line announces, or null. The WHOLE line must be the number
 * (with an optional keyword), or keyword + number + separator + title — so "I Hope They Won't
 * See Us" is a title, not chapter one. Openers set the number and the title as separate <p>s,
 * so only an opener's first line is passed here.
 */
export function openerNumber(text) {
  const t = text.replace(/[.:]$/, '').trim();
  const m = new RegExp(`^(?:${KEYWORD}\\s+)?(${NUM})$`, 'i').exec(t)
    || new RegExp(`^${KEYWORD}\\s+(${NUM})\\s*[:.\\-–—]`, 'i').exec(t);
  return m ? parseNumber(m[1]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The audit of one EPUB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse one EPUB (Buffer). Pure: no I/O.
 * Returns { chapters: [{file, label, number, words}], flags: [{file, index, text, test}],
 *           numbered: {first, last, gaps, repeats}, median, oversized: [{file, label, words, ratio}] }
 */
export function analyseEpub(buf) {
  const files = readZip(buf);
  const epub = parseEpub(files);
  const chapters = [];
  const flags = [];
  const skipped = [];
  const documents = [];   // every audited document, for the no-opener fallback below

  for (const { item } of epub.spine) {
    if (!/x?html/i.test(item.type) && !/\.x?html?$/i.test(item.full)) continue;
    const raw = files.get(item.full);
    if (!raw) continue;
    let html = raw.toString('utf8');
    const why = skipReason(item, html);
    if (why) { skipped.push({ file: item.full, why }); continue; }

    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    html = body ? body[1] : html;
    const heading = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
    const op = cutDivs(html, 'opener');
    const pp = cutDivs(op.html, 'partpage');
    html = pp.html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, ' ');

    let index = 0;
    for (const p of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = plain(p[1]);
      const test = headingTest(text);
      if (test) flags.push({ file: item.full, index, text, test });
      index++;
    }

    const words = countWords(plain(html));
    if (op.removed.length) {
      const label = plain(op.removed[0]).replace(/\s*[❦✦⁂*]+\s*$/u, '').trim();
      const first = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(op.removed[0]);
      chapters.push({ file: item.full, label, number: openerNumber(first ? plain(first[1]) : label), words });
    }
    documents.push({ file: item.full, label: heading ? plain(heading[2]) : '', words });
  }

  // No openers at all — a Standard Ebooks classic, or a collection set with a plain <h1> per
  // piece. Rather than pass the sequence and length checks by seeing nothing, fall back to
  // headings: every audited document of FALLBACK_MIN_WORDS or more is a chapter, labelled by
  // its first h1–h3. Part and book pages are left out so their numbers don't join the run.
  let source = 'openers';
  if (!chapters.length) {
    source = 'headings';
    for (const d of documents) {
      if (d.words < FALLBACK_MIN_WORDS || /^(?:part|book)\b/i.test(d.label)) continue;
      chapters.push({ ...d, number: openerNumber(d.label) });
    }
  }

  // The numbering, in spine order.
  const nums = chapters.map((c) => c.number).filter((n) => n !== null);
  const gaps = [];
  const repeats = [];
  const seen = new Set();
  for (let i = 0; i < nums.length; i++) {
    // A drop back to 1 is a new part numbering afresh (The Rescue: I–IV, I–VII, …), so it
    // starts a new run. Anything else out of step is reported as found.
    if (i > 0 && nums[i] === 1 && nums[i - 1] > 1) seen.clear();
    else if (i > 0 && nums[i] !== nums[i - 1] + 1) gaps.push(`${nums[i - 1]}→${nums[i]}`);
    if (seen.has(nums[i])) repeats.push(nums[i]);
    seen.add(nums[i]);
  }

  const sorted = chapters.map((c) => c.words).sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  const oversized = median
    ? chapters.filter((c) => c.words > OVERSIZE_FACTOR * median)
      .map((c) => ({ file: c.file, label: c.label, words: c.words, ratio: +(c.words / median).toFixed(2) }))
    : [];

  return {
    source,
    chapters,
    flags,
    skipped,
    numbered: { first: nums.length ? nums[0] : null, last: nums.length ? nums[nums.length - 1] : null, gaps, repeats },
    median,
    oversized,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The run against the live catalogue
// ─────────────────────────────────────────────────────────────────────────────

function chaptersCell(r) {
  const named = r.chapters.filter((c) => c.number === null).length;
  if (!r.chapters.length) return 'none found';
  const parts = [];
  if (r.numbered.first !== null) parts.push(`${r.numbered.first}–${r.numbered.last}`);
  if (named) parts.push(`${named} named`);
  if (r.numbered.gaps.length) parts.push(`gaps ${r.numbered.gaps.join(', ')}`);
  if (r.numbered.repeats.length) parts.push(`repeats ${r.numbered.repeats.join(', ')}`);
  return `${parts.join('; ') || 'none numbered'} (${r.chapters.length} ${r.source === 'openers' ? 'openers' : 'by heading, no openers'})`;
}

const cell = (s) => String(s).replace(/\|/g, '\\|');

export function renderReport(rows, { date, count }) {
  const out = [];
  out.push(`# Folded chapter headings — ${date}`, '');
  out.push(`bookstore_titles records: ${count}. EPUBs examined: ${rows.length}. `
    + `Unchecked: ${rows.filter((r) => r.unchecked).length}.`, '');
  out.push(`Chapter numbers come from each opener's first line; a book with no openers is read by its headings `
    + `(a document of ${FALLBACK_MIN_WORDS}+ words, labelled by its first h1–h3). Oversized = more than `
    + `${OVERSIZE_FACTOR}× the book's median chapter.`, '');
  out.push('| slug | cat. | file | chapters found | flagged ¶ | oversized chapters | unchecked |');
  out.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    if (r.unchecked) {
      out.push(`| ${cell(r.slug)} | ${r.catalogueNumber ?? '—'} | ${r.kind} | — | — | — | ${cell(r.unchecked)} |`);
      continue;
    }
    const short = (l) => (l.length > 40 ? `${l.slice(0, 40).trim()}…` : l);
    const over = r.result.oversized.map((o) => `${short(o.label || o.file)} (${o.words} w, ${o.ratio}×)`).join('; ') || '0';
    out.push(`| ${cell(r.slug)} | ${r.catalogueNumber ?? '—'} | ${r.kind} | ${cell(chaptersCell(r.result))} | `
      + `${r.result.flags.length} | ${cell(over)} | |`);
  }
  out.push('', '## Every flag', '');
  const flagged = rows.filter((r) => !r.unchecked && r.result.flags.length);
  if (!flagged.length) out.push('None.');
  for (const r of flagged) {
    out.push(`### ${r.slug} — ${r.kind}`, '');
    for (const f of r.result.flags) out.push(`- \`${f.file}\` ¶${f.index} [${f.test}]: “${f.text}”`);
    out.push('');
  }
  return out.join('\n') + '\n';
}

function parseArgs(argv) {
  const i = argv.indexOf('--out');
  if (i < 0 || !argv[i + 1]) throw new Error('usage: node scripts/audit-folded-headings.mjs --out <path outside the repo>');
  const out = resolve(argv[i + 1].replace(/^~(?=\/|$)/, homedir()));
  const rel = relative(ROOT, out);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`refusing to write the report inside the repo (${rel})`);
  return { out };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const { mintToken } = await import('./rules-pull.mjs');
  const token = await mintToken();

  const titles = await (await fetch(`${DB}/bookstore_titles.json?access_token=${token}`)).json();
  const records = Object.entries(titles || {})
    .map(([key, t]) => ({ key, slug: t?.slug || key, catalogueNumber: t?.catalogueNumber ?? null,
      status: t?.status ?? null, epubPath: t?.epubPath || null, samplePath: t?.samplePath || null }))
    .sort((a, b) => (a.catalogueNumber ?? 1e9) - (b.catalogueNumber ?? 1e9) || a.slug.localeCompare(b.slug));
  console.log(`bookstore_titles records: ${records.length} `
    + `(${records.filter((r) => r.status === 'published').length} published, `
    + `${records.filter((r) => r.status !== 'published').length} other)`);

  const tmp = await mkdtemp(join(tmpdir(), 'folded-headings-'));
  const rows = [];
  try {
    for (const rec of records) {
      for (const kind of ['master', 'sample']) {
        const path = kind === 'master' ? rec.epubPath : rec.samplePath;
        const row = { slug: rec.slug, catalogueNumber: rec.catalogueNumber, kind };
        if (!path) {
          // A record with no sample is reported, not skipped; a record with no master is UNCHECKED.
          if (kind === 'sample') { row.unchecked = 'no samplePath on the record'; rows.push(row); continue; }
          row.unchecked = 'no epubPath on the record'; rows.push(row); continue;
        }
        try {
          const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          const file = join(tmp, `${rec.key}.${kind}.epub`);
          await writeFile(file, bytes);
          row.result = analyseEpub(bytes);
        } catch (e) {
          row.unchecked = String(e?.message || e).slice(0, 200);
        }
        rows.push(row);
        console.log(`${rec.slug} ${kind}: ${row.unchecked ? `UNCHECKED (${row.unchecked})`
          : `${row.result.chapters.length} chapters (${row.result.source}), ${row.result.flags.length} flags, ${row.result.oversized.length} oversized`}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const date = new Date().toISOString().slice(0, 10);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderReport(rows, { date, count: records.length }), { mode: 0o600 });
  console.log(`report → ${out} (outside the repo); temp copies deleted`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
