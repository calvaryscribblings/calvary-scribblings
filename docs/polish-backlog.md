# Polish Backlog

Items deferred from earlier phases for hardening, refinement, or follow-up. Each entry notes the phase it was deferred from and the trigger condition for picking it up.

---

## Server-side quiz submission hardening

**Deferred from:** Phase 3.1 Step 2
**Trigger:** Before Membership tiers launch (July 2026), or before any cash-adjacent flow returns.

Currently quiz submissions are written directly from the client (`QuizCard.js` writes to `points/{uid}`, `quizSubmissions/{slug}/{uid}`, `userStoryTiers/{uid}/{slug}`, and increments `cms_stories/{slug}/quizMeta/attemptCount`). Trust model: Firebase security rules. Risk: a determined user could submit a fabricated score via the browser console and credit themselves Scribbles. Acceptable for the small-readership phase.

**Fix:** convert submission to a Cloudflare Pages Function at `functions/quiz/submit.js`, with server-side score recomputation from the canonical quiz node, then write to Firebase using the user's verified ID token. Same pattern as `functions/admin/migrate-quiz-meta.js`.