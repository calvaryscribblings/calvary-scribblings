// THE MOTIF SHEET — gate 1 of Shorelines (CARDS-R1.2).
//
//   node scripts/cards/motif-sheet.mjs        # writes cards/review/MOTIF-SHEET.md + cards/data/deck.json
//
// Reads cards/data/motif-draft.json, which holds one drafted motif (or 'none') for every eligible
// story, every published Series instalment, and every published SERIES as a whole, each with a
// quote checked verbatim against the text. This file holds the PROPOSAL: which of those become
// the deck, and under which motif. It writes nothing anywhere but the two files above.
//
// ── THE RULE THE PROPOSAL KEEPS ──────────────────────────────────────────────────────────
// A card takes the story's PRIMARY motif where it can. Where a motif is short, a card may take
// an ALTERNATE, but only one the reader marked strong or fair, never a weak one. Every alternate
// is labelled as one on the sheet. Where the library has no honest card, the slot stays EMPTY
// and is counted as a shortfall. It is never filled by stretching a motif.
//
// ── R1.1 RULINGS ─────────────────────────────────────────────────────────────────────────
// Picture cards are one per published series, carrying the motif the series turns on.
// Storm → Water and Fire → Grave. The livery-mix targets are dropped, but every livery should
// still carry a spread of motifs. Ikenna's own bylines (Calvary, Ikenna Okpara) go in wherever
// the balance allows.
//
// ── R1.2 RULING ──────────────────────────────────────────────────────────────────────────
// Water is replaced by Captive (a kidnapping, an arrest, a prison or a locked room that holds
// someone against their will, and the story turns on it). Every Ending keeps its name. If the
// library can't fill Captive honestly, the deck runs short.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTIFS } from './geometry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const draft = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/motif-draft.json'), 'utf8'));
const bySlug = new Map([...draft.stories, ...draft.pictures].map((r) => [r.slug, r]));
const IKENNA = /^(Calvary|Ikenna Okpara)$/;

// The ruled shape: six motifs at 7, two at 6. Captive takes Water's 6 (it is the motif the
// library is shortest of), and House keeps its 6 (it is carried only by alternate readings).
export const TARGET = Object.freeze({ Letter: 7, Secret: 7, Child: 7, Captive: 6, Road: 7, House: 6, Debt: 7, Grave: 7 });

// The picture cards, one per published series: each takes the motif its series turns on.
export const PICTURES = Object.freeze(draft.pictures.filter((p) => p.status === 'published').map((p) => p.slug));

// The story cards, motif by motif. Within each motif, the scarce liveries come first, then
// Ikenna's bylines, then strength.
export const DECK = Object.freeze({
  Letter: ['purple-rain', '7am-an-american-pulp-classic', 'skin-eater', 'a-legacy-through-time', 'love-it-enough', 'a-daub-of-blue', 'my-daddy-is-a-superhero'],
  Secret: ['how-are-you-my-friend', 'full', 'brenda', 'lagos-friendship', 'the-songbird-s-birdsong'],
  Child: ['mother-and-other-poems', 'dont-worry', 'you-will-love-it', 'boomerang', 'beyond-saving', 'sixth-cycle', 'chernobyl'],
  Captive: ['free-will', 'the-number-thirteen', 'the-man-i-met-at-nineteen', 'anomaly', 'the-call'],
  Road: ['miss-lady', 'arrival-again', 'odeluwa', 'zee-a-love-letters-story', 'final-boarding-call', 'seat-14b', 'puppy-love'],
  House: ['the-girl-who-sang-through-the-dark', 'from-scratch', 'terms-and-conditions', 'mango-season', 'small-permissions', 'room-14'],
  Debt: ['the-enabler', 'unstoppabbl', 'safety-net', 'till-debt-do-us-part', 'manage-it', 'sapiosexual'],
  Grave: ['the-deadline', 'the-most-dangerous-job-in-nigeria', 'beautifully-blue', 'drip-drip-drip', '1967', 'i-told-you', 'peer-pressure-from-the-dead'],
});

