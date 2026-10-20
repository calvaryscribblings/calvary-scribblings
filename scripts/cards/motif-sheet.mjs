// THE MOTIF SHEET — gate 1 of CARDS-R1.
//
//   node scripts/cards/motif-sheet.mjs        # writes cards/review/MOTIF-SHEET.md + cards/data/deck.json
//
// Reads cards/data/motif-draft.json, which holds one drafted motif (or 'none') for every eligible
// story and every published Series instalment, each with a quote checked verbatim against the
// story's own text. This file holds the PROPOSAL: which of those become the deck, and under which
// motif. It writes nothing anywhere but the two files above.
//
// ── THE RULE THE PROPOSAL KEEPS ──────────────────────────────────────────────────────────
// A card takes the story's PRIMARY motif where it can. Where a motif is short, a card may take
// an ALTERNATE, but only one the reader marked strong or fair, never a weak one. Every alternate
// is labelled as one on the sheet. Where the library has no honest card, the slot stays EMPTY
// and is counted as a shortfall. It is never filled by stretching a motif.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIFS } from './geometry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const draft = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/motif-draft.json'), 'utf8'));
const bySlug = new Map([...draft.stories, ...draft.series].map((r) => [r.slug, r]));

// The ruled shape: six motifs at 7, two at 6. Storm and Fire take the 6s because they are the
// two the library is shortest of; they still cannot reach them.
export const TARGET = Object.freeze({ Letter: 7, Secret: 7, Child: 7, Storm: 6, Road: 7, House: 7, Debt: 7, Fire: 6 });
export const LIVERY_TARGET = Object.freeze({ short: 30, flash: 7, poetry: 7, inspiring: 6, series: 4 });

// The proposal, motif by motif. Order within a motif: the scarce liveries first, then strength.
export const DECK = Object.freeze({
  Letter: ['purple-rain', '7am-an-american-pulp-classic', 'beta-princess-i2', 'skin-eater', 'a-legacy-through-time', 'love-it-enough', 'a-daub-of-blue'],
  Secret: ['how-are-you-my-friend', 'full', 'brenda', 'the-songbird-s-birdsong', 'lagos-friendship', 'did-you-enjoy-it', 'ladies-diaries'],
  Child: ['mother-and-other-poems', 'dont-worry', 'you-will-love-it', 'boomerang', 'beyond-saving', 'sixth-cycle', 'the-call'],
  Storm: ['diary-of-a-lagos-9-5er-i1'],
  Road: ['miss-lady', 'beautifully-blue', 'arrival-again', 'odeluwa', 'final-boarding-call', 'zee-a-love-letters-story', 'seat-14b'],
  House: ['the-doherty-confessions-i2', 'the-girl-who-sang-through-the-dark', 'room-14', 'small-permissions', 'threshold', 'from-scratch', 'terms-and-conditions'],
  Debt: ['the-enabler', 'unstoppabbl', 'safety-net', 'till-debt-do-us-part', 'manage-it', 'sapiosexual', 'notes'],
  Fire: ['pigment', 'one-day-for-the-thief', 'beta-princess-i3'],
});

export const ALTERNATES = Object.freeze({
  Letter: ['my-daddy-is-a-superhero', 'diary-of-a-lagos-9-5er-i4'],
  Secret: ['you-didnt-ask', 'the-man-i-met-at-nineteen'],
  Child: ['mango-season', '1967'],
  Storm: [],
  Road: ['puppy-love', 'hold-your-breath-and-count-to-ten'],
  House: ['till-debt-do-us-part', 'diary-of-a-lagos-9-5er-i3'],
  Debt: ['diary-of-a-lagos-9-5er-i2', 'boomerang'],
  Fire: [],
});

const LIVERY_NAME = { short: 'Short Story', flash: 'Flash Fiction', poetry: 'Poetry', inspiring: 'Inspiring', series: 'Series' };
const LIVERIES = Object.keys(LIVERY_NAME);

/** The card a story makes under `motif`: its own quote if primary, the alternate's if not. */
export function cardFor(slug, motif) {
  const r = bySlug.get(slug);
  if (!r) throw new Error(`no draft for ${slug}`);
  if (r.primary === motif) return { ...r, motif, quote: r.quote, reading: 'primary', fit: r.strength };
  const alt = r.alternates.find((a) => a.motif === motif);
  if (!alt) throw new Error(`${slug} does not honestly carry ${motif} (primary ${r.primary}, no such alternate)`);
  if (!['strong', 'fair'].includes(alt.strength)) throw new Error(`${slug}: ${motif} is only ${alt.strength}`);
  return { ...r, motif, quote: alt.quote, reading: 'alternate', fit: alt.strength };
}

