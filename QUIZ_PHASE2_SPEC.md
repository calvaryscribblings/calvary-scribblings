# Quiz Feature — Phase 2 Spec

## Goal

Build the user-facing flow for taking quizzes on story pages. Story-mode only. Reader-mode (book reader) ships in Phase 1.5 separately.

This is the moment of truth: readers see the quiz card under a story, take the quiz, get their tier, earn Scribbles to their wallet. The Scribbles catalogue (perks redeemable for Scribbles) opens September 2026 — for Phase 2, Scribbles accumulate but the catalogue isn't yet built.

## Vocabulary

The reward currency is called **Scribbles** in all user-facing copy. Backend storage stays at `points/{uid}/total` for stability — only the UI label changes. The variable names in code can stay `points` to match the existing schema.

## Stack

Same as Phase 1: Next.js static export on Cloudflare Pages, Firebase Realtime DB, Cloudflare Pages Functions for any server-side logic.

## Where the quiz lives

On the story page, the quiz card sits **between the story content and the Discuss/comments section**. It is conditional: only renders if a quiz exists at `cms_quizzes/{slug}` AND `approvedAt` is non-null.

If no approved quiz exists, the page renders as before — no card, straight from story to Discuss.

## User states

The quiz card has four possible states. Logic for which to show, in order:

### State A — Not signed in
Card shows:
- 📚 Test your reading: **Take the Quiz** (50 Scribbles)
- Body text: *"Sign in to take the quiz and start earning Scribbles."*
- Button: "Sign in to take quiz" → opens existing AuthModal

### State B — Signed in but hasn't read the story
Logic: `users/{uid}/readStories/{slug}` does not exist.

Card shows:
- 📚 Test your reading: **Take the Quiz** (50 Scribbles)
- Locked appearance (slightly dimmed, lock icon)
- Body text: *"Read the story first to unlock the quiz."*
- No button

### State C — Signed in, has read, hasn't attempted
Logic: `users/{uid}/readStories/{slug}` exists AND `quiz_submissions/{uid}/{slug}` does not exist.

Card shows:
- 📚 Test your reading: **Take the Quiz** (50 Scribbles)
- Body text: *"15 questions. One attempt. Test your close reading."*
- Button: "Begin Quiz" → opens guidelines modal (see below)

### State D — Already submitted
Logic: `quiz_submissions/{uid}/{slug}` exists.

Card shows:
- Result summary:
  - Tier badge (Platinum/Gold/Silver/Bronze, or "No tier" if <60%)
  - "You scored 87% — **Silver tier** — earned 40 Scribbles"
  - Submitted [time ago]
- No retry button. One attempt, ever.
- If user scored <60%: gentle text — *"Quizzes have a single attempt. Your reading still earns you the comments below."*
## Guidelines Modal

Opens when user clicks "Begin Quiz" from State C. Cinematic — full-screen overlay, branded styling.

### Content

```
✦ Before you begin ✦

One attempt. There are no retries.

Your answers are scored:
100% = Platinum · 90% = Gold · 80% = Silver · 60% = Bronze
Below 60% = no tier

You earn Scribbles for every quiz you pass. Scribbles never expire. They unlock perks: exclusive stories, signed prints, member-only events, and more.

The Scribbles catalogue — what you can spend them on — opens September 2026.

The first question is a comprehension check. If your answer doesn't show close reading, the quiz locks. You can still join the Discussion.

This isn't a race. Take your time.

[ I understand — begin ]   [ Cancel ]
```

### Styling
- Full-screen overlay, dark backdrop (rgba(10,10,10,0.92))
- Modal card centred, 540px max-width, dark `#12091e` background, purple border
- Cinzel for the "Before you begin" header
- Cormorant Garamond for body
- Inter for buttons
- Purple "I understand" button, ghost "Cancel" button

### Behaviour
- "Cancel" closes modal, returns to story page, no submission record created
- "I understand — begin" closes modal and renders the HARDBALL section

## HARDBALL Section

