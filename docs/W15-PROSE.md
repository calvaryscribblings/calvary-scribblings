# W15: the paragraph rulings of 26 Sept, on the web

A16 brought the app to Ikenna's prose rulings of 26 Sept. This round brings the web to the same
ones. The copy half is in `docs/COPY-RULINGS.md` (W15) and the counts half in `docs/W15-COUNTS.md`.

## The rulings

- **22.** The opening paragraph, and the first paragraph after a scene break or a heading, are
  flush left, with or without a drop cap.
  - A scene break is the CMS's `section-break`, a bare `***`, `* * *` or `— ✦ —` paragraph, and
    `<hr>`.
  - A heading is `h1`–`h6`, plus a poem's numeral.
  - Every other paragraph is indented, including one after a list, a blockquote or a figure.
  - An indent written inline into a story body still wins.
- **21.** A Series instalment sets its indented paragraphs at the stories' 1.5em, not the files'
  0.5cm. The files still decide which paragraphs are indented.
- **Centred lines** are never indented, even when the body writes an indent inline. A tracked
  centred line gives back its trailing letter-space, so it sits on the true centre.
- **35.** The 14 inline-purple ornaments in "May Nigeria Never Happen to You", "Mother and Other
  Poems" and "Seven Metres" stay purple: #6B2FAD on cream, and #9062DA wherever the web draws them
  on a dark ground.

## Where it lives

- **`app/lib/paragraphTag.js`** decides which story paragraphs are flush, and tags them
  `para-flush`.
  - It's a pure string function run inside the render, after `tagSubheads`, for the same reason
    `subheadTag.js` is one: the static export, the client and the offline shelf reader all render
    the same classes before any script runs.
  - It runs at all three places a story body is drawn: the story page, its lock preview, and the
    shelf reader.
  - The opener is the paragraph the drop cap would take (the same `prosePredicate.js` walk).
  - It looks at top-level paragraphs only, so a quotation's own paragraphs keep their rule.
  - Empty spacer paragraphs don't count as "what came before".
  - The stored bodies are never touched.
- **`app/lib/proseCSS.js`** has two new rules, marked W15:
  - A top-level paragraph after a list, blockquote, figure (or other block) is indented.
    `para-flush` sets 0, without `!important`, so an inline indent still wins.
  - A centred line (inline `text-align:center`, `.section-break`, `.poem-numeral`) has
    `text-indent: 0 !important` and `padding-left: 0.3em`. That padding equals the 0.3em tracking
    every one of those lines carries.
- **The Series.** The Series reader opens the Reading Room with `?indent=series`.
  `public/reading-room.html` then rewrites every rule in the section's own stylesheets that says
  `text-indent: 0.5cm` to `1.5em`, at the same priority. The instalments' `p.no-indent` and
  `p.scene-break` stay at 0. A book never passes the flag.

## Proof

### Story pages: `tests/typography/prose-census.mjs`

The census measured every `<p>` of every story page on the build at 390 wide: 187 pages (the
185 published stories, plus two built but unpublished) and 7,595 paragraphs. It measured once
at HEAD and once after, and diffed the two.

It first reproduced A16's figures for the old build exactly:
- 67 centred lines;
- 42 of them indented, 8.63–8.64px right of centre;
- the other 25 left of centre (10 at 2.17px, the 15 poem numerals at 2.52px, since their type is
  larger);
- the 14 ornaments at `rgb(107, 47, 173)`, which is #6B2FAD.

**After: 130 paragraphs moved, and nothing else did.**

| What moved | Paragraphs | Stories |
|---|---|---|
| Centred lines, now on the true centre (all 67 within 0.01px) | 67 | 21 |
| Flush: first paragraph after a section-break | 27 | 1967 ×2, beyond-the-metered-grid ×2, each-time-i-disappear ×4, lagos-friendship, my-daddy-is-a-superhero, my-life-at-39 ×6, the-most-dangerous-job-in-nigeria ×5, the-other-woman, the-resistance-of-the-worn-strap ×2, things-i-m-owed ×2, zee-a-love-letters-story |
| Flush: first paragraph after a bare `***` / `* * *` | 8 | peekaboo ×2, real-heartbreak, still-becoming, you-will-love-it ×4 |
| Flush: the opener, after front matter | 1 | neverland |
| Indented: after a figure | 15 | asake-m-ney-album-review ×3, how-to-make-peppersoup ×5, odeluwa ×3, release-the-footage-…, spotlight-ikenna-okeh-… ×3 |
| Indented: after a list | 10 | amor-s-cage, apple-s-quiet-health-overhaul, beyond-the-metered-grid, nostalgia-still-sells, one-scan-can-cost-you-everything, records-fell-at-the-emmys-one-didn-t ×2, sim-swapping, the-bots-are-reading-your-cv-…, the-resistance-of-the-worn-strap |
| Indented: after a blockquote | 2 | a-legacy-through-time, seven-metres-and-four-years-of-silence |

- No colour changed, and the 14 ornaments are still #6B2FAD.
- No paragraph count changed, and no alignment changed.
- The two built-but-unpublished pages contributed nothing.
- Across the 185 published bodies the classifier tags 467 paragraphs flush. 355 of them were
  already flush. The 76 that carry an inline indent (49 after a heading, 13 after a break, 12
  openers, 2 first lines) keep it, because an inline indent outranks the class.

**63 paragraph moves, not 61.** A16's list of 61 was made in the app repository and isn't in this
one, so the two lists can't be matched line for line here. The table above is the web's own list,
with a reason for every move, for the app side to compare against. There are three likely places
a difference of two comes from:
- the 8 bold-paragraph subheadings flush after a section-break (the ruling doesn't count a bold
  paragraph as a heading, so the one after it is indented);
- the web counting 187 pages where A16 counted 184;
- `neverland`'s opener.

**Dark ground.** No web surface draws story prose on a dark ground. The story page and the shelf
reader are both cream, Open Pages doesn't render story bodies, and `/reader` only opens EPUBs. So
the ornaments are #6B2FAD everywhere they appear, and #9062DA has nowhere to apply today. The
stylesheet has no `!important` colour that could repaint them, which the test pins.

### The Series: `tests/typography/paragraph-census.mjs --epubs`

This renders the four instalments' real EPUBs in the Reading Room. Books aren't affected: `--as-book`
shows the files' own 0.5cm, which is what a book gets.

| Instalment | Paragraph pairs | Before | After |
|---|---|---|---|
| beta-princess-i1 | 220 | 1.05em (0.5cm) | 1.50em |
| beta-princess-i2 | 220 | 1.05em | 1.50em |
| beta-princess-i3 | 208 | 1.05em ×196, verse 0 ×12 | 1.50em ×196, verse 0 ×12 |
| diary-of-a-lagos-9-5er-i1 | 96 | 1.05em | 1.50em |

The files' exceptions are unchanged: scene breaks, letters, end marks and diary timestamps.

### Tests

- `tests/ci/w15-prose.test.mjs` (in `npm run test:ci`), 38 tests:
  - the classifier, one case per break and heading kind;
  - after a list, blockquote, figure and subheading;
  - spacers, nesting, idempotence, an unbalanced body, and ordering with `tagSubheads`;
  - the stylesheet, and every render site;
  - the Series flag, and that the book and story registers never pass it.
- Mutations: 11 mutants of the classifier, the stylesheet, the render sites and the Series wiring,
  and all 11 were caught.
- `tests/ci/w4-gate.test.mjs` and `tests/ci/w4b-preview.test.mjs` pinned the lock preview's exact
  call. They now pin it through `tagParagraphs(tagSubheads(…))`, so the preview and the body it
  replaces render identically.
