# W17 — the deletion rulings, the test-money record, and live tests that cannot write

26 Sep 2026.

## 1. Rulings 29–34 on the account-deletion plan

They're recorded in `docs/ACCOUNT-SCRUB-PLAN.md` (under **Rulings**) and applied in
`scripts/account/scrub-plan.mjs`.

| # | Ruling | What changed in the scrub |
|---|---|---|
| 29 | Their comments and Square posts are deleted with the account | Already so. The DRAFT marks came off |
| 30 | Other readers' replies stay, under "This response was deleted." / "This post was deleted." | **New.** A comment or post of theirs with someone else's reply beneath it becomes a tombstone (`{ deleted, deletedAt, createdAt, parentId, replies }`, with no words, author, counts or reactions). Before W17 the whole thread was deleted |
| 31 | Their row comes off finished season boards | Unchanged |
| 32 | In DMs, only what they sent is removed | Unchanged |
| 33 | Reader voices quoting them come down | **New.** The `cms_voices` record is deleted, its images under Storage `voices/{slug}/` are removed, and the run fires the deploy hook so the voice's static page goes. Before W17 only `matchUid` was removed |
| 34 | Stories, series and author pages they wrote stay | Unchanged, now pinned by the emulator suite |

**A gap closed on the way.** In Open Pages threads, a reply of theirs two levels deep was never
removed. The rewrite walks both shapes: flat `parentId` threads and nested `replies/…`, at any
depth.

**Drawing.** `app/lib/deletedContent.js` holds the two ruled sentences. Tombstones are drawn with
no name, avatar, reactions or Reply on:
- the story page and the reader, where response counts leave tombstones out;
- Open Pages threads, where a tombstone survives the parse while a reply hangs beneath it, and
  `countNodes` leaves it out;
- the Square, through `PostBody` (`deleted`): the feed post, the reply, the quoted card, the
  closed preview and the permalink.

**Proof.**
- `tests/account/deletion.test.mjs`: 38 tests on the plan, including one per ruling, the nested
  case, no overlapping paths, and a second pass over scrubbed data that finds nothing.
- `tests/account/deletion.emulator.test.mjs`: 20 tests. Both halves run against the database
  emulator, with a test for each ruling. That includes a run with no Storage or rebuild access,
  which refuses rather than half-applies.
- `tests/ci/w17-deletion-rulings.test.mjs`: every Square surface renders the tombstone, and the
  source guards cover the other surfaces.

**Readers already deleted: nothing touched.** `scripts/account/rulings-report.mjs` (read-only,
counts only) found **0** for 29, **0** for 30 and **0** for 33 across all 18. How far that reaches
is set out in the plan: 0 is exact for the one reader who was in a backup, and a floor for the 17
same-day accounts.

**Still open for Ikenna:** their Open Pages *pieces*. Today a piece goes with every comment on
it, other readers' included, and rulings 29–34 don't say.

## 2. Ruling 39: the W3 test-money record

`ops/money_failures/charge_success-ms_Fr9KxI…-paid_after_deletion` now has `resolved: true` and a
`resolution` note that cites ruling 39. Those are the same two fields the other 13 W3 records
carry. I read the node before and after: 14 records both times, 2 fields changed, both on that
record, and 0 unresolved now.

## 3. The live-test safety gap

**The gap is real, and was shown on production.** `tests/live/firewall-proof.mjs` signs in as the
test reader. Under the W9–W16 guard, which watched only the database socket, it forced the SDK's
long-polling fallback two ways: with the SDK's own `previous_websocket_failure` flag set, and with
no flag and just a socket failure. Both times a write to the test reader's own record went out
over `/.lp` and **landed**. The probe removed its own flag both times.

**The fix.** `tests/live/firewall.mjs` is one guard for every live harness:
- It aborts every long-poll request, reads included, so the fallback doesn't exist for a harness.
- It aborts every non-GET that isn't on a six-entry read-only allow-list: token refresh, account
  lookup, `/api/story`, `/api/series/stream`, `/api/bookstore/stream` and
  `/api/membership/return-status`.
- It aborts `/api/hit`.
- It stops write frames at the socket proxy.

Under the same forced fallback it produced no ack and nothing landed, whether the socket was
refused or proxied. With an ordinary socket, the database still reads and the write stops at the
proxy. The real story page, with the fallback forced, had 9 long-poll requests aborted. Every
test-reader record read back unchanged.

**The test reader.** `tests/live/test-reader.mjs` sets it up:
- It isn't a founder and has no claims, no email, no handle, no search row and no password. A
  custom token signed by the service account mints each session.
- Its uid lives only at `ops/live_test_reader` (Admin SDK only) and is never printed.
- It has an adult date of birth in `users_private`, so no prompt appears.
- It has **no `founder_preview` flag.** The flag only ever works for a founder uid (`/api/story`
  and the page both check `isFounder` first), so on this account it would do nothing. Giving it
  effect would mean opening a founder-only door, which I didn't do.

**The live harnesses have moved.** `tests/reactions/live.mjs` (W13), `tests/offline/offline-shelf-probe.mjs`
(W11), `tests/storybar/lock-shots.mjs` (W9), `tests/storybar/readout-shot.mjs` (W16) and
`scripts/audit/states-shots.mjs` (W2) now use the test reader and the firewall.
`tests/storybar/founder-session.mjs` is gone.
- `lock-shots` refuses to run before the 30 Sept switch, because only a founder sees the lock
  before then.
- `readout-shot` now proves the readout's gate from outside: the test reader and a signed-out
  reader both get no readout. The founder's own view was proven live in W16.
- `tests/ci/w17-live-safety.test.mjs` fails if any harness signs in to production other than
  through `test-reader.mjs`, keeps its own socket-only guard, or names a founder uid.

**Could the earlier live tests have used the fallback?**

| Round | Harness | Could it? | Read-back |
|---|---|---|---|
| W9 | `lock-shots` (as Ikenna) | Yes, if its proxied socket had failed once. Nothing records whether it did | "unchanged" (6 records) |
| W10 | none | No live test: a words-only ruling round | n/a |
| W11 | `offline-shelf-probe` (as Ikenna) | **Most exposed.** It goes offline and back. Re-run today behind the new firewall, the SDK fell back to long-polling on its own (9 long-poll requests aborted) after 2 socket writes had been stopped. In W11 nothing would have stopped them | the record says the records were re-read; no figure survives |
| W13 | `reactions/live` (as Ikenna) | Yes, as W9 | 358 writes answered at the proxy; 7 records unchanged |
| W16 | `readout-shot` (as Ikenna) | Yes, as W9 | 0 writes dropped; records unchanged |

The read-backs covered only the records each harness watched. So I also scanned every
top-level node that holds a child keyed by Ikenna's uid (30 of 87) for timestamps inside each
test window. There were six hits:
- four story reads and one comment, none on a page any harness opened (W9 opened
  `trouble-shooting` and the Series instalment; W13 opened `47-sessions`, the Square and one
  piece);
- a Book Store reading-progress save at 03:03 London, and no harness opened the Book Store.

That leaves one push-token refresh at 22:05 UTC, which came from the phone app. **No test
write was found.**

## 4. Rule 13

`public/reading-room.html`: "This book would not open." is now "This book wouldn’t open." It's
pinned in `tests/reader/load-fence.spec.mjs` (7/7) and logged in `docs/COPY-RULINGS.md`.

## Suites

`test:ci` 1194/1194; `test:account` 65/65; `test:account:emulator` 20/20; `test:square` 82/82;
`test:openpages` 162/162; reader load-fence 7/7. Lint is held at the baseline, and the build
passes.
