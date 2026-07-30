// R7.4 §D — THE LOOKUP PIPELINE, under Node, with no browser and no network.
//
// app/lib/dictionary.js is plain ESM for exactly this reason (the app/lib/ribbonGeometry.js
// precedent from R7.3): the rule that decides what a reader SEES when they long-press a word
// should not be reachable only through a rendered page. Everything here runs in-process.
//
// THE ASSERTION THAT MATTERS MOST is that a glossary hit makes NO network call. It is not
// checked by inspecting a flag — the injected fetch THROWS. If the house glossary ever stops
// short-circuiting, these tests fail loudly rather than quietly getting slower.
import { test, expect } from '@playwright/test';
import {
  lookupWord, glossaryLookup, normaliseWord, wordForms, isSingleWord,
  parseGlossary, serialiseGlossary, validateGlossary,
  HOUSE_SOURCE, API_SOURCE, GLOSSARY_MAX_DEF,
} from '../../app/lib/dictionary.js';

const GLOSSARY = {
  harmattan: 'The dry, dust-laden wind that blows south from the Sahara between November and March.',
  ogbanje: 'A child said to die and return to the same mother, again and again.',
  'well-worn': 'Made familiar by long use; of a phrase, worn smooth by repetition.',
  ferryman: 'In this book, the keeper of the crossing — never named, never absent.',
};

/** A fetch that must never be called. */
const forbiddenFetch = () => { throw new Error('the network was reached on a glossary hit'); };

/** A fetch that answers like api.dictionaryapi.dev. */
function apiFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}

const API_BODY = [{
  word: 'raven',
  phonetic: '/ˈreɪv(ə)n/',
  phonetics: [{ text: '/ˈreɪv(ə)n/' }],
  meanings: [{
    partOfSpeech: 'noun',
    definitions: [
      { definition: 'A large heavily built crow with mainly black plumage.' },
      { definition: 'A deep glossy black colour.' },
      { definition: 'A third sense, kept.' },
      { definition: 'A fourth sense, which must be dropped.' },
    ],
  }],
}];

// ── normalisation ────────────────────────────────────────────────────────────
test('normaliseWord strips the punctuation a selection drags along, and keeps what is part of the word', () => {
  expect(normaliseWord('“Harmattan,”')).toBe('harmattan');
  expect(normaliseWord('Ferryman.')).toBe('ferryman');
  expect(normaliseWord("ferryman's")).toBe('ferryman');   // the possessive is not a headword
  expect(normaliseWord('well-worn')).toBe('well-worn');   // internal hyphen survives
  expect(normaliseWord("o'clock")).toBe("o'clock");       // internal apostrophe survives
  expect(normaliseWord('  RAVEN  ')).toBe('raven');
  expect(normaliseWord('—')).toBe('');
  expect(normaliseWord(null)).toBe('');
});

test('isSingleWord is the gate the chip uses', () => {
  expect(isSingleWord('harmattan')).toBe(true);
  expect(isSingleWord('the harmattan')).toBe(false);
  expect(isSingleWord('')).toBe(false);
});

test('wordForms tries regular plurals BOTH ways and never stems', () => {
  expect(wordForms('ravens')).toContain('raven');
  expect(wordForms('raven')).toContain('ravens');
  expect(wordForms('stories')).toContain('story');
  expect(wordForms('story')).toContain('stories');
  expect(wordForms('boxes')).toContain('box');
  // THE GUARD AGAINST A STEMMER: 'raven' must never be reduced to 'rave', which is a real
  // word with a real and completely wrong definition.
  expect(wordForms('raven')).not.toContain('rave');
  // 'ss' is not a plural marker: 'glass' must not become 'gla'.
  expect(wordForms('glass')).not.toContain('gla');
});

// ── the house glossary ───────────────────────────────────────────────────────
test('the glossary answers, case-insensitively and without the network', async () => {
  const entry = await lookupWord('Harmattan', { glossary: GLOSSARY, fetchImpl: forbiddenFetch });
  expect(entry).not.toBeNull();
  expect(entry.senses[0].definition).toContain('Sahara');
  expect(entry.source).toBe(HOUSE_SOURCE);
  expect(entry.house).toBe(true);
});

test('the glossary is plural-tolerant in both directions', async () => {
  // Reader taps a plural; the glossary holds the singular.
  const plural = await lookupWord('Ferrymen', { glossary: GLOSSARY, fetchImpl: forbiddenFetch });
  expect(plural).toBeNull();     // 'ferrymen' is irregular — honestly a miss, not a bad guess

  const regular = await lookupWord('ogbanjes', { glossary: GLOSSARY, fetchImpl: forbiddenFetch });
  expect(regular?.senses[0].definition).toContain('die and return');

  // Reader taps the singular; a glossary that happened to store the plural still answers.
  const reverse = glossaryLookup({ ravens: 'The birds of the crossing.' }, 'raven');
  expect(reverse?.senses[0].definition).toContain('birds');
});

test('punctuation carried in from the selection does not defeat the glossary', async () => {
  const entry = await lookupWord('“harmattan,”', { glossary: GLOSSARY, fetchImpl: forbiddenFetch });
  expect(entry?.source).toBe(HOUSE_SOURCE);
});

test('the glossary BEATS the API even when the API would have answered', async () => {
  const entry = await lookupWord('raven', {
    glossary: { raven: 'In this book: the bird that carries the second message.' },
    fetchImpl: forbiddenFetch,     // reaching it at all is the failure
  });
  expect(entry.senses[0].definition).toContain('second message');
  expect(entry.source).toBe(HOUSE_SOURCE);
});

