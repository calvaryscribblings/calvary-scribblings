# Polish Backlog

Items deferred from earlier phases for hardening, refinement, or follow-up. Each entry notes the phase it was deferred from and the trigger condition for picking it up.

---

## Server-side quiz submission hardening

**Deferred from:** Phase 3.1 Step 2
**Trigger:** Before Membership tiers launch (July 2026), or before any cash-adjacent flow returns.

Currently quiz submissions are written directly from the client (`QuizCard.js` writes to `points/{uid}`, `quizSubmissions/{slug}/{uid}`, `userStoryTiers/{uid}/{slug}`, and increments `cms_stories/{slug}/quizMeta/attemptCount`). Trust model: Firebase security rules. Risk: a determined user could submit a fabricated score via the browser console and credit themselves Scribbles. Acceptable for the small-readership phase.

**Fix:** convert submission to a Cloudflare Pages Function at `functions/quiz/submit.js`, with server-side score recomputation from the canonical quiz node, then write to Firebase using the user's verified ID token. Same pattern as `functions/admin/migrate-quiz-meta.js`.
---

## HARDBALL and essay scoring — semantic evaluation rebuild

**Deferred from:** Phase 2 (in-flight redesign)
**Trigger:** Tomorrow morning, before Phase 3.1 Step 7.

Two compounding issues surfaced from test users:

1. **HARDBALL keyword matching too strict.** Readers who closely-read but used synonyms outside the keyword array (counterclockwise vs anticlockwise, etc.) are being locked out. Rebecca, Chioma, and at least one other.
2. **Essays default to `essayScore: 0`.** No editor-review workflow ever existed; every submission since Phase 2 launched is silently undercounting essay content, dragging tiers down across the board.

**Solution:** unify both under a single semantic evaluator. At submission time, Claude (Sonnet) evaluates each HARDBALL answer and each essay answer against the source story plus the question's intent. Returns a per-question score and a brief justification. Falls back to existing keyword-array match if the API fails.

**Scope tomorrow:**

- Build the evaluator function (Cloudflare Pages Function, callable from QuizCard's submit handler)
- Update writeQuizResult to route through the evaluator, write per-question scores into the submission record
- One-off re-evaluation script for historical submissions — same pattern as the migration tool, dry run + real run via the admin UI
- Decide whether to retroactively bump tiers for users whose old submissions undercounted them (probably yes — goodwill move)

**Architectural note:** the keyword arrays in each quiz's HARDBALL stay in place as fallback and as a hint to the evaluator (the prompt can include them as 'examples of acceptable phrasing'). Don't delete them.