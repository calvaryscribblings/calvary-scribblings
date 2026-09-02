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

## R21 — withdrawal and deletion: the two rules changes, and why each was needed

### `bookstore_titles_deleted` (new node)

The tombstone a deleted title leaves behind: `titleId`, `slug`, `title`, `author`, `coverUrl`,
`catalogueNumber`, `publisherId`, `deletedAt`, `deletedBy`, `ownersAtDeletion`. `.read: true`,
founder write.

**It is its own node and never a `deleted: true` flag on the title record.** A flag is
something every reader of `bookstore_titles` — the storefront, the detail route, the reader
route, five loader functions and the section resolver — has to remember to exclude, forever,
and one forgotten filter puts a deleted book back on the shelf.

Public read discloses nothing new: every field was already public on `bookstore_titles` while
the title was on sale, and three of the four display fields are already denormalised onto the
buyer's own purchase record. The `$other` deny is the load-bearing line — it is what makes
"no prices, no `epubPath`, no publisher payment detail on a `.read: true` node" a property of
the database rather than a property of one function's field list.
`tests/rules/database.test.mjs` writes the real output of `tombstoneOf()` into the emulator, so
a field added to the writer and not to the rule fails there.

`bookstore_readership/{titleId}` is deliberately **left standing** when a title is deleted. The
entitlements did not end — the readers still own the book — and the count is now the record of
why the master EPUB is still in the bucket.

### `storage.rules` — `allow write` split into `allow create, update` + `allow delete`

On the three bookstore prefixes (`bookstore_covers/{titleId}`,
`bookstore_epubs/{titleId}/sample.epub`, `bookstore_epubs/{titleId}/master.epub`).

**This closes a hole that was already there.** Each rule was a single `allow write` guarded on
`request.resource.size` and `request.resource.contentType`. On a DELETE, `request.resource` is
**null**, so those guards evaluated against null and every delete was refused — for the
founders too. Nothing noticed because until R21 nothing in the product ever deleted a bookstore
object: `deleteTitle` was `setTitleStatus(id, 'unpublished')`.

The size and type conditions stay on `create, update`, which are the operations that put bytes
in the bucket. `delete` needs only the identity.

⚠ **The master EPUB's delete rule does not encode R21's ruling, and must not pretend to.** The
ruling is "the master is not deleted if anyone owns the book". That needs a purchase count, and
a Storage rule cannot read RTDB. The guard is `deletionPlan()` in
`app/lib/bookstore/withdrawal.js`, asserted in `tests/bookstore/withdrawal.test.mjs`. A rule
written to *look* like it enforced the ruling would be worse than this one, because it would
move a reader's confidence onto a line that cannot hold it.

Neither change touches `bookstore_purchases`. Withdrawal and deletion are acts on the SHOP;
revocation from an owner is a different act, it happens only on a refund or a chargeback, and
only the two payment webhooks can perform it.


## `comment_screening` — R32, and why the verdict is not inside the comment

`comment_screening/{slug}/{commentId}` holds the promotion verdict for a reader's comment:
`{ promotable, text?, uid, categories, reason, model, version, checkedAt }`. It is
world-readable and written by `functions/api/comments/screen.js` and
`scripts/screen-comments.mjs` with the service account, which bypasses these rules entirely.

**It is deliberately NOT a child of the comment record.** The obvious design was a
`screening` child on `comments/{slug}/{commentId}`, and it is worthless: that node's rule
grants the comment's author `.write` on the whole record, and in RTDB **a permissive parent
grants the entire subtree** — a `.write: false` nested inside it is decoration, not a
boundary. That is the R31 lesson about combined grants restated. Giving the verdict its own
node means the comments rule is not reopened at all.

Founders keep `.write` on it so `promotable: false` can be set by hand — the general
"do not promote" signal, which keeps a comment off every promoted surface without deleting
it. `text` may only be written when `promotable` is true, and `$other` is refused, so a hand
edit cannot invent fields.

(This paragraph lives here because RTDB rejects a `"//"` comment key at a node position —
`Expected '{'` — so the JSON cannot carry its own reasoning.)
