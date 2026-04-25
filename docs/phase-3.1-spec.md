# Phase 3.1 — Quiz Discovery

**Calvary Scribblings · Quizzes & Scribbles**
*Spec drafted 25 April 2026 · Owner: Ikenna · Status: Ready to build*

---

## 0. Goal

Make quizzes findable. Until now, a reader only discovers a quiz exists by scrolling to the end of a story. Phase 3.1 surfaces quiz availability across the platform — story cards, a dedicated browse page, the top nav, and a subtle in-story hint — so quizzes become a destination rather than an Easter egg. It also gives the admin the tools to manage the inevitable mess (resets, locked-out readers).

Out of scope: badges, streaks, leaderboards, Square integration, analytics. Those are 3.2–3.5.

---

## 1. Data model changes

### 1.1 Story cache: `quizMeta`

Story cards on the homepage and `/quizzes` need to render quickly. Reading from `cms_stories/{slug}/quiz` for every card is wasteful. Add a denormalised `quizMeta` block to each story node, written by the admin quiz publisher (and updated on quiz edit/delete):

```
cms_stories/{slug}/quizMeta: {
  hasQuiz: true,
  scribblesReward: 50,
  publishedAt: 1714000000000,
  attemptCount: 0,            // incremented on each submission
  namingClaimedBy: null,      // uid of first Platinum, or null
  namingClaimedAt: null
}
```

When `hasQuiz` is `false` or absent, the badge surface stays clean.

### 1.2 Per-user tier cache: `userStoryTiers`

For tier-aware story card badges, each card needs to know the *current user's* tier on that story without reading the full submission record. Add:

```
userStoryTiers/{uid}/{slug}: {
  tier: 'bronze' | 'silver' | 'gold' | 'platinum',
  scorePct: 84,
  completedAt: 1714000000000
}
```

Written by the quiz submission handler at the same time it writes to `quizSubmissions/{slug}/{uid}` and credits Scribbles to `points/{uid}`. Three writes, one transaction. If the third fails, retry; we'd rather have a slightly stale tier badge than a missing Scribble.

### 1.3 Attempt counter

`cms_stories/{slug}/quizMeta/attemptCount` increments inside the submission transaction. Used on `/quizzes` cards ('327 readers have taken this') and later on the admin dashboard.

### 1.4 Reset audit log

`/admin/quiz-resets` writes to `quizResetLog/{autoId}`:

```
{
  uid: 'XaG6...',
  slug: 'mother-and-other-poems',
  resetBy: 'Ikennaworksfromhome@gmail.com',
  resetAt: 1714000000000,
  reason: 'HARDBALL keyword too strict'
}
```

Never delete a reset. The log is the receipt.

---

## 2. UI surfaces

### 2.1 Story card badge (tier-aware adaptive)

Three states per card:

- **No quiz** — no badge. Card unchanged.
- **Quiz available, user hasn't completed** — small pill, top-right of cover image: `✦ Quiz` in brand purple `#6b2fad` on a white 90%-opacity background, 11pt, single-quote-style ornament.
- **Quiz completed** — pill takes the user's tier colour, label changes to tier name. Bronze `#a97142`, Silver `#9ca3af`, Gold `#d4a437`, Platinum `#3a3f4b` with pearl finish (subtle inner gradient `linear-gradient(135deg, #f5f5f5 0%, #e8e6e1 100%)` with a `#3a3f4b` border).

Pill is always positioned identically; only its fill changes. Renders from `quizMeta.hasQuiz` + `userStoryTiers[slug].tier`. Signed-out users see the neutral `✦ Quiz` pill — no tier surface for them.

The pill is non-interactive on the card; clicking the card still opens the story. Hovering shows a tooltip on desktop (`Bronze tier · 64%` or `Earn up to 50 Scribbles`).

### 2.2 `/quizzes` browse page

Header: full-width letterhead band in brand purple, title 'Quizzes', subtitle 'Read the story. Earn the Scribbles.' Below it, a single line of meta: total quiz count, total Scribbles in circulation if you fancy showing it, otherwise leave it.

Controls row:

- **Sort** (default Most Recent First): Most Recent · Most Attempted · Highest Reward
- **Filter**: All · Unattempted · Completed *(signed-out users see only All; the other two are disabled with a tooltip 'Sign in to filter')*

Card grid: same density as the homepage. Each card shows:

- Cover image (16:10, no people — same rules as story covers)
- Title (italicised, brand serif)
- Author byline ('by Chioma Okonkwo')
- Scribbles pill: `✦ 50 Scribbles`
- Attempt count: `327 readers · 41 Platinum`
- User's tier badge if completed (bottom-right corner of cover)

Card click goes to `/stories/{slug}` with the quiz ready to take. Don't deep-link to a quiz-only view — the quiz lives inside the story page.

