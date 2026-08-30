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

## R30.1 — the eight explicit shelf colours

**Status:** live on `bookstore_titles`, web (R30.1, 30 Aug 2026). Written by
`scripts/bookstore-shelf-colour-overrides.mjs`, which **is the record** — the values live in the
database where a reader of the code cannot see them, so they live in git too, with their
reasons, under review.

### The ruling

Ikenna, on reading R30's proposed shelf: the Calvary-liveried classics must not sort as a
near-black block. They sort by their **cover artwork** — the museum paintings — so the shelf
reads chromatically rather than as a short rainbow followed by a wall.

> ⚠ **The extraction rule is untouched, and must stay untouched.** This is the whole reason the
> change is eight editorial values and not a smarter extractor.
>
> **A board whose dominant colour is `#080710` is correctly read as neutral.** rgb(8,7,16) is a
> near-black; `spectrum.js` is right about it, chroma 32 is still the line, and every future
> cover through the CMS door is still measured exactly as R30 measured these. **Nobody should
> later "fix" the extractor to produce these values automatically.** That would mean teaching a
> general rule to see past a livery only these titles wear, and it would silently re-file every
> honest near-black in the catalogue.
>
> What is true of these eight is not a defect in the measurement. It is that **a reader's
> experience of them is the painting, not the board**: the livery puts the artwork on the top
> 60% of the cover and a dark plate under it, and the plate is what wins a whole-cover
> histogram. A curator saying "file this book under the colour a reader sees" is an editorial
> act, and `coverColourOverride` is the field built for exactly it.

### The method, and why the obvious version of it fails

1. **The crop was measured, not guessed.** Mean luminance across each cover in twentieths of its
   height: every liveried cover holds high through band 12 and has collapsed to 8–28 by band 16.
   The painting is the **top 60%** — above the scrim, the wordmark and its gold rule, the title,
   the author, the CS number and the museum credit. (*The Rescue* carries no plate: 78%.)

2. ⚠ **Re-running the plain dominant-colour rule on that crop returns mud**, and this finding is
   the reason the round worked at all. Measured: Marrow `#1d1c12`, Mrs Dalloway `#343433`, The
   Awakening `#9baeaa`, Wildfell Hall `#434b3c`. All neutral, all arithmetically correct, all
   useless — the change would have moved these books from one grey to another. **A
   nineteenth-century oil's most common pixel is its tonal ground**, because that is what an oil
   painting mostly is; its colour lives in smaller, more saturated regions. *The dominant swatch
   of a painting is not the colour of a painting.*

3. So: the painting's own **hue family** first — a circular mean over every swatch carrying real
   colour (chroma ≥ 8), weighted by area *and* saturation — then, within that family, the **most
   saturated colour covering at least 2% of the board**. A real colour, really in the painting,
   in the painting's own dominant hue.

4. And **a gate**, so the method cannot invent a colour for a picture that has none: at least
   **25% of the painting must carry chroma ≥ 20**. Measured spread: 30.6% (Wildfell Hall, the
   weakest kept) against 11.8% (*The Rescue*) and 0.0% (Equiano). A clean gap, and what falls
   below it is left alone — the brief's own instruction was "say so rather than forcing a hue".

### The eight

| CS | Title | Hex | h / l / chroma | Band | Note |
|----|-------|-----|----------------|------|------|
|005|The Marrow of Tradition|`#48290b`|30 / 16 / 61|30–60°|Hue rounds to **exactly 30**, the band edge. Family is 36, so gold is the honest home — the boundary landed where the painting already pointed.|
|006|The Autobiography of an Ex-Colored Man|`#46361b`|38 / 19 / 43|30–60°|65% coloured, coherence 0.92.|
|007|The Sport of the Gods|`#3c6267`|187 / 32 / 43|180–210°|Every populous swatch between hue 162 and 189.|
|016|Beyond Good and Evil|`#e4cca8`|36 / 78 / 60|30–60°|68% coloured at coherence 0.99. No judgement call at all.|
|008|The Tenant of Wildfell Hall|`#666749`|62 / 35 / 30|**neutral**|⚠ Chroma 30 — two under the line. **Does not reach a hue band, and that is the rule working.** The override buys its true lightness (35, not the plate's 2). **Do not raise it to clear the threshold.**|
|009|The Awakening|`#8dacb4`|192 / 63 / 39|180–210°|⭑ See below.|
|010|Mrs Dalloway|`#786846`|41 / 37 / 50|30–60°|The swatch argues with the eye, which goes to the foliage. Fry's greens are heavily desaturated — one green swatch, 3% of board at chroma 12.|
|004|The Interesting Narrative|`#787977`|90 / 47 / 2|**neutral**|A neutral *correction*, not a colour. No swatch reaches chroma 8. Buys the painting's lightness (47) over the plate's (5).|

#### ⭑ The Awakening — an editorial call overriding a measurement

The one value here a later reader would otherwise "correct", so it is written down as what it
is. This is the only genuinely **split** painting of the nine — coherence 0.62, warm 60% of the
board against cool 38% — and the warm reading (`#93866b`, the sand) **won on area** and was the
defensible default that was proposed.

Ikenna took the cool: *"the novel is a woman and the sea, and the cover is a beach scene; the sky
is what the book is about."*

That is precisely what `coverColourOverride` exists for. **Do not restore the majority colour.**
The measurement is not wrong and the value is not a mistake — a person chose between two true
readings of the same picture, on grounds a histogram cannot hold.

### Left alone, on purpose

**The Rescue** (CS 012, Joseph Conrad) carries no override and must not be given one. Only 11.8%
of its painting reaches chroma 20, and that is a sliver of warm cloud-edge on a charcoal storm.
Its cover is also not the Calvary livery — no dark plate — so its stored extraction is already
the painting, and there is nothing to correct.

### For the record: the gold band is the catalogue, not a bug

Four of the eight land in **30–60°**, joining *The Yellow Trumpet* and *Whatever Happens in
Antalya*. On the fiction shelf that is five books in one band, grading by lightness
**16 · 19 · 37 · 48 · 54**; *Beyond Good and Evil* makes a sixth at 78 on the non-fiction shelf.

That is what nineteenth-century oils are — warm, earth-toned, umber and ochre — and the band
**grades rather than jumbles**, which is exactly what "order by lightness within a hue band" was
put in for. The next person to look at this shelf should read the band as a property of the
catalogue, not as a fault in the sort.

*The Sport of the Gods* and *The Awakening* open the **180–210°** band, which nothing in this
catalogue occupied before.

### What it did to the author pass

Fiction adjacencies fell from **2 to 1** (only *Slavery Is (Not) a Choice* / *Deportee* remains);
non-fiction stayed at **0**. The cool Awakening is what did it — the warm reading left the count
at 2.

One visible consequence worth expecting: on the fiction shelf the band headers now read
180–210° → 150–180° → 180–210°, because the author pass lifts *The Sport of the Gods* over
*Yahoo! Yahoo!* to break an Ikenna Okeh adjacency. That is the documented behaviour — *a nudge
may cross a band edge locally* — working in the open, not a sorting fault.

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
