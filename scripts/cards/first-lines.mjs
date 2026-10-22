// FIRST LINES — the data for the Ledger (CARDS-R3).
//
//   node scripts/cards/first-lines.mjs --fetch   # ask the live site, signed out, then build
//   node scripts/cards/first-lines.mjs           # build from the responses already fetched
//   → cards/data/first-lines.json + cards/review/FIRST-LINES.md
//
// For every card in cards/data/deck.json, the first sentence of the story's body, verbatim: its
// quotes, dashes, ellipses and italics as stored. A picture card takes the first sentence of its
// series' first instalment.
//
// HOW THE TEXT IS READ: the way a signed-out reader gets it. POST /api/story { slug } with no
// token and no telemetry fields (so each call counts once in story_clients/<day>/story/unknown,
// as any unlabelled open does), and POST /api/series/stream { instalmentId } with no token. No
// credentials are loaded, and /api/hit is never called. A gated story answers a preview, which
// always holds the opening. The byline and title come from the story's static page (a GET; no
// script runs), because the endpoint does not carry them and deck.json's can be stale.
//
// The responses are stored OUTSIDE the work tree (RAW, below), never in it: only the first
// sentence, which the Ledger prints, comes into the repo. A rebuild reads them back and calls
// nothing, so the counter is touched once per card per --fetch.
//
// THE READING, and every place it needs a judgement, is flagged on the card:
//   - furniture before the prose is passed over and named: a content note (p.intro-note), a
//     heading (h1–h6), an epigraph or dateline (a paragraph set wholly in italics);
//   - verse (consecutive unindented lines) is read across its lines until the sentence ends, the
//     lines joined by " / " as verse is quoted in prose;
//   - a sentence ends at . ! ? or … followed, after any closing quotes, by a space and a capital
//     or an opening quote, or by the end of the paragraph. Where that rule meets an
//     abbreviation, a quotation left open, or a run of fragments, the card says so;
//   - over LONG_WORDS words is flagged.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECK = join(ROOT, 'cards/data/deck.json');
const OUT_JSON = join(ROOT, 'cards/data/first-lines.json');
const OUT_MD = join(ROOT, 'cards/review/FIRST-LINES.md');
export const RAW = join(homedir(), 'calvary-private', 'cards-first-lines');
const SITE = 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

export const LONG_WORDS = 40;                 // the brief's threshold
// The rulebook prints this card's line. If the reading ever gives anything else, nothing is built.
const PINNED = { slug: 'the-number-thirteen', line: 'Dayo was afraid of the number thirteen.' };

// THE JUDGEMENTS that the rule alone cannot make, each one named. Everything else is the rule.
const READINGS = {
  // The paragraph is the title's refrain, three one-word sentences. The rule gives "Drip."; the
  // refrain is read whole, as the title prints it.
  'drip-drip-drip': { wholeParagraph: true, note: 'a run of three one-word fragments ("Drip." alone by the rule); read whole, as the title prints it' },
};

// ── HTML → blocks of styled runs ──────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENTITIES[e.toLowerCase()] ?? m));

/** Top-level blocks: { tag, cls, style, runs: [{ t, i }] } with italics from <em>/<i>. */
export function blocks(html) {
  const out = [];
  const re = /<(p|h[1-6]|blockquote|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[2];
    const runs = [];
    let italic = 0;
    for (const part of m[3].split(/(<[^>]+>)/)) {
      if (!part) continue;
      if (part.startsWith('<')) {
        if (/^<(em|i)\b/i.test(part)) italic++;
        else if (/^<\/(em|i)>/i.test(part)) italic = Math.max(0, italic - 1);
        else if (/^<br\b/i.test(part)) runs.push({ t: '\n', i: false });
        continue;
      }
      const t = decode(part);
      const last = runs[runs.length - 1];
      if (last && last.i === (italic > 0) && last.t !== '\n') last.t += t;
      else runs.push({ t, i: italic > 0 });
    }
    out.push({
      tag: m[1].toLowerCase(),
      cls: (/class="([^"]*)"/.exec(attrs) || [])[1] || '',
      style: (/style="([^"]*)"/.exec(attrs) || [])[1] || '',
      runs,
    });
  }
  return out;
}