export function buildDeck() {
  const cards = [];
  const seen = new Set();
  for (const motif of MOTIFS) {
    for (const slug of DECK[motif]) {
      if (seen.has(slug)) throw new Error(`${slug} is in the deck twice`);
      seen.add(slug);
      cards.push(cardFor(slug, motif));
    }
  }
  return cards;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const name = (r) => (r.kind === 'series' ? `${r.seriesTitle} — ${r.instalmentTitle}` : r.title);

function sheet(cards) {
  const L = [];
  const count = (pred) => cards.filter(pred).length;
  const total = Object.values(TARGET).reduce((a, b) => a + b, 0);
  const short = total - cards.length;
  L.push('# Story Island — motif sheet (CARDS-R1, gate 1)');
  L.push('');
  L.push('**DRAFT for Ikenna.** It is ratified when Ikenna renames this file to `RATIFIED.md`, or gives a quoted authorisation that is recorded at the rename. It is never renamed on anyone else\'s judgement.');
  L.push('');
  L.push(`Generated by \`scripts/cards/motif-sheet.mjs\` from \`cards/data/motif-draft.json\`. Every quote below is checked character for character against the story's own text in \`story_bodies\` (Series: the instalment's EPUB). The checks were read-only.`);
  L.push('');
  L.push('## The short answer');
  L.push('');
  L.push(`**The library cannot honestly fill 54.** It fills **${cards.length}**, and the other **${short}** slots are left empty. The ruled shape is six motifs at 7 and two at 6. Six motifs reach 7; Storm and Fire, set as the two 6s, cannot reach them:`);
  L.push('');
  for (const m of MOTIFS) {
    const have = count((c) => c.motif === m);
    if (have < TARGET[m]) L.push(`- **${m}: ${have} of ${TARGET[m]}** — short by ${TARGET[m] - have}. ${m === 'Storm' ? 'No eligible story turns on weather. The one honest Storm is a Series instalment (Diary of a Lagos 9-5er, Chapter I: the flooded commute), where it is the reader\'s strong alternate.' : 'Two eligible stories turn on real fire. The third is a Series instalment, as a fair alternate. Every other "fire" in the library is a metaphor (*Widow\'s Fire*, for one) or a passing detail.'}`);
  }
  L.push('');
  L.push(`House reaches 7, but only on alternate readings: no story has House as its PRIMARY motif. Each House card is labelled.`);
  L.push('');
  L.push('**This is a question for Ikenna, not something to fix by stretching.** Either the deck is 46 cards, or Storm and Fire give way to two motifs the library does carry. The Endings are named by ring neighbours, so replacing a motif renames two Endings.');
  L.push('');
  L.push('## Livery mix');
  L.push('');
  L.push('| Livery | Provisional target | In the deck | Eligible in library | Eligible with any motif |');
  L.push('|---|---:|---:|---:|---:|');
  for (const l of LIVERIES) {
    const pool = l === 'series' ? draft.series : draft.stories.filter((s) => s.livery === l);
    const withMotif = pool.filter((s) => s.primary !== 'none' || s.alternates.length).length;
    L.push(`| ${LIVERY_NAME[l]} | ${l === 'series' ? 'up to 4' : `about ${LIVERY_TARGET[l]}`} | ${count((c) => c.livery === l)} | ${pool.length} | ${withMotif} |`);
  }
  L.push('');
  L.push('**Poetry and Inspiring cannot reach their targets.** Of 17 poems, one carries a motif honestly (*Mother and Other Poems*, Child). Of 13 Inspiring pieces, three do. Most of these pieces are reflection or address, not story, and nothing in them turns on an object or an event. The space goes to Short Story and Flash Fiction instead. Flash is over its target because it carries Road and Debt where the poems cannot.');
  L.push('');
  L.push('**Calvary bylines:** three eligible pieces. *Miss Lady* is in, as Road. *Early* and *50 Lines of War* turn on none of the eight motifs. Three of the six eligible *Ikenna Okpara* bylines are in too: *Purple Rain* (Letter), *Mother and Other Poems* (Child) and *Zee: A Love Letters Story* (Road). *1967* is an alternate for Child.');
  L.push('');
  L.push(`## The ${cards.length} (+ ${short} empty)`);
  L.push('');
  L.push('| # | Title | Author | Livery | Motif | Reading | Quote |');
  L.push('|---:|---|---|---|---|---|---|');
  let n = 0;
  for (const m of MOTIFS) {
    for (const c of cards.filter((x) => x.motif === m)) {
      n += 1;
      L.push(`| ${n} | ${cell(name(c))} | ${cell(c.author)} | ${LIVERY_NAME[c.livery]} | ${m} | ${c.reading}, ${c.fit} | “${cell(c.quote)}” |`);
    }
    for (let i = count((x) => x.motif === m); i < TARGET[m]; i++) L.push(`| — | *empty — no honest ${m} card* | | | ${m} | | |`);
  }
  L.push('');
  L.push('## Livery × motif');
  L.push('');
  L.push(`| | ${MOTIFS.join(' | ')} | Total |`);
  L.push(`|---|${MOTIFS.map(() => '---:').join('|')}|---:|`);
  for (const l of LIVERIES) L.push(`| ${LIVERY_NAME[l]} | ${MOTIFS.map((m) => count((c) => c.livery === l && c.motif === m) || '·').join(' | ')} | ${count((c) => c.livery === l)} |`);
  L.push(`| **Total** | ${MOTIFS.map((m) => `**${count((c) => c.motif === m)}**`).join(' | ')} | **${cards.length}** |`);
  L.push(`| Target | ${MOTIFS.map((m) => TARGET[m]).join(' | ')} | ${total} |`);
  L.push('');
  L.push('**Spread:** Short Story carries seven of the eight motifs, and Flash Fiction five. Inspiring carries three (Letter, Road, House), and Series four (Letter, Storm, House, Fire). Poetry carries only Child, because no other poem carries a motif at all.');
  L.push('');
  L.push('## Alternates (up to two per motif)');
  L.push('');
  L.push('| Motif | Title | Author | Livery | Reading | Quote |');
  L.push('|---|---|---|---|---|---|');
  for (const m of MOTIFS) {
    if (!ALTERNATES[m].length) { L.push(`| ${m} | *none — the library has no further honest ${m} story* | | | | |`); continue; }
    for (const slug of ALTERNATES[m]) {
      const c = cardFor(slug, m);
      L.push(`| ${m} | ${cell(name(c))} | ${cell(c.author)} | ${LIVERY_NAME[c.livery]} | ${c.reading}, ${c.fit} | “${cell(c.quote)}” |`);
    }
  }
  L.push('');
  L.push('Two alternates are already in the deck under another motif: *Till Debt Do Us Part* (Debt in the deck, a House alternate here) and *Boomerang* (Child in the deck, a Debt alternate here). Each could move if Ikenna prefers.');
  L.push('');
  L.push('## Appendix — the draft for every eligible story');
  L.push('');
  const none = draft.stories.filter((s) => s.primary === 'none').length;
  L.push(`${draft.stories.length} eligible stories: published \`cms_stories\`, not hidden, not retired, not scheduled for later, excluding News & Updates. None is \`ageRestricted\`. Plus ${draft.series.length} published Series instalments. **${none} of the ${draft.stories.length} stories turn on none of the eight motifs.** That is the honest answer for them, not a gap in the reading.`);
  L.push('');
  L.push('| Title | Livery | Primary | Fit | Quote | Also fits |');
  L.push('|---|---|---|---|---|---|');
  for (const r of [...draft.stories.sort((a, b) => a.livery.localeCompare(b.livery) || a.title.localeCompare(b.title)), ...draft.series]) {
    L.push(`| ${cell(name(r))} | ${LIVERY_NAME[r.livery]} | ${r.primary} | ${r.strength ?? ''} | ${r.quote ? `“${cell(r.quote)}”` : ''} | ${r.alternates.map((a) => `${a.motif} (${a.strength})`).join(', ')} |`);
  }
  L.push('');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cards = buildDeck();
  mkdirSync(resolve(ROOT, 'cards/review'), { recursive: true });
  writeFileSync(resolve(ROOT, 'cards/review/MOTIF-SHEET.md'), sheet(cards));
  const slim = cards.map(({ kind, slug, title, author, livery, subcategory, descriptor, url, motif, reading, fit, quote, seriesId, seriesTitle, instalmentTitle, ordinal, posterUrl }) =>
    ({ kind, slug, title, author, livery, subcategory, descriptor, url, motif, reading, fit, quote, seriesId, seriesTitle, instalmentTitle, ordinal, posterUrl }));
  writeFileSync(resolve(ROOT, 'cards/data/deck.json'), `${JSON.stringify(slim, null, 1)}\n`);
  console.log(`${cards.length} cards; shortfall ${Object.values(TARGET).reduce((a, b) => a + b, 0) - cards.length}`);
}
