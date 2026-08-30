# `coverColour` — the shelf's colour field

**Status:** live on `bookstore_titles`, web (R30, 30 Aug 2026). The app reads it next round.

This is a **cross-repository interface**, in the same class as
[`docs/cfi-exchange-protocol.md`](./cfi-exchange-protocol.md): two codebases have to produce
the *same shelf* from the same records, so the field's shape and the arithmetic applied to it
are written down here rather than being inferred from either implementation.

---

## The ruling this serves

Ikenna, 30 August 2026:

> Arrange the books by colour. Make the store beautiful.

With a second ruling folded into the same round: **no author may cluster** — publication-date
order had put every one of one author's titles in a row, and that is the reason the round
happened at all.

> ⚠ **CS numbers are untouched by any of this.** `catalogueNumber` is an accession mark. It is
> permanent, never reused, never resequenced, and it is printed on the shelf ticket, the
> bookplate, the reader and My Library. R30 changes the **walk order** of a shelf — which book
> stands next to which — and nothing else. A CS number appears in the sort in exactly one
> place: the final tiebreak.

---

## The two fields

Both are **schema-external** — `TITLE_SCHEMA` in `app/lib/bookstore/schema.js` is locked, and
these ride onto the record through the loader's spread exactly as `samplePath`, `glossary`,
`catalogueNumber`, `coverSizes` and `coverLqip` already do. Neither has a `.validate` rule to
add in `database.rules.json`; there is no `$other` deny on the node to refuse them.

```
bookstore_titles/{titleId}/
  coverColour          { h, s, l, c, hex, v }   what the machine read off the cover
  coverColourOverride  { h, s, l, c, hex, v }   what a human said instead — and it wins
```

| key   | type          | meaning                                                        |
|-------|---------------|----------------------------------------------------------------|
| `h`   | int `0–359`   | hue, degrees around the wheel                                   |
| `s`   | int `0–100`   | HSL saturation, percent. **Not** what neutrality is judged on.   |
| `l`   | int `0–100`   | lightness, percent. Orders books *within* a hue band.            |
| `c`   | int `0–255`   | **chroma** — `max(r,g,b) − min(r,g,b)`. Decides the shelf-end.   |
| `hex` | `'#rrggbb'`   | the same colour, to paint a swatch. **Never sorted on.**          |
| `v`   | int           | shape version. Currently `1`.                                    |

`null`, or the field absent, is a supported value everywhere — see *Absent colour* below.

### Why both keys exist

Colour is editorial the moment it is wrong. A dark painting extracts as a near-neutral; a
duotone files under whichever ink covers more board; a cover that is 70% cream with a red title
*is* cream on a 106px shelf board, right up until Ikenna looks at it and says it is red.

If an override were written into `coverColour`, the next re-upload or `--force` backfill would
silently erase a human decision. So the machine owns one key and the human owns the other, and
`coverColourOf()` states which wins. Clearing the override hands the book back to the machine
rather than leaving a hole.

### Why `c` is stored when it is derivable

It is exactly derivable: `c = (1 − |2l − 1|) × s × 255`. It is stored anyway, because it is the
value the sort's single most consequential decision turns on — *which end of the shop a book
stands at* — and `s` and `l` are stored **rounded**. Asking a second codebase to reconstruct
that from two rounded integers, with its own idea of the formula, is precisely what an
interface exists to prevent. One integer is cheaper than that argument.

A record written without `c` (hand-edited, or predating the field) has it **derived** by
`normaliseCoverColour` rather than being rejected. A book never falls off the shelf because one
of five numbers is missing.

---

## The order

All of it lives in **`app/lib/bookstore/spectrum.js`**, which is pure: no clock, no database, no
DOM, and no imports at all. `arrangeShelf(titles) → { order, unbroken }` is the whole contract.

### 1 · The colour walk

Sort key, compared left to right:

| # | key         | value                                                                    |
|---|-------------|--------------------------------------------------------------------------|
| 0 | shelf-end   | chromatic → neutral → unplaced                                            |
| 1 | hue band    | `floor(((h − HUE_ORIGIN) mod 360) / HUE_BAND_DEGREES)`, chromatic only     |
| 2 | lightness   | `l`, ascending — so each band itself grades dark → light                   |
| 3 | CS number   | `catalogueNumber` ascending. **The final tiebreak, and its only appearance.** |
| 4 | slug        | last resort, for a title with no CS number yet                             |