Empty states:
- No quizzes published yet: 'New quizzes are added every Friday. Come back soon.'
- Filter returns nothing ('Unattempted' when user has done them all): 'You've taken every quiz. Polymath energy.' *(this is a soft preview of a 3.2 badge name; harmless to drop here)*

### 2.3 Top nav

Add `Quizzes` between `Square` and `Reader's Reward`. New order:

`Stories · Square · Quizzes · Rewards · Profile`

No CTA on the rewards page for now. Revisit if analytics show a routing problem.

### 2.4 Story page indicator

Below the byline, before the body text:

```
✦ This story has a quiz · 50 Scribbles
```

11pt, brand purple, no underline, links to the QuizCard anchor at the bottom of the page. Smooth scroll, not a jump. Hidden if the user has already completed the quiz on this story (the QuizCard at the bottom shows their tier instead, which is enough).

Don't render at all if `quizMeta.hasQuiz` is false.

---

## 3. Admin: `/admin/quiz-resets`

A simple table tool. Two ways in:

- **By reader**: search by email or uid → list of all their submissions → reset button per row
- **By story**: pick a story → list of all submissions on it → reset button per row, plus a 'reset all' for the nuclear option

A reset:

1. Deletes `quizSubmissions/{slug}/{uid}`
2. Deletes `userStoryTiers/{uid}/{slug}`
3. Decrements `cms_stories/{slug}/quizMeta/attemptCount`
4. Does **not** claw back Scribbles already credited (we're not the IRS)
5. Does **not** revoke a Naming claim if one was made (Naming is irreversible by design — see 3.2)
6. Writes to `quizResetLog`

The reset button opens a confirm modal with a reason field (required, min 8 chars). The reason goes into the audit log.

Also include a 'Locked Out' shortcut at the top of the page: lists submissions where the user failed HARDBALL but otherwise scored well (e.g. 70%+ on MCQs but stuck on the gate). One-click reset from there with auto-filled reason 'HARDBALL synonym'. This is the Rebecca-counterclockwise problem solved at the admin level until 3.2 ships proper synonym editing.

---

## 4. Build order

Suggested sequence — each step is committable on its own:

1. **Data model migration** — write a one-off script in `app/admin/migrate-quiz-meta.js` (admin-gated route, runs server-side) that walks `cms_stories`, finds nodes with a `quiz` child, and writes `quizMeta` for each. Idempotent.
2. **Submission handler update** — modify the existing quiz submission transaction in `app/api/quiz/submit/route.js` (or wherever it currently lives) to write `userStoryTiers` and increment `attemptCount`.
3. **Story card badge component** — `app/components/QuizPill.js`. Pure render, takes `{ hasQuiz, userTier, scribblesReward }`. Reuse on homepage cards and `/quizzes` cards.
4. **`/quizzes` page** — `app/quizzes/page.js` (server) + `app/quizzes/page-client.js` (client for sort/filter state). `generateStaticParams` not needed; this page is dynamic enough to render fresh.
5. **Top nav update** — single line in `app/components/Navbar.js`.
6. **Story page indicator** — small component in `app/stories/[slug]/page-client.js`, conditional on `quizMeta.hasQuiz` and absence of completed tier.
7. **Admin reset tool** — `app/admin/quiz-resets/page.js`, gated by the existing admin auth check. Reset action goes through a server route that performs all five writes atomically.

---

## 5. Edge cases & open questions

- **Stale tier cache**: if I change the quiz (edit a question), should existing tiers reset? My instinct: no. Tiers reflect the quiz at the moment it was taken. A small footnote on the user's profile reading 'Tier earned on v1 of this quiz' is overkill for now. Flag for 3.5.
- **Cover-less stories**: a couple of older migrated stories don't have covers. The `/quizzes` cards need a fallback — use the brand purple square with a white serif `S` (the existing Calvary Scribblings logo treatment).
- **Filter persistence**: should sort/filter persist across visits? Suggest yes, in `localStorage`, no auth needed. Cheap UX win.
- **Naming claim display on `/quizzes`**: if a story has a Naming claim, a tiny pearl dot under the card title with the claimer's handle ('First named by @rebecca'). Phase 3.2 territory but worth wiring the data hook now so 3.2 is purely a render change.
- **Mobile**: pill placement on cover images needs the small-screen QA pass — at 380px, the pill plus the cover badge shouldn't overlap. Use `top-2 right-2` Tailwind, never `top-4 right-4`.

---

## 6. Done = shipped to `main` when

- Every published quiz story shows the pill on its homepage card
- `/quizzes` is in the nav and lists all quizzes with working sort/filter
- Story pages show the under-byline indicator
- Admin can reset a submission in under 30 seconds
- The migration script has run once on production data and `quizMeta` exists on every story with a quiz
- Rebecca can take the *Mother and Other Poems* quiz again

That last one is the real test.