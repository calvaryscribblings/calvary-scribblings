# Calvary Scribblings — Working Directory Rules

**The Next.js app lives at the repo root.** `package.json`, `next.config.mjs`, `app/`, `public/`, `scripts/`, and `emails/` all sit at the top level. There is no longer a nested `calvary-scribblings-next/` source directory.

## Critical paths

- App code: `app/`
- Components: `app/components/`
- Admin pages: `app/admin/`
- API routes (Next.js Route Handlers): `app/api/<endpoint>/route.js`
- Email templates: `emails/`
- Build scripts: `scripts/`
- Static assets: `public/` (includes `_headers` and `_redirects` for Cloudflare Pages)

## Build context

Cloudflare Pages runs `npm install && npm run build` from the repo root. The `build` script is `node scripts/generate-redirects.mjs && next build`. `next.config.mjs` sets `output: 'export'`, so the build produces a static export in `out/`.

## Rules for editing

1. Before creating or editing any `.js` / `.jsx` / `.ts` / `.tsx` file, verify the path starts at the repo root (e.g. `app/admin/<feature>/page.js`). Do **not** create or edit anything inside a nested `calvary-scribblings-next/` directory.
2. For new server-side endpoints, use Cloudflare Pages Functions: `functions/api/<endpoint>.js`, exporting `onRequestPost` / `onRequestGet`. That is where every live endpoint actually runs — `next.config.mjs` sets `output: 'export'`, so Next.js Route Handlers are not built into the deployed output. Two stale handlers remain at `app/api/points-reset/` and `app/api/square-cleanup/`; do not copy that pattern.
3. Never use `cd` and rely on the working directory persisting between Bash calls — each call starts fresh. Use absolute paths or `cd … && …` chains within one call.

## History note

The repo was previously laid out with the Next.js app under `calvary-scribblings-next/`. Commit `e2d6f59` "Newsletter block composer" (force push) restructured everything to the root.

**The `functions/` tree was not deleted.** An earlier version of this file claimed it was, and that the endpoints under `functions/api/*` had no handler on the deployed branch. Both claims were wrong. The tree is present, git-tracked, and actively maintained — `functions/api/` currently holds `generate-quiz.js`, `evaluate-quiz.js`, `record-attempt.js`, `hit.js`, `og-image.js`, `admin/*`, `newsletter/*`, and `open-pages/moderate.js`.

## Vestigial directories you may see locally

A repo checkout that pre-dates the restructure can leave `calvary-scribblings-next/` and `calvary-app/` directories on disk, containing stale `node_modules/` and `out/`. Do not edit files inside them — `rm -rf calvary-scribblings-next calvary-app` is safe.

**Correction — `calvary-scribblings-next/` was not fully untracked.** An earlier version of this file said the directory was untracked in its entirety. That was wrong. Eight bookstore files were git-tracked in `HEAD`, added by `db4f05d` ("recover A0-A2.4 build from codespace branch") and left behind by the `e2d6f59` restructure:

```
calvary-scribblings-next/app/admin/bookstore/page.js
calvary-scribblings-next/app/admin/publishers/page.js
calvary-scribblings-next/app/bookstore/layout.js
calvary-scribblings-next/app/bookstore/not-found.js
calvary-scribblings-next/app/bookstore/page.js
calvary-scribblings-next/app/lib/bookstore/admin-writes.js
calvary-scribblings-next/app/lib/bookstore/loader.js
calvary-scribblings-next/app/lib/bookstore/schema.js
```

They were frozen A2.4-era snapshots, and five of the eight had diverged from their root counterparts by 100+ lines. They were never built (Next builds from the root), so an edit landing in one was silently lost — a real trap for greps and fuzzy file-opens. **R5.0 removed all eight from git.** Whatever remains in that directory on disk is untracked build residue.

Never edit anything under `calvary-scribblings-next/`, and never re-add it to git. The bookstore surface lives at `app/bookstore/`, `app/admin/bookstore/`, `app/admin/publishers/`, and `app/lib/bookstore/` — root paths only.

## 🚨 THERE IS NO APP SOURCE IN THIS REPO. A BRIEF MUST NOT ASK FOR IT.

`calvary-app/` on disk holds **`node_modules/` and nothing else**. The React Native app
lives in a separate repository that this container cannot see — not on disk, not in git
history, not in any branch here.

**This has now been established three times**, each time after a round went hunting for it:

| | round | what the brief asked for | what was actually there |
|---|---|---|---|
| 1 | R16 | "the app's fore-edge constants" | nothing — the parity record was built from the ruling in the prompt plus the web's own measurements |
| 2 | R17.4 | "match the app exactly, its constants were never pasted in" | nothing — and the app's `lib/bookDepth.ts` had transcribed the fore-edge **from this repo** at `da3b53d` |
| 3 | R34 | "read the app's implementation rather than inventing a third phase" | nothing — both fixes were implemented natively from the rulings as stated in the brief |

**So a round that says "read the app's implementation", "match the app's numbers", or "the
app's value is already in this repo — find it" cannot be satisfied from this container.**
The instruction costs a search every time and has never once returned a number.

