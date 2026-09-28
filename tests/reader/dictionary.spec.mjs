// R7.4 §D — THE LOOKUP PIPELINE, under Node, with no browser and no network.
//
// app/lib/dictionary.js is plain ESM for exactly this reason (the app/lib/ribbonGeometry.js
// precedent from R7.3): the rule that decides what a reader SEES when they long-press a word
// should not be reachable only through a rendered page. Everything here runs in-process.
//
// W23: step 2 is now the HOUSE DICTIONARY — static shards under /dict/en/<DICT_VERSION>/, read
// here through a stubbed fetch: a tiny in-memory dictionary for the pipeline's own rules, and the
// real built shards (public/dict/en/…) for morphy's golden cases, so "went finds go" is proven
// against the data a reader actually gets.
//
// THE ASSERTION THAT MATTERS MOST is that a glossary hit makes NO network call. It is not
// checked by inspecting a flag — the injected fetch THROWS. If the house glossary ever stops
// short-circuiting, these tests fail loudly rather than quietly getting slower.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lookupWord, glossaryLookup, normaliseWord, wordForms, isSingleWord,
  parseGlossary, serialiseGlossary, validateGlossary, dictionaryLookup,
  morphyCandidates, shardFor, sanitiseKey, shardFileName, clearDictionaryCache,
  HOUSE_SOURCE, DICT_SOURCE, DICT_VERSION, DICT_BASE, GLOSSARY_MAX_DEF,
} from '../../app/lib/dictionary.js';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

const GLOSSARY = {
  harmattan: 'The dry, dust-laden wind that blows south from the Sahara between November and March.',
  ogbanje: 'A child said to die and return to the same mother, again and again.',
  'well-worn': 'Made familiar by long use; of a phrase, worn smooth by repetition.',
  ferryman: 'In this book, the keeper of the crossing — never named, never absent.',
};

/** A fetch that must never be called. */
const forbiddenFetch = () => { throw new Error('the network was reached on a glossary hit'); };

// A small house dictionary, in the published shape: a manifest of prefixes, and shards of
// { headword: { s: [[pos, definition]…], x: { pos: [base…] } } }.
const MINI = {
  'manifest.json': { version: 'test', prefixes: ['c', 'g', 'r', 'w'] },
  [shardFileName('r')]: {
    raven: { s: [['n', 'large black bird with a straight bill'], ['v', 'obtain or seize by violence']] },
    run: { s: [['n', 'a score in baseball'], ['v', 'move fast by using one\'s feet'], ['v', 'flee'], ['v', 'stretch out']] },
    ran: { x: { v: ['run'] } },
  },
  [shardFileName('c')]: { city: { s: [['n', 'a large and densely populated urban area']] } },
  [shardFileName('g')]: { go: { s: [['n', 'a board game for two players'], ['v', 'change location; move']] } },
  [shardFileName('w')]: { went: { x: { v: ['go'] } } },
};

/** A fetch over a dictionary held in memory. Counts what it was asked for. */
function dictFetch(files = MINI, log = []) {
  return async (url) => {
    log.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    if (!(name in files)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(files[name])) };
  };
}

/** A fetch over the REAL built dictionary in public/, as the site serves it. */
function builtFetch(log = []) {
  return async (url) => {
    log.push(url);
    const path = `${PUBLIC}${url}`;
    if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) };
  };
}

test.beforeEach(() => clearDictionaryCache());

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

test('the glossary BEATS the house dictionary even when the dictionary would have answered', async () => {
  const entry = await lookupWord('raven', {
    glossary: { raven: 'In this book: the bird that carries the second message.' },
    fetchImpl: forbiddenFetch,     // reaching it at all is the failure
  });
  expect(entry.senses[0].definition).toContain('second message');
  expect(entry.source).toBe(HOUSE_SOURCE);
});

// ── the house dictionary ─────────────────────────────────────────────────────
test('a word outside the glossary falls through to the house dictionary and is shaped for the modal', async () => {
  const log = [];
  const entry = await lookupWord('raven', { glossary: GLOSSARY, fetchImpl: dictFetch(MINI, log) });
  expect(entry.source).toBe(DICT_SOURCE);
  expect(entry.house).toBe(false);
  expect(entry.phonetic).toBeNull();
  expect(entry.senses[0]).toEqual({ partOfSpeech: 'noun', definition: 'large black bird with a straight bill' });
  expect(entry.senses[1].partOfSpeech).toBe('verb');
  // The site's own path, and nothing else: the manifest, then the one shard.
  expect(log).toEqual([`${DICT_BASE}/manifest.json`, `${DICT_BASE}/${shardFileName('r')}`]);
  expect(log.every((u) => u.startsWith('/dict/en/'))).toBe(true);
});

