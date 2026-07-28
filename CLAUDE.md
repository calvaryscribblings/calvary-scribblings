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

## Verification

Before committing any new file, run `git status` and confirm the path is at the repo root (`app/…`, `emails/…`, `scripts/…`, `public/…`). If you see a path starting with `calvary-scribblings-next/` or `calvary-app/`, stop — that is a vestigial location, and nothing under it may be staged or committed.
