// ─────────────────────────────────────────────────────────────────────────────
// THE DICTIONARY — the house's word before the world's.
//
// A reader long-presses a word and gets a definition. The order is not an implementation
// detail, it is the feature: a Calvary title may use a word in its own way — a coinage, a
// character's name, a piece of the book's private vocabulary — and when it does, OUR
// definition is the correct one and the world's is at best a distraction. So:
//
//   1. THE HOUSE GLOSSARY for this title. Case-insensitive, singular/plural tolerant.
//   2. api.dictionaryapi.dev — the Free Dictionary, no key, no attribution requirement.
//   3. A graceful miss, in the register's own voice. Never an error tone: not finding a
//      word is a normal thing for a dictionary to do, and it is not the reader's fault.
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
export const API_SOURCE = 'Free Dictionary';

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
    .trim();
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
        source: HOUSE_SOURCE,
        house: true,
      };
    }
  }
  return null;
}

// api.dictionaryapi.dev returns an ARRAY of entries, each with meanings[] →
// definitions[]. A 404 carries a JSON body with a `title` of "No Definitions Found",
// which is a miss and not an error — the distinction the whole graceful-miss rule rests on.
export function shapeApiResponse(payload, raw) {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const senses = [];
  let phonetic = null;
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    if (!phonetic) {
      if (typeof entry.phonetic === 'string' && entry.phonetic.trim()) phonetic = entry.phonetic.trim();
      else if (Array.isArray(entry.phonetics)) {
        const p = entry.phonetics.find((x) => x && typeof x.text === 'string' && x.text.trim());
        if (p) phonetic = p.text.trim();
      }
    }
    for (const meaning of entry.meanings || []) {
      for (const def of (meaning && meaning.definitions) || []) {
        const text = def && typeof def.definition === 'string' ? def.definition.trim() : '';
        if (!text) continue;
        senses.push({ partOfSpeech: meaning.partOfSpeech || null, definition: text });
        // THREE, and the cap is editorial rather than technical. The Free Dictionary will
        // happily return eleven senses of "set"; a reader who long-pressed a word mid
        // sentence wants to know what it means HERE, and a wall of senses is a worse answer
        // than the first three. The rest are a tap away in a real dictionary.
        if (senses.length >= 3) break;
      }
      if (senses.length >= 3) break;
    }
    if (senses.length >= 3) break;
  }
  if (!senses.length) return null;
  return {
    word: (payload[0] && typeof payload[0].word === 'string' && payload[0].word) || normaliseWord(raw),
    phonetic,
    senses,
    source: API_SOURCE,
    house: false,
  };
}

/**
 * The whole pipeline. Never throws and never rejects: every failure — offline, 404, a
 * malformed body, a server that answers in eight seconds — returns null, which the register
 * renders as the same calm miss. A dictionary that throws at a reader has misunderstood
 * its job.
 *
 * @param {string} raw               the tapped word, as selected
 * @param {object} opts
 * @param {object|null} opts.glossary   the title's house glossary
 * @param {Function} [opts.fetchImpl]   injected for the harness; defaults to global fetch
 * @param {number} [opts.timeoutMs]     4 s in the wild; the specs pass something small
 * @returns {Promise<object|null>}
 */
export async function lookupWord(raw, { glossary = null, fetchImpl = null, timeoutMs = DEFINE_TIMEOUT_MS } = {}) {
  const word = normaliseWord(raw);
  if (!word) return null;

  const house = glossaryLookup(glossary, word);
  if (house) return house;                     // ← the network is never touched

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;

  // The timeout is a RACE as well as an abort. Aborting is the right way to stop a real
  // request, but a stub that ignores the signal would otherwise hang the pipeline for as
  // long as it liked and the timeout would be untestable — so the clock is authoritative
  // and the abort is the courtesy that stops the socket.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} resolve('__timeout__'); }, timeoutMs);
  });

  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await Promise.race([
      doFetch(url, controller ? { signal: controller.signal } : undefined),
      timeout,
    ]);
    if (res === '__timeout__') return null;
    if (!res || !res.ok) return null;          // 404 "No Definitions Found" lands here
    const body = await Promise.race([res.json(), timeout]);
    if (body === '__timeout__') return null;
    return shapeApiResponse(body, word);
  } catch (e) {
    return null;                               // offline, DNS, abort, malformed JSON — all a miss
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