export const ALTERNATES = Object.freeze({
  Letter: ['you-didnt-ask', 'chaff'],
  Secret: ['did-you-enjoy-it', 'ladies-diaries'],
  Child: ['things-i-m-owed', 'your-money-cannot-save-you'],
  Captive: [],
  Road: ['hold-your-breath-and-count-to-ten', 'notes'],
  House: ['threshold', 'pigment'],
  Debt: ['notes'],
  Grave: ['what-the-light-remembers', 'the-pill'],
});

/**
 * Stories a reader looked at for Captive and declined, because nobody is held or the story does
 * not turn on it. Shown on the sheet, so the shortfall can be checked rather than taken on trust.
 */
export const DECLINED = Object.freeze([
  { slug: 'witness-me', reason: 'the arrest of HorseShoe and Yam Leg is the closing beat; the story turns on witnessing the murder' },
  { slug: 'maid-of-honour', reason: 'Kodi is handcuffed only after the shooting, and the story does not turn on the arrest' },
  { slug: 'proof-of-life', reason: 'the police escort Jemima to their car only in the closing lines' },
  { slug: '1967', reason: 'the villagers are herded to the square to be shot that afternoon: a round-up for an execution, not a holding' },
  { slug: 'hold-your-breath-and-count-to-ten', reason: 'the arrest and the binding vines are passing moments; it turns on the judgement at the bridge' },
  { slug: 'brenda', reason: 'the abduction is staged, and the narrator is Brenda herself' },
  { slug: 'how-are-you-my-friend', reason: 'Halimat disappears and is found dead; she is never shown held' },
]);

const LIVERY_NAME = { short: 'Short Story', flash: 'Flash Fiction', poetry: 'Poetry', inspiring: 'Inspiring', series: 'Series' };
const LIVERIES = Object.keys(LIVERY_NAME);

/** The card a record makes under `motif`: its own quote if primary, the alternate's if not. */
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
  const take = (slug, motif) => {
    if (seen.has(slug)) throw new Error(`${slug} is in the deck twice`);
    seen.add(slug);
    cards.push(cardFor(slug, motif));
  };
  for (const slug of PICTURES) take(slug, bySlug.get(slug).primary);
  for (const motif of MOTIFS) for (const slug of DECK[motif]) take(slug, motif);
  return cards;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const name = (r) => (r.kind === 'picture' ? `${r.title} (picture card)` : r.kind === 'instalment' ? `${r.seriesTitle} — ${r.instalmentTitle}` : r.title);

