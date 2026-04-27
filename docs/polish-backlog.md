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

---

## Semantic evaluator — HARDBALL retry cost

**Deferred from:** Phase 3.1 (semantic evaluator build)
**Trigger:** If evaluator call volume becomes meaningful (>500 quiz attempts/month).

Each HARDBALL attempt fires a separate evaluator call. A reader who fails attempt 1 then passes attempt 2 incurs two HARDBALL calls plus one essays call — ~3p total vs ~2p for a clean pass. At current scale this is negligible, but the optimisation is straightforward: cache the first HARDBALL evaluation result in a React ref or session state and skip the second evaluator call if the answer is identical (or always, since the second attempt is a resubmit on the same question). The keyword fallback already operates this way implicitly.

---

## attemptCount fire-and-forget pattern

**Deferred from:** Phase 3.1 record-attempt build
**Trigger:** If `[QuizCard] record-attempt failed` warnings become non-trivial in production logs.

The `/api/record-attempt` call is fire-and-forget after the user-data Firebase write succeeds. If the function fails (rate limit, 500, etc.), the user submission still persists but the public `attemptCount` doesn't increment. Acceptable trade-off currently — counter accuracy is approximate, user experience is preserved. If failures become noticeable, add a client-side retry queue or move the increment into the same atomic write path via the service-account-authed Firebase REST call.