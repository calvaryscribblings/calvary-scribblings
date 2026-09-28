#!/usr/bin/env node
// W23 — THE HOUSE DICTIONARY. Turns Open English WordNet into sharded static JSON the Reading
// Room can look a word up in without the word ever leaving the site.
//
//   node scripts/dictionary/build.mjs                  download the pinned release, build, write
//   node scripts/dictionary/build.mjs --source <zip>   build from a local copy of the same zip
//   node scripts/dictionary/build.mjs --check          build in memory and compare with what is committed
//
// WHERE IT LANDS: public/dict/en/<DICT_VERSION>/ — p_<prefix>.json shards, manifest.json, LICENSE.
// The folder is VERSIONED so a rebuild can never serve a mixed dictionary: a shard is immutable
// once published (public/_headers caches /dict/en/* for a year), and a new build that would
// change a byte of an existing version REFUSES rather than overwriting. Change the format or the
// source → bump DICT_VERSION in app/lib/dictionary.js, which is what the reader asks for.
//
// THE SOURCE is the WNDB flavour of the release (index.*, data.*, *.exc), pinned by sha256. WNDB
// rather than the GWA XML or the JSON because it carries both things we need in one archive: the
// senses in the source's own order (the index lists synsets in sense order) and morphy's own
// exception lists (noun.exc, verb.exc, adj.exc, adv.exc), which the XML does not ship.
//
// THE CORE 2025 EDITION, not 2025+. From 2025, OEWN moved proper nouns out to Open English
// Namenet; "2025+" adds a curated set of them back. The Reading Room's dictionary is for words;
// a name is the title's own business, and that is what its house glossary is for.
//
// WHAT AN ENTRY IS (the contract docs/APP-HANDOFF-DICTIONARY.md hands to the app):
//
//   "<headword>": { "s": [["n","definition"], ["v","definition"], …], "x": { "v": ["go"] } }
//
//   s  the senses, in the source's order: parts of speech in WordNet's order (n, v, a, r), and
//      within each, the index's sense order. AT MOST THREE PER PART OF SPEECH — the reader is
//      shown three in all, but morphy works per part of speech ("went" is the verb go, never go
//      the board game), so each part of speech has to carry its own first three.
//   x  morphy's exception entries for this form (from *.exc), by part of speech. Only when the
//      base is itself a headword in that part of speech.
//
// Satellite adjectives (ss_type 's') are adjectives. Multi-word lemmas (ice_cream) are left out:
// the chip is single-word only, so no reader can ever tap one.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DICT_VERSION, shardFileName, sanitiseKey } from '../../app/lib/dictionary.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SOURCE = {
  name: 'Open English WordNet',
  edition: '2025',
  url: 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.zip',
  sha256: '73355e48f8117a24ca9ebc23ed75b35434e6cd21cc9dd3984e80aff5a5f63636',
  licence: 'CC BY 4.0 (with the Princeton WordNet 3.1 notice)',
  // The two licence texts, from the same tag. Shipped verbatim, in this order, as LICENSE.
  licenceFiles: [
    'https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/LICENSE.md',
    'https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/WNDB_License.txt',
  ],
};

/** The ceiling for one shard, gzip -9. Pages' limit is 25 MiB; this keeps a lookup one small read. */
export const SHARD_MAX_GZ = 48 * 1024;
export const SENSES_PER_POS = 3;
const POS_ORDER = ['n', 'v', 'a', 'r'];
const POS_FILE = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };

