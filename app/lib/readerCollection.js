// ─────────────────────────────────────────────────────────────────────────────
// THE BOOK-READER COLLECTION — one predicate, every surface.
//
// Membership is an EXPLICIT EDITORIAL FLAG, not a property of the file. The stories
// admin writes `readerMode` from a checkbox (app/admin/page.js:461) and the collection
// surfaces read it: /book-reader filters `s.readerMode === true`, and /public-library
// prints the "Book Reader / THE COLLECTION" row off the same test.
//
// `bookReader` rides alongside it because the Story Island app's storyHref /
// isReaderCollection resolve `bookReader === true || readerMode === true` — the contract
// recorded at the top of app/lib/storyIndex.js. No live record is bookReader-only today,
// but the app treats either flag as membership, so this repo must too or the two
// codebases can disagree about what a story IS.
//
// WHAT MEMBERSHIP IS NOT. It is not "has an epubUrl", even though the two sets are
// coextensive in production right now (audited 2026-07-29: 9 collection stories, all 9
// with an EPUB, and no story outside the collection carrying one). Nor is it the reader
// ROUTING predicate — app/stories/[slug]/page-client.js sends
// `(poetry && epubUrl) || novel || readerMode` to /reader/{slug}, which is a WIDER test
// than this one and would drag two whole categories in with it. Gate on the flag: it is
// the thing an editor actually sets, and the thing the collection pages already show.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this story part of the book-reader collection?
 * @param {object|null|undefined} story  A cms_stories record or its index projection.
 * @returns {boolean}
 */
export function isReaderCollection(story) {
  if (!story || typeof story !== 'object') return false;
  return story.readerMode === true || story.bookReader === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE QUIZ RULE (R7.3 §A). The collection reads as a bound book, and a bound book does not
// stop to be marked out of ten. Quiz RECORDS are untouched in the database — cms_quizzes
// and quizMeta are exactly as they were, and un-ticking readerMode restores the quiz
// everywhere with no migration. What goes is the RENDERING and the GATING.
//
// TWO PREDICATES, because the surfaces ask two different questions.
//
//   quizAllowed   — "may this story show a quiz at all?" For the places that render
//                   QuizCard, which already decides for itself whether a quiz exists.
//   advertisesQuiz— "should this card promise a quiz?" For QuizPill and the /quizzes index,
//                   which have no card to defer to and must test the flag themselves.
//
// BOTH ARE NEEDED, and the second is not decoration. Two live collection stories carry a
// quiz today (diary-of-a-lagos-9-5er-1 and filtered-reality, audited 2026-07-30). Gating
// only the reader and the story page would leave their library, search and /quizzes cards
// still advertising a quiz — a pill that promises a thing, and a tap that arrives at a page
// where the thing is gone. A promise with nothing behind it is worse than no promise.
//
// These accept a cms_stories record OR a cms_stories_index projection: the index carries
// readerMode and bookReader (app/lib/storyIndex.js:93-98) and folds quizMeta down to a
// `quiz` summary (buildQuizSummary), which is why the flag is read from either shape.
// ─────────────────────────────────────────────────────────────────────────────

/** May this story render a quiz at all? */
export const quizAllowed = (story) => !isReaderCollection(story);

/** Should this story's card promise a quiz? */
export function advertisesQuiz(story) {
  if (!quizAllowed(story)) return false;
  return ((story && (story.quiz || story.quizMeta)) || {}).hasQuiz === true;
}
