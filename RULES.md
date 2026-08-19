# Firebase Security Rules — repo is the source of truth

As of 2026-07-18, the Firebase **console is READ-ONLY by convention**. The rules
the backend serves live in this repo and are deployed from here:

- **RTDB** → `database.rules.json`
- **Storage** → `storage.rules`

wired by `firebase.json` (project in `.firebaserc`: `calvary-scribblings`).

## Changing rules

1. Edit `database.rules.json` and/or `storage.rules`.
2. Commit the change.
3. Deploy: `npm run rules:deploy` (or `rules:deploy:db` / `rules:deploy:storage`).

That is the **only** way rules change. Do not edit rules in the Firebase console.

## Before every deploy

Run `npm run rules:check` first. It pulls what Firebase is serving live and
diffs it against the repo files:

- **Empty diff** → repo matches live; safe to deploy.
- **Nonzero drift** → someone edited the console directly. **Do not deploy over
  it.** Reconcile the drift *into* the repo first (inspect it, fold the intended
  change into the repo file, commit), then deploy. Deploying over unexamined
  drift silently reverts whatever was changed in the console.

## Auth

Deploys authenticate with the `serviceAccountKey.json` service account via
`GOOGLE_APPLICATION_CREDENTIALS` (already wired into the `rules:deploy*` scripts).
The pull/check scripts mint their own OAuth token from the same key (no
`firebase-admin` dependency), so the workflow survives `node_modules` churn.
`serviceAccountKey.json` is gitignored — keep it out of commits. To keep deploy
rights after a Codespace rebuild, store the key as a Codespace secret (see the
project notes) and materialise it at `serviceAccountKey.json`.

## Historical fragment files

The `database.rules.*-fragment.json` and `storage.rules.bookstore-fragment` files
are **historical documentation** — the console blocks that were hand-pasted before
this workflow existed. They are superseded by the canonical files above and are
kept only for provenance. Do not deploy or edit them.

## Shared project

This Firebase project is shared with the Story Island app (`calvary-app` repo) — rules changes needed for app features are made HERE; the app repo never carries rules files.

## `bookstore_readership` — the one public fact about who owns a book (R14)

`bookstore_readership/{titleId}/count` is `.read: true`, and that must stay true.
`bookstore_purchases` is per-reader and gated to its owner, so an anonymous storefront has no
other way to learn this number and must never be given one — the count is what the shop
prints as "In 12 readers' libraries", and deriving it in a browser would mean reading other
people's purchases.

It is written by exactly two things, both on a service-account token that bypasses rules:

- the two payment webhooks, inside the **same multi-path update that records the purchase**
  (`functions/api/bookstore/_lib.js` → `patchPurchase`), so a grant and its count cannot drift;
- `scripts/readership.mjs backfill`, once, at ship time.

The founder `.write` grant exists only so a drift reported by `scripts/readership.mjs report`
can be repaired by hand. **No client may write it.** A client that could set this number could
tell the shop a book is loved.

`database.rules.json` carries no comments — RTDB parses an unknown key as a child path, so a
`"_comment"` string is a syntax error, not documentation. The reasoning for every bookstore
node lives beside the code that reads or writes it.