**What to write instead.** State the ruling and, where a number matters, state the number
*and the ground it was measured on* — then say to re-measure at the web's own widths. R34's
brief did exactly this for the strip ("the fixed furniture costs 140pt of 200 … mirror the
app's own measurement at the web's widths rather than copying its numbers") and it worked:
the ruling ported cleanly and the web's own furniture came out at 164.4px of 294.4px.

**And check which side transcribed which before treating the app as the reference.** Twice
now the answer has been that the app copied the web. R34 is the third instance of the
related trap: the brief's "#6b2fad measures 2.52:1" was the app's number, and the web's
score was `#a78bfa` at 6.88:1 — passing. The change shipped for consistency, not legibility.

The direction of travel is **app → web for look, web → app for systems**, and the hand-off
notes in each round's report are the only interface between the two repos.

## 🚨 PROBES THAT WRITE TO LIVE DATA

A rules round proves itself against production with a real token. That is right, and it is
how R33.1, R35 and R36 were verified. **But on 4 Sep 2026 an R36 probe destroyed a live
record**: it wrote `R36 PROBE` into the body of Ikenna's published "welcome to 'open pages'"
letter. The text was recovered from the automated backup an hour later — but only after the
round had already reported it permanently lost and restored the wrong version from a stale
mirror.

Four rules, each of which would have prevented it on its own:

1. **READ THE VALUE FIRST, and restore the moment a write you expected to fail succeeds.**
   The probe asserted a refusal instead of checking for one. `const before = await get(...)`
   costs nothing; `if (!denied) await set(ref, before)` is the whole fix.
2. **NEVER TARGET A FOUNDER-AUTHORED RECORD.** The two founder uids hold node-level `.write`
   on most nodes, so where the author is a founder, *author* and *admin* are the same account
   and **a refusal cannot be assumed**. The R36 probe picked `Object.entries(posts)[0]`, which
   happened to be founder-authored. Filter founders out, or assert the grant you actually
   mean.
3. **PREFER A RECORD THE PROBE CREATED ITSELF.** Write to a scratch id you seeded and will
   delete. Use a human's record only when the test is specifically about a real one, and then
   only under rule 1.
4. **VERIFY INTEGRITY AFTERWARDS AND SAY SO.** Re-read every record touched and compare it to
   the pre-probe read. R36's probe did print `live body unchanged (false)` — the check worked;
   the round nearly shipped past it.

And before concluding anything is unrecoverable: **check
`calvary-scribblings-default-rtdb-backups`.** Daily archives, 30-day retention. See
`scripts/backup/RESTORE.md`.

## Verification

Before committing any new file, run `git status` and confirm the path is at the repo root (`app/…`, `emails/…`, `scripts/…`, `public/…`). If you see a path starting with `calvary-scribblings-next/` or `calvary-app/`, stop — that is a vestigial location, and nothing under it may be staged or committed.

## Covers: two rules, and they are different rules

**The story library is typographic BY RULE.** Every published `cms_stories` cover is generated
by `scripts/covers/` — deterministic, offline, no artwork. R12.6/R12.6a swept all 158.

**Series covers are curated artwork BY RULE.** `series/*` posters and `series_instalments/*`
are *deliberately* not typographic. Ikenna's ruling, 18 Aug 2026, on seeing the Beta Princess
poster survive the sweep:

> "Beautiful accident. I like the way it sits on the page. Let Series be the only category
> that will explore actual arts."

Commissioned artists, or AI images picked carefully, one poster at a time, at small volume.
That is a **standing editorial decision, not an oversight and not a backlog item.**

So: **nothing under `series/` or `series_instalments/` is ever in scope for a cover sweep.**
If you find yourself about to "fix" the Beta Princess poster, or to extend the migration to
series, stop — you would be reverting a ruling. `scripts/covers/migrate.mjs` reads
`cms_stories` and nothing else, and its preflight asserts that.

### Covers are generated automatically now — by a worker, never in the publish path

R18 (22 Aug 2026). `.github/workflows/covers.yml` runs `scripts/covers/on-publish.mjs --apply`
on a `*/15` cron. The CMS does **not** generate: a story with no generated cover is saved
`published:false` + `coverHold:true` and the reconciler publishes it in the *same atomic patch*
that gives it a cover. Descriptor edits go to `descriptorPending` and land with the cover that
prints them.

**Do not try to move generation into the publish path.** The renderer is `@napi-rs/canvas`
pinned exact at 1.0.6 *because measurement must come from the drawing engine*. `app/admin/page.js`
is a browser client (Blink's Skia measures differently — a cover rendered there is a different
image from the 158 in Storage and breaks the sha-based idempotence test), and every live
endpoint is a Pages Function on workerd, which loads no native N-API addons. There is no Node
server in this architecture.

Both writers share `scripts/covers/store.mjs`. `scripts/covers/DESIGN-LOCK.json` is the
reconciler's sign-off — change the design and `--apply` refuses until `npm run covers:lock` is
committed alongside it.

The generator's **Series livery stays exactly as built** — it is proven on the contact sheet
and costs nothing to keep. Whether it is ever *used* is a separate decision for a separate
day; its existence is not a plan to migrate series.
