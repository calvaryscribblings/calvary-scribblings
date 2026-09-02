# R32 — Reader voices on the trailer cards

Shipped 2 Sept 2026. Every story-trailer card in the home carousel now carries two quotes:
the writer's trailer line (the house speaking) and a real reader's comment from that story
(a reader speaking).

Where things live:

| What | Where |
|---|---|
| Eligibility, abridging, rotation, identity ladder | `app/lib/trailerVoices.js` |
| The stage measurement | `app/lib/pinQuoteStage.js` |
| The classifier — prompt, tool, parse | `app/lib/voiceScreening.js` |
| The write-time check | `functions/api/comments/screen.js` |
| The one backfill | `scripts/screen-comments.mjs` |
| The card | `app/public-library/page.js`, `app/globals.css` |
| The verdict | `comment_screening/{slug}/{commentId}.promotable` |

---

# R32.1 — what the backfill found

The backfill ran 2 Sept 2026. 425 calls, 306 promotable, 129 of the 157 quoted stories now
end with at least one reader's line. Four things came back with it, and this is the record.

## 1. ⭑ SPOILER IS A LEADING REFUSAL, AND NOBODY PREDICTED IT

Of the refusals on record, **44 are spoilers** — the largest single category, ahead of the
whole off-topic family once its four spellings are merged (36 + 21 + 2 + 1 = 60 across the
family, but no single label near spoiler's 44).

**The brief never asked for this.** Ikenna's three words were *abusive, spammy, or simply
embarrassing*, and the spoiler clause went into the system prompt as an afterthought about
the card being an invitation to read. It turned out to be the clause doing the most work.

It is also the failure that would have been worst. An embarrassing comment on the front page
is an embarrassment; **a comment revealing a story's ending, promoted by the house beside
that story's own trailer quote, on the first screen a new reader sees, destroys the thing the
card exists to advertise** — and does it to the reader most likely to have clicked. The
carousel is an invitation, and 44 of the comments eligible to appear on one were an answer.

There is no action here. The screening already catches them, and it catches them because
somebody wrote one line into a prompt. The finding is that **the line earns its place**, and
that if the classifier is ever simplified, tightened for cost, or replaced with a filter, the
spoiler clause is the last thing to go, not the first.

## 2. THE REFUSAL VOCABULARY IS CLOSED — `SCREENING_VERSION` 2

Version 1 let the model name its own reason. Over 129 refusals it produced **27 distinct
labels** for six or seven real reasons: `off-topic` / `not about the story` /
`not_about_story` / `no_story_reference` are one category in four spellings, and an
eleven-strong family (`unclear context`, `context-dependent`, `no context`, `out of context`,
`out-of-context`, `lacks context`, `incomplete context`, `contextual fragment`,
`unclear reference`, `inside-reference`, `unclear`) is one more.

**The verdict was never affected** — `promotable` is a boolean and the model got it right —
so **nothing was rescreened**. What a free-text reason cost is everything downstream: it
cannot be counted, cannot be filtered, cannot be acted on by a rule that needs a stable key,
and drifts silently under any dashboard built on it the moment the prompt or the model moves.

The closed list, derived from what the run actually found:

| label | v1 labels folded in | count |
|---|---|---|
| `spoiler` | — | 44 |
| `off-topic` | `not about the story`, `not_about_story`, `no_story_reference`, `political advocacy`, `sports prediction`, `generic advice`, `generic platitude` | 66 |
| `needs-context` | the eleven-strong context family, plus `fragment`, `incomplete` | 30 |
| `self-promotion` | — | 10 |
| `incoherent` | — | 8 |
| `spam` | `likely spam or bot` | 8 |
| `abuse` | — | 0 |
| `explicit` | `violence` | 1 |
| `other` | anything unforeseen | — |

`abuse` and `explicit` are on the list although the backlog had almost none: **the system
prompt refuses on them, and a closed list missing a reason the prompt names would force the
model to mislabel.** `other` is the escape hatch, and it is dropped whenever a real label sits
beside it.

The list is stated in **three places** — the tool schema `enum`, the system prompt's
`CATEGORIES` block, and `normaliseCategories()`. All three, because a schema enum is a strong
hint and not a guarantee; **the coercion is the part that holds.** An off-list word becomes
`other`, and — the one thing this change must never do — **it does not throw.** Turning a
labelling quibble into a fail-closed would let a mislabel demote a perfectly promotable
comment, so the verdict is untouched by anything that happens to `categories`.

The 474 version 1 rows keep the words they were given. `foldCategory()` reads them in the new
vocabulary without rewriting one, and `screen-comments.mjs --apply` now prints the whole
stored history folded — the census that was impossible before the list was closed.

**Not tightened: `database.rules.json`.** The `categories` validator still accepts any string
under 64 characters. Founders hold `.write` on `comment_screening` so `promotable: false` can
be set by hand, and an enum there would reject a hand edit that put a **version 1** row back
with its original free-text labels. The boundary that matters is the coercion in
`parseScreeningResponse`, which every writer goes through.

## 3. ⚠ FAIL-CLOSED IS A DEFERRAL, NOT AN EXCLUSION — CONFIRMED

One comment failed closed on a fetch error: `life-will-be-hard/-Oz1RjHH1T2ubaMJH2RH`.

**Verified against live data, 2 Sept 2026.** `comment_screening/life-will-be-hard/-Oz1RjHH1T2ubaMJH2RH`
is `undefined` — the failure wrote nothing at all. The comment is still eligible (226 chars,
not a reply, its story carries a trailer quote, `isScreenable` true), and the only line of the
funnel that removes anything is `already carries a verdict`. So it is queued again, and a dry
run today prints it as **the entire queue**:

```
  − already carries a verdict                        -474
  = calls this run will make                            1
```

**It is retried. It is not permanently excluded. There is no defect.**

⚠ **But nothing schedules the retry, and the endpoint is not it.** The browser fires
`/api/comments/screen` once and forgets it (`app/lib/requestScreening.js` — deliberately, so a
moderation failure can never block a comment), and never fires again. The endpoint returns
early on a comment that has a verdict and does nothing for one that has none until asked. **A
later run of `scripts/screen-comments.mjs` is the whole retry path**, and it is a hand-run
script. The header that called it a once-only job has been corrected; whether it wants the
`*/15` cron treatment that R18 gave the covers reconciler is a separate decision — at one
stranded comment per 425, on a $0.002 call, it is not urgent.

## 4. ⚠ THE ESTIMATOR WAS 100% LOW — CORRECTED AT THE SITE

The R32 report projected **526 input / 70 output** tokens per call. The run's own `usage`
blocks came back at **~1,297 input**, and the cost at almost exactly double the projection —
which puts output at ~91. Every figure derived from that estimator was half of the truth,
**including the 10×-traffic number Ikenna ruled on.**

**Why.** The guess priced the system prompt and the comment. It missed three things, all of
them billed input:

1. **The tool definition.** `tools: [TOOL]` is serialised into every request and charged like
   any other input — ~620 characters of schema nobody counted.
2. **The tool-use scaffolding.** Supplying `tools` at all makes the API prepend its own
   instructions about calling one, and `tool_choice: { type: 'tool' }`, which this call
   forces, is the most expensive form of it. Several hundred tokens that **exist in no string
   in the file** and so cannot be found by reading the source.
3. The system prompt itself was under-counted; it is 2,000+ characters of prose.

The lesson is (2): **a prompt's token cost is not the length of its text.**

**The fix.** `PROJECTED_IN`/`PROJECTED_OUT` are gone from `scripts/screen-comments.mjs`, and
so are its private copies of the rates. The projection now comes from `estimateCallCost()` in
`app/lib/voiceScreening.js`, which is:

- **anchored to the measurement**, not to a guess — `CALIBRATION` carries the run's real
  per-call tokens along with the prompt size they were measured at;
- **self-correcting for prompt edits** — `promptChars()` measures system + tool schema +
  wrapper as they stand today, and the estimate moves by the difference. Closing the
  refusal list added 1,251 characters, and the estimate went up by 321 tokens on its own;
- **checked on every run** — after 50 calls the script prints measured against estimated, and
  past 15% disagreement prints a `DRIFT` block containing the replacement `CALIBRATION`
  object to paste. The old script compared against a hardcoded guess and printed *"100% off"*
  as if that were a normal result.

### The restated figures

Haiku 4.5, first-party rates ($1/Mtok in, $5/Mtok out).

| | in / out | per call |
|---|---|---|
| R32 projection | 526 / 70 | $0.000876 |
| **R32 measured** | **1,297 / 91** | **$0.001752** — 100% higher |
| R32.1, with the closed list in the prompt | 1,618 / 91 | $0.002073 — a further 18% |

The closed list is not free: it costs about **18% per call**, and the estimator surfaced that
by itself, which is the point of it.

Ongoing volume, measured over `comments/*` timestamps on live data:

| month | comments | eligible for screening |
|---|---|---|
| Apr 2026 | 64 | 11 |
| May 2026 | 239 | 46 |
| Jun 2026 | 369 | 58 |
| Jul 2026 | 294 | 55 |
| **Aug 2026** (Summer Reading) | **1,374** | **298** |

**The ongoing monthly figure, restated:**

| scenario | calls/mo | old (wrong) | **corrected** |
|---|---|---|---|
| steady state — Apr–Jul mean | 43 | $0.04 | **$0.09** |
| 5-month mean, contest included | 78 | $0.07 | **$0.16** |
| a contest month like Aug 2026 | 298 | $0.26 | **$0.62** |
| **10× steady state** | 425 | $0.37 | **$0.88** |
| **10×, contest included** | 780 | $0.68 | **$1.62** |
| **10× a contest month** | 2,980 | $2.61 | **$6.18** |

And the backfill itself: projected $0.37 for 425 calls, actually **$0.74**.

**Nothing here changes the ruling.** The worst case on the board — ten times the busiest
month this platform has ever had, every eligible comment screened — is **$6.18 a month**, and
the realistic ongoing number is **under twenty cents**. The estimator being 100% low mattered
because it was wrong, not because it was expensive: the same code produced the number a
decision was taken on, and it would have gone on producing halved numbers for every future
one.

---

## ⚠ OWED — three things this round found and did not fix

### 1. Two live trailer quotes are animating an editor's rationale

**Ikenna is fixing these himself in the CMS** — faster than a round, and the reason R32 did
not touch them. Both are in `cms_stories_index/{slug}/trailerQuote`:

- **`puppy-love`** — ends `…" — the opening's quiet, specific ache, before the reader knows
  what's coming.`
- **`lust-is-a-symphony-of-colours`** — ends `…" — the strongest, most evocative single
  image, inviting without being the poem's most explicit line.`

In both, an editor's note about *why the line was chosen* was saved into the quote field, and
the homepage animates it word by word as if the story said it. Both also carry an unmatched
closing curly quote. They are the only two of the 157 with this shape (`grep` for a closing
quote mark followed by an em dash).

They are also two of the four tallest quotes in the pool, so trimming them lowers the
measured pin — from 335px to 278px at 1440. **Nothing needs changing in code when they are
fixed**: the pin is measured at render over whatever the pool actually contains.

### 2. The story pages still show stale names — a round of its own

R33 found identity photographed at write time in the Square. The same disease is in the
comments, measured on live data 2 Sept 2026:

- **447 of 1,830** stored `authorName` copies (**24.4%**) disagree with the reader's live
  `users/{uid}` record — mostly short names since filled out (`J Tech` → `Nzubechukwu Okere`,
  `Chi chi` → `Chinemerem`) and trailing-space edits.
- **29 of the 99** commenters hold no name at all in `users/{uid}` — their record has only
  `readCount` and `readStories` — so for them the stored copy is the only name that exists.

**R32 fixed the carousel only.** The trailer card resolves name, photo and badge from
`users/{uid}` at render and never from the comment. `app/stories/[slug]/page-client.js` and
`app/reader/[slug]/page-reader.js` still render `comment.authorName` verbatim, so the story
pages keep showing the stale quarter. Fixing them is a separate round: it touches two comment
lists, the reply rendering, and the 29 readers with no live name at all — for whom the
correct behaviour on a story page is probably the stored copy, not a blank, which is the
opposite of the carousel's answer.

`resolveVoiceIdentity(user, stored)` in `app/lib/trailerVoices.js` already implements the
full ladder including that last rung. The carousel passes `null` for `stored` deliberately;
the story-page round is what the parameter is for.

### 3. The attribution wrap — FIXED HERE, recorded so the measurement is not lost

Found while measuring, not reported by anyone: `from {title} · {author}` was free-height and
wrapped to two lines on **11 of the 157** live quotes at 390px, so the line under the gold
rule was already jumping 17px between rotations before R32 existed. It is inside this round's
held-height work, so it is fixed here — `.trailer-attr` is clamped to one line with an
ellipsis — and `tests/voices/heights.spec.mjs` asserts it never wraps at any width.

---

## Running it

```bash
node scripts/screen-comments.mjs                 # the funnel and the projected cost, no spend
ANTHROPIC_API_KEY=… node scripts/screen-comments.mjs --apply --limit 50   # prove the cost
ANTHROPIC_API_KEY=… node scripts/screen-comments.mjs --apply             # the whole backlog

npm run test:voices          # the logic — 22 cases, 19 mutations each observed red
npm run test:voices:heights  # the held heights over the LIVE pool, five viewports
```

The endpoint needs `ANTHROPIC_API_KEY` in the Cloudflare Pages environment. Until the
backfill has run, no comment is promotable and no trailer step is emitted — the carousel
shows plain cards, which is the correct fail-closed state and not a bug.
