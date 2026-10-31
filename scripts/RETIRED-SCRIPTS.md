# Retired scripts

SAFETY-1 (31 Oct 2026) put every script that writes to production behind one guard
(`scripts/safety/guard.mjs`: dry by default, then a fresh, verified backup, then the write).
Scripts whose job was done were **retired instead of retrofitted**. A retired script is a bulk
writer with nobody left to need it. Keeping it costs a guard retrofit, and it can still be run
by mistake against data that has moved on since it was written.

**The code is in git history.** To read one: `git show <commit>^:<path>`, where `<commit>` is
the SAFETY-1 commit that removed it (`git log --diff-filter=D -1 -- <path>`). Bringing one back
means routing its writes through the guard first. `tests/ci/safety-guard.test.mjs` will refuse
it otherwise, and it also fails if a file listed here reappears under the same path.

| Script | What it did | Why it went |
|---|---|---|
| `scripts/backfill-bookstore-cover-derivatives.mjs` | R20: cut 360/720 px WebP rungs for every Book Store cover; overwrote them in Storage, and wrote `bookstore_titles/{id}/coverSizes`. | One-off, run once (R20, Aug 2026). The CMS cuts the rungs at upload now. Re-running replaced download tokens in place. |
| `scripts/backfill-bookstore-cover-lqip.mjs` | R29: wrote the inline stand-in `coverLqip` for the covers from before the door. | One-off; the 20 covers were done in R29. New covers get one at upload. |
| `scripts/backfill-cover-derivatives.mjs` | Cut the story-cover WebP rungs, set long-cache metadata, and PATCHed whole `cms_stories_index/<slug>` records. | One-off (Jul 2026). Superseded by the typographic covers, whose rungs `scripts/covers/` makes. |
| `scripts/backfill-published-at.mjs` | P1: wrote `cms_stories/<slug>/publishedAtMs` from the live node. | One-off. The composer writes the field on every save. |
| `scripts/backfill-user-search.mjs` | Built `user_search/{uid}` for name search. | One-off, and **harmful to re-run**: it replaced each record whole with three fields, which would have wiped `isAuthor` (written by `app/lib/handle.js`) from every reader. Signup and profile edits keep the index now. |
| `scripts/bookstore-set-cors.mjs` | Set the main bucket's CORS policy for the Reading Room (read, merge, PATCH). **Wrote by default.** | One operator action, done Jul 2026. The policy is in place. A config change belongs in a reviewed, dry-by-default tool, not a default-write script. |
| `scripts/create-voice-ed-oiji.mjs` | R46.2: created Ed Oiji's `cms_voices` roster card. | One-off, done. |
| `scripts/fix-arthur-slug.mjs` | R46.2: staged `arthur-eze`, then published it and deleted `arthor-eze` in one PATCH. | One-off, done. Its `--cutover` exits if the old record is gone. |
| `scripts/migrate-beta-princess.mjs` | Moved Beta Princess into the Series. Copied EPUBs in Storage, PATCHed the root (series records, unpublished the two stories, nulled their index entries). | One-off, done (Aug 2026). Re-running would rewrite whole series records the admin has edited since. |
| `scripts/migrate-publishers-split.js` | Split `bookstore_publishers/{slug}` into public and `_private` halves with a root PATCH. **No dry run at all.** | One-shot (Jul 2026), and it rewrote each record to a whitelist, so any later field would be erased. |
| `scripts/pull-book-reader-collection.mjs` | W-era: unpublished the Book Reader records and nulled their `cms_stories_index` entries. | Done 16 Aug 2026. Retirement is now `scripts/stories/retire.mjs` and the `cms_stories_retired` marker (W35). Its note that un-ticking `readerMode` would revive two quizzes is in the git copy, and CLAUDE.md now points here. |
| `scripts/repair-handle-fields.mjs` | Repaired `users/{uid}` handle fields, `user_search`, and the `usernames/` reverse index across all readers in one update. | One-off (Sep 2026). It could re-point a `usernames/` entry to another uid; handle fields are strict in the rules since W1. |
| `scripts/repair-malformed-bodies.mjs` | R11.8a: rewrote the 6 story bodies that failed the preview gate (with a local backup). | Done in R11.8a. Bodies now live in `story_bodies`, and this wrote `cms_stories/<slug>/content`. Running it after PROOFS-R1 would put text back on the public node. |
| `scripts/repair-quiz-advertisement.mjs` | R11.1: restored `quizMeta` and the index `quiz` object on stories whose approved quiz had stopped being advertised. | One-off repair, done (Aug 2026). |
| `scripts/strip-wrapped-closing-tags.mjs` | R11.2: rewrote `cms_stories/<slug>/content` to drop paragraphs wrapping a lone closing tag. **No backup.** | Done (Aug 2026). Same public-node problem as the malformed-bodies repair. |
| `scripts/write-voice-registers.mjs` | R46.1: wrote the ten approved `register` fields into `cms_voices`. | Done (memory: "registers are WRITTEN"). |
| `scripts/bench-reader-gate.mjs` | R7.3: timed the reader gate's two reads with the Firebase client SDK. Read-only. | A finished benchmark. It is the only script that used the browser SDK, which has no place under `scripts/`. |
| `scripts/clear-test-purchases.mjs` | Removed the test-mode purchases (and their readership counts) before live money. | Done 25 Sep 2026 (W3, 8 removed, backup kept). Its test and the comps test's "the clear never takes a comp" went with it. |
| `scripts/gate01-remove-legacy-copies.mjs` | GATE-01: deleted the public `epubs/` objects no published story used, and nulled withdrawn books' `extractedText`/`epubUrl`. | Done 25 Sep 2026. A dry run reports 0/0, and the deleted bytes are in `calvary-scribblings-storage-backups/gate-01/`. Its planner tests in `tests/ci/w4-gate.test.mjs` went with it. |
| `scripts/account/rulings-backfill.mjs` | W19 / ruling 48: applied rulings 29, 30 and 33 to past deletions. | Done 27 Sep 2026 (0/0/0). The scrub applies them to every new deletion. |
| `scripts/epub-repair/swap.mjs` | W45: swapped a live master EPUB for its repaired file, after copying the old generation to the backups bucket. | Both swaps done (15 Oct, re-checked 22 Oct). A future swap brings it back through the guard. `carry-over.mjs`, which a swap also needs, stays. |
| `scripts/square/scrub-attachments.mjs` | W1 / SQ-01: slimmed `attachedStory` on Square posts so they carry no story body. | Done 24 Sep 2026. The Square write Function only ever writes the slim shape (W54). |
| `scripts/series/strip-handle-at.mjs` | W39: removed a stray `@` from series writer handles. | Done 13 Oct 2026 (2 records). Every series write path strips it now. Its one sweep test went with it. |
| `scripts/series/seed-reads.mjs` | W49 / ruling 178: seeded each instalment's read count from existing reading positions. | Applied 17 Oct 2026, 8 instalments. A second run would recount reads now owned by `/api/hit`. Its emulator test and two mutation rows went with it. |

## Not retired, but changed

- `scripts/backup/rehearse.mjs`: its round trip used to PUT the whole database (every reader
  record included) under `_restore_rehearsal/<stamp>` in **production** and DELETE it again.
  A failed delete left a full copy of the database there. It now runs in the database emulator only.
- `scripts/readership.mjs` and `scripts/migrate-bookstore-taxonomy.mjs` **wrote by default**
  with an opt-in `--dry-run`. They are dry by default now, like everything else.