const textOf = (b) => b.runs.map((r) => r.t).join('');
const isEmpty = (b) => !textOf(b).replace(/[\s ]/g, '');
const allItalic = (b) => !isEmpty(b) && b.runs.every((r) => r.i || !r.t.trim());
// A verse line: the stories' editor sets verse as paragraphs with no indent and no margin.
const isVerseLine = (b) => b.tag === 'p' && /text-indent:\s*0/.test(b.style) && /margin:\s*0/.test(b.style);

// ── the sentence ──────────────────────────────────────────────────────────────────────────

const CLOSE = `'"’”)`;
const OPEN = `'"‘“(`;
const ABBREV = /(?:\b[a-z]\.[a-z]\.|\b(?:Mr|Mrs|Ms|Dr|St|Prof|Jr|Sr|No|vs|etc)\.)$/;

/**
 * The end of the first sentence in `s` (an index just past it), or -1 if it runs to the end.
 * Also reports what the boundary needed: an abbreviation read as the end, a quotation left open.
 */
export function firstSentenceEnd(s) {
  for (let i = 0; i < s.length; i++) {
    if (!'.!?…'.includes(s[i])) continue;
    let j = i + 1;
    while (j < s.length && '.!?…'.includes(s[j])) j++;
    while (j < s.length && CLOSE.includes(s[j])) j++;
    if (j >= s.length) return { end: j, abbrev: ABBREV.test(s.slice(0, i + 1)) };
    if (!/\s/.test(s[j])) continue;
    let k = j;
    while (k < s.length && /\s/.test(s[k])) k++;
    const next = s[k];
    if (next && (/\p{Lu}/u.test(next) || OPEN.includes(next) || /\d/.test(next))) {
      return { end: j, abbrev: ABBREV.test(s.slice(0, i + 1)) };
    }
  }
  return { end: -1, abbrev: false };
}

/** Cut a list of runs to its first `n` characters, keeping each run's style. */
function cutRuns(runs, n) {
  const out = [];
  let left = n;
  for (const r of runs) {
    if (left <= 0) break;
    const t = r.t.slice(0, left);
    out.push({ t, i: r.i });
    left -= t.length;
  }
  return out;
}

