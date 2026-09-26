# W11: the copy rulings, and the byline dot

The rulings, every changed string, both locks word for word, the offline verdict (ruling 11) and
the paragraph measurements (ruling 15) are in `docs/COPY-RULINGS.md`. The under-18 scrub plan
summary is `docs/ACCOUNT-SCRUB-PLAN.md`. The copy elsewhere that breaks rule 13, left for
Ikenna's separate ruling, is `docs/RULE-13-OPEN-LIST.md`.

## The byline dot

**The fault.** On a story page the byline was `by · name · dot · date · dot · time`, each a
flex item of its own. At phone widths the row wraps, and a dot could land at the head of a line
("• 2 MIN. READ" on "You" at 402) or hang at the end of one (at 390). The live census counted:

| Width | Bylines | Lines starting with a dot | Lines ending with a dot |
|---|---|---|---|
| 390 | 187 | 55 | 132 |
| 402 | 187 | 28 | 159 |
| 820 | 187 | 0 | 0 |
| 1180 | 187 | 0 | 0 |

It also left "by" alone on its own line for 11 stories with long names, at both 390 and 402.

**The fix** is the app's A13, in CSS (`app/stories/[slug]/page-client.js`).
- Every item carries a leading separator of one fixed width: gap, 3px dot, gap.
- The row is pulled left by exactly that width inside an `overflow: hidden` box, so whichever
  item starts a line has its dot in the clipped strip.
- The gap is today's: 1.4rem (22.4px) at desktop and 0.6rem (9.6px) under 600px, so the spacing
  either side of a dot is unchanged.
- The dots are real spans, so they can be measured, and are `aria-hidden`.

**The census after** (`tests/typography/byline-census.mjs`, every story on the build):

| Width | Bylines | Lines | Starting with a dot | Faults | Gap either side of every dot |
|---|---|---|---|---|---|
| 390 | 187 | 374 | 0 | 0 | 9.59px |
| 402 | 187 | 374 | 0 | 0 | 9.59px |
| 820 | 187 | 187 | 0 | 0 | 22.39px |
| 1180 | 187 | 187 | 0 | 0 | 22.39px |

A fault would be any of these:
- a drawn dot at the head of a line;
- a later item without a drawn dot;
- a gap off by more than 0.5px;
- text not flush left;
- an item running past the clip.

**What else moved, measured against the live site:**
- **726 of 748** bylines break exactly as before. Their 2,117 items sit at the same positions to
  0.0px, apart from 61 items that each moved left by exactly 12.6px. Those are the ones that
  used to sit behind a stray leading dot (the 3px dot plus its 9.6px gap).
- **The other 22** (11 stories, at 390 and 402) are the stranded "by". "by" now stays with the
  name, because the two are one item.

Nothing else on the page changed.

## Tooling added

- `tests/ci/w11-copy-rulings.test.mjs` (in `npm run test:ci`) pins every ruled line, checks
  rule 13 mechanically, and fails if a DRAFT mark returns to any of the eight files.
- `tests/typography/byline-census.mjs` is the census above. It works on the old DOM too, so it
  can be pointed at the live site.
- `tests/typography/paragraph-census.mjs` covers ruling 15, on story pages and on the Series
  reader rendering the real EPUBs.
- `tests/typography/lock-words.mjs` records both locks' words as drawn.
- `tests/offline/offline-shelf-probe.mjs` covers ruling 11 on the live site. It uses the founder
  session with the socket write-firewall, and re-reads the account's records afterwards.

Screenshots were kept locally, because the repo is public.
