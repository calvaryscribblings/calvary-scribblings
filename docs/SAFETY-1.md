# SAFETY-1: nothing wipes data in bulk without a fresh backup and a trial run

31 Oct 2026. The doctrine is in CLAUDE.md ("A bulk write goes through the guard"), the guard is
`scripts/safety/guard.mjs`, and the restore procedures are in `scripts/backup/RESTORE.md`. This
file records what the round found and decided.

## 1. Inventory: every script that could delete or overwrite production data

Status before this round, then what happened to each script. "Own backup" means the script saved a
copy itself before SAFETY-1. The guard now does that for all of them. "Last ran" is the evidence on
record; where none exists, the date is the file's last change.

### Scheduled (run by a workflow with `--apply`)

| Script | Touches | Kind | Own backup | Dry by default | Last ran | Now |
|---|---|---|---|---|---|---|
| `account/scrub.mjs` (+ `private-fields.mjs`) | null-paths across ~40 nodes per deleted reader, tombstones, counter transactions, `users/{uid}` remove, `voices/<slug>/` Storage prefix | bulk delete | no | yes | every 15 min | guard (`adminDb` + `adminBucket`) |
| `square/horizon.mjs` | moves posts to `square_archive*`, nulls `square_posts`/`square_reactions`/`user_square_posts` | bulk delete (a move) | no | yes | daily, 20:00 bell | guard (`adminDb`) |
| `push/*` via `push/db.mjs` | claims (transaction), marks, `push_tokens` prunes, receipts | bulk delete (tokens, receipts) | no | yes | every 15 min | guard (`adminDb` in `openProductionDb`) |
| `covers/on-publish.mjs` + `covers/store.mjs` | cover uploads, root PATCH of cover fields and whole `cms_stories_index/<slug>` records, follower notifications | whole-record replace | no | yes | every 15 min | guard (`rtdbPatch(guard, …)`, `adminBucket`, notifications as one guarded update) |
| `bookstore/withdrawals.mjs` | `bookstore_titles/{id}` status fields | field patch | no | yes | hourly | guard |
| `reconcile-index.mjs` | whole `cms_stories_index/<slug>` records, ≤10 per run | whole-record replace | no | yes | every 15 min | guard (one atomic update, read-back kept) |
| `backup/liveness.mjs` | `ops/backup_liveness` heartbeat | single record | — | no | daily | exempt (single record) |

### Run by hand, still needed (retrofitted)

| Script | Touches | Kind | Own backup | Dry by default | Last ran | Now |
|---|---|---|---|---|---|---|
| `backfill-story-bodies.mjs` | `story_bodies/<slug>` | whole-record replace (was a whole-node PUT until PROOFS-R1) | no | yes | 31 Oct (59) | guard; writes only missing or differing records, never a body held only in `story_bodies` |
| `readership.mjs` | the whole `bookstore_readership` node (PUT) | **wholesale replace** | no | **no, wrote by default** | never | guard; **dry by default** |
| `migrate-bookstore-taxonomy.mjs` | 12 `bookstore_genres` records, `bookstore_sections` | whole-record replace | no | **no, wrote by default** | before 20 Aug | guard; **dry by default** |
| `backfill-user-comments.mjs` | `user_comments/{uid}/{id}` (and nulls with `--prune`) | field patch / bulk delete | no | yes | not recorded (23 Aug) | guard; counts only |
| `repair-index-record.mjs` | one `cms_stories_index/<slug>` | single record | printed only | yes | R48 | guard |
| `screen-comments.mjs` | `comment_screening/<slug>/<id>` | bulk create | no | yes | R32 | guard, batches of 50 |
| `epub-repair/carry-over.mjs` | reading positions and bookmarks across readers | field patch (conditional) | yes (local) | yes | 15 Oct (W45) | guard (`transact`), bucket read-only |
| `backfill-bookstore-cover-colour.mjs` | `bookstore_titles/{id}/coverColour` | field patch | no | yes | not recorded (30 Aug) | guard |
| `bookstore-shelf-colour-overrides.mjs` | `coverColourOverride` on 8 titles | field patch | no | yes | not recorded (30 Aug) | guard |
| `leaderboard-snapshot.mjs` | `leaderboards/{id}/snapshot\|final` | whole-child replace | no | yes | 31 Jul | guard |
| `bookstore/founder-comps.mjs` | Ikenna's comp purchase records (grant / revoke) | bulk create / delete | yes (local) | yes | 25 Sep | guard |
| `series/backfill-writers.mjs` | `series/{id}` writer fields | field patch | yes (local) | yes | 11 Oct | guard |
| `stories/retire.mjs` | retire markers, index nulls, text placement | field patch + deletes | yes (local) | yes | 7 Oct | guard (`--unretire` is the documented path) |
| `stories/unreleased-text-out.mjs` | `cms_stories/{slug}` content (transaction) | field delete | yes (local) | yes | 31 Oct | guard |
| `covers/migrate.mjs` | 158 covers + index records | whole-record replace | yes (manifest) | yes | 18 Aug | guard |
| `backup/rehearse.mjs` | **PUT of the whole tree to `_restore_rehearsal/` in production**, then DELETE | scratch copy of the whole database | — | `--offline` opt-in | not recorded | **emulator only** |
| `bookstore/author-copy.mjs` | one title's author copy | single record, create-only | yes | yes | W33 | exempt (single record) |
| `storage/lifecycle.mjs` | main bucket lifecycle rules | bucket config | prints before | yes | 20 Oct | exempt (bucket config) |
| `audit/states-shots.mjs` | the live test reader's own record | single record | — | — | W17 | exempt (single record) |

