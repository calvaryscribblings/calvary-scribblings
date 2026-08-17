# Vendored cover fonts — provenance, licence, and how to rebuild them

These three files are the ONLY typefaces the cover generator draws with. They are vendored,
not fetched: `scripts/covers/render.mjs` registers them from this directory by absolute path
and makes no network call at any point. A cover generated on a machine with no DNS is
byte-identical to one generated on a machine with a font cache full of Garamonds.

## The files

| file | family as registered | weight | used for |
|---|---|---|---|
| `CormorantGaramond-SemiBold.ttf` | `Cormorant Garamond SemiBold` | 600 | titles |
| `CormorantGaramond-Italic.ttf` | `Cormorant Garamond Italic` | 400 italic | author |
| `EBGaramond-Regular.ttf` | `EB Garamond` | 400 | eyebrow, descriptor, footer, fleuron |

Each is registered under a family name that names exactly one face. That is deliberate: a
canvas `font` string resolves by family, and if two faces shared a family the engine would
pick between them by its own rules rather than ours. One family, one file, no ambiguity.

## Licence

Both families are under the **SIL Open Font License 1.1**, verbatim copies alongside:

- `OFL-CormorantGaramond.txt` — Copyright Catharsis Fonts
- `OFL-EBGaramond.txt` — Copyright The EB Garamond Project Authors

The OFL permits embedding, redistribution and modification. Instancing a variable font to a
fixed weight (below) is a Modified Version under §2; the licence travels with these files and
must not be separated from them.

## Why static instances and not the variable fonts

Upstream ships only variable fonts (`CormorantGaramond[wght].ttf`, `EBGaramond[wght].ttf`).
A canvas engine asked for `600 186px "Cormorant Garamond"` against a variable font either
selects an instance by its own heuristics or silently renders the default master — 300 for
Cormorant, which is a visibly lighter face than the one this design specifies. That choice
is the engine's, it is undocumented, and it can change between engine versions. So the
weight is resolved HERE, once, by instancing, and the engine is handed a file that has only
one possible answer.

## Rebuilding, exactly

Sources, both from `google/fonts` `main`:

    https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf
    https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf
    https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf

Instanced with `fontTools 4.63.0`:

    instancer.instantiateVariableFont(font, {'wght': W}, inplace=True, updateFontNames=True)

with W = 600 (Cormorant upright), 400 (Cormorant italic), 400 (EB Garamond), then the name
table's family/style records (IDs 1, 2, 4, 16, 17) overwritten with the family names above.

Cormorant's `wght` axis runs 300–700 with default 300; EB Garamond's runs 400–800 with
default 400. Note that Cormorant's default is NOT the weight we want, which is the concrete
form of the hazard described in the previous section.

## SHA-256 — the determinism anchor

If any of these change, every cover changes. Verify before believing a regeneration is clean:

    682f6cbb7a64cf73a4bfbae0cf7c2953dba7a2214b08247ba7af0a59547a4a8e  CormorantGaramond-Italic.ttf
    5b4a386a781a9ed9311536febe88366ee39fe7ac4969400b9a15cb6c71ca0e12  CormorantGaramond-SemiBold.ttf
    fb7eec6ce49c18df8a151b7aeb2f90d710d2c454a442c72180638328a95d8048  EBGaramond-Regular.ttf

`npm run covers:verify` checks these hashes, the renderer version, and the fleuron path
together, because all three must hold for "deterministic" to mean anything.

## Glyph coverage — checked, not assumed

All three cover the full Latin-1 accent set, so `Amoré`, `Beyoncé`, `Céline` and `Àkúdáàya`
render from the real face with no fallback.

**U+2766 FLORAL HEART is present in all three files.** The brief that commissioned this work
stated it was "not present in either family" and specified extracting the outline from a
third font. That premise is false — Cormorant Garamond carries U+2766, and EB Garamond
carries both U+2766 and U+2767 — and the licence problem the brief was trying to escape
(an outline lifted from GPL FreeSerif) therefore never arises. The fleuron is taken from
`EBGaramond-Regular.ttf`, the OFL font already vendored here. See
`assets/covers/fleuron-2766.mjs`.