// ── the Free Dictionary ──────────────────────────────────────────────────────
test('a word outside the glossary falls through to the API and is shaped for the modal', async () => {
  const entry = await lookupWord('raven', { glossary: GLOSSARY, fetchImpl: apiFetch(API_BODY) });
  expect(entry.source).toBe(API_SOURCE);
  expect(entry.phonetic).toBe('/ˈreɪv(ə)n/');
  expect(entry.senses[0].partOfSpeech).toBe('noun');
  expect(entry.senses[0].definition).toContain('crow');
  // AT MOST THREE. The contract's cap is editorial: a reader mid-sentence wants what it
  // means HERE, not eleven senses of 'set'.
  expect(entry.senses).toHaveLength(3);
});

test('a 404 is a MISS, not an error — the graceful-miss rule', async () => {
  const entry = await lookupWord('zzzznotaword', {
    glossary: GLOSSARY,
    fetchImpl: apiFetch({ title: 'No Definitions Found' }, { ok: false }),
  });
  expect(entry).toBeNull();
});

test('a malformed body is a miss rather than a throw', async () => {
  expect(await lookupWord('raven', { fetchImpl: apiFetch({ not: 'an array' }) })).toBeNull();
  expect(await lookupWord('raven', { fetchImpl: apiFetch([{ meanings: [] }]) })).toBeNull();
});

test('a network failure is a miss rather than a throw', async () => {
  const entry = await lookupWord('raven', {
    fetchImpl: async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); },
  });
  expect(entry).toBeNull();
});

test('a server that never answers is a miss at the timeout, and the wait is bounded', async () => {
  // The contract's 4 s, exercised at 120 ms so CI does not spend four seconds proving it.
  // The stub deliberately IGNORES the abort signal, which is why the pipeline races a clock
  // as well as aborting: an injected fetch that hangs must not hang the reader.
  const started = Date.now();
  const entry = await lookupWord('raven', {
    fetchImpl: () => new Promise(() => {}),      // never settles, never aborts
    timeoutMs: 120,
  });
  const elapsed = Date.now() - started;
  expect(entry).toBeNull();
  expect(elapsed).toBeGreaterThanOrEqual(100);
  expect(elapsed, 'the timeout must be what ends the wait').toBeLessThan(3000);
});

test('a glossary hit is not subject to the timeout at all', async () => {
  const started = Date.now();
  const entry = await lookupWord('harmattan', {
    glossary: GLOSSARY,
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 5000,
  });
  expect(entry.source).toBe(HOUSE_SOURCE);
  expect(Date.now() - started, 'the house answer is instant').toBeLessThan(200);
});

// ── the field: parse, serialise, validate ────────────────────────────────────
test('the editor writes lines and gets a map', () => {
  const { map, errors } = parseGlossary(
    'Harmattan — the dry wind\nogbanje – a child who returns\nwell-worn - made familiar by use\n\n',
  );
  expect(errors).toEqual([]);
  expect(map).toEqual({
    harmattan: 'the dry wind',
    ogbanje: 'a child who returns',
    'well-worn': 'made familiar by use',
  });
});

test('a headword keeps its own hyphen — the separator is a SPACED dash', () => {
  // The trap this guards: a naive split on '-' turns "well-worn — used" into "well".
  const { map } = parseGlossary('well-worn — made familiar by use');
  expect(Object.keys(map)).toEqual(['well-worn']);
});

test('a definition containing a dash survives intact', () => {
  const { map } = parseGlossary('crossing — the river — and what waits on the far bank');
  expect(map.crossing).toBe('the river — and what waits on the far bank');
});

test('malformed lines are reported by number and do not poison the rest', () => {
  const { map, errors } = parseGlossary('good — a definition\nthis line has no separator\nalso — fine');
  expect(Object.keys(map).sort()).toEqual(['also', 'good']);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('Line 2');
});

test('an over-long definition is refused, not truncated', () => {
  const { map, errors } = parseGlossary(`long — ${'x'.repeat(GLOSSARY_MAX_DEF + 1)}`);
  expect(map).toEqual({});
  expect(errors[0]).toContain(String(GLOSSARY_MAX_DEF));
});

test('parse and serialise round-trip', () => {
  const text = 'harmattan — the dry wind\nogbanje — a child who returns';
  expect(serialiseGlossary(parseGlossary(text).map)).toBe(text);
});

test('validateGlossary is the last gate before RTDB', () => {
  expect(validateGlossary(null)).toEqual([]);
  expect(validateGlossary({ harmattan: 'the dry wind' })).toEqual([]);
  // RTDB forbids these in a key outright; catching it here turns a database throw into a
  // sentence an editor can act on.
  expect(validateGlossary({ 'a.b': 'x' })[0]).toContain('RTDB forbids');
  expect(validateGlossary({ 'a/b': 'x' })[0]).toContain('RTDB forbids');
  expect(validateGlossary({ Harmattan: 'x' })[0]).toContain('lowercased');
  expect(validateGlossary({ '': 'x' })[0]).toContain('non-empty');
  expect(validateGlossary({ word: '' })[0]).toContain('non-empty definition');
  expect(validateGlossary({ word: 'x'.repeat(GLOSSARY_MAX_DEF + 1) })[0]).toContain(String(GLOSSARY_MAX_DEF));
  expect(validateGlossary(['not', 'a', 'map'])[0]).toContain('object or null');
});