Renders inline below the (now-collapsed) quiz card. Sits below the story content — the story stays visible above for reference. Quiz appears as a new section the user can scroll through.

### Content
- Section header: HARDBALL — Comprehension Check
- Helper text from the quiz data, italicised: e.g. *"Think about the kitchen scene early in the story."*
- The question, displayed prominently
- A textarea, ~5 rows, placeholder *"Write your answer here…"*
- Submit button: "Check my answer"

### On submit

Client-side keyword matching:
- Normalise user's answer: lowercase, strip punctuation
- Normalise each keyword the same way
- Apply basic stemming: strip trailing `s`, `es`, `ed`, `ing` to handle plurals/tenses
- Count how many distinct keywords appear in the answer
- Pass if count >= `minMatches` (default 2)

### On pass
- Brief shimmer or pulse on the card
- HARDBALL section collapses with a "✓ Passed" indicator
- MCQs and essays appear below

### On fail
- HARDBALL section locks, shows: *"Your answer didn't show enough close reading — the quiz is locked, but you can still join the discussion in the comments below."*
- Write `quiz_submissions/{uid}/{slug}` with `hardballPassed: false`, `tier: null`, `pointsAwarded: 0`, `submittedAt: <now>`
- This counts as their one attempt. No retry.
- Discuss section renders normally below.

## MCQ + Essay Section (after HARDBALL passes)

All on one scrollable page. No paginated wizard. No timer.

### Layout
- Section header: 15 Multiple Choice
- 15 MCQ cards, each with question + 4 radio options
- Section header: 3 Essays
- 3 essay cards, each with question + textarea (~6 rows)
- No keyword-pool hint above each essay textarea — don't show users which keywords they need to hit. That defeats the engagement test. Just the question.
- Final submit button at the bottom: "Submit Quiz"

### Validation before submit
- All 15 MCQs must have an answer selected
- All 3 essays must have at least 30 characters of text
- If any are missing, scroll to first incomplete and highlight in red — don't submit

### On submit

Client-side scoring:
- For each MCQ: 1 point if correct, 0 if wrong → MCQ score = X / 15
- For each essay: count distinct keywords from `keywordPool` matched in the answer (same normalisation + basic stemming as HARDBALL). If count >= `requiredMatches` (default 5), essay marked correct (1 pt). Else 0. → Essay score = Y / 3
- Combined score percent = ((X + Y) / 18) * 100
- Determine tier:
  - 100% → Platinum, 50 Scribbles
  - 90%+ → Gold, 45 Scribbles
  - 80%+ → Silver, 40 Scribbles
  - 60%+ → Bronze, 25 Scribbles
  - <60% → no tier, 0 Scribbles

Trigger cinematic animation immediately. Write to Firebase only after animation begins (so user feels instant feedback).
## Cinematic Animation Sequence

Triggered on submit. Full-screen takeover, dark backdrop.

### Sequence (target ~5 seconds total)

1. **0.0–1.5s — Marking shimmer**
   - "Marking your answers…" centred, italic Cormorant
   - Subtle gold shimmer animation across the text

2. **1.5–4.0s — Percentage dial**
   - Large circular dial appears, spins from 0% to final score
   - Number counts up in sync
   - Dial fills with gradient (purple to gold)

3. **4.0–4.8s — Tier reveal**
   - Tier badge slides in from below the dial
   - Tier name in Cinzel, large, with subtle scale-up
   - Bronze: amber, Silver: pale grey, Gold: warm gold, Platinum: pearl gradient
   - If <60%: instead show *"Keep reading. Keep growing."* in italic Cormorant — no badge, no negative tone

4. **4.8–5.5s — Scribbles burst**
   - "+40 Scribbles" (or whatever) appears next to the badge
   - Particles or a small comet trails toward where the wallet icon would live in the top nav (top-right area)
   - Wallet icon if visible: pulse purple briefly

5. **5.5s — Settle**
   - Animation fades, returns to the story page
   - Quiz card has updated to State D (showing result + tier)
   - Discuss section is now unlocked / visible