Named constants, and why they are what they are:

| constant               | value | reason |
|------------------------|-------|--------|
| `HUE_ORIGIN`           | `0`   | Reds first, so the shop opens warm — it meets the gold lamp and the `#c9a84c` house tone rather than arguing with them, and red → violet is the order every reader already has in their head. Changing this one number rotates the whole shop and nothing else. |
| `HUE_BAND_DEGREES`     | `30`  | Measured, not chosen for tidiness. The live catalogue's chromatic covers cluster between 0° and 60°; at 60° bands that entire cluster collapses into one band ordered by lightness, and crimson would stand next to mustard. At 15° each band holds one book and "grade by lightness" stops meaning anything. |
| `NEUTRAL_CHROMA_MAX`   | `32`  | See below. |
| `AUTHOR_NUDGE_WINDOW`  | `2`   | The smallest window that can step over a *pair* of same-author books, and the largest that keeps a nudge inside its own neighbourhood. |
| `COVER_COLOUR_SAMPLE_WIDTH` | `48` | Wide enough that a title band or a spine flash cannot win the histogram; small enough that a browser canvas and `sharp` resample to something close. |
| `COLOUR_QUANTISE_BITS` | `5`   | 8 bits histograms noise; 4 bits merges colours a reader can plainly tell apart. |

### 2 · Neutrals are their own shelf-end

Covers below the chroma threshold form **one band after the last hue band**, graded **dark →
light**.

> **The brief asked for a *saturation* threshold, and the verify run proved saturation cannot do
> the job.** Seven of this shop's classics share a near-black livery extracting to `#080710` —
> `rgb(8,7,16)`, a board no reader would call violet — whose **HSL saturation is 39%**. *The
> Tenant of Wildfell Hall* reads **72%**. HSL saturation is a ratio against a lightness that is
> nearly zero, so at the dark end it amplifies a nine-value difference into most of the scale.
> Any `s` threshold high enough to catch those eight boards would first swallow the deep maroon
> of *Rogues of the East* at `s` 84. There is no `s` that separates them.

Chroma does, with a gap you could drive a shelf through. Measured over all 22 live covers:

```
0 0 0 1 2 3 8 9 9 9 9 9 9 9 11 17  │  54 88 104 190 217 245
── cream, greys, near-blacks ───────┴── everything with ink in it ──
```

`NEUTRAL_CHROMA_MAX = 32` sits in the middle of that gap — twice the highest neutral, well under
half the lowest chromatic. It is out of 255 because that is the space the pixels are in; as a
percentage, 12.5%.

**Dark → light is derived, not preferred.** With the wheel starting at red, the last chromatic
book in this shop is a deep green at lightness 22. Running the neutrals light → dark would put a
pure-white board at lightness 100 hard against it and then walk back down into black — a jump,
then a decline. Dark → light continues almost exactly the tone the green ends on, and the shelf
resolves upward into the cream essays. The shop opens warm, deepens, and closes quiet and light.

### 3 · The author pass

One deterministic forward pass over the colour walk. Normally take the head of the queue; if the
head shares an author with the book just placed, look ahead up to `AUTHOR_NUDGE_WINDOW`
positions for the first book that does not, and place that one first — the same movement as
nudging the clashing book down one or two places, described from the other side.

Author matching is case- and whitespace-insensitive and normalises nothing else.

**The bound is structural, not a promise.** No book can be displaced further than the window,
because the window is the only distance the pass can see. Consequently *any two books more than
`2 × AUTHOR_NUDGE_WINDOW` apart in the colour walk stay in walk order* — the spectrum survives
intact at every scale larger than a nudge. A nudge **may** cross a band edge locally; forbidding
that would forbid the author ruling from applying at a band edge at all.

**It degrades, it does not loop.** If nothing within the window has a different author — a shelf
one author dominates — the pass places the clashing book anyway and records the pair in
`unbroken`. It never searches further, never backtracks, never retries. On the live catalogue
this leaves **3 unbroken adjacencies out of 22**, all Ikenna Okeh, who holds 8 of the 22 titles.

### 4 · Absent colour

A title with no `coverColour` and no override is filed at the **very end of the walk**, in CS
order. Present, findable, obviously un-arranged. This is the same posture `coverSrcSet()` (R20)
and `coverLqip()` (R29) take: a title that predates a derivative is a normal title, not a broken
one, and nothing is ever dropped from the shop because an optimisation was unavailable.

---