test('the ORDER: glossary, then the house dictionary, then the calm miss', async () => {
  // 1. A glossary word never reaches the dictionary, even when the dictionary holds it.
  const g = await lookupWord('raven', { glossary: { raven: 'In this book: the messenger.' }, fetchImpl: forbiddenFetch });
  expect(g.source).toBe(HOUSE_SOURCE);
  // 2. A word only the dictionary holds.
  const d = await lookupWord('city', { glossary: GLOSSARY, fetchImpl: dictFetch() });
  expect(d.source).toBe(DICT_SOURCE);
  // 3. A word neither holds: null, which the register renders as the calm miss.
  expect(await lookupWord('corvid', { glossary: GLOSSARY, fetchImpl: dictFetch() })).toBeNull();
  // …including one whose shard does not exist at all.
  expect(await lookupWord('zzyzx', { glossary: GLOSSARY, fetchImpl: dictFetch() })).toBeNull();
});

test('AT MOST THREE senses, in the source\'s order', async () => {
  const entry = await lookupWord('run', { fetchImpl: dictFetch() });
  expect(entry.senses.map((s) => s.definition)).toEqual(['a score in baseball', 'move fast by using one\'s feet', 'flee']);
});

test('the literal form is tried FIRST, and morphy only when it is not a headword', async () => {
  const lit = await lookupWord('run', { fetchImpl: dictFetch() });
  expect(lit.word).toBe('run');
  const ran = await lookupWord('ran', { fetchImpl: dictFetch() });
  expect(ran.word).toBe('run');
  expect(ran.form).toBe('ran');
  // Through the verb exception, so ONLY the verb's senses — never "a score in baseball".
  expect(ran.senses.every((s) => s.partOfSpeech === 'verb')).toBe(true);
});

test('an exception can send the lookup to another shard, and keeps to its part of speech', async () => {
  const log = [];
  const went = await lookupWord('went', { fetchImpl: dictFetch(MINI, log) });
  expect(went.word).toBe('go');
  // "went" is the verb go — the board game must not appear.
  expect(went.senses.map((s) => s.definition)).toEqual(['change location; move']);
  expect(log).toContain(`${DICT_BASE}/${shardFileName('g')}`);
});

test('a rule candidate is accepted only when the dictionary holds it in that part of speech', async () => {
  const cities = await lookupWord('cities', { fetchImpl: dictFetch() });
  expect(cities.word).toBe('city');
  // "ravens" → raven by the noun rule; "ravened" → raven by the verb rule, verb senses only.
  const ravened = await lookupWord('ravened', { fetchImpl: dictFetch() });
  expect(ravened.senses.map((s) => s.partOfSpeech)).toEqual(['verb']);
});

test('each shard is read ONCE a session', async () => {
  const log = [];
  const f = dictFetch(MINI, log);
  await lookupWord('raven', { fetchImpl: f });
  await lookupWord('run', { fetchImpl: f });
  await lookupWord('ravens', { fetchImpl: f });
  expect(log.filter((u) => u.endsWith(shardFileName('r')))).toHaveLength(1);
  expect(log.filter((u) => u.endsWith('manifest.json'))).toHaveLength(1);
});

test('a FAILED read is not kept: offline once is not offline for the session', async () => {
  let online = false;
  const good = dictFetch();
  const f = async (url) => { if (!online) throw new Error('net::ERR_INTERNET_DISCONNECTED'); return good(url); };
  expect(await lookupWord('raven', { fetchImpl: f })).toBeNull();
  online = true;
  expect((await lookupWord('raven', { fetchImpl: f }))?.source).toBe(DICT_SOURCE);
});

test('a 5xx or a malformed body is a miss rather than a throw', async () => {
  expect(await lookupWord('raven', { fetchImpl: async () => ({ ok: false, status: 522, json: async () => ({}) }) })).toBeNull();
  clearDictionaryCache();
  expect(await lookupWord('raven', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) })).toBeNull();
  clearDictionaryCache();
  expect(await lookupWord('raven', { fetchImpl: dictFetch({ 'manifest.json': { nope: true } }) })).toBeNull();
});

test('a network failure is a miss rather than a throw', async () => {
  const entry = await lookupWord('raven', {
    fetchImpl: async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); },
  });
  expect(entry).toBeNull();
});

