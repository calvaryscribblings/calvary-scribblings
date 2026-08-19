# R13 — the curation system and the genre taxonomy: what was measured

Every image here was taken against the **Firebase emulators**, never production, using the
same fixture pattern as `tests/series/harness.mjs`: the four real published titles and the
real publisher record copied out of production (a public read), the taxonomy written by
`buildGenreMigration`, and section records written by hand into the local emulator.

**No claim in these images was published.** `bookstore_sections` in production is still
empty; the sections beyond the Window exist only in the emulator, for the preview. The claims
are Ikenna's to make in the CMS.

## The migration proof — identical tabs before and after

| | |
|---|---|
| `tabs-before.png` | the genre tab strip on the pre-R13 storefront |
| `tabs-after.png`  | the same strip after, reading from `bookstore_genres` |

**0 changed pixels of 183,040.** Captured at deviceScaleFactor 2 with the animated film grain
and the lamp pulse suppressed — those two animate independently of anything R13 touched and
would otherwise dominate a pixel diff at ±9/255. The DOM text was captured alongside and is
identical: `All Fiction · Literary Fiction · Historical · Short Story Collections`, and the
non-fiction half is absent on both, because no published title is non-fiction.

## The Window — what survived, and the one thing that did not

| | |
|---|---|
| `window-before.png` | the display case before |
| `window-after.png`  | the display case after |
| `obi-before-after.png` | the only region that differs, cropped (before on top) |

**36,552 changed pixels of 2,408,000 — 1.518% — confined to y 830–917, x 184–607.** That
rectangle is the obi band. Everything else about the case is pixel-identical: the plate, the
border, the fleuron corners, the lamp, the book, the kicker, the title, the pull quote, the
shelf card, the buy button, the sample link.

The band is gone because R13 gave it one input. It used to come from `title.featured`, which
also chose the Window; those are now two separate claims, and only a live `EDITORS_CHOICE`
section grants a band. Ikenna gets it back by claiming *After the Fact* in an Editor's Choice
section — one dropdown in the Sections panel.

## The system, rendering

| | |
|---|---|
| `shop-window-only.png` | the shop as it stands the moment R13 deploys: the Window, and nothing else claimed |
| `shop-full-system.png` | the shop with the emulator's example claims: Window → Editor's Choice → Book of the Month · August 2026 → Opening Lines → Fiction |

In `shop-full-system.png`, three of the six planned sections are absent and none of them
leaves a gap: a Book of the Month claiming July 2026 (its month ended), a Top of the Shelf
with nothing claimed, and a dormant Readers' Choice.

## The CMS

| | |
|---|---|
| `cms-sections.png` | the Sections panel — six planned, three rendering, each silence named |
| `cms-preview-editors-choice.png` | the preview, drawn with the shop's own components and the shop's own stylesheet |
| `cms-preview-expired-month.png` | the preview obeying the rule: "Nothing renders. The claim was for July 2026, and that month has ended." |
| `cms-genres.png` | the Genres panel — twelve records, three tabs shown, nine absent |
