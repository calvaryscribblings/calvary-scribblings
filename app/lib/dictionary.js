// ─────────────────────────────────────────────────────────────────────────────
// THE DICTIONARY — the house's word before the world's.
//
// A reader long-presses a word and gets a definition. The order is not an implementation
// detail, it is the feature: a Calvary title may use a word in its own way — a coinage, a
// character's name, a piece of the book's private vocabulary — and when it does, OUR
// definition is the correct one and the world's is at best a distraction. So:
//
//   1. THE HOUSE GLOSSARY for this title. Case-insensitive, singular/plural tolerant.
//   2. THE HOUSE DICTIONARY (W23) — Open English WordNet, built into static shards under
//      /dict/en/<DICT_VERSION>/ by scripts/dictionary/build.mjs, served from our own origin.
//   3. A graceful miss, in the register's own voice. Never an error tone: not finding a
//      word is a normal thing for a dictionary to do, and it is not the reader's fault.
//
// W23 — WHY THERE IS NO OUTSIDE SERVICE ANY MORE. Until W23 step 2 was api.dictionaryapi.dev.
// By September 2026 it answered in ~19.5 s (20 of 20 timed from the codespace, half of them
// HTTP 522), so behind our 4 s timeout EVERY lookup became the calm miss — correctly calm, which
// is why weeks passed before anyone noticed. A reader's words no longer leave the site at all.
//
// A GLOSSARY HIT MAKES NO NETWORK CALL AT ALL. That is asserted rather than assumed
// (tests/reader/dictionary.spec.mjs passes a fetch that throws if it is called): it is what
// makes the house glossary instant, and what makes the feature work on a train.
//
// WHY THIS FILE IS PLAIN ESM. No React, no imports, no DOM — so the harness can import it
// under Node and drive the whole pipeline with a stubbed fetch, including the timeout,
// without a browser. Same reason app/lib/ribbonGeometry.js is plain ESM: the rule that
// decides what a reader SEES should not be reachable only through a rendered page.
// ─────────────────────────────────────────────────────────────────────────────

/** Where an answer came from. Rendered verbatim at the foot of the modal. */
export const HOUSE_SOURCE = 'House glossary · Calvary Scribblings';
// RULED (101, 28 Sep 2026). The licence (CC BY 4.0, with the Princeton WordNet notice) asks for
// credit to BOTH, so both are named. The full text is served at /dict/en/<DICT_VERSION>/LICENSE.
export const DICT_SOURCE = 'Open English WordNet · Princeton WordNet';

// The published dictionary this bundle reads. A folder, not a file: every shard in it is
// immutable (cached for a year), so a rebuild that changes anything must bump this, and the
// build refuses to overwrite a version with different bytes. Format and source edition both.
export const DICT_VERSION = 'oewn-2025-1';
export const DICT_BASE = `/dict/en/${DICT_VERSION}`;

export const DEFINE_TIMEOUT_MS = 4000;
export const GLOSSARY_MAX_DEF = 500;

