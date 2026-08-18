# Contact sheet sign-off — the typographic cover system

**Approved by Ikenna, 18 August 2026.** In his words: *"All clear. Love it… it's a go."*

contactSheetSha256: 9cebeaddd284ae9ba9b22dd9c82cb0a2627685e4a9530c38621135ac30ba54bf

## What this hash is, and why it is here

It is the SHA-256 of `covers-contact-sheet/manifest.json` — the exact set of seventeen
rendered covers that was reviewed, recorded livery by livery, size by size, with the SHA-256
of every individual PNG inside it.

`scripts/covers/migrate.mjs` recomputes this hash on every `--apply` and refuses to run if
it does not match. That is deliberate. A sign-off is not a general licence to change covers;
it is approval of a **specific set of images**. If anyone touches the layout, a livery, a
font, the renderer version or the case list after today, the sheet's hash moves, this file
stops matching, and the migration refuses again until a new sheet has been built and looked
at. Approval cannot silently outlive the thing approved.

## The three titles nobody recognised

Ikenna's one query on the sheet was the unfamiliar titles. They are the three plates the
sheet itself labels SYNTHETIC:

| slug | title | what it proves |
|---|---|---|
| `akudaaya-synthetic` | Àkúdáàya | Yorùbá diacritics in both title and author |
| `unknown-category-synthetic` | The Unfiled Story | missing category → imprint eyebrow, footer omitted |
| `series-instalment-synthetic` | Halfway Around the Moon | the Series livery and its instalment ordinal |

**They are not stories.** They have no `cms_stories` record and no slug anyone can visit.
They exist to prove the renderer against cases the live library does not currently contain,
and they are **not part of the migration**.

That is not left to trust. `preflight()` in `scripts/covers/migrate.mjs` derives the
synthetic set from the contact sheet's own `CASES` array — the same array the sheet renders
from, so the two cannot drift apart — and refuses to upload anything if a synthetic slug
appears in the migration set, if the manifest carries a slug that is not a live published
story, if any record is unpublished or unnamed, or if any slug is duplicated.

## Scope

158 published stories. No cover file is overwritten and none is deleted: every object goes
to a new path under `covers-typographic/{slug}/`, and the old files stay exactly where they
are. Rollback is `--rollback`, which restores six scalars per story from the manifest's
pre-flip snapshot.

## The second gate is NOT covered by this file

`covers-descriptors/REVIEW-SHEET.md` remains unratified and untouched. No descriptor has
been written to any story. That gate is Ikenna's to open by renaming the file himself.
