// R45 — THE QUIZ MARKER IS OFF THE CARDS, asserted. `npm run test:quiz-marker` (and test:ci).
//
// ── WHAT THIS SUITE IS FOR ───────────────────────────────────────────────────────────────
//
// Ikenna's ruling: the badge telling a card that its story has a quiz comes off the cards.
// It is a REMOVAL, and a removal is the hardest thing to keep removed — nothing breaks when
// it comes back, so only a test notices.
//
// ⚠ THE FAILURE MODE THIS SUITE IS WRITTEN AGAINST. Twice now a census in this repo has read
// THE CALLER rather than WHAT THE CALLER RENDERS, and passed while the screen disagreed. So
// the source assertions below are deliberately not the whole proof: they pin which files may
// mount the pill, and tests/ci/quiz-marker.spec.mjs — the browser half — counts what actually
// PAINTS on a card at phone and desktop. A card component that stopped importing QuizPill but
// grew its own `✦ Quiz` span would pass everything in this file and fail there.
//
// ── WHAT IS NOT IN SCOPE, AND MUST STAY ──────────────────────────────────────────────────
//
// The ruling was about CARDS. These four surfaces carry a quiz marker and KEEP it — they are
// asserted present here, so a later sweep cannot quietly take them too:
//
//   /search             a result row  — QuizPill
//   /quizzes            the index     — QuizPill
//   /stories/[slug]     the byline    — "✦ This story has a quiz", a jump link to #quiz-card
//   /stories/[slug]     the quiz      — <QuizCard>, the entry point itself
//
// And the FEATURE is untouched: quizzes generate, score, and feed Scribbles and the
// leaderboards exactly as before. quizMeta.hasQuiz is unchanged in the database and still has
// five other consumers. An absent badge is not a retired feature, and a future round must not
// read it as one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { advertisesQuiz, quizAllowed } from '../../app/lib/readerCollection.js';
import { buildQuizSummary } from '../../app/lib/storyIndex.js';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');
/** Comment lines stripped — a file that EXPLAINS the removal is not performing it. */
const code = (rel) => src(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** Every file that draws a story card. None of these may name the marker. */
const CARD_SURFACES = [
  'app/components/StoryCard.js',   // the shared card: /flash /short /poetry /news /inspiring /book-reader
  'app/public-library/page.js',    // three local cards: StoryCard, JustAddedCard, Top10Card
  'app/my-library/page.js',        // ShelfStoryCard — a lean local card that never had one
];

/** The pages that mount the shared card. None may still thread tier props into it. */
const CARD_PAGES = [
  'app/poetry/page.js', 'app/flash/page.js', 'app/short/page.js',
  'app/inspiring/page.js', 'app/news/page.js', 'app/book-reader/page.js',
];

/** Deliberately NOT cards. The ruling did not touch these. */
const KEEPS_THE_MARKER = ['app/search/page.js', 'app/quizzes/page.js'];

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R45 — NO CARD RENDERS THE MARKER', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('no card surface mounts QuizPill', () => {
    for (const f of CARD_SURFACES) {
      assert.equal(/<QuizPill/.test(code(f)), false, `${f} still mounts QuizPill`);
      assert.equal(/from '.*QuizPill'/.test(code(f)), false, `${f} still imports QuizPill`);
    }
  });

  test('no card surface hand-rolls a marker of its own', () => {
    // The regression the browser half exists to catch, caught here too where it is cheap:
    // a card that drops the component and re-types the glyph.
    for (const f of CARD_SURFACES) {
      const body = code(f);
      assert.equal(body.includes('✦ Quiz'), false, `${f} hard-codes the marker text`);
      for (const tier of ['Bronze', 'Silver', 'Gold', 'Platinum']) {
        assert.equal(new RegExp(`['"]${tier}['"]`).test(body), false, `${f} hard-codes a tier label`);
      }
    }
  });

  test('a card no longer takes the props the marker needed', () => {
    // userTier / scorePct existed ONLY to style the pill. A prop left on the signature is an
    // invitation to pass it again.
    const card = code('app/components/StoryCard.js');
    assert.match(card, /export default function StoryCard\(\{ story, rank = null, \.\.\.rest \}\)/);
    for (const f of CARD_PAGES) {
      assert.equal(/userTier=|scorePct=/.test(code(f)), false, `${f} still passes tier props to a card`);
    }
  });

  test('a story WITH a quiz and a story WITHOUT render identically on a card', () => {
    // The ruling, stated as the property it actually is. The card reads `story` for cover,
    // title, author, isNew and url — and the quiz fields are now absent from ALL of them, so
    // two records differing only in quizMeta produce byte-identical card markup.
    const card = code('app/components/StoryCard.js');
    for (const field of ['quizMeta', 'quiz', 'hasQuiz', 'scribblesReward', 'advertisesQuiz']) {
      assert.equal(card.includes(field), false, `the card still reads ${field}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R45 — THE READ WENT WITH THE RENDER', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the seven card pages no longer read userStoryTiers', () => {
    // useUserStoryTiers() is one RTDB get() of userStoryTiers/{uid} per page load for a
    // signed-in reader, and on these pages its ONLY consumer was the pill. Seven reads a
    // visit, for a badge nothing draws.
    for (const f of [...CARD_PAGES, 'app/public-library/page.js']) {
      assert.equal(/useUserStoryTiers/.test(code(f)), false, `${f} still fetches story tiers`);
      assert.equal(/userTiersMap/.test(code(f)), false, `${f} still holds the tier map`);
    }
  });

  test('/search keeps its read, because /search keeps its pill', () => {
    // The saving is not "delete the hook". Asserted so a tidying round does not follow the
    // deletions into the one page that still needs it.
    const s = code('app/search/page.js');
    assert.match(s, /useUserStoryTiers/, '/search lost the read its pill depends on');
    assert.match(s, /<QuizPill/, '/search lost its pill');
  });

  test('the hook itself survives — it has a live consumer', () => {
    assert.match(code('app/lib/useUserStoryTiers.js'), /export function useUserStoryTiers/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R45 — WHAT IS NOT A CARD KEEPS ITS MARKER', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('/search and /quizzes still mount the pill', () => {
    for (const f of KEEPS_THE_MARKER) {
      assert.match(code(f), /<QuizPill/, `${f} lost its marker — the ruling was about cards`);
    }
  });

  test('the pill component is still there for them', () => {
    const pill = code('app/components/QuizPill.js');
    assert.match(pill, /export default function QuizPill/);
    assert.ok(src('app/components/QuizPill.js').includes('✦ Quiz'), 'the marker text is gone from the pill');
  });

  test('the story page keeps its jump link AND the quiz card it lands on', () => {
    const story = code('app/stories/[slug]/page-client.js');
    assert.match(story, /advertisesQuiz\(story\)/, 'the byline marker is gone');
    assert.match(story, /id="quiz-card"/, 'the quiz anchor is gone');
    assert.match(story, /<QuizCard/, 'THE ENTRY POINT IS GONE — this is the feature, not the badge');
    assert.ok(src('app/stories/[slug]/page-client.js').includes('This story has a quiz'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R45 — THE FIELD HAS OTHER CONSUMERS, AND THE QUIZ IS NOT RETIRED', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('advertisesQuiz still answers, and still gates on the reader collection', () => {
    assert.equal(advertisesQuiz({ quizMeta: { hasQuiz: true } }), true);
    assert.equal(advertisesQuiz({ quiz: { hasQuiz: true } }), true, 'the index projection shape');
    assert.equal(advertisesQuiz({ quizMeta: { hasQuiz: false } }), false);
    assert.equal(advertisesQuiz({}), false);
    assert.equal(advertisesQuiz({ quizMeta: { hasQuiz: true }, readerMode: true }), false,
      'R7.3 — a bound book does not stop to be marked out of ten');
    assert.equal(quizAllowed({ readerMode: true }), false);
  });

  test('the index still projects the quiz summary', () => {
    assert.deepEqual(buildQuizSummary({ hasQuiz: true, scribblesReward: 50, attemptCount: 17 }),
      { hasQuiz: true, scribblesReward: 50 });
    assert.equal(buildQuizSummary({ hasQuiz: false }), null);
  });

  test('hasQuiz still has consumers that are not the badge', () => {
    // A field with one visible consumer is not a field with one consumer. Removing the badge
    // must not read as permission to drop the field.
    const consumers = {
      'app/lib/quizPicker.js': /hasQuiz/,              // the admin picker facets on it
      'app/admin/quizzes/page.js': /hasQuiz/,          // the CMS writes it
      'app/lib/storyIndex.js': /hasQuiz/,              // the index projection
      'workers-external/calvary-newsletter.worker.js': /hasQuiz/, // the newsletter's own copy
      'app/quizzes/page.js': /<QuizPill/,              // the index surface
    };
    for (const [f, re] of Object.entries(consumers)) {
      assert.match(code(f), re, `${f} no longer reads the quiz field`);
    }
  });

  test('the picker still distinguishes built from advertised', () => {
    assert.match(code('app/lib/quizPicker.js'), /advertised \? 'live' : 'unlisted'/);
  });
});
