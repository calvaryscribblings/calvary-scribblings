# W19 — rulings 47–49 (deletions) and the Android test push

27 Sep 2026. Rulings 47, 48 and 49 are Ikenna's. The brief matched my records of rulings 29, 30
and 33 (W17, `docs/W17-DELETION-RULINGS-AND-LIVE-SAFETY.md`), and of the question ruling 47
answers. W17 left that question open: what a deleted reader's Open Pages *pieces* become.

## 1. Ruling 47: "This piece was deleted."

The words live once, as `DELETED_PIECE` in `app/lib/deletedContent.js`. They're drawn like the
site's empty-state notes: italic Cormorant, muted, no link, no byline. The brief's example, "No
responses yet. Be the first.", isn't in the code under that wording. I matched the Open Pages
page's own note, "No comments yet — be the first.", which is the same kind of line.

**Surfaces changed**

| Surface | What a reader sees now |
|---|---|
| The piece's page, `/open-pages/{id}`, before a rebuild (its static page still exists) | Only the line, inside the site chrome. The tab title stops naming the piece |
| The same address after a rebuild (no static page, so Cloudflare serves the site 404) | Only the line, instead of "There's nothing at this address." A script in the 404 hides the ordinary words before first paint, so they never flash up |
| The Square's announcement post ("New on Open Pages — "Title"", plus a card), on all 7 surfaces that can draw one: feed post, reply, quoted card, closed preview, permalink, your own profile, another reader's profile | Only the line, in place of the words that quote the title. The card, a link to nothing, is gone |

**When it's shown.** Only after the database has answered that no piece exists at that id, and
only when the id has the shape of a real piece id. A read that fails, or an address like
`/open-pages/none` or `/open-pages/not-a-piece`, keeps the ordinary not-found page. Nothing is
called deleted unless it was seen to be.

**The piece's static page is now removed on deletion.** Each piece page is built with its title
and a 160-character excerpt in the page head. Until now, nothing rebuilt the site when a piece was
removed, so those stayed in the HTML until an unrelated deploy. Now both removal paths summon a
rebuild:
- `/admin/forum` "Remove" fires the Open Pages hook and says whether it started;
- the account scrub fires the deploy hook when it removes a deleted reader's pieces.

**Left unchanged, with the reason**