### Retired (24)

Listed with what each did and why it went in `scripts/RETIRED-SCRIPTS.md`. Two of them were
dangerous to keep. `backfill-user-search.mjs` would have wiped `isAuthor` from every
`user_search` record. `migrate-publishers-split.js` had no dry run at all.

### Outside the guard on purpose

Stripe and Paystack scripts (`money/*`, `create-founding-*`) write to the payment providers, not to
our database or Storage. They are dry by default, and the live ones need `--i-mean-live`.
`money/stripe-webhooks.mjs --recreate` deletes a live webhook endpoint, and it should be read
before it is ever run. The Facebook re-scrape and the deploy-hook POSTs are marked `not-firebase`
on their call lines.

## 2. The guard

`scripts/safety/guard.mjs`. Dry by default, `--apply` to write. Before any write it backs up exactly
the paths and objects about to change to
`gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/batch-N.json`. It reads the
backup back and checks MD5 and SHA-256. If any step fails, it refuses to write. It refuses the
root, empty path segments and `undefined`/`null` segments. Database writes are one atomic update;
Storage deletes and overwrites are conditional on the generation it backed up. It prints counts
only. `scripts/safety/restore.mjs` undoes a batch. It is dry by default, and it is guarded too.

The backups expire after 30 days because they live in the database-backup bucket. That is on
purpose: the account scrub writes through the guard, and a deleted reader's data must not outlive
the daily backups the deletion copy already allows for.

Read-only scripts wrap their handles in `readOnlyDb()`/`readOnlyBucket()`, which throw on any
write. Eleven scripts do this now.

## 3. The CI check

`tests/ci/safety-guard.test.mjs` (in `npm run test:ci`, in the hygiene job) runs
`scripts/safety/check.mjs` over every file under `scripts/`. It fails on any raw write: a `fetch`
with a write method, a firebase-admin database or a bucket not handed to the guard, or the
Firebase client SDK. It also asserts that the pre-PROOFS-R1 `backfill-story-bodies.mjs` (kept as
a fixture) fails. Put back in place of today's file, the check prints:

```
✗ scripts/backfill-story-bodies.mjs
    line 137: rest: fetch with method 'PUT'
1 file(s) write to production without going through scripts/safety/guard.mjs.
```

Exemptions live in `EXEMPT` in `check.mjs`, by file name, with one of four reasons. There are
eight entries. The hygiene job also runs the guard against the emulators
(`test:safety-guard:emulator`, 14 tests). It then runs the scrub and push suites with their
database handed through the guard (`test:safety-guard:wrapped`, 21 + 18).

## 4. Restore drill (31 Oct 2026)

`npm run backup:restore-drill`, exactly as RESTORE.md says. Archive `2026-10-31T01:00:49Z`:
6.01 MB gzip, 20.45 MB inflated, 101 nodes. It restored into the emulator and the whole tree read
back canonically identical. Against live (read-only, counts and hashes):

- 93 of 102 nodes had identical record counts. The rest grew. One node is new since the backup
  (`series_note_replies`). None shrank.
- `story_bodies` / `cms_stories`: 252 / 252 in the backup, every body paired with a story. Live:
  270 / 270.
- `users` 328 / 328 and `bookstore_purchases` 8 / 8, unchanged.
- 113 random records over 14 major nodes: 111 hash-identical. One had changed with a later
  timestamp. One `cms_stories` record had changed without one, consistent with PROOFS-R1's text
  removal that day (41 records lost `content`, none gained a timestamp).
- The real restore path was rehearsed too: `restore-archive.mjs --all --apply` into the emulator,
  through the guard. 101 of 101 nodes read back identical.

What RESTORE.md had wrong, now fixed:

- the backup does not always run at 00:13 UTC;
- the one-record recipe printed a reader's record to the terminal and wrote it back outside any guard;
- the whole-database recipe was a raw `curl` PUT at the root, with a token on the command line;
- the rehearsal wrote the whole tree into production;
- "turn on automated backups" was still listed as not done;
- "last proven" was 4 Sep.

## 5. Storage

See the round's report. In short:

- Nothing outside the main bucket holds a copy of the master EPUBs, the Series artwork or readers'
  uploads. The bucket's 30-day soft delete is the only undo.
- `export.mjs`, the only backup of the auth accounts, has no output anywhere.

## 6. Live code paths

The audit of `functions/`, `workers-external/` and `app/admin/` found paths that can write
wholesale. Most of them build a database path from an id that is never checked against a pattern,
so a blank or crafted id widens a one-record write to a whole node. All of them need a founder
session or a server secret. The details, with the fixes proposed, are in a private note
(`~/calvary-private/audits/safety-1-live-paths.md`): this repository is public. Nothing on a live
path was changed in this round.