## Where the order applies

**It does:** the All Fiction shelf, the All Non-Fiction shelf, and every genre tab.

**It does not:** the Window, the interleaved section tables (Editor's Choice and friends keep
their claimed books and their stops — every R15 placement ruling stands), or any curated order.
The shelf *between* the tables takes the spectral order; the tables float where their stops put
them.

> ⚠ **The sort is applied to the filtered set, not to the catalogue and then filtered.** The
> colour half would give the same answer either way — a total order's subsequence is that order
> — but the author half would not. On the All Fiction shelf a third author's book may be the
> only thing standing between two of one author's; the moment a genre tab filters that book
> away the two close up. A shelf that only obeys the no-clustering ruling when unfiltered does
> not obey it.

The curated tables cannot move: `interleaves` is a list of **depths** into the shelf and
`planShopFlow` counted them off the shelf's **length**. Neither is something a re-ordering can
change, so every stop is exactly where R15 put it and only the books standing at it differ.
`tests/bookstore/placement.spec.mjs` asserts that against the real static export.

---

## Where the colour is written

Two writers, sharing **one** extractor — `dominantColourFromPixels` in `spectrum.js`, which
takes a raw interleaved pixel buffer and knows nothing about canvases or files. A browser copy
and a Node copy of a histogram would agree on the day they were written and drift by the second
time either was touched, and the shelf order would then depend on *which door a cover came
through*.

| writer | when | how |
|---|---|---|
| `app/lib/coverDerivatives.js` → `buildCoverColour` | CMS upload, the same moment R20 cuts the rungs and R29 cuts the stand-in | canvas `getImageData`, RGBA |
| `scripts/backfill-bookstore-cover-colour.mjs` | `npm run covers:backfill:colour` | `sharp` `.raw()`, RGBA |

**The method** is a histogram, not a mean. Averaging a red cover with black type and a cream
margin gives a brown that appears nowhere on the board — averages of colours are not colours.
So: quantise to 5 bits per channel, count, take the most populous bucket, and return the **mean
of that bucket's members**. Ties break on the lowest bucket key.

Neither writer ever throws, and neither is gated on. A title that saves without a colour files
at the end of the walk. A cover that will not save is a book the shop does not have.

### The backfill

```
npm run covers:backfill:colour                    # plan + the proposed shelf, no writes
npm run covers:backfill:colour -- --apply         # extract and write coverColour
npm run covers:backfill:colour -- --slug basil --apply
npm run covers:backfill:colour -- --force --apply # re-cut existing ones
npm run covers:backfill:colour -- --json out.json
```

Plan mode prints the whole proposed shelf with true-colour swatches, because R30's brief was
verify-first: the order goes in front of Ikenna before the shop is rearranged.

> ⚠ **`--force` never touches `coverColourOverride`.** The script writes `coverColour` only.

`sharp` is script-only and deliberately out of `package.json`, exactly as the derivative and
stand-in backfills say of it. It never runs in a build.

---

## For the app

Read `coverColourOverride` first, then `coverColour`. Apply the key in *The order* above,
verbatim, including `HUE_ORIGIN = 0`, `HUE_BAND_DEGREES = 30`, `NEUTRAL_CHROMA_MAX = 32`,
lightness ascending, CS number as the final tiebreak, and the forward author pass with
`AUTHOR_NUDGE_WINDOW = 2`. Apply it to whatever set is about to be drawn — never to the whole
catalogue followed by a filter.

Do not re-extract from pixels. The record is the answer, and both surfaces must reach the same
shelf from it.

---

## Tests

`tests/bookstore/spectrum.test.mjs` (`npm run test:spectrum`, also swept by `test:purchases`).
It asserts the order is a pure function of the catalogue; that rotating or reversing the input
changes nothing; that neutrals band correctly **and that moving the threshold reclassifies a
book** (the mutation the brief asked for); that the author pass breaks every breakable adjacency
and displaces at most `AUTHOR_NUDGE_WINDOW`; that an unbreakable shelf degrades and reports; and
— read as text — that `catalogueNumber` is read on exactly one line of `spectrum.js` and
assigned on none.

Every fixture in that suite is invented, deliberately, and it is the opposite of the decision
`tests/bookstore/live-slug.mjs` makes for the surface suites. Those must not hardcode a slug
because the catalogue is Ikenna's; this one must not read the catalogue, because a suite whose
expected order came from the same database as its input would pass no matter what the function
did.