// ── a zip reader: stored and deflated entries, central directory only ─────────────────────
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    if (!name.endsWith('/')) {
      if (method === 0) files.set(name, raw);
      else if (method === 8) files.set(name, inflateRawSync(raw));
      else throw new Error(`zip: ${name} uses method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ── WNDB parsing ──────────────────────────────────────────────────────────────────────────
const lines = (buf) => buf.toString('utf8').split('\n').filter((l) => l && !l.startsWith('  '));

/** data.<pos>: synset offset → definition. The gloss is `definition; "example"; "example"`. */
export function parseData(buf) {
  const out = new Map();
  for (const line of lines(buf)) {
    const bar = line.indexOf(' | ');
    if (bar < 0) continue;
    const offset = line.slice(0, 8);
    out.set(offset, definitionOf(line.slice(bar + 3)));
  }
  return out;
}

/** The definition part of a gloss: everything before the first quoted example. */
export function definitionOf(gloss) {
  const g = String(gloss || '').trim();
  const ex = g.search(/;\s*"/);
  const def = (ex >= 0 ? g.slice(0, ex) : g).trim().replace(/\s+/g, ' ').replace(/;$/, '').trim();
  return def.startsWith('"') ? '' : def;
}

/** index.<pos>: lemma → synset offsets, in sense order. */
export function parseIndex(buf) {
  const out = new Map();
  for (const line of lines(buf)) {
    const f = line.trim().split(' ');
    const lemma = f[0];
    const synsetCnt = Number(f[2]);
    const pCnt = Number(f[3]);
    // lemma pos synset_cnt p_cnt [ptr_symbol…] sense_cnt tagsense_cnt synset_offset…
    const offsets = f.slice(4 + pCnt + 2, 4 + pCnt + 2 + synsetCnt);
    out.set(lemma, offsets);
  }
  return out;
}

/** <pos>.exc: inflected form → base forms. */
export function parseExc(buf) {
  const out = new Map();
  for (const line of buf.toString('utf8').split('\n')) {
    const [form, ...bases] = line.trim().split(/\s+/);
    if (!form || !bases.length) continue;
    // A form can have several lines ("leaves leaf" and "leaves leave"), so accumulate.
    const have = out.get(form) || [];
    for (const b of bases) if (!have.includes(b)) have.push(b);
    out.set(form, have);
  }
  return out;
}

const singleWord = (lemma) => !lemma.includes('_');

// ── the entries ───────────────────────────────────────────────────────────────────────────
export function buildEntries(files) {
  const get = (suffix) => {
    const hit = [...files.keys()].find((k) => k.endsWith(`/${suffix}`) || k === suffix);
    if (!hit) throw new Error(`the archive has no ${suffix}`);
    return files.get(hit);
  };
  const entries = new Map();
  const entry = (w) => { if (!entries.has(w)) entries.set(w, { s: [], x: {} }); return entries.get(w); };
  const defined = { n: new Set(), v: new Set(), a: new Set(), r: new Set() };

  for (const pos of POS_ORDER) {
    const data = parseData(get(`data.${POS_FILE[pos]}`));
    const index = parseIndex(get(`index.${POS_FILE[pos]}`));
    for (const [lemma, offsets] of index) {
      if (!singleWord(lemma)) continue;
      const defs = [];
      for (const o of offsets) {
        const d = data.get(o);
        if (d && !defs.includes(d)) defs.push(d);
        if (defs.length >= SENSES_PER_POS) break;
      }
      if (!defs.length) continue;
      defined[pos].add(lemma);
      // POS_ORDER is the outer loop, so each headword's senses arrive n, v, a, r.
      for (const d of defs) entry(lemma).s.push([pos, d]);
    }
  }

  for (const pos of POS_ORDER) {
    for (const [form, bases] of parseExc(get(`${POS_FILE[pos]}.exc`))) {
      if (!singleWord(form)) continue;
      const ok = bases.filter((b) => b !== form && singleWord(b) && defined[pos].has(b));
      if (!ok.length) continue;
      entry(form).x[pos] = ok;
    }
  }

  // Compact: drop the empty halves, so the common entry is { s: [...] } and nothing else.
  const out = {};
  for (const w of [...entries.keys()].sort()) {
    const e = entries.get(w);
    const o = {};
    if (e.s.length) o.s = e.s;
    if (Object.keys(e.x).length) o.x = e.x;
    out[w] = o;
  }
  return out;
}

// ── sharding ──────────────────────────────────────────────────────────────────────────────
const gzLen = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;
const shardJson = (words, all) => JSON.stringify(Object.fromEntries(words.map((w) => [w, all[w]])));

/**
 * Split by headword prefix until every shard is under the ceiling. A word whose key IS the prefix
 * being split stays in that prefix's own shard; the rest go one character deeper. The reader
 * finds a word's shard as the LONGEST listed prefix of its key (see shardFor in dictionary.js).
 */
export function shard(all, max = SHARD_MAX_GZ) {
  const shards = {};
  const words = Object.keys(all).sort();
  const split = (prefix, ws) => {
    const json = shardJson(ws, all);
    if (prefix && gzLen(json) <= max) { shards[prefix] = json; return; }
    const here = ws.filter((w) => sanitiseKey(w) === prefix);
    const groups = new Map();
    for (const w of ws) {
      const k = sanitiseKey(w);
      if (k === prefix) continue;
      const c = prefix + k[prefix.length];
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(w);
    }
    if (here.length) shards[prefix] = shardJson(here, all);
    for (const [c, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) split(c, g);
  };
  split('', words);
  if (shards['']) throw new Error('a headword with an empty key reached the root shard');
  return shards;
}

// ── the build ─────────────────────────────────────────────────────────────────────────────
async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function build({ source } = {}) {
  const zip = source ? readFileSync(source) : await fetchBuf(SOURCE.url);
  const sha = createHash('sha256').update(zip).digest('hex');
  if (sha !== SOURCE.sha256) throw new Error(`the source zip's sha256 is ${sha}, not the pinned ${SOURCE.sha256}`);
  const all = buildEntries(unzip(zip));
  const shards = shard(all);
  const licenceParts = await Promise.all(SOURCE.licenceFiles.map((u) => fetchBuf(u).then((b) => b.toString('utf8'))));
  const licence = [
    `${SOURCE.name} ${SOURCE.edition} — ${SOURCE.licence}`,
    `Source: ${SOURCE.url}`,
    'Reshaped for the Calvary Scribblings Reading Room by scripts/dictionary/build.mjs: definitions only,',
    'at most three senses per part of speech, single-word headwords only.',
    '',
    ...licenceParts.map((t) => t.trimEnd() + '\n'),
  ].join('\n');
  const prefixes = Object.keys(shards).sort();
  const manifest = {
    version: DICT_VERSION,
    source: { name: SOURCE.name, edition: SOURCE.edition, url: SOURCE.url, sha256: SOURCE.sha256, licence: SOURCE.licence },
    headwords: Object.keys(all).length,
    shards: prefixes.length,
    prefixes,
  };
  const files = { 'manifest.json': JSON.stringify(manifest), LICENSE: licence };
  for (const p of prefixes) files[shardFileName(p)] = shards[p];
  return { files, all, manifest };
}

function report(files) {
  const names = Object.keys(files).filter((n) => n.startsWith('p_'));
  let raw = 0, gz = 0, big = { name: '', gz: 0, raw: 0 };
  for (const [n, s] of Object.entries(files)) {
    const r = Buffer.byteLength(s), g = gzLen(s);
    raw += r; gz += g;
    if (names.includes(n) && g > big.gz) big = { name: n, gz: g, raw: r };
  }
  return { files: Object.keys(files).length, shards: names.length, rawBytes: raw, gzBytes: gz, largest: big };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--source');
  const { files, manifest } = await build({ source: si >= 0 ? args[si + 1] : undefined });
  const dir = join(ROOT, 'public', 'dict', 'en', DICT_VERSION);
  const committed = existsSync(dir) ? readdirSync(dir) : [];
  const differs = committed.length > 0 && (
    committed.length !== Object.keys(files).length
    || Object.entries(files).some(([n, s]) => !existsSync(join(dir, n)) || readFileSync(join(dir, n), 'utf8') !== s));
  const r = report(files);
  console.log(`${manifest.headwords} headwords → ${r.shards} shards + manifest + LICENSE = ${r.files} files`);
  console.log(`total ${(r.rawBytes / 1048576).toFixed(2)} MiB raw, ${(r.gzBytes / 1048576).toFixed(2)} MiB gzip`);
  console.log(`largest shard ${r.largest.name}: ${(r.largest.gz / 1024).toFixed(1)} KiB gzip, ${(r.largest.raw / 1024).toFixed(1)} KiB raw`);
  if (args.includes('--check')) {
    if (differs || !committed.length) { console.error(`public/dict/en/${DICT_VERSION} does NOT match a fresh build`); process.exit(1); }
    console.log(`public/dict/en/${DICT_VERSION} matches a fresh build byte for byte`);
    process.exit(0);
  }
  if (differs) {
    console.error(`public/dict/en/${DICT_VERSION} already holds a DIFFERENT dictionary. A published version is immutable\n`
      + '(cached for a year). Bump DICT_VERSION in app/lib/dictionary.js and build again.');
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  for (const [n, s] of Object.entries(files)) writeFileSync(join(dir, n), s);
  // Older versions are left in place for one deploy, so a reader holding the previous bundle is
  // not stranded mid-session; remove them in the round after.
  const others = readdirSync(join(ROOT, 'public', 'dict', 'en')).filter((v) => v !== DICT_VERSION);
  if (others.length) console.log(`older versions still present (remove next round): ${others.join(', ')}`);
  console.log(`wrote public/dict/en/${DICT_VERSION}/`);
}
