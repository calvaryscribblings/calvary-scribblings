# R17.4 — the fore-edge becomes a proportion: what was measured

Every image here was taken against the **real static export** (`out/`, served locally), at
`deviceScaleFactor: 3`, with animation and transition suppressed. Regenerate the whole
directory — both halves and the JSON — with:

```
npm run build && node scripts/capture-foreedge.mjs
```

## Why there is a "before" at all, when the old rule no longer exists

The pair is shot in **one run, from one page**. The `after` frames are the shipped rule. The
`before` frames are the same page with R17.4's declaration overridden by the one it replaced —
`width:12px; right:-11px`, verbatim from `da3b53d` — and nothing else. So the two frames differ
in exactly one declaration by construction, which is what makes the pair readable as a
difference rather than as two screenshots that happen to sit side by side.

Nothing was checked out, and no frame was re-cropped by hand.

## The defect, and the number it is

The web and the app were never drawing *different* fore-edges. The app's `lib/bookDepth.ts`
transcribed this element **from this repo's own stylesheet** — the same fixed `12`, the same
`-11` tuck, the same 2.5% insets, radius, tones and side shadow. Both platforms carry the
identical fixed 12px. What differs is what a fixed 12px *means* on a board that changes size:

| surface | board | fore-edge | fraction |
|---|---|---|---|
| app, iPad — **the ratified look** | 245.33pt | 12 | **4.891%** |
| web, laptop shelf | 200px | 12 | 6.02% |
| web, Window | 190px | 12 | 6.33% |
| web, curated case | 170px | 12 | 7.07% |
| web, 390px handset | 106px | 12 | **11.26%** — the slab |

So the ruling is a **proportion**, and that is what the width now is:
`max(2px, calc(100cqw * 12 / 245.33))`.

## The four before/afters

| frame | board | before | after |
|---|---|---|---|
| `window-190-*.png`  | 190px | 12.04px = 6.33%  | 9.31px = 4.90% |
| `curated-170-*.png` | 170px | 12.01px = 7.07%  | 8.32px = 4.89% |
| `shelf-200-*.png`   | 200px | 12.05px = 6.02%  | 9.82px = 4.91% |
| `shelf-106-*.png` — **the acceptance test** | 106px | **11.94px = 11.26%** | **5.14px = 4.85%** |

The measured percentage under each frame is printed *in* the frame, and the capture refuses to
take the shot if the caption does not fit — an earlier attempt cropped the handset's percentage
off the right-hand edge, and a proof whose number is cropped is not a proof.

`measurements-before.json` / `measurements-after.json` carry the full probe for each frame:
computed width, offset, insets, radius, shadow and background, plus the painted width, the
seam, the protrusion and the block's height as a percentage of the board.

## What the height column answers

The walk raised a question about whether the page block was reaching full board height
somewhere. **It was not** — the block measures 95.1–95.6% of the board at every size, before
and after, which is the 2.5% top and bottom insets doing exactly their job.

## What the seam figures mean

`tuckPx` reads 0.13–0.34px, not 1px, and that is not an error. The strip sits at
`translateZ(-7px)` inside a book rotated −9° under a 1600px perspective, so 1px of CSS projects
to a fraction of a pixel on the glass, by an amount that depends on the board's size. It is
measured and written down rather than "corrected" — the same foreshortening
`CONTACT_SHADOW_REBASE` records for the shadow's 8px. Correcting it would mean scaling a seam.

## The app is not changed by this, yet

The app still carries `FORE_EDGE_W = 12` fixed, and therefore still carries **the same latent
slab at phone sizes** — its board is not 245.33pt on an iPhone either. The web leads here
deliberately; the app mirrors the rule in a later round.
