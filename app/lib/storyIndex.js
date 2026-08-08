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
//      Three fields are app-only in exactly this way: `bookReader` (routing, above)
//      plus `authorHandle` and `readTime`, which the app's SEARCH results, PROFILE
//      → myStories list and USER AUTHOR-LIST surfaces render off the index alone.
//      Nothing in this repo reads authorHandle or readTime FROM the index either —
//      dropping them looks free here and blanks the handle and the "N min read" on
//      three app screens.
//   2. ANYTHING WRITING TO THE INDEX MUST WRITE A COMPLETE PROJECTED RECORD —
//      buildIndexRecord() via indexUpdatePaths(), never a partial path. A deep-path
//      write (`cms_stories_index/<slug>/<field>`) CREATES the parent when the slug
//      has no entry, leaving a record that holds only that one field: it still
//      counts as a member, so membership checks pass, while carrying no authorUid,
//      title or date. That is precisely how a story silently vanished from an
//      author's Voices page (see the R4a index-integrity commit); the repair is
//      scripts/backfill-stories-index.mjs, the standing check is
//      scripts/audit-stories-index.mjs.
//   3. ANY PATH THAT FLIPS published:false → true MUST WRITE THE INDEX ENTRY in the
//      same atomic update — flipping `cms_stories/<slug>/published` alone (with no
//      index write) leaves a published story with NO index record, invisible on
//      every index-fed surface (homepage, category pages, search, gateway-build,
//      Voices) since the Phase A cut-over. The admin's unhideStory() does this
//      correctly (`cms_stories/<slug>/published: true` + indexUpdatePaths). The
//      scheduled-publish CRON — the external `calvary-newsletter` Cloudflare Worker,
//      which flips scheduled stories to published:true when publishAt arrives — is
//      the SAME kind of writer and is bound by the SAME rule: it must project a
//      complete record with buildIndexRecord() (mirrored, since it cannot import
//      this module), never a bare `published: true` deep-path write. The
//      scheduled-publish integrity section of scripts/audit-stories-index.mjs
//      guards this specific failure mode.
// ─────────────────────────────────────────────────────────────────────────────
//
// Slim public index projection for cms_stories — the single source of truth for
// the fields the hot list/build surfaces actually render. See
// database.rules.storiesIndex-fragment.json and the Phase A performance work.
//
// The full record is 1.22 MB wholesale; content (846 KB) + extractedText (258 KB)
// are 89% of that and never appear on a list card. This index keeps only the ~19
// scalars a card/hero/whisper needs, so /public-library and the category pages
// fetch ~85 KB instead of the whole node. content/extractedText/epubUrl and the
// mutable quizMeta.attemptCount are DELIBERATELY excluded (attemptCount mutates on
// reader actions and would force a public write path — the index stays
// editorially-immutable, refreshed only on publish/edit/unpublish/delete).
//
// Pure ESM, safe under the static-export build AND importable from scripts/*.mjs
// (the backfill), so the projection is defined exactly once.
//
// R11.9: this used to say "zero imports". It now takes exactly one — publishedAtMsFor
// from app/lib/storyAccess.js, which is itself import-free — and the property that
// mattered is unchanged: no React, no Firebase, no network, nothing that bare Node or
// a Worker cannot load. The alternative was hand-copying the date derivation into the
// projection, which is precisely the kind of second copy this file's own contract
// header warns about three paragraphs up.
import { publishedAtMsFor } from './storyAccess.js';

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
//
// authorHandle and readTime were added so the app can read the index alone on its
// search, profile myStories and user author-list surfaces — those three render a
// handle and a "N min read" and previously had to fall back to the full record for
// them. authorHandle is the source scalar verbatim; readTime is precomputed here
// (see indexReadTime below) because the index deliberately excludes `content`, so
// the app cannot derive it downstream.
export function buildIndexRecord(slug, story) {
  const s = story || {};
  const rec = {
    title: s.title || '',
    author: s.author || '',
    authorUid: s.authorUid || '',
    authorHandle: s.authorHandle || '',
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
    readTime: indexReadTime(s.content),
    // publishedAtMs is the ONE field on this projection that is load-bearing for
    // ENTITLEMENT rather than for rendering, and it is worth knowing which. The
    // story-serving endpoint resolves the most-recent-5 free floor with an ordered
    // query on this node (orderBy="publishedAtMs"&limitToLast=N), so a record that
    // lacks it is invisible to the floor — see STORY-SERVING-CONTRACT.md §3.2, §8.
    // `"publishedAtMs"` is in .indexOn on cms_stories_index in database.rules.json;
    // without it Firebase refuses the query outright rather than answering slowly.
    //
    // Derived here rather than copied from s.publishedAtMs so that a record written
    // before the R11.8 backfill still projects a correct value instead of a hole.
    publishedAtMs: publishedAtMsFor(s),
    url: s.url || `/stories/${slug}`,
  };
  if (s.publishAt) rec.publishAt = s.publishAt;
  if (s.coverSizes) rec.coverSizes = s.coverSizes;
  const quiz = buildQuizSummary(s.quizMeta);
  if (quiz) rec.quiz = quiz;
  return rec;
}

// Reading time in whole minutes, at 220 wpm — a BYTE-FOR-BYTE reimplementation of
// the app's lib/storyDerived.ts:37. Empty/missing content → 0.
//
//   ⚠ PRESERVE THE QUIRK: this counts RAW HTML TOKENS. There is no stripHtml call,
//   so markup counts as words — `<p>` is one token, `<a href="…">` is two, and a
//   heavily-tagged story reads longer than it is. That is NOT a bug to fix here.
//   The app renders this exact number on the story page today; the index exists to
//   let its search/profile/author-list surfaces show THE SAME number without
//   fetching content. Silently "correcting" it would make the index disagree with
//   the story page for every story — cross-platform parity outranks correctness.
//   If the count is ever fixed, it must be fixed in lib/storyDerived.ts and HERE in
//   the same change (and in the Worker mirror), never in one place alone.
export function indexReadTime(content) {
  if (!content || typeof content !== 'string') return 0;
  return Math.ceil(content.split(/\s+/).filter(Boolean).length / 220);
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