test('a shard that never arrives is a miss at the timeout, and the wait is bounded', async () => {
  // The contract's 4 s, exercised at 120 ms so CI does not spend four seconds proving it. The
  // stub never settles, which is why the pipeline races a clock.
  const started = Date.now();
  const entry = await lookupWord('raven', {
    fetchImpl: () => new Promise(() => {}),      // never settles
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

// ── morphy, as morph.c has it ────────────────────────────────────────────────
test('morphy\'s detachment rules, in morph.c\'s order', () => {
  const bases = (w, pos) => morphyCandidates(w, pos).map((c) => c.base);
  expect(bases('cities', 'n')).toEqual(['citie', 'city']);
  expect(bases('boxes', 'n')).toEqual(['boxe', 'box']);
  expect(bases('churches', 'n')).toEqual(['churche', 'church']);
  expect(bases('firemen', 'n')).toEqual(['fireman']);
  expect(bases('hoped', 'v')).toEqual(['hope', 'hop']);
  expect(bases('making', 'v')).toEqual(['make', 'mak']);
  expect(bases('tries', 'v')).toEqual(['trie', 'try', 'tri']);
  expect(bases('larger', 'a')).toEqual(['larg', 'large']);
  expect(bases('slowly', 'r')).toEqual([]);                // adverbs: the exception list only
});

test('morph.c\'s noun guards: -ss and short words are not detached; -ful keeps its ful', () => {
  expect(morphyCandidates('glass', 'n')).toEqual([]);
  expect(morphyCandidates('is', 'n')).toEqual([]);
  expect(morphyCandidates('boxesful', 'n')).toEqual([{ base: 'boxe', then: 'ful' }, { base: 'box', then: 'ful' }]);
  // The verb has no such guard: "passes" can be the verb pass.
  expect(morphyCandidates('passes', 'v').map((c) => c.base)).toContain('pass');
});

test('shards: the key and the longest listed prefix', () => {
  expect(sanitiseKey("O'clock")).toBe('o_clock');
  expect(sanitiseKey('éclair')).toBe('_clair');
  expect(shardFor('unhappy', ['u', 'un', 'unh'])).toBe('unh');
  expect(shardFor('under', ['u', 'un', 'unh'])).toBe('un');
  expect(shardFor('u', ['u', 'un'])).toBe('u');
  expect(shardFor('zebra', ['u', 'un'])).toBeNull();
  expect(shardFileName('con')).toBe('p_con.json');           // never a bare reserved name
});

// ── the BUILT dictionary: the golden cases the brief names, against the real shards ─────
test.describe('the built dictionary', () => {
  test.skip(!existsSync(`${PUBLIC}${DICT_BASE}/manifest.json`), `public${DICT_BASE} is not built`);

  for (const [tapped, headword, pos] of [
    ['ran', 'run', 'verb'], ['cities', 'city', 'noun'], ['mice', 'mouse', 'noun'], ['went', 'go', 'verb'],
    ['serendipity', 'serendipity', 'noun'], ['Leaves,', 'leaf', 'noun'], ['happier', 'happy', 'adjective'],
    ["o'clock", "o'clock", 'adverb'], ['well-worn', 'well-worn', 'adjective'],
  ]) {
    test(`"${tapped}" finds ${headword}`, async () => {
      const e = await lookupWord(tapped, { fetchImpl: builtFetch() });
      expect(e?.word).toBe(headword);
      expect(e.senses[0].partOfSpeech).toBe(pos);
      expect(e.senses.length).toBeGreaterThan(0);
      expect(e.senses.length).toBeLessThanOrEqual(3);
      expect(e.source).toBe(DICT_SOURCE);
    });
  }

  test('"went" is only ever the verb', async () => {
    const e = await lookupWord('went', { fetchImpl: builtFetch() });
    expect(e.senses.every((s) => s.partOfSpeech === 'verb')).toBe(true);
  });

  test('"leaves" shows both readings morphy found before either gets a second sense', async () => {
    const e = await lookupWord('leaves', { fetchImpl: builtFetch() });
    expect(e.senses.map((s) => s.partOfSpeech)).toEqual(['noun', 'noun', 'verb']);
  });

  test('"raven" is never read as "rave"', async () => {
    const e = await lookupWord('raven', { fetchImpl: builtFetch() });
    expect(e.word).toBe('raven');
    expect(e.senses[0].definition).toMatch(/bird/);
  });

  test('a word the dictionary lacks is a miss', async () => {
    expect(await lookupWord('zzqxv', { fetchImpl: builtFetch() })).toBeNull();
  });

  test('the folder is the version the bundle asks for, and carries its licence', () => {
    const m = JSON.parse(readFileSync(`${PUBLIC}${DICT_BASE}/manifest.json`, 'utf8'));
    expect(m.version).toBe(DICT_VERSION);
    expect(readFileSync(`${PUBLIC}${DICT_BASE}/LICENSE`, 'utf8')).toMatch(/Creative Commons Attribution 4\.0/);
  });

  test('dictionaryLookup and lookupWord agree', async () => {
    const f = builtFetch();
    expect(await dictionaryLookup('cities', { fetchImpl: f })).toEqual(await lookupWord('cities', { fetchImpl: f }));
  });
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
