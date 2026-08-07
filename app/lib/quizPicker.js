// Pure list logic for the Quiz Builder's story picker — search, filters, facet
// counts and sort. It lives outside the page component for one reason: the picker
// now decides what 160+ rows the admin sees, and that decision has to be checkable
// against the real index rather than by clicking around. Zero imports, plain ESM,
// so scripts/verify-quiz-picker.mjs runs THIS code (not a copy of it) over the live
// cms_stories_index — the same rule storyIndex.js follows.

// ── Search ───────────────────────────────────────────────────────────────────
// Accent-folded, case-folded, punctuation-free. Punctuation is REMOVED rather than
// replaced with a space: replacing would split "Don't" into "don t", and a typed
// "dont" would then miss it. Removing also collapses the curly/straight apostrophe
// difference ("amores cage" finds "Amoré’s Cage") and lets both "5 to 9" and
// "5-to-9" find "5-To-9". Digits survive, so "47 sessions" finds "47 Sessions".
export function searchKey(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(query) {
  return searchKey(query).split(' ').filter(Boolean);
}

// Every typed token must appear somewhere in the row's key (title + author), so
// word order does not matter: "sessions 47" and "okaro dera" both hit. An empty
// query matches everything.
export function matchesQuery(rowKey, tokens) {
  return tokens.every(t => rowKey.includes(t));
}

// ── Rows ─────────────────────────────────────────────────────────────────────
// One cms_stories_index record — or one full cms_stories record, for the
// unpublished rows the index does not carry — becomes one picker row. `indexed`
// drives the R1 dual-write guard in save/approve and means exactly what it did
// before: this slug has an index entry that must be kept in sync.
export function toRow(slug, record, indexed) {
  const r = record || {};
  const title = r.title || slug;
  const author = r.author || '';
  return {
    slug,
    title,
    author,
    categoryName: r.categoryName || r.category || '',
    date: r.date || '',
    ts: r.date ? Date.parse(r.date) || 0 : 0,
    // The app routes reader collections on `bookReader === true || readerMode === true`
    // (app/lib/storyIndex.js) — the same pair stands in for the picker's old
    // `!!epubUrl` test, and agrees with it on every live record.
    reader: r.readerMode === true || r.bookReader === true,
    // Whether the STORY advertises a quiz. The index carries this as `quiz`, the
    // full record as `quizMeta`; buildQuizSummary keeps them the same shape.
    advertised: !!((r.quiz || r.quizMeta) || {}).hasQuiz,
    indexed,
    key: `${searchKey(title)} ${searchKey(author)}`.trim(),
  };
}

// ── Quiz state ───────────────────────────────────────────────────────────────
// Two sources disagree, and the disagreement is the point. cms_quizzes says whether
// a quiz was ever BUILT; the story's own badge says whether it is ADVERTISED. On the
// live data 13 published stories hold an approved quiz their badge never mentions,
// so a picker trusting the badge alone would file all 13 under "No quiz yet" and
// invite a pointless regeneration. "Built" decides the filter; the gap gets its own
// badge instead of being papered over.
//
// `quizKeysOk` false means the shallow cms_quizzes read failed — then the badge is
// all we have, which is the pre-round behaviour.
export function quizState(slug, { quizSlugs, advertisedSlugs, quizKeysOk }) {
  const advertised = advertisedSlugs.has(slug);
  const built = quizKeysOk ? quizSlugs.has(slug) : advertised || quizSlugs.has(slug);
  if (!built) return 'none';
  return advertised ? 'live' : 'unlisted';
}

// ── Selection ────────────────────────────────────────────────────────────────
// One pass, four facets, AND across all of them. Each facet's counts are computed
// over the rows passing every OTHER active filter, so "No quiz yet (12)" while an
// author is selected means twelve for that author — a count always describes what
// clicking it would produce.
export function selectRows(rows, filters, stateOf) {
  const { tokens = [], mode = 'all', cat = 'all', author = 'all', quiz = 'all', sort = 'newest' } = filters || {};

  const passSearch = r => !tokens.length || matchesQuery(r.key, tokens);
  const passMode = r => mode === 'all' || (mode === 'reader') === r.reader;
  const passCat = r => cat === 'all' || r.categoryName === cat;
  const passAuthor = r => author === 'all' || r.author === author;
  const passQuiz = r => {
    if (quiz === 'all') return true;
    const st = stateOf(r.slug);
    return quiz === 'none' ? st === 'none' : st !== 'none';
  };

  const base = rows.filter(r => passSearch(r) && passMode(r) && passCat(r) && passAuthor(r));
  const quizCounts = { all: base.length, none: 0, has: 0 };
  for (const r of base) {
    if (stateOf(r.slug) === 'none') quizCounts.none++;
    else quizCounts.has++;
  }

  const tally = (subset, field) => {
    const m = new Map();
    for (const r of subset) if (r[field]) m.set(r[field], (m.get(r[field]) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const visible = base.filter(passQuiz).sort(
    sort === 'title'
      ? byTitle
      : sort === 'oldest'
        ? (a, b) => a.ts - b.ts || byTitle(a, b)
        : (a, b) => b.ts - a.ts || byTitle(a, b)
  );

  return {
    visible,
    quizCounts,
    catOptions: tally(rows.filter(r => passSearch(r) && passMode(r) && passAuthor(r) && passQuiz(r)), 'categoryName'),
    authorOptions: tally(rows.filter(r => passSearch(r) && passMode(r) && passCat(r) && passQuiz(r)), 'author'),
  };
}
