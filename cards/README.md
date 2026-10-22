# Shorelines: the Story Island card game

A physical deck of real island stories. Each card wears its typographic cover, rebuilt at card size, plus one motif drawn from the story. Ruled by Ikenna:
- bridge-size cards (57 × 89 mm)
- 53 deck cards (50 story cards and 3 picture cards; ratified at 53, Captive 5 of 6), 8 Ending cards and 1 Ring card
- one picture card per published series, its curated poster matted whole on Series cream (R1.1, R1.3)
- eight motifs: Letter, Secret, Child, Captive, Road, House, Debt, Grave (R1.2: Captive replaced Water)
- a print-and-play prototype comes before any printer

## Where things are

| | |
|---|---|
| `review/RATIFIED.md` | **Gate 1, ratified 20 Oct 2026 (CARDS-R1.3).** The deck: 53 cards and their motifs, with the ratification record at the top |
| `review/CONTACT-SHEET.png` | **Gate 2.** The card faces, the same faces with trim, bleed and safe lines, and details at 100% |
| `review/MEASUREMENTS.md` | Every measurement, point size, code result and crop, each marked derived or chosen |
| `data/motif-draft.json` | One drafted motif (or none) for every eligible story and Series instalment, each quote checked verbatim |
| `data/deck.json` | The proposal as data, written by the motif sheet |
| `data/qr-results.json` | Every card's code: version, size and decode |
| `posters/` | Ikenna's poster files, one per series, matted whole on the picture cards (R1.3); moved from `public/` in R1.2 |
| `Story-Island-icon.png` | Ikenna's app icon, the source of the story back. Kept under his name for it |
| `review/SIGNOFF.md` | **Gate 2, approved 20 Oct 2026 (CARDS-R2).** The contact sheet's sha256 and what the sign-off authorises |
| `print/mpc-playtest/MANIFEST.md` | The MakePlayingCards upload set for playtest deck 1: slot, files, title, motif, livery, code. The images themselves are delivered privately (draft release `shorelines-playtest-1`), never committed |
| `review/MPC-PROOF.png` | Every upload image, decoded from the exported JPEGs, with MPC's trim and safe area |
| `glyphs/*.svg` | The eight motif glyphs, 6 mm with a 0.15 mm stroke |
| `data/first-lines.json`, `review/FIRST-LINES.md` | **CARDS-R3.** Every card's first sentence, verbatim, read signed out, with every flag (furniture passed over, verse, dialogue, sentence-boundary judgements, over 40 words). The three picture cards have none: the series endpoint refuses a signed-out reader |
| `review/PAPER.md`, `review/PAPER-SHEET.png` | **CARDS-R3.** The playtest paper: The Turn's guess slips, the First Lines Ledger, the scorepad. Every measurement D or C, the sheets a six-player night needs, and every sheet rendered from the PDFs with details at 100%. The PDFs are delivered with the draft release, never committed |

## Rebuilding

```
cd scripts/cards && npm ci && cd ../..        # qrcode, jsqr, pdfkit, pdfjs-dist: pinned, kept out of the site's install
node scripts/cards/motif-sheet.mjs            # refuses now: the deck is ratified (RATIFIED.md)
node --expose-gc scripts/cards/contact-sheet.mjs   # CONTACT-SHEET.png + MEASUREMENTS.md (reads posters/ and the icon)
node --expose-gc scripts/cards/mpc-export.mjs     # the MPC upload set + MANIFEST.md + MPC-PROOF.png
node scripts/cards/first-lines.mjs           # FIRST-LINES (add --fetch to ask the live site again, signed out)
node scripts/cards/paper.mjs                  # the three playtest PDFs (cards/print/paper/) + PAPER.md
node scripts/cards/paper-sheet.mjs            # PAPER-SHEET.png, rasterised from those PDFs
npm run covers:lock:check                     # the covers pipeline must still say its probes are unchanged
```

The card code imports the cover generator's modules from `scripts/covers/` and never edits them.

A full-raster `getImageData` in @napi-rs/canvas 1.0.6 is never freed (about 14 MB a call). The sheet reads only the region around each code, and collects between cards when run with `--expose-gc`.

Both gates are passed (RATIFIED.md, SIGNOFF.md). The first print export is the MakePlayingCards playtest set (CARDS-R2).

`first-lines.mjs --fetch` asks `/api/story` with no token and no telemetry fields, so each call adds one to `story_clients/<day>/story/unknown`, as any unlabelled open does. The responses are kept in `~/calvary-private/cards-first-lines/`, outside the work tree, and a plain run rebuilds from them without calling anything.
