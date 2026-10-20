# Shorelines: the Story Island card game

A physical deck of real island stories. Each card wears its typographic cover, rebuilt at card size, plus one motif drawn from the story. Ruled by Ikenna:
- bridge-size cards (57 × 89 mm)
- 54 story cards, 8 Ending cards and 1 Ring card
- one picture card per published series, wearing its curated poster, framed in Series cream (R1.1, R1.2)
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
| `posters/` | Ikenna's poster files, one per series (moved from `public/` in R1.2; nothing card-related is served by the site) |
| `data/poster-type.json` | Each poster file's own type, measured to derive its frame scale, with the method |
| `Story-Island-icon.png` | Ikenna's app icon, the source of the story back. Kept under his name for it |
| `glyphs/*.svg` | The eight motif glyphs, 6 mm with a 0.15 mm stroke |

## Rebuilding

```
cd scripts/cards && npm ci && cd ../..        # qrcode + jsqr, pinned, kept out of the site's install
node scripts/cards/motif-sheet.mjs            # refuses now: the deck is ratified (RATIFIED.md)
node --expose-gc scripts/cards/contact-sheet.mjs   # CONTACT-SHEET.png + MEASUREMENTS.md (reads posters/ and the icon)
npm run covers:lock:check                     # the covers pipeline must still say: 22 probes unchanged
```

The card code imports the cover generator's modules from `scripts/covers/` and never edits them.

A full-raster `getImageData` in @napi-rs/canvas 1.0.6 is never freed (about 14 MB a call). The sheet reads only the region around each code, and collects between cards when run with `--expose-gc`.

Not built yet, by design: the print files. The next round builds the MakePlayingCards upload set, after `RATIFIED.md` exists and the contact sheet is approved.
