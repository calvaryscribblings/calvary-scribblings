// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT SHARED WITH THE STORY ISLAND APP (calvary-app repo).
//
// cms_stories_index is not private to this repo. The app reads the same RTDB node
// and routes on fields this repo may not consume: storyHref/isReaderCollection
// there resolve `bookReader === true || readerMode === true`. So:
//
//   1. DO NOT DROP A FIELD from this projection because nothing in this repo reads
//      it. `bookReader` has no consumer here and is load-bearing there. Removing a
//      field is a breaking change to another codebase and will not show up in this
//      repo's build, tests, or pages — it shows up as stories misrouting in the app.
//   2. ANYTHING WRITING TO THE INDEX MUST WRITE A COMPLETE PROJECTED RECORD —
//      buildIndexRecord() via indexUpdatePaths(), never a partial path. A deep-path
//      write (`cms_stories_index/<slug>/<field>`) CREATES the parent when the slug
//      has no entry, leaving a record that holds only that one field: it still
//      counts as a member, so membership checks pass, while carrying no authorUid,
//      title or date. That is precisely how a story silently vanished from an
//      author's Voices page (see the R4a index-integrity commit); the repair is
//      scripts/backfill-stories-index.mjs, the standing check is
//      scripts/audit-stories-index.mjs.
// ─────────────────────────────────────────────────────────────────────────────
//
// Slim public index projection for cms_stories — the single source of truth for
// the fields the hot list/build surfaces actually render. See
// database.rules.storiesIndex-fragment.json and the Phase A performance work.
//
// The full record is 1.22 MB wholesale; content (846 KB) + extractedText (258 KB)
// are 89% of that and never appear on a list card. This index keeps only the ~17
// scalars a card/hero/whisper needs, so /public-library and the category pages
// fetch ~85 KB instead of the whole node. content/extractedText/epubUrl and the
// mutable quizMeta.attemptCount are DELIBERATELY excluded (attemptCount mutates on
// reader actions and would force a public write path — the index stays
// editorially-immutable, refreshed only on publish/edit/unpublish/delete).
//
// Pure ESM, zero imports: safe under the static-export build AND importable from
// scripts/*.mjs (the backfill), so the projection is defined exactly once.

export const INDEX_PATH = 'cms_stories_index';

// Index membership mirrors the public-library gate's published side
// (published !== false). A hidden story is absent from the index entirely; the
// publishAt future-gate stays a client concern (publishAt travels in the record).
export function isIndexed(story) {
  return !!story && story.published !== false;
}

// Project a full cms_stories record to its slim index record. coverSizes rides
// along only when present (Phase B populates it) — never invented here. The quiz
// summary carries just { hasQuiz, scribblesReward } (never attemptCount) and only
// when a quiz exists, so the common no-quiz row costs nothing.
export function buildIndexRecord(slug, story) {
  const s = story || {};
  const rec = {
    title: s.title || '',
    author: s.author || '',
    authorUid: s.authorUid || '',
    category: s.category || '',
    categoryName: s.categoryName || '',
    subcategory: s.subcategory || '',
    cover: s.cover || '',
    coverHash: s.coverHash || '',
    trailerQuote: s.trailerQuote || '',
    date: s.date || '',
    published: s.published !== false,
    featuredPin: s.featuredPin === true,
    readerMode: s.readerMode === true,
    // bookReader rides alongside readerMode: the app's storyHref/isReaderCollection route on
    // `bookReader === true || readerMode === true`, so an index that carries only one of the two
    // can misroute a reader-collection story. No live record is bookReader-only today
    // (filtered-reality sets both), so nothing misroutes yet — this closes it before one does.
    bookReader: s.bookReader === true,
    url: s.url || `/stories/${slug}`,
  };
  if (s.publishAt) rec.publishAt = s.publishAt;
  if (s.coverSizes) rec.coverSizes = s.coverSizes;
  const quiz = buildQuizSummary(s.quizMeta);
  if (quiz) rec.quiz = quiz;
  return rec;
}

// The quiz sub-object the index carries — { hasQuiz, scribblesReward } — or null
// when there is no quiz (callers write null to remove the key). attemptCount is
// deliberately absent: it mutates on reader actions, and the index is admin-write
// only. Both writers (the stories admin's full projection above and the quiz
// admin's targeted dual-write) go through THIS function so they cannot diverge.
export function buildQuizSummary(quizMeta) {
  const q = quizMeta || {};
  return q.hasQuiz ? { hasQuiz: true, scribblesReward: q.scribblesReward ?? 50 } : null;
}

// The multi-path fragment that keeps one slug's index entry in lockstep with its
// full record. Merge this into the SAME update(ref(db), …) that writes
// cms_stories/${slug} so the pair can never half-write. An index-ineligible
// (hidden) or null (deleted) next-state removes the index entry.
export function indexUpdatePaths(slug, story) {
  return {
    [`${INDEX_PATH}/${slug}`]: isIndexed(story) ? buildIndexRecord(slug, story) : null,
  };
}
