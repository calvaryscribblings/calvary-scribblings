# Story Island: the card game

A physical deck of real island stories. Each card wears its typographic cover, rebuilt at card size, plus one motif drawn from the story. Ruled by Ikenna:
- bridge-size cards (57 × 89 mm)
- 54 story cards, 8 Ending cards and 1 Ring card
- the Series are the picture cards, in curated artwork
- a print-and-play prototype comes before any printer

## Where things are

| | |
|---|---|
| `review/MOTIF-SHEET.md` | **Gate 1.** The proposed deck. It becomes `RATIFIED.md` only by Ikenna's rename, or by his quoted authorisation recorded at the rename |
| `review/CONTACT-SHEET.png` | **Gate 2.** The card faces, the same faces with trim, bleed and safe lines, and details at 100% |
| `review/MEASUREMENTS.md` | Every measurement, point size, code result and crop, each marked derived or chosen |
| `data/motif-draft.json` | One drafted motif (or none) for every eligible story and Series instalment, each quote checked verbatim |
| `data/deck.json` | The proposal as data, written by the motif sheet |
| `data/qr-results.json` | Every card's code: version, size and decode |
| `glyphs/*.svg` | The eight motif glyphs, 6 mm with a 0.15 mm stroke |

## Rebuilding

```
cd scripts/cards && npm ci && cd ../..        # qrcode + jsqr, pinned, kept out of the site's install
node scripts/cards/motif-sheet.mjs            # MOTIF-SHEET.md + data/deck.json
node scripts/cards/contact-sheet.mjs          # CONTACT-SHEET.png + MEASUREMENTS.md (reads the Series posters)
npm run covers:lock:check                     # the covers pipeline must still say: 22 probes unchanged
```

The card code imports the cover generator's modules from `scripts/covers/` and never edits them.

Not built yet, by design: the sheet imposition and the print-and-play PDF. They come in the next round, after `RATIFIED.md` exists and the contact sheet is approved.
