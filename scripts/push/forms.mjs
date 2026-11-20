// RULED — Ikenna, 25 Sep 2026: the {form} wording below, as drafted.
//
// A story push reads "New {form} by {author} · {trailer quote}". This table is the {form}:
// one phrase per live category/subcategory, lower case because it sits mid-sentence after
// "New" (except a column's name, which keeps its capital: 'Spotlight', ruled 20 Nov 2026), after
// "New". Proposed in the push round (23 Sep 2026) from the live index — 183 visible stories,
// 34 category/subcategory pairs in use — and from the full vocabulary in app/lib/taxonomy.js,
// so a subcategory nobody has filed under yet already has an answer.
//
// Changing a phrase is an editorial act and nothing else: no data moves, no key changes.
// tests/push/push.test.mjs asserts that EVERY pair the taxonomy can produce has an entry here,
// so adding a subcategory to taxonomy.js without deciding its wording fails the suite rather
// than shipping a push that reads "New story" for want of a row.

import { SUBCATEGORIES, CATEGORIES } from '../../app/lib/taxonomy.js';

export const FORMS_STATUS = 'RULED';

/** When a story has no subcategory, or one not listed below. */
export const CATEGORY_FORM = {
  flash: 'flash fiction',
  short: 'short story',
  poetry: 'poem',
  news: 'article',
  inspiring: 'inspiring piece',
  novel: 'novel',
  serial: 'serial',
};

/** category → subcategory label (as stored) → phrase. Absent = CATEGORY_FORM. */
export const SUBCATEGORY_FORM = {
  flash: {
    Romance: 'flash fiction', Horror: 'flash fiction', Humour: 'flash fiction',
    Drama: 'flash fiction', Thriller: 'flash fiction', 'Slice of Life': 'flash fiction',
  },
  short: {
    Romance: 'short story', Horror: 'short story', Humour: 'short story', Drama: 'short story',
    Thriller: 'short story', 'Slice of Life': 'short story', Mystery: 'short story',
    'Sci-Fi': 'short story', Historical: 'short story', Fantasy: 'short story',
  },
  poetry: {
    Love: 'love poem', Grief: 'poem', Elegy: 'elegy', Political: 'poem', Nature: 'poem',
    Spiritual: 'poem', 'Spoken Word': 'spoken word poem',
  },
  news: {
    'Op-Ed': 'op-ed', Essay: 'essay', Music: 'music piece', Film: 'film piece',
    Tech: 'tech piece', Science: 'science piece', Business: 'business piece',
    Finance: 'finance piece', Sport: 'sport piece', Politics: 'politics piece',
    Culture: 'culture piece',
    // RULED — Ikenna, 20 Nov 2026 (SPOT-1.1): "New Spotlight by {author} · {quote}". Capital S,
    // because it is the column's name: the ONE proper noun in this table, and the only phrase the
    // lower-case rule in tests/push/push.test.mjs lets through (PROPER_NOUN_FORMS there).
    Spotlight: 'Spotlight',
  },
  inspiring: {
    'Personal Essay': 'personal essay', Essay: 'essay', Overcoming: 'inspiring piece',
    Faith: 'inspiring piece', Ambition: 'inspiring piece', 'Loss & Recovery': 'inspiring piece',
  },
  novel: { Novel: 'novel', Novella: 'novella', Serial: 'serial' },
  serial: { Novel: 'novel', Novella: 'novella', Serial: 'serial' },
};

/** The last resort: a category this table has never heard of. Never an invented genre. */
export const FALLBACK_FORM = 'story';

export function formFor(category, subcategory) {
  const sub = SUBCATEGORY_FORM[category]?.[subcategory];
  if (sub) return sub;
  return CATEGORY_FORM[category] || FALLBACK_FORM;
}

/** Every pair the taxonomy can produce, for the table in the report and the coverage test. */
export function allPairs() {
  const out = [];
  for (const { value, label } of CATEGORIES) {
    out.push({ category: value, categoryLabel: label, subcategory: '', form: formFor(value, '') });
    for (const sub of SUBCATEGORIES[value] || []) {
      out.push({ category: value, categoryLabel: label, subcategory: sub, form: formFor(value, sub) });
    }
  }
  return out;
}