// The word as the reader sees it, reduced to the word a dictionary can be asked about.
// Strips the punctuation that rides along with a selection — quotes, a trailing comma, an
// em dash, the possessive — but keeps INTERNAL hyphens and apostrophes, because "well-worn"
// and "o'clock" are words and "well" and "o" are not what was tapped.
export function normaliseWord(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'")     // curly apostrophes → straight, so keys match
    .replace(/[‐-―]/g, '-')          // every dash → hyphen-minus
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')           // leading punctuation
    .replace(/[^\p{L}\p{N}]+$/u, '')           // trailing punctuation
    .replace(/'s$/, '')                        // the possessive is not a headword
    .replace(/\s+/g, ' ')                      // W24: a glossary PHRASE may be selected across a line break
    .trim();
}

/**
 * RULED (103): the multi-word keys of a title's glossary ("grand isle", "middle passage"). This is
 * ALL the reading-room frame is told — the phrases, never the definitions — so the chip can offer
 * Define for a selection that is one of them, and for no other multi-word selection.
 */
export function glossaryPhrases(glossary) {
  if (!glossary || typeof glossary !== 'object') return [];
  const out = [];
  for (const k of Object.keys(glossary)) {
    const w = normaliseWord(k);
    if (w.includes(' ') && typeof glossary[k] === 'string' && !out.includes(w)) out.push(w);
  }
  return out.sort();
}

/** Is this one word? The chip is single-word only, so this is the gate the host uses too. */
export function isSingleWord(raw) {
  const w = normaliseWord(raw);
  return w.length > 0 && w.length <= 48 && !/[\s]/.test(w);
}

// The forms to try against the glossary, in order, most literal first.
//
// DELIBERATELY NOT A STEMMER. A stemmer would turn "raven" into "rave" and hand back the
// wrong entry with total confidence — worse than a miss, because the reader has no way to
// tell. These are only the regular English plural/singular pairs, applied in BOTH
// directions, because an editor may have written the headword either way and should not
// have to guess which the reader will tap.
export function wordForms(raw) {
  const w = normaliseWord(raw);
  if (!w) return [];
  const forms = [w];
  const add = (f) => { if (f && f !== w && !forms.includes(f)) forms.push(f); };

  // Reader tapped a plural, the glossary holds the singular.
  if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2) add(w.slice(0, -1));

  // Reader tapped a singular, the glossary holds the plural.
  add(w + 's');
  if (/[^aeiou]y$/.test(w)) add(w.slice(0, -1) + 'ies');
  if (/(s|x|z|ch|sh)$/.test(w)) add(w + 'es');

  return forms;
}

/**
 * The house glossary. Keys are stored lowercased; we still lowercase on read so a
 * hand-edited record cannot silently stop matching.
 * @returns {{word:string, phonetic:null, senses:{partOfSpeech:null, definition:string}[], source:string, house:true}|null}
 */