- **Lists** (the `/open-pages` contents page, the Library's Open Pages row, profile piece lists).
  These read `open_pages`, where a deleted piece no longer is, so it's already left out.
- **"X replied to your comment on Open Pages"** notifications. The text doesn't quote the piece,
  and the link lands on the piece's page, which shows the line.
- **`/open-pages/edit/{id}`** for a deleted piece. This is the author's own tool, not a link to
  the piece. After a rebuild it gets the ordinary 404. There's no sensible place for the line.
- **Emails already sent** (newsletter, notifications) can't be changed. Their links land on the
  piece's page, which shows the line.
- **Admin pages.** They aren't public.

**Today, live:** 8 pieces, none deleted with a link still pointing at it. One archived Square
announcement exists, and its piece is live. 12 reply notifications, none pointing at a deleted
piece.

## 2. Ruling 48: rulings 29, 30 and 33 for past deletions

`scripts/account/rulings-backfill.mjs` is a one-off script. It's a dry run by default, and
`--apply` backs up and then applies. It covers every deletion record whose scrub finished before
W17 shipped the rulings (fbe39d2c, 26 Sep 23:31 UTC). For each record it plans against today's
data and against the daily backup taken before the deletion:

- **29:** anything of theirs still up is deleted, exactly as the scrub does today.
- **30:** a comment or post of theirs still up with someone else's reply beneath it becomes the
  same tombstone a fresh deletion writes. Replies by other readers that the *old* scrub removed
  are found in the backup and counted. **They aren't restored automatically.** A reply missing
  today may since have been taken down by its own author or by a moderator, and a backup can't
  say which. So `--apply` refuses while any is found, and the case comes back as a report.
- **33:** a voice still linked to them comes down, and so does one the old scrub only detached
  (linked in the backup, unlinked today). That means the record, its images and a rebuild.
- **Anything else the old scrub left** (a reaction, a notification) is outside ruling 48. The run
  reports it and refuses to apply.

It's idempotent: every change is planned from what's there now, so a second run finds nothing.
The test applies a plan and re-plans to prove it.

**The run, 27 Sep, about 03:46 UTC**

| | Dry run | Applied | Dry run again |
|---|---|---|---|
| Past deletions in scope (all 18 records, 23–25 Sep) | 18 | 18 | 18 |
| With a backup from before the deletion | 18 | | 18 |
| 29: their comments / replies / Square posts / archived posts still up | 0 / 0 / 0 / 0 | nothing to write | 0 |
| 30: tombstones to write | 0 | nothing to write | 0 |
| 30: other readers' replies the old scrub removed | 0 | | 0 |
| 33: voices still linked / detached earlier | 0 / 0 | nothing to write | 0 |
| Refusals | none | | none |

**The backup** is at `~/calvary-backups/w19-ruling48-2026-09-27T03-46-24-142Z.json` in the
codespace (outside the repo, mode 600). It holds 0 records, because nothing was planned to
change. The script writes the file on every applied run anyway, so a run always leaves one.

**How far the 0 for ruling 30 reaches** is unchanged from W17. 17 of the 18 accounts were created
and deleted on the same day, so no backup ever held their threads. For them, 0 is a floor. For
the one reader who was in a backup, it's exact.

**Live check (census).** `tests/live/w19-deletions.mjs` searches all 87 top-level nodes for every
past deletion's account ID (Admin SDK, read-only, counts only). The only nodes that still name a
past deletion are the ones kept by decision:
- `deletions` (the record itself);
- `memberships`, `ops` (money records) and `paystack_membership_index`, all accounting;
- `rate_limits`, which the plan keeps.

All of these are closed to readers. **No public surface names a past deletion**, so what a reader
sees of a past deletion is what a fresh one leaves.

One thing I noticed on the way, not changed: the plan calls rate-limit windows "self-cleaning",
but windows from 23–25 Sep still hold 30 mentions of deleted accounts. They're admin-only and not
public, so they're outside ruling 48. The claim in the plan is looser than what actually happens.

## 3. Ruling 49: the deletion screen keeps its wording

Nothing on the screen changed. `tests/ci/w19-deletion-screen.test.mjs` pins it verbatim, curly
apostrophes included:
- every string in `COPY` (the modal, the sign-in-again step, the errors, the settings panel line
  and the page after deletion);
- both conditional lines (membership, author);
- the ending of the limiter's message;
- that the modal holds no words of its own and draws all 16 of its `COPY` lines;
- the settings danger zone's literals;
- the literals on the page after deletion.

A copy sweep that touches any of these turns it red.

## 4. The Android test push: skipped again

Ikenna's account still has **one** device, an **iOS** phone on app 1.7.0, last refreshed
27 Sep 00:22 UTC. There's no Android token, so no push was sent. The only Android token in
`push_tokens` belongs to a reader, and it's never a test target. Nothing was sent to anyone.

## 5. Proof

**New tests**
- `tests/ci/w19-piece-deleted.test.mjs` (9 tests). The Square's post body and card are rendered
  on every surface. The piece page, the 404 and both rebuild paths are held by source guards.
- `tests/account/rulings-backfill.test.mjs` (9 tests). One or more per ruling, plus the refusal
  cases and idempotence. Added to `test:account`.
- `tests/ci/w19-deletion-screen.test.mjs` (6 tests).

**Mutation: 18 of 18 reverts go red**
- 47: the words; the post body ignoring a deleted piece; the card staying; the feed not passing
  the piece; the piece page back to its 404; a failed read called a deletion; the 404 never
  checking; admin removal without a rebuild.
- 48: the scope widened to every record; the scrub plan dropped; removed replies not looked for;
  detached voices not taken down; out-of-scope leftovers applied.
- 49: a word of the modal; the membership line; a sentence hard-coded in the modal; the danger
  zone; the page after deletion.

Each mutant was applied to a copy of the file set aside and then restored. There was no
`git stash`.

**Suites**
- `test:ci` 1215/1215
- `test:account` 74/74
- `test:square` 82/82
- `test:openpages` 162/162
- Lint held at the baseline (134 errors, 104 warnings, as before; the new files are clean)
- The build passes

**Live browser test.** `tests/live/w19-deletions.mjs` runs as the **W17 test reader, behind
`tests/live/firewall.mjs`**. It checks:
- a piece-shaped address with no piece behind it shows exactly the line, with no link, and the
  404's ordinary words are held back from first paint and never visible;
- a live piece still draws itself;
- a non-piece address keeps the ordinary 404;
- the Square shows no deletion line.

The test reader's 11 records read the same before and after.

**Run live on production, 27 Sep, after the deploy of a5050820 (built 03:48:37 UTC): all passed.**
- Census: 18 past deletions, 87 nodes, 0 mentions outside the kept-by-decision set.
- Ruling 47: all 6 browser checks are ok.
- Firewall: 2 socket writes stopped (the SDK's own presence frames), 0 long-poll, 0 REST, 0
  `/api`.
- Test reader: 0 of 11 records changed.

The same harness passed first against the local export (`--serve out`) before the push. The
piece page's own deleted state, meaning the window before a rebuild, has no live subject: no
piece is deleted today. It's held by its source guard and by the mutation above.
