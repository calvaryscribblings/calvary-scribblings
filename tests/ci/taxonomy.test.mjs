// R44 — THE LIBRARY'S TAXONOMY, asserted. `npm run test:taxonomy` (and `npm run test:ci`).
//
// ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────────────────
//
// The round that added ELEGY began as a census, and the census found nine copies of the
// subcategory vocabulary and no test looking at any of them. Eight agreed; the ninth had
// drifted a year earlier and nobody knew, because each copy only ever answered its own
// question. app/lib/taxonomy.js is now the only literal. This suite is what keeps it that way.
//
// It is modelled on tests/bookstore/genres.test.mjs, which does the same job for the shop's
// twelve genres — and the two lists are DELIBERATELY unrelated. The library files stories by
// category and subcategory; the shop files titles by genre. A round that conflates them adds
// a poetry subcategory to a bookshop, so the last describe() below asserts the separation
// rather than trusting anyone to remember it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CATEGORIES,
  SUBCATEGORIES,
  ALL_TAB,
  subcategoriesFor,
  tabsFor,
  inSubcategory,
  tabsPresentIn,
} from '../../app/lib/taxonomy.js';
import { GENRE_SEED_SLUGS } from '../../app/lib/bookstore/genres.js';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');

/** Source with comment lines stripped — a label discussed in prose is not a fourth copy. */
const code = (rel) => src(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// The nine files that used to hold a copy. If any of them speaks a label again, it has
// started the tenth.
const SURFACES = [
  'app/admin/page.js',
  'app/flash/page.js',
  'app/short/page.js',
  'app/poetry/page.js',
  'app/news/page.js',
  'app/inspiring/page.js',
  'app/book-reader/page.js',
  'scripts/classify-subcategories.mjs',
  'scripts/reclassify-short-stories.mjs',
];

const CATEGORY_PAGES = {
  flash: 'app/flash/page.js',
  short: 'app/short/page.js',
  poetry: 'app/poetry/page.js',
  news: 'app/news/page.js',
  inspiring: 'app/inspiring/page.js',
  novel: 'app/book-reader/page.js',
};

const ALL_LABELS = [...new Set(Object.values(SUBCATEGORIES).flat())];

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R44 — ELEGY, the ruling itself', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('Elegy is in the poetry vocabulary, and only there', () => {
    assert.ok(subcategoriesFor('poetry').includes('Elegy'), 'poetry does not offer Elegy');
    for (const [cat, list] of Object.entries(SUBCATEGORIES)) {
      if (cat === 'poetry') continue;
      assert.equal(list.includes('Elegy'), false, `${cat} also offers Elegy`);
    }
  });

  test('it sits beside Grief, which is the placement the ruling was given', () => {
    const p = subcategoriesFor('poetry');
    assert.equal(p[p.indexOf('Grief') + 1], 'Elegy', 'Elegy no longer follows Grief');
  });

  test('the CMS picker offers it — the only way it ever stops being empty', () => {
    // tabsFor() is the picker's view: the WHOLE vocabulary, unfiltered by occupancy.
    assert.ok(tabsFor('poetry').some((t) => t.value === 'Elegy' && t.label === 'Elegy'));
    // And the picker reads the map this file imports, rather than one of its own.
    const admin = code('app/admin/page.js');
    assert.match(admin, /from '\.\.\/lib\/taxonomy'/, 'the CMS no longer imports the taxonomy');
    assert.match(admin, /SUBCATEGORY_MAP\[form\.category\]/, 'the picker no longer keys off the map');
  });

  test('the label IS the key — a subcategory carries nothing else', () => {
    // Guards the shape against somebody "improving" it into a slug/label record, which would
    // silently orphan every story, because a story stores the display string verbatim.
    for (const label of ALL_LABELS) assert.equal(typeof label, 'string');
    for (const tab of tabsFor('poetry')) {
      assert.deepEqual(Object.keys(tab).sort(), ['label', 'value']);
      if (tab.value !== ALL_TAB.value) assert.equal(tab.value, tab.label, 'value and label diverged');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R44 — ONE LITERAL, and the drift that proved it was needed', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('every surface is on disk — the greps below are worthless against a missing file', () => {
    // The two classifier scripts were UNTRACKED until R44. A grep suite that silently skips
    // an absent file polices nothing, and an absent file is exactly where the 'Essay' drift
    // survived a year. They are committed now; this fails loudly if one leaves again.
    for (const f of SURFACES) assert.doesNotThrow(() => src(f), `${f} is not on disk`);
  });

  test('no surface holds a subcategory table', () => {
    for (const f of SURFACES) {
      assert.equal(/const SUBCATEGORIES = \[|const SUBCATEGORY_MAP = \{/.test(code(f)), false,
        `${f} carries a subcategory table`);
    }
  });

  test('no surface hard-codes a subcategory label', () => {
    for (const f of SURFACES) {
      const body = code(f);
      for (const label of ALL_LABELS) {
        assert.equal(body.includes(`'${label}'`) || body.includes(`"${label}"`), false,
          `${f} hard-codes the label "${label}"`);
      }
    }
  });

  test('every category page imports the taxonomy', () => {
    for (const f of Object.values(CATEGORY_PAGES)) {
      assert.match(code(f), /from '\.\.\/lib\/taxonomy'/, `${f} does not import the taxonomy`);
    }
  });

  test("the classifier can suggest 'Essay' for an inspiring piece — the drift, closed", () => {
    // scripts/classify-subcategories.mjs's own list omitted it from 29 Jun 2026 until R44,
    // while the picker and the tab row both offered it and three published stories carried
    // it. The import is the fix; this asserts the outcome rather than the mechanism.
    assert.ok(subcategoriesFor('inspiring').includes('Essay'));
    assert.match(code('scripts/classify-subcategories.mjs'), /from '\.\.\/app\/lib\/taxonomy\.js'/);
  });

  test('the vocabulary has no duplicate within a category, and no blank', () => {
    for (const [cat, list] of Object.entries(SUBCATEGORIES)) {
      assert.equal(new Set(list).size, list.length, `${cat} repeats a label`);
      for (const l of list) assert.ok(l && l.trim() === l, `${cat} has a blank or padded label`);
      assert.equal(list.includes(ALL_TAB.label), false, `${cat} declares a subcategory called "All"`);
    }
  });

  test('every category the CMS offers has a vocabulary', () => {
    for (const c of CATEGORIES) {
      assert.ok(subcategoriesFor(c.value).length > 0, `${c.value} has no subcategories`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R44 — AN EMPTY SUBCATEGORY IS ABSENT, NOT AN EMPTY TAB', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const poem = (subcategory) => ({ id: subcategory, subcategory });

  test('a subcategory with no story gets no tab', () => {
    const shelf = [poem('Love'), poem('Love'), poem('Grief')];
    assert.deepEqual(tabsPresentIn('poetry', shelf).map((t) => t.value), ['all', 'Love', 'Grief']);
  });

  test('Elegy draws nothing today, and a tab the moment one is filed', () => {
    const before = [poem('Love')];
    assert.equal(tabsPresentIn('poetry', before).some((t) => t.value === 'Elegy'), false,
      'an empty Elegy drew a tab');
    const after = [...before, poem('Elegy')];
    assert.ok(tabsPresentIn('poetry', after).some((t) => t.value === 'Elegy'),
      'a filed Elegy drew no tab');
  });

  test('"All" survives an empty shelf — it is not a subcategory', () => {
    assert.deepEqual(tabsPresentIn('poetry', []).map((t) => t.value), ['all']);
    assert.deepEqual(tabsPresentIn('novel', null).map((t) => t.value), ['all']);
  });

  test('order is the vocabulary’s, not the shelf’s', () => {
    const shelf = [poem('Spoken Word'), poem('Love'), poem('Nature')];
    assert.deepEqual(tabsPresentIn('poetry', shelf).map((t) => t.value),
      ['all', 'Love', 'Nature', 'Spoken Word']);
  });

  test('EVERY category page filters its row — not just /news', () => {
    // The regression this suite exists to stop. Five of six pages rendered the whole
    // vocabulary unconditionally until R44, and two were drawing bare headings in production.
    for (const [cat, f] of Object.entries(CATEGORY_PAGES)) {
      const body = code(f);
      assert.match(body, /tabsPresentIn\(/, `${f} does not filter its tab row`);
      assert.equal(/\{SUBCATEGORIES\.map\(/.test(body), false,
        `${f} still maps the whole vocabulary`);
      assert.ok(cat, cat);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R44 — ONE PREDICATE', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('a story is filed under a subcategory by exact match, and nothing else', () => {
    assert.equal(inSubcategory({ subcategory: 'Elegy' }, 'Elegy'), true);
    assert.equal(inSubcategory({ subcategory: 'elegy' }, 'Elegy'), false, 'case-insensitive match');
    assert.equal(inSubcategory({ subcategory: '' }, ''), false, 'an unfiled story matched');
    assert.equal(inSubcategory({}, 'Elegy'), false);
    assert.equal(inSubcategory(null, 'Elegy'), false);
  });

  test("/news's categoryName clause is gone, and was a no-op — asserted both ways", () => {
    // The clause read `|| s.categoryName === activeTab`, and lived on /news alone. /news
    // narrows to `category === 'news'` before it filters, so every story it holds carries the
    // SAME categoryName — "News & Updates" — and the clause could only ever have matched if
    // that string were itself a news subcategory. It is not.
    //
    // Scoped to /news deliberately. The blanket version of this check is FALSE: the 'novel'
    // category's display name is "Novel", which is also a subcategory under it, so the clause
    // would NOT have been a no-op on /book-reader. /book-reader never had it.
    const news = CATEGORIES.find((c) => c.value === 'news');
    assert.equal(subcategoriesFor('news').includes(news.label), false,
      `"${news.label}" is also a news subcategory — the clause was NOT a no-op`);
    // And the live corroboration: no index record's categoryName is any subcategory label at
    // all (0 of 207, 9 Sep 2026), which is the stronger claim the removal actually relied on.
    for (const c of CATEGORIES) {
      if (c.value === 'novel') continue; // "Novel" — see above; /book-reader never had the clause
      assert.equal(ALL_LABELS.includes(c.label), false,
        `the category display name "${c.label}" is also a subcategory label`);
    }
    assert.equal(/categoryName === activeTab/.test(code('app/news/page.js')), false,
      '/news still carries the dead clause');
    for (const f of Object.values(CATEGORY_PAGES)) {
      assert.match(code(f), /inSubcategory\(s, activeTab\)/, `${f} does not use the shared predicate`);
    }
  });

  test('a story filed under Elegy is findable — search reads the subcategory', async () => {
    // The other half of "findable": the tab row shows it, and search matches the word.
    //
    // ⚠ THIS USED TO ASSERT A SOURCE LITERAL — the exact text
    // `(s.subcategory || '').toLowerCase().includes(q)` in app/search/page.js. R46 moved the
    // matching into app/lib/searchIndex.js:matchStories, and the guard failed on a change
    // that preserved the behaviour perfectly. A literal-matching guard is pinned to one
    // spelling in one file: it goes red on a refactor and, worse, it goes GREEN forever if
    // the line survives as dead code. So it now asserts the BEHAVIOUR, which is what R44
    // actually ruled — a subject word finds the stories filed under it.
    const { matchStories } = await import('../../app/lib/searchIndex.js');
    for (const label of ALL_LABELS) {
      const shelf = [
        { title: 'unrelated', author: '', categoryName: '', subcategory: label, date: '' },
        { title: 'unrelated', author: '', categoryName: '', subcategory: '', date: '' },
      ];
      const found = matchStories(shelf, label.toLowerCase());
      assert.equal(found.length, 1, `search does not match a story on the subcategory "${label}"`);
      assert.equal(found[0].subcategory, label);
    }
    // and the surface really does route its matching through that function
    assert.match(code('app/search/page.js'), /matchStories\(/,
      'the search page no longer runs the shared matcher');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R44 — THE LIBRARY IS NOT THE BOOK SHOP', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('no library subcategory is a shop genre slug, and no shop slug leaked in here', () => {
    for (const label of ALL_LABELS) {
      assert.equal(GENRE_SEED_SLUGS.includes(label), false,
        `"${label}" is a bookstore genre slug — the two taxonomies have been conflated`);
    }
    assert.equal(code('app/lib/taxonomy.js').includes('bookstore'), false,
      'the library taxonomy imports or names the shop');
  });

  test('the shop keeps its own shape — a record, where the library has a bare string', () => {
    // Not a duplicate of genres.test.mjs: this asserts the two shapes stay DIFFERENT, which
    // is the thing a well-meaning "unify the taxonomies" round would quietly destroy.
    assert.ok(GENRE_SEED_SLUGS.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)), 'shop slugs are kebab-case');
    assert.ok(ALL_LABELS.some((l) => /[A-Z]/.test(l)), 'library subcategories are display strings');
  });
});
