# Calvary Scribblings — Working Directory Rules

**The Next.js app lives at `calvary-scribblings-next/`, NOT at the repo root.**

## Critical paths

- App code: `calvary-scribblings-next/app/`
- Components: `calvary-scribblings-next/app/components/`
- Admin pages: `calvary-scribblings-next/app/admin/`
- Cloudflare Pages Functions: `functions/` (repo root — NOT inside `calvary-scribblings-next/`)
- Cloudflare Workers: `workers/`
- Spec docs: `docs/`

## Build context

Cloudflare Pages runs `cd calvary-scribblings-next && npm install && npm run build`. Anything outside `calvary-scribblings-next/` is invisible to the Next.js build, except `functions/` (which Cloudflare Pages picks up separately at the repo root).

## Rules for editing

1. Before creating or editing any `.js`, `.jsx`, `.ts`, or `.tsx` file, verify the path starts with `calvary-scribblings-next/app/` (or `functions/` for Pages Functions).
2. If a file with the same name exists at both `app/...` (repo root) and `calvary-scribblings-next/app/...`, the repo-root one is vestigial. **Always edit the one inside `calvary-scribblings-next/`.**
3. When unsure, run `pwd` first, then `ls calvary-scribblings-next/app/` to orient.
4. Never use `cd` and rely on the new working directory persisting — every bash invocation starts fresh. Use absolute paths or `cd ... &&` chains.

## Common mistakes to avoid

- Creating `app/admin/<feature>/page.js` at repo root instead of `calvary-scribblings-next/app/admin/<feature>/page.js`
- Creating Pages Functions inside `calvary-scribblings-next/functions/` (wrong) instead of `functions/` at repo root
- Editing the repo-root `QuizCard.js` (vestigial, not deployed) instead of `calvary-scribblings-next/app/components/QuizCard.js` (deployed)

## Verification

Before committing any new file, run `git status` and confirm the path. If you see a path starting with `app/` (no parent directory), stop — that's the repo-root vestigial location.