A "Skip" button (subtle, top-right of overlay) lets impatient users bypass the animation.

## Firebase writes

### `quiz_submissions/{uid}/{slug}`
```json
{
  "hardballPassed": true,
  "mcqAnswers": [0, 2, 1, 3],
  "essayAnswers": ["...", "...", "..."],
  "mcqScore": 13,
  "essayScore": 2,
  "totalPercent": 83.33,
  "tier": "silver",
  "pointsAwarded": 40,
  "submittedAt": 0
}
```

### `points/{uid}/total`
Increment by `pointsAwarded`. Use Firebase `runTransaction` to avoid race conditions.

### `points/{uid}/history` push
```json
{
  "type": "quiz",
  "amount": 40,
  "description": "Almost Like Her — Silver",
  "slug": "almost-like-her",
  "createdAt": 0
}
```

## Wallet UI label

Wherever the wallet currently displays "points" in user-facing copy, change to "Scribbles". Keep all backend Firebase paths and variable names as `points` — only the display label changes.

Examples of likely places to update:
- Top nav wallet badge tooltip
- `/rewards` page (any user-facing copy)
- Profile page if points are displayed
- Any toast notifications when points are earned

Search the codebase for user-facing strings containing "point" and update where appropriate. Do NOT change variable names, Firebase paths, or admin/internal copy.

## Files to create / modify

### Create
- `app/components/QuizCard.js` — the conditional card on the story page
- `app/components/QuizGuidelinesModal.js` — the cinematic guidelines modal
- `app/components/QuizHardball.js` — the HARDBALL section
- `app/components/QuizMain.js` — the MCQ + essay form
- `app/components/QuizResultAnimation.js` — the cinematic animation overlay
- `app/lib/quizScoring.js` — keyword normalisation, stemming, scoring helpers

### Modify
- `app/stories/[slug]/page-client.js` — render `<QuizCard />` between story content and `<CommentsSection />`. The card manages its own internal state and child components.
- User-facing strings showing "points" → "Scribbles" (see Wallet UI label section above)

### Firebase rules — already covered in Phase 1 (`cms_quizzes` and `quiz_submissions` are already wired)

## Editorial preferences

Same as Phase 1:
- British English, single quotes, em dashes with spaces, no Oxford comma
- Cochin or Cormorant Garamond for headings
- Inter for UI labels
- Purple `#6b2fad`, gold `#c9a44c`, cream `#f0ead8`
- Dark `#0a0a0a` background

## Out of scope for Phase 2

- Book reader (reader-mode) quizzes — Phase 1.5
- "Quiz available" badge on story cards — Phase 3
- Quiz analytics dashboard — Phase 3
- Scribbles catalogue (perks redemption UI) — opens September 2026
- Leaderboards — separate consideration

## Testing checklist

- [ ] Story page renders QuizCard only when `cms_quizzes/{slug}` has `approvedAt` set
- [ ] State A (not signed in) shows correctly with sign-in CTA
- [ ] State B (no readStories entry) shows locked card
- [ ] State C (read, no submission) shows Begin Quiz button
- [ ] State D (already submitted) shows tier result, no retry
- [ ] Guidelines modal opens, both buttons work
- [ ] HARDBALL pass writes nothing yet, opens MCQ+essay
- [ ] HARDBALL fail writes submission with hardballPassed: false, locks card to State D
- [ ] All 15 MCQs and 3 essays must be filled to submit
- [ ] Scoring math correct: tier and Scribbles awarded match thresholds
- [ ] Animation runs through full sequence; Skip button works
- [ ] Scribbles written to `points/{uid}/total` and history
- [ ] Submission written to `quiz_submissions/{uid}/{slug}`
- [ ] Refreshing the page after submission shows State D with correct tier
- [ ] Discuss section unlocks/appears after quiz completion (or hardball fail)
- [ ] Mobile layout works — single column, animation scales down
- [ ] All user-facing "points" copy reads "Scribbles"; backend paths unchanged