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
    url: s.url || `/stories/${slug}`,
  };
  if (s.publishAt) rec.publishAt = s.publishAt;
  if (s.coverSizes) rec.coverSizes = s.coverSizes;
  const q = s.quizMeta || {};
  if (q.hasQuiz) rec.quiz = { hasQuiz: true, scribblesReward: q.scribblesReward ?? 50 };
  return rec;
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