const quoteBalance = (s) => {
  const opens = (s.match(/[‘“]/g) || []).length;
  const closes = (s.match(/[’”]/g) || []).length - (s.match(/\p{L}’\p{L}/gu) || []).length;
  return opens - closes;
};
const words = (s) => s.split(/[\s/]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The reading of one body. Returns { line, runs, flags[] } or throws. */
export function readFirstLine(html, slug) {
  const bs = blocks(html);
  const flags = [];
  let i = 0;
  const skipped = [];
  for (; i < bs.length; i++) {
    const b = bs[i];
    if (isEmpty(b)) continue;
    if (/intro-note/.test(b.cls)) { skipped.push('content note'); continue; }
    if (/^h[1-6]$/.test(b.tag)) { skipped.push(`heading ("${textOf(b).trim()}")`); continue; }
    if (allItalic(b)) {
      const t = textOf(b).trim();
      skipped.push(words(t) <= 3 ? `dateline ("${t}", in italics)` : 'epigraph (a line in italics)');
      continue;
    }
    break;
  }
  if (i >= bs.length) throw new Error(`${slug}: no prose found`);
  if (skipped.length) flags.push({ kind: 'furniture', note: `passed over before the first sentence: ${skipped.join('; ')}` });

  const reading = READINGS[slug];
  let runs;
  if (isVerseLine(bs[i])) {
    // Verse: read line after line until a sentence ends.
    const lines = [];
    for (let k = i; k < bs.length && isVerseLine(bs[k]) && !isEmpty(bs[k]); k++) {
      lines.push(bs[k].runs.map((r) => ({ ...r, t: r.t.replace(/\s+$/, '') })));
      const joined = lines.map((l) => l.map((r) => r.t).join('')).join(' / ');
      const { end } = firstSentenceEnd(joined);
      if (end !== -1) break;
    }
    const merged = [];
    lines.forEach((l, n) => { if (n) merged.push({ t: ' / ', i: false }); merged.push(...l); });
    const joined = merged.map((r) => r.t).join('');
    const { end } = firstSentenceEnd(joined);
    runs = cutRuns(merged, end === -1 ? joined.length : end);
    flags.push({ kind: 'verse', note: lines.length > 1 ? `the sentence runs over ${lines.length} lines of verse, joined with " / "` : 'set as verse; the sentence ends inside its first line' });
  } else {
    const b = bs[i];
    const s = textOf(b);
    if (reading?.wholeParagraph) {
      runs = b.runs;
      flags.push({ kind: 'boundary', note: reading.note });
    } else {
      const { end, abbrev } = firstSentenceEnd(s);
      runs = cutRuns(b.runs, end === -1 ? s.length : end);
      if (abbrev) flags.push({ kind: 'boundary', note: 'the sentence ends on an abbreviation\'s full stop, read as the end' });
    }
  }
  // Trim surrounding space, keeping styles.
  runs = runs.map((r) => ({ ...r })).filter((r) => r.t.length);
  runs[0].t = runs[0].t.replace(/^[\s ]+/, '');
  runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/[\s ]+$/, '');
  runs = runs.filter((r) => r.t.length);
  const line = runs.map((r) => r.t).join('');

  if (/^['"‘“]/.test(line)) flags.push({ kind: 'dialogue', note: 'opens on dialogue' });
  if (quoteBalance(line) > 0) flags.push({ kind: 'boundary', note: 'the sentence ends inside a quotation, so its opening quote is left open, as printed' });
  if (/^['"‘“][^'"’”]*[.!?…]['"’”]\s/.test(textOf(bs[i])) && /['"’”]$/.test(line) && textOf(bs[i]).trim() !== line) {
    flags.push({ kind: 'boundary', note: 'the quoted sentence is read alone; the narration after it in the same paragraph is a new sentence' });
  }
  const n = words(line);
  if (n > LONG_WORDS) flags.push({ kind: 'long', note: `${n} words, over ${LONG_WORDS}` });
  if (runs.some((r) => r.i)) flags.push({ kind: 'italics', note: 'carries italics' });
  return { line, runs, words: n, flags };
}

// ── IO ────────────────────────────────────────────────────────────────────────────────────

async function fetchAll(deck) {
  mkdirSync(RAW, { recursive: true, mode: 0o700 });
  const pages = {};
  for (const c of deck) {
    if (c.kind === 'story') {
      const r = await fetch(`${SITE}/api/story`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: c.slug }) });
      writeFileSync(join(RAW, `${c.slug}.json`), await r.text(), { mode: 0o600 });
      const h = await (await fetch(`${SITE}/stories/${c.slug}`)).text();
      const dec = (s) => decode(s || '');
      pages[c.slug] = {
        title: dec((/<title>([^<]*) — Calvary Scribblings<\/title>/.exec(h) || [])[1]),
        author: dec((/name="description" content="By ([^·"]*?) ·/.exec(h) || [])[1]),
      };
    } else {
      const rows = await (await fetch(`${DB}/series_instalments.json?orderBy=%22seriesId%22&equalTo=%22${encodeURIComponent(c.seriesId)}%22`)).json();
      const first = Object.entries(rows || {}).sort((a, b) => (a[1].ordinal ?? 0) - (b[1].ordinal ?? 0))[0]?.[0] ?? null;
      const r = await fetch(`${SITE}/api/series/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instalmentId: first }) });
      const j = await r.json().catch(() => ({}));
      // Only the refusal is kept. A granted answer carries a signed URL, which is never stored.
      writeFileSync(join(RAW, `${c.slug}.series.json`), JSON.stringify({ instalmentId: first, status: r.status, code: j.code ?? null, granted: !!j.url }), { mode: 0o600 });
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  writeFileSync(join(RAW, '_pages.json'), JSON.stringify(pages, null, 1), { mode: 0o600 });
}

function build(deck) {
  const pages = JSON.parse(readFileSync(join(RAW, '_pages.json'), 'utf8'));
  const cards = deck.map((c, deckIndex) => {
    const base = { deckIndex, slug: c.slug, kind: c.kind, motif: c.motif };
    if (c.kind !== 'story') {
      const p = join(RAW, `${c.slug}.series.json`);
      const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { instalmentId: `${c.seriesId}-i1`, status: 401, code: 'signed_out' };
      return {
        ...base, title: c.title, author: c.author, line: null, runs: null, words: null,
        source: `POST /api/series/stream { instalmentId: ${s.instalmentId} }, signed out`,
        flags: [{ kind: 'unavailable', note: `not readable signed out: the series endpoint answers ${s.status} ${s.code} (the Series gate is on, and no instalment is Free to read)` }],
      };
    }
    const res = JSON.parse(readFileSync(join(RAW, `${c.slug}.json`), 'utf8'));
    const html = res.content || res.preview;
    if (!html) throw new Error(`${c.slug}: the endpoint gave no text (${res.code || res.access})`);
    const page = pages[c.slug] || {};
    const r = readFirstLine(html, c.slug);
    const flags = [...r.flags];
    if (page.author && page.author !== c.author) flags.push({ kind: 'byline', note: `byline from the story page; deck.json still has "${c.author}"` });
    return {
      ...base, title: page.title || c.title, author: page.author || c.author,
      line: r.line, runs: r.runs, words: r.words,
      source: `POST /api/story { slug }, signed out (access: ${res.access})`, flags,
    };
  });
  const pin = cards.find((c) => c.slug === PINNED.slug);
  if (pin?.line !== PINNED.line) throw new Error(`STOP: ${PINNED.slug} reads ${JSON.stringify(pin?.line)}, not the rulebook's ${JSON.stringify(PINNED.line)}`);
  return cards;
}

function markdown(cards) {
  const esc = (s) => s.replace(/\|/g, '\\|');
  const styled = (runs) => runs.map((r) => (r.i ? `*${esc(r.t)}*` : esc(r.t))).join('');
  const flagged = cards.filter((c) => c.flags.length);
  const straight = cards.filter((c) => c.line && /['"]/.test(c.line)).length;
  const L = [];
  L.push('# Shorelines: first lines (CARDS-R3)', '');
  L.push('Generated by `scripts/cards/first-lines.mjs` from `cards/data/deck.json`. Each line is the first sentence of the story\'s body, verbatim, read as a signed-out reader gets it: `POST /api/story` with no token and no telemetry fields; for a picture card, `POST /api/series/stream` for its series\' first instalment. Bylines and titles come from each story\'s page. *Italics* are the story\'s own.', '');
  L.push(`**${cards.filter((c) => c.line).length} of ${cards.length} cards have a line.** ${flagged.length} carry a flag. The Number Thirteen reads "${PINNED.line}", as the rulebook prints it.`, '');
  L.push(`Quotes are as stored: ${straight} lines use straight (typewriter) quotes or apostrophes, and none was changed.`, '');
  L.push('## Flags', '');
  for (const c of flagged) {
    L.push(`- **${c.title}** (${c.author}): ${c.flags.map((f) => `${f.kind}: ${f.note}`).join(' · ')}`);
  }
  L.push('', '## Every card', '', '| # | Title | Author | First line | Words | Flags |', '|---|---|---|---|---|---|');
  for (const c of cards) {
    L.push(`| ${c.deckIndex + 1} | ${esc(c.title)} | ${esc(c.author)} | ${c.line ? styled(c.runs) : '*(none: see flags)*'} | ${c.words ?? '—'} | ${c.flags.map((f) => f.kind).join(', ') || '—'} |`);
  }
  L.push('');
  return L.join('\n');
}

async function main() {
  const deck = JSON.parse(readFileSync(DECK, 'utf8'));
  if (process.argv.includes('--fetch')) await fetchAll(deck);
  const cards = build(deck);
  writeFileSync(OUT_JSON, `${JSON.stringify({ generated: 'scripts/cards/first-lines.mjs', longWords: LONG_WORDS, cards }, null, 1)}\n`);
  mkdirSync(dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, markdown(cards));
  console.log(`${cards.filter((c) => c.line).length}/${cards.length} lines; ${cards.filter((c) => c.flags.length).length} flagged`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
