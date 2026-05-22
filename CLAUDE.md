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
2. For new server-side endpoints, use Next.js Route Handlers: `app/api/<endpoint>/route.js`. Existing examples: `app/api/points-reset/route.js`, `app/api/square-cleanup/route.js`.
3. Never use `cd` and rely on the working directory persisting between Bash calls — each call starts fresh. Use absolute paths or `cd … && …` chains within one call.

## History note

The repo was previously laid out with the Next.js app under `calvary-scribblings-next/` and Cloudflare Pages Functions at a root-level `functions/` directory. Commit `e2d6f59` "Newsletter block composer" (force push) restructured everything to the root and deleted the `functions/` tree. Endpoints that used to live under `functions/api/*` (`generate-quiz`, `evaluate-quiz`, `record-attempt`, `admin/*`) currently have no handler on the deployed branch.

## Vestigial directories you may see locally

A repo checkout that pre-dates the restructure can leave untracked `calvary-scribblings-next/` and `calvary-app/` directories on disk, containing stale `node_modules/` and `out/`. They are not tracked in git and the live tree ignores them. If you see them, do not edit files inside them — `rm -rf calvary-scribblings-next calvary-app` is safe.

## Verification

Before committing any new file, run `git status` and confirm the path is at the repo root (`app/…`, `emails/…`, `scripts/…`, `public/…`). If you see a path starting with `calvary-scribblings-next/` or `calvary-app/`, stop — that is a vestigial untracked location.