function sheet(cards) {
  const L = [];
  const count = (pred) => cards.filter(pred).length;
  const total = Object.values(TARGET).reduce((a, b) => a + b, 0);
  const short = total - cards.length;
  const byMotif = (m) => count((c) => c.motif === m);
  L.push('# Shorelines — motif sheet (CARDS-R1.2, gate 1)');
  L.push('');
  L.push('**DRAFT for Ikenna.** It is ratified when Ikenna renames this file to `RATIFIED.md`, or gives a quoted authorisation that is recorded at the rename. It is never renamed on anyone else\'s judgement.');
  L.push('');
  L.push(`Generated by \`scripts/cards/motif-sheet.mjs\` from \`cards/data/motif-draft.json\`. For R1.2 every eligible story and Series instalment was re-read in full for Captive, and each series judged as a whole. Every quote below is checked character for character against the text: \`story_bodies\` for stories, the instalment EPUBs for Series. All reads were read-only, and the database is unchanged since R1.1.`);
  L.push('');
  L.push('**Captive:** a kidnapping, an arrest, a prison or a locked room that holds someone against their will, and the story turns on it, not a passing word. Feeling "trapped" in a job, a marriage or a life is a metaphor and does not count. **Grave:** a death, a funeral or a burial the story turns on. The other six motifs are as R1 defined them. Ring order, clockwise from the top: Letter, Secret, Child, Captive, Road, House, Debt, Grave. Child–Captive is THE RESCUE and Captive–Road is THE ESCAPE.');
  L.push('');
  L.push('## The short answer');
  L.push('');
  L.push(`**The library honestly fills ${cards.length} of 54**: ${PICTURES.length} picture cards and ${cards.length - PICTURES.length} story cards. **${short === 1 ? 'One slot is left empty, and it is Captive.' : `${short} slots are left empty, all of them Captive.`}**`);
  L.push('');
  const cap = cards.filter((c) => c.motif === 'Captive');
  L.push(`- **Captive: ${byMotif('Captive')} of ${TARGET.Captive}.** ${cap.filter((c) => c.reading === 'primary').length} stories turn on it as their main motif, and ${cap.filter((c) => c.reading === 'alternate').length} carry it honestly as a fair alternate:`);
  for (const c of cap) L.push(`  - *${c.title}* (${c.reading}, ${c.fit}): ${bySlug.get(c.slug).primary === 'Captive' ? bySlug.get(c.slug).why : { 'the-man-i-met-at-nineteen': 'the narrator is arrested and tells the story from prison; the arrest is the payoff of the secret, so Secret stays its main motif.', anomaly: 'Chike holds Nonso tied up on the kitchen floor for the reckoning; the story still turns on the abused child, so Child stays its main motif.', 'the-call': 'the whole story runs on a ransom demand for the daughter Edet abandoned. **Flag:** the kidnapping turns out to be a hoax staged by her cousins, which is why it is only fair. Child stays its main motif.' }[c.slug]}`);
  L.push(`  - **All ${cap.length} are Short Stories**, and ${cap.filter((c) => c.author === 'Dera Okaro').length} of the ${cap.length} are by Dera Okaro. That is what the library holds; it is not a choice.`);
  L.push(`  - **Considered and declined** (no one is held, or the story does not turn on it): ${DECLINED.map((d) => `*${bySlug.get(d.slug).title}*: ${d.reason}`).join('; ')}. Every \"trapped\", \"cage\" and \"prison\" used as a figure of speech was declined too.`);
  L.push('  - **The series:** Beta Princess (Part One, strong: Sibry and her servants are chained and marched to Silverclaw) and The Doherty Confessions (Instalment I, fair: the police come to arrest Victoria, and she jumps before they can) both carry Captive as an alternate. Their picture cards keep the motif each series turns on most (Secret), as ruled in R1.1.');
  L.push(`- **No story already in R1.1's deck moved to Captive**, so no motif lost a card and nothing had to be back-filled. The two R1.1 Water cards (*Widow\'s Fire*, *Almost Like Her*) leave the deck: neither carries Captive, and every other motif is already full.`);
  L.push(`- **Grave is still the opposite case.** ${draft.stories.filter((s) => s.primary === 'Grave').length} stories have it as their main motif, so the deck takes 7 and leaves plenty out.`);
  L.push(`- **House** reaches ${byMotif('House')}, but only on alternate readings. No story has House as its main motif, and each House card is labelled.`);
  L.push('');
  L.push(`**For Ikenna:** the ruling says the deck runs at 50 if the library can't fill Captive honestly. It fills ${byMotif('Captive')} of ${TARGET.Captive}, so the honest deck is **${cards.length}**, one short. Whether that is ${cards.length} cards, or 50 with three cards taken out, is Ikenna\'s call. Nothing has been stretched to reach 54.`);
  L.push('');
  L.push('## Picture cards: one per published series');
  L.push('');
  L.push('| Series | Author | Instalments read | Motif | Quote (from) |');
  L.push('|---|---|---:|---|---|');
  for (const c of cards.filter((x) => x.kind === 'picture')) {
    L.push(`| ${cell(c.title)} | ${cell(c.author)} | ${c.instalments.length} | **${c.motif}** (${c.fit}) | “${cell(c.quote)}” (${cell(c.quoteFromTitle)}) |`);
  }
  L.push('');
  L.push('Each motif is the one its series turns on, read across all of its published instalments. **The Doherty Confessions** is Secret: the confession is the engine. Grave is a close second, since Instalment I ends on Victoria\'s death; it is listed as the series\' strong alternate.');
  L.push('');
  L.push(`## The ${cards.length} (+ ${short} empty)`);
  L.push('');
  L.push('| # | Title | Author | Livery | Motif | Reading | Quote |');
  L.push('|---:|---|---|---|---|---|---|');
  let n = 0;
  for (const m of MOTIFS) {
    for (const c of cards.filter((x) => x.motif === m)) {
      n += 1;
      L.push(`| ${n} | ${cell(name(c))}${IKENNA.test(c.author) ? ' ✱' : ''} | ${cell(c.author)} | ${LIVERY_NAME[c.livery]} | ${m} | ${c.reading}, ${c.fit} | “${cell(c.quote)}” |`);
    }
    for (let i = byMotif(m); i < TARGET[m]; i++) L.push(`| — | *empty — no honest ${m} card* | | | ${m} | | |`);
  }
  L.push('');
  L.push('✱ Ikenna\'s own byline (Calvary or Ikenna Okpara).');
  L.push('');
  L.push('## Livery × motif');
  L.push('');
  L.push(`| | ${MOTIFS.join(' | ')} | Total |`);
  L.push(`|---|${MOTIFS.map(() => '---:').join('|')}|---:|`);
  for (const l of LIVERIES) L.push(`| ${LIVERY_NAME[l]} | ${MOTIFS.map((m) => count((c) => c.livery === l && c.motif === m) || '·').join(' | ')} | ${count((c) => c.livery === l)} |`);
  L.push(`| **Total** | ${MOTIFS.map((m) => `**${byMotif(m)}**`).join(' | ')} | **${cards.length}** |`);
  L.push(`| Target | ${MOTIFS.map((m) => TARGET[m]).join(' | ')} | ${total} |`);
  L.push('');
  const spread = (l) => MOTIFS.filter((m) => count((c) => c.livery === l && c.motif === m));
  L.push(`**Spread:** ${LIVERIES.map((l) => `${LIVERY_NAME[l]} carries ${spread(l).length} (${spread(l).join(', ')})`).join('; ')}. The livery-mix targets are dropped by ruling. Poetry carries two motifs because only two poems carry any motif at all: *Mother and Other Poems* (Child) and *The Deadline* (Grave). The third, *What the Light Remembers* (Grave), is an alternate.`);
  L.push('');
  const ik = draft.stories.filter((s) => IKENNA.test(s.author));
  const inDeck = ik.filter((s) => cards.some((c) => c.slug === s.slug));
  L.push(`**Ikenna's bylines:** ${inDeck.length} of ${ik.length} eligible are in: ${inDeck.map((s) => `*${s.title}* (${cards.find((c) => c.slug === s.slug).motif})`).join(', ')}. ${ik.filter((s) => !inDeck.includes(s)).map((s) => `*${s.title}*`).join(', ')} turn on none of the eight motifs.`);
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
  L.push('*Notes* is the only further honest Debt story. *Boomerang* also reads as Debt, but it is in the deck as Child.');
  L.push('');
  L.push('## What changed from R1.1');
  L.push('');
  const r11 = new Set(['purple-rain', '7am-an-american-pulp-classic', 'skin-eater', 'a-legacy-through-time', 'love-it-enough', 'a-daub-of-blue', 'my-daddy-is-a-superhero', 'how-are-you-my-friend', 'full', 'brenda', 'lagos-friendship', 'the-songbird-s-birdsong', 'mother-and-other-poems', 'dont-worry', 'you-will-love-it', 'boomerang', 'beyond-saving', 'sixth-cycle', 'chernobyl', 'widow-s-fire', 'almost-like-her', 'miss-lady', 'arrival-again', 'odeluwa', 'zee-a-love-letters-story', 'final-boarding-call', 'seat-14b', 'puppy-love', 'the-girl-who-sang-through-the-dark', 'from-scratch', 'terms-and-conditions', 'mango-season', 'small-permissions', 'room-14', 'the-enabler', 'unstoppabbl', 'safety-net', 'till-debt-do-us-part', 'manage-it', 'sapiosexual', 'the-deadline', 'the-most-dangerous-job-in-nigeria', 'beautifully-blue', 'drip-drip-drip', '1967', 'i-told-you', 'peer-pressure-from-the-dead']);
  const now = new Set(cards.filter((c) => c.kind === 'story').map((c) => c.slug));
  L.push(`- **In, as Captive:** ${[...now].filter((s) => !r11.has(s)).map((s) => `*${bySlug.get(s).title}*`).join(', ')}.`);
  L.push(`- **Out, with Water:** ${[...r11].filter((s) => !now.has(s)).map((s) => `*${bySlug.get(s).title}*`).join(', ')}.`);
  L.push('- **Reclassified on the re-read:** *Free Will* (Secret → Captive) and *The Number Thirteen* (no motif → Captive). Every other primary stands.');
  L.push('- **Alternates:** *The Man I Met at Nineteen* (Secret) and *Anomaly* (Child) are now in the deck as Captive, so the Secret and Child alternates are the next-best: *Ladies\' Diaries* and *Your Money Cannot Save You*. Water\'s alternates are gone with Water.');
  L.push('- **The 45 cards of the other seven motifs are unchanged**, as are the three picture cards.');
  L.push('');
  L.push('## Appendix — the draft for every eligible story and instalment');
  L.push('');
  const none = draft.stories.filter((s) => s.primary === 'none').length;
  L.push(`${draft.stories.length} eligible stories: published \`cms_stories\`, not hidden, not retired, not scheduled for later, excluding News & Updates; none is \`ageRestricted\`. Then ${draft.instalments.length} published Series instalments, read individually; their series-level motifs are in the picture-card table above. **${none} of the ${draft.stories.length} stories turn on none of the eight motifs.**`);
  L.push('');
  L.push('| Title | Livery | Primary | Fit | Quote | Also fits |');
  L.push('|---|---|---|---|---|---|');
  for (const r of [...[...draft.stories].sort((a, b) => a.livery.localeCompare(b.livery) || a.title.localeCompare(b.title)), ...draft.instalments]) {
    L.push(`| ${cell(name(r))} | ${LIVERY_NAME[r.livery]} | ${r.primary} | ${r.strength ?? ''} | ${r.quote ? `“${cell(r.quote)}”` : ''} | ${r.alternates.map((a) => `${a.motif} (${a.strength})`).join(', ')} |`);
  }
  L.push('');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // RATIFIED (CARDS-R1.3, 20 Oct 2026). The sheet is Ikenna's record now, and deck.json is the
  // deck it ratified. A change to the deck needs a new sheet and a new ratification, so this
  // refuses rather than writing a draft beside the ratified one.
  if (existsSync(resolve(ROOT, 'cards/review/RATIFIED.md'))) {
    console.error('REFUSED — cards/review/RATIFIED.md exists. The deck is ratified; a change needs a new sheet and a new ratification.');
    process.exit(2);
  }
  const cards = buildDeck();
  mkdirSync(resolve(ROOT, 'cards/review'), { recursive: true });
  writeFileSync(resolve(ROOT, 'cards/review/MOTIF-SHEET.md'), sheet(cards));
  const slim = cards.map(({ kind, slug, title, author, livery, subcategory, descriptor, url, motif, reading, fit, quote, seriesId, seriesTitle, posterUrl, quoteFrom }) =>
    ({ kind, slug, title, author, livery, subcategory, descriptor, url, motif, reading, fit, quote, seriesId, seriesTitle, posterUrl, quoteFrom }));
  writeFileSync(resolve(ROOT, 'cards/data/deck.json'), `${JSON.stringify(slim, null, 1)}\n`);
  console.log(`${cards.length} cards; shortfall ${Object.values(TARGET).reduce((a, b) => a + b, 0) - cards.length}`);
}
