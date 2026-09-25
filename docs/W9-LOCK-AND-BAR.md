# W9 — the archive lock, redesigned, and the story bar that drifted

25 Sep 2026. Commits `63c14e5c`, `04aed1fe`, `a4c99754`.

## The lock

One component, `app/components/ArchiveLock.js`. Its numbers, colours and words are in
`app/lib/archiveLock.js`. It serves the story archive (cream, via `StoryGate.js`) and the Series
(dark, on the instalment page and the reader's locked and signed-out states).

- **The fade had a box.** It ended in `#f5f0e8` on a reading ground of `#f0ead8`, and it sat inside
  its own 2rem side padding within the article's, so it was 64px narrower than the text and offset.
  It now runs from the ground at alpha 0 to the exact ground. Measured on live, it matches the text
  measure to 0px at 390, 820 and 1180 and ends 24px above the mark.
- **Body contrast** (measured on live): 7.61:1 on cream, 11.88:1 on dark. The old grey `#8a8378` was
  3.12:1.
- **Copy (the app's words, ruled 26 Sep — see *Rulings*):** "Every story published this week is
  free to read, Monday to Sunday. Earlier stories are open to members." The "first week" line is
  gone. Series (from A12, `5f624360`): the eyebrow is "FROM THE SERIES", the headline is "This
  instalment is closed.", and the body is the instalment's own refusal line. W9 first shipped
  "THE SERIES" / "This instalment is for members.".
- Cormorant 300 is now actually loaded. It wasn't in the font request, so any "300" rendered at 400.
- **The founder-preview pill** steps aside at once whenever its resting box comes within 24px of
  a lock block. Measured on live: 0 of 559 sampled frames overlapped. The first version slid away
  over 220ms and touched the lock on 1–2 frames per width.

## The bar: the cause

It wasn't `visualViewport`, a scroll-delta transform, or sticky inside a transformed ancestor. None
of the bar's ancestors carries a transform, filter, perspective or contain (checked in WebKit on
live). The cause was the bar's own furniture and scroll logic:

1. The bar sat at `top: 3px`. The progress line was a separate fixed element at `top: 0`, 45–61px
   away from the bar's bottom edge.
2. Hidden was `translateY(-100%)` from 3px, so it rested with 3px still on screen.
3. It flipped on every raw scroll delta, with no threshold, and it treated three kinds of browser
   motion as "scrolled up": momentum tails, rubber-band values (below 0 or past the maximum) and
   the toolbar clamping scrollY at the bottom. Reversals mid-transition made it follow the scroll.
4. Every scroll event set React state, which re-rendered the whole story page and re-bound the
   listener.

Series used `position: sticky`, which rides the top bounce in Safari.

## The bar: the rule, applied

`app/components/StoryBar.js` implements it, and `app/lib/storyBar.js` makes the decisions. The bar
is fixed at `top: 0` with `env(safe-area-inset-top)` as padding. The progress line is a child on its
bottom edge, and the hairline is an inset shadow so the two meet exactly. The bar rests only fully
shown or fully hidden, with a 32px hysteresis. Rubber-band and viewport-height changes are ignored,
and nothing sets React state per scroll. It is used on `/stories/[slug]` (story, news and poetry),
`/series/[slug]` and `/series/instalment/[id]` (always shown there).

## Proof

- `tests/storybar/bar-probe.mjs` (WebKit at 1180×820, 820×1180 and 390×844; momentum, top and
  bottom rubber-band, toolbar collapse and expand; every frame sampled):
  - **before, live:** 12 of 12 runs fail. The shown bar rests at 3px, the line is 45–61px off,
    and the bar flips during the bounce.
  - **after, live:** 24 of 24 runs pass. The shown bar is at 0px on every rested frame, the line
    gap is 0px, and there are no partial rests and no bounce flips.
- `tests/storybar/lock-shots.mjs`: the live screenshots (kept locally, since the repo is public)
  plus the measurements above. The founder session proxied the database socket to drop any client
  write, and Ikenna's records were re-read afterwards: unchanged.
- `tests/ci/w9-lock-bar.test.mjs`: 28 of 28. Each of 13 reverts was watched failing, plus the
  pill's instant step-aside.

## For the app

The lock body copy is the app's sentence. Both locks' wording is now ruled (below), so the
app matches the web, not the other way round. A change to either needs a new ruling.

## Rulings

- **26 Sep 2026, 00:36 (Ikenna) — archive lock:** the "this week" sentence stays exactly as W9 left
  it. `STORY_LOCK_COPY` is no longer DRAFT.
- **26 Sep 2026, 00:36 (Ikenna) — Series lock:** "FROM THE SERIES" / "This instalment is closed.",
  with the instalment's own refusal line as the body, stays as it is. `SERIES_LOCK_COPY` is no
  longer DRAFT.

Cleared in W10. `tests/ci/w9-lock-bar.test.mjs` pins both sets of words.
