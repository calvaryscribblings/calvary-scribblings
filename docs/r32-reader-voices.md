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