export function glossaryLookup(glossary, raw) {
  if (!glossary || typeof glossary !== 'object') return null;
  const index = new Map();
  for (const [k, v] of Object.entries(glossary)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    const key = normaliseWord(k);
    if (key && !index.has(key)) index.set(key, v);
  }
  for (const form of wordForms(raw)) {
    const hit = index.get(form);
    if (hit) {
      return {
        word: normaliseWord(raw),
        phonetic: null,
        senses: [{ partOfSpeech: null, definition: hit }],
        groups: [{ word: normaliseWord(raw), senses: [{ partOfSpeech: null, definition: hit }] }],
        source: HOUSE_SOURCE,
        house: true,
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE HOUSE DICTIONARY — shards, morphy, and the lookup.
// ─────────────────────────────────────────────────────────────────────────────

export const POS_NAME = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const POS_ORDER = ['n', 'v', 'a', 'r'];
// RULED (102): three senses per part of speech (the shards carry no more), and SIX in all, so a
// word that is a headword and also a form of others never turns into a wall mid-sentence.
export const MAX_SENSES = 6;

/** A headword's shard key: lowercased, and every character outside a–z/0–9 read as '_'. */
export function sanitiseKey(word) {
  return Array.from(String(word || '').toLowerCase()).map((c) => (/[a-z0-9]/.test(c) ? c : '_')).join('');
}

/** A shard's file name. Prefixed, so no prefix ever becomes a reserved name like con.json. */
export const shardFileName = (prefix) => `p_${prefix}.json`;

/**
 * Which shard holds this word: the LONGEST prefix in the manifest that begins its key. The build
 * splits a prefix only when its shard is too large, and keeps any word whose key IS that prefix in
 * the prefix's own shard — so the longest match is the one place the word can be.
 */
export function shardFor(word, prefixes) {
  const key = sanitiseKey(word);
  const set = prefixes instanceof Set ? prefixes : new Set(prefixes || []);
  for (let n = key.length; n > 0; n--) if (set.has(key.slice(0, n))) return key.slice(0, n);
  return null;
}

// MORPHY — WordNet's own, ported from morph.c (WordNet 3.x), so "ran" finds run and "cities"
// finds city. It is NOT a stemmer: a candidate is only ever accepted if the dictionary holds it
// in that part of speech, which is what keeps "raven" from being read as "rave".
//
// The EXCEPTION LISTS (noun.exc, verb.exc, adj.exc, adv.exc: "went go", "mice mouse") are
// morphy's too, but they travel in the shards as each inflected form's `x`, not in this file:
// they are data from the same release, versioned with it, and 5,000 lines of them have no
// business in the reader's JavaScript. So "went" is found by reading the shard "went" lives in.
//
// The detachment rules, morph.c's sufx[]/addr[] tables, in its order:
export const MORPHY_RULES = {
  n: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  v: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  a: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  r: [],     // adverbs: the exception list only
};

/**
 * The rule candidates for a word in one part of speech, in morph.c's order. Pure: whether each is
 * a real headword is the caller's question. morph.c's two noun guards are kept — a noun ending in
 * "ss" or of two letters or fewer is not detached ("glass" is not "glas") — and so is its "-ful"
 * rule ("boxesful" is tried as "box" + "ful").
 * @returns {{base:string, then:string}[]}  `then` is re-appended after a match ("ful" or "")
 */
export function morphyCandidates(word, pos) {
  const w = String(word || '');
  const rules = MORPHY_RULES[pos] || [];
  if (!rules.length) return [];
  let stem = w, end = '';
  if (pos === 'n') {
    if (w.endsWith('ful')) { stem = w.slice(0, w.lastIndexOf('f')); end = 'ful'; }
    else if (w.endsWith('ss') || w.length <= 2) return [];
  }
  const out = [];
  for (const [suffix, ending] of rules) {
    if (!stem.endsWith(suffix)) continue;
    const base = stem.slice(0, stem.length - suffix.length) + ending;
    if (base && base !== stem && !out.some((c) => c.base === base)) out.push({ base, then: end });
  }
  return out;
}

const sensesOf = (entry, pos) => ((entry && Array.isArray(entry.s)) ? entry.s.filter((x) => !pos || x[0] === pos) : []);

// The shards a session has read, by URL. A shard is read once and kept: a reader who looks up
// three words on one page reads one file. A FAILED read is not kept, so a reader who was offline
// for one lookup is not stuck missing for the rest of the session.
const sessionCache = new Map();
export function clearDictionaryCache() { sessionCache.clear(); }

function readJson(url, doFetch, cache) {
  if (cache.has(url)) return cache.get(url);
  const p = Promise.resolve()
    .then(() => doFetch(url))
    .then((res) => {
      if (res && res.status === 404) return null;                  // a shard that does not exist is a miss
      if (!res || !res.ok) throw new Error(`dictionary read ${res && res.status}`);
      return res.json();
    })
    .catch((e) => { cache.delete(url); throw e; });
  cache.set(url, p);
  return p;
}

/**
 * The house dictionary alone. Rejects on a network failure (the caller turns that into the miss);
 * resolves null for a word it does not hold.
 */
export async function dictionaryLookup(raw, { fetchImpl, base = DICT_BASE, cache = sessionCache } = {}) {
  const word = normaliseWord(raw);
  if (!word) return null;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;

  const manifest = await readJson(`${base}/manifest.json`, doFetch, cache);
  if (!manifest || !Array.isArray(manifest.prefixes)) return null;
  const prefixes = new Set(manifest.prefixes);
  const entryFor = async (w) => {
    const p = shardFor(w, prefixes);
    if (p === null) return null;
    const shard = await readJson(`${base}/${shardFileName(p)}`, doFetch, cache);
    return (shard && Object.prototype.hasOwnProperty.call(shard, w)) ? shard[w] : null;
  };

  // Every rule candidate is known before anything is read, so the literal and the candidates are
  // read together; nearly always they share a shard, and that shard is read once.
  const candidates = POS_ORDER.flatMap((pos) => morphyCandidates(word, pos).map((c) => ({ pos, ...c })));
  const [literal, ...found] = await Promise.all([entryFor(word), ...candidates.map((c) => entryFor(c.base))]);

  // RULED (102): the tapped word's OWN entry comes first, when it has one — and then every word
  // morphy says it may come from, in morphy's order. "saw" is saw, then see; "went" has no entry
  // of its own, so it is go alone. One group per headword; a base reached in two parts of speech
  // ("stalls" → stall the noun and stall the verb) is one group carrying both.
  const groups = [];
  const add = (headword, senses) => {
    if (!senses.length) return;
    const g = groups.find((x) => x.word === headword);
    if (!g) { groups.push({ word: headword, senses: senses.slice() }); return; }
    for (const s of senses) if (!g.senses.includes(s)) g.senses.push(s);
  };
  add(word, sensesOf(literal));

  // MORPHY, per part of speech, in WordNet's order. As in morph.c: the exception list wins for
  // that part of speech, and only when it has nothing do the rules run, first match taken.
  for (const pos of POS_ORDER) {
    const exc = ((literal && literal.x && literal.x[pos]) || []).filter((b) => b !== word);
    if (exc.length) {
      const entries = await Promise.all(exc.map((b) => entryFor(b)));
      exc.forEach((b, i) => add(b, sensesOf(entries[i], pos)));
      continue;
    }
    const i = candidates.findIndex((c, k) => c.pos === pos && c.base !== word && sensesOf(found[k], pos).length);
    if (i < 0) continue;
    const c = candidates[i];
    if (c.then) {
      // The "-ful" rule: "boxesful" → box → the headword is "boxful", which must exist too.
      add(c.base + c.then, sensesOf(await entryFor(c.base + c.then), pos));
    } else {
      add(c.base, sensesOf(found[i], pos));
    }
  }
  if (!groups.length) return null;
  return shape(groups, word);
}

// A group's share, spread across its parts of speech ("leaves": leave the noun AND leave the verb,
// not three nouns), then shown in the source's order. A group within its share is shown whole.
function pick(senses, n) {
  if (senses.length <= n) return senses;
  const byPos = POS_ORDER.map((pos) => senses.map((x, i) => [x, i]).filter(([x]) => x[0] === pos)).filter((b) => b.length);
  const chosen = [];
  for (let round = 0; chosen.length < n; round++) {
    let any = false;
    for (const b of byPos) if (round < b.length && chosen.length < n) { chosen.push(b[round]); any = true; }
    if (!any) break;
  }
  return chosen.sort((a, b) => a[1] - b[1]).map(([x]) => x);
}

// SIX senses in all, dealt one group at a time, so each headword the lookup found is shown before
// any of them gets a further sense. Within a group the source's order is kept, and each part of
// speech already carries at most three (the shards hold no more). A group dealt nothing is dropped.
function shape(rawGroups, form) {
  const take = rawGroups.map(() => 0);
  let total = 0;
  for (let progressed = true; progressed && total < MAX_SENSES;) {
    progressed = false;
    rawGroups.forEach((g, i) => {
      if (total < MAX_SENSES && take[i] < g.senses.length) { take[i]++; total++; progressed = true; }
    });
  }
  const groups = rawGroups
    .map((g, i) => ({
      word: g.word,
      senses: pick(g.senses, take[i]).map(([pos, definition]) => ({ partOfSpeech: POS_NAME[pos] || null, definition })),
    }))
    .filter((g) => g.senses.length);
  if (!groups.length) return null;
  return {
    word: groups[0].word,
    form,
    phonetic: null,
    groups,
    senses: groups.flatMap((g) => g.senses),      // flat, for any reader of the old shape
    source: DICT_SOURCE,
    house: false,
  };
}

/**
 * The whole pipeline. Never throws and never rejects: every failure — offline, a missing shard,
 * a malformed body, a server that answers in eight seconds — returns null, which the register
 * renders as the same calm miss. A dictionary that throws at a reader has misunderstood its job.
 *
 * @param {string} raw               the tapped word, as selected
 * @param {object} opts
 * @param {object|null} opts.glossary   the title's house glossary
 * @param {Function} [opts.fetchImpl]   injected for the harness; defaults to global fetch
 * @param {number} [opts.timeoutMs]     4 s in the wild; the specs pass something small
 * @param {string} [opts.base]          where the dictionary lives; the site's own path by default
 * @returns {Promise<object|null>}
 */
export async function lookupWord(raw, { glossary = null, fetchImpl = null, timeoutMs = DEFINE_TIMEOUT_MS, base = DICT_BASE, cache } = {}) {
  const word = normaliseWord(raw);
  if (!word) return null;

  const house = glossaryLookup(glossary, word);
  if (house) return house;                     // ← the network is never touched
  // A phrase is the glossary's alone (103): the house dictionary holds single words only.
  if (word.includes(' ')) return null;

  // The timeout is a RACE. A stub that ignores everything would otherwise hang the pipeline for
  // as long as it liked, so the clock is authoritative. It bounds the whole lookup — manifest,
  // shard, and any shard morphy sends it to — not each read.
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('__timeout__'), timeoutMs); });
  try {
    const found = await Promise.race([dictionaryLookup(word, { fetchImpl, base, cache }), timeout]);
    return found === '__timeout__' ? null : found;
  } catch (e) {
    return null;                               // offline, DNS, a 5xx, malformed JSON — all a miss
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GLOSSARY FIELD — parsing, serialising, validating.
//
// Stored as a flat map { lowercasedWord: definition }, which is what makes the reader's
// lookup a Map.get rather than a scan, and what lets RTDB hand the whole thing over with
// the title in one read. Authored as one entry per line, `word — definition`, because that
// is how a glossary is written on paper and an editor should not have to think in JSON.
// ─────────────────────────────────────────────────────────────────────────────

// Em dash, en dash, or a bare hyphen with spaces around it. NOT a bare hyphen without
// spaces — "well-worn — thoroughly used" must split at the em dash and keep the headword
// whole, and a naive /-/ would cut it into "well".
const ENTRY_SPLIT = /\s+[—–]\s+|\s+-\s+|\s*[—–]\s*/;

/** Textarea → map. Silently drops blank lines; a line with no separator is reported. */
export function parseGlossary(text) {
  const map = {};
  const errors = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(ENTRY_SPLIT);
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: expected "word — definition"`);
      return;
    }
    const key = normaliseWord(parts[0]);
    const def = parts.slice(1).join(' — ').trim();
    if (!key) { errors.push(`Line ${i + 1}: the word is empty`); return; }
    if (!def) { errors.push(`Line ${i + 1}: "${parts[0].trim()}" has no definition`); return; }
    if (def.length > GLOSSARY_MAX_DEF) {
      errors.push(`Line ${i + 1}: "${key}" is ${def.length} characters (max ${GLOSSARY_MAX_DEF})`);
      return;
    }
    map[key] = def;
  });
  return { map, errors };
}

/** Map → textarea, sorted, so an edit round-trips to something an editor recognises. */
export function serialiseGlossary(map) {
  if (!map || typeof map !== 'object') return '';
  return Object.keys(map)
    .filter((k) => typeof map[k] === 'string')
    .sort()
    .map((k) => `${k} — ${map[k]}`)
    .join('\n');
}

/**
 * The shape check the writer runs before anything reaches the database. Returns an array
 * of error strings; empty means ok. null/undefined is valid — most titles have no glossary.
 */
export function validateGlossary(glossary) {
  if (glossary === null || glossary === undefined) return [];
  if (typeof glossary !== 'object' || Array.isArray(glossary)) return ['glossary must be an object or null'];
  const errors = [];
  for (const [k, v] of Object.entries(glossary)) {
    if (typeof k !== 'string' || !k.trim()) { errors.push('glossary keys must be non-empty words'); continue; }
    // RTDB forbids these in a key outright; catching it here turns a write that would throw
    // at the database into a sentence an editor can act on.
    if (/[.$#[\]/]/.test(k)) { errors.push(`glossary key '${k}' contains a character RTDB forbids ( . $ # [ ] / )`); continue; }
    if (k !== k.toLowerCase()) { errors.push(`glossary key '${k}' must be lowercased`); continue; }
    if (typeof v !== 'string' || !v.trim()) { errors.push(`glossary entry '${k}' must have a non-empty definition`); continue; }
    if (v.length > GLOSSARY_MAX_DEF) errors.push(`glossary entry '${k}' must be ${GLOSSARY_MAX_DEF} characters or fewer`);
  }
  return errors;
}
