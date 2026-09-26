# The account scrub plan, in plain English

Signed off by Ikenna on 26 Sep 2026: rulings 29–34, recorded under **Rulings** below and applied
in W17. This describes `scripts/account/scrub-plan.mjs` as it stands after W17. (Written for
sign-off under ruling 14, at W11.)

## Where it sits

Every account deletion, including the under-18 one, goes through the same two halves.

1. **The endpoint** (`POST /api/account/delete`, `functions/api/account/_deletion.js`) runs the
   moment the reader confirms. It deletes everything filed **under the reader's own account**:
   - their profile, private fields (date of birth), search row, handle, follows both ways,
     bookmarks, points, streaks, badges, wallet, reading progress, drafts, notifications, DM
     inbox list, push tokens and similar;
   - their newsletter and Book Store waitlist rows (matched by email);
   - their uploaded pictures (avatar, header, Open Pages images);
   - any live subscription, which it cancels;
   - finally, their sign-in account.

   It keeps a record at `deletions/{uid}`. That record holds the uid, the times and the finished
   steps, and nothing else: no name, no email, no reason.
2. **The scrub** (this plan, run by `scripts/account/scrub.mjs` every 15 minutes) finds what the
   reader left **in other people's places** and removes it. That means comments under stories,
   likes on other people's posts, notifications in other readers' inboxes, and so on. It runs
   only once the endpoint has deleted the sign-in account.

## The under-18 path

A reader whose stored date of birth is under 18 is asked to confirm it (`app/components/DobCheck.js`).
If they confirm an under-18 date, the screen says "Story Island is for readers aged 18 and over."
and offers **Delete my account**. That button calls the same endpoint as the ordinary Delete
account button, with no grace period, and the scrub finishes the job within 15 minutes.
Signup refuses an under-18 date before any account exists, so this path is only for accounts
made earlier, or by an app build that didn't check.

## What the scrub deletes

- **Their comments and replies (ruling 29).** Nothing of theirs stays up under "a deleted reader".
- **Other readers' replies stay (ruling 30).** A comment of theirs that has someone else's reply
  beneath it is kept as a **tombstone**: `{ deleted: true, deletedAt, createdAt, parentId, replies }`,
  with no words, no author, no counts and no reactions. Every thread draws it as **"This response
  was deleted."**, with the other readers' replies beneath it, in their thread. A comment of
  theirs with nothing of anyone else's beneath it is simply deleted. This covers both comment
  shapes: flat replies (`parentId`) on stories and the reader, and nested replies (`replies/…`,
  two levels) in Open Pages threads. W17 also closed a gap there: a reply of theirs two levels
  deep was never removed before.
- **Their Square posts, live and archived (rulings 29 and 30).** These work the same way. A post of
  theirs with another reader's reply beneath it becomes a tombstone that reads **"This post was
  deleted."**, and the reply keeps its thread. Otherwise the post is deleted. Reactions and likes
  on a deleted or tombstoned comment or post go with its words.
- **Their Open Pages pieces**, with the comments, likes and reports attached to them. *Rulings
  29–34 don't cover pieces, so this is unchanged. See "Still open" below.*
- **Their reactions, likes and poll votes on other people's work.** Each counter goes down by
  one, so "12 hearts" stops counting someone who is gone.
- **Notifications they caused in other readers' inboxes**, because those carry their name and
  picture.
- **Their reading records and their rows on the seasonal boards (ruling 31)**, finished seasons
  included, as before.
- **The DMs they sent (ruling 32).** The other reader's own messages, and their link to the
  conversation, stay, because those are the other reader's.
- **A reader voice that quotes them (ruling 33).** The `cms_voices` record, and its card images
  under Storage `voices/{slug}/`, which keeps them for 30 days under soft delete. The voice's page
  is static, so the scrub fires the site's deploy hook (`CMS_DEPLOY_HOOK_URL`, added to
  `account-scrub.yml`) and the page is gone after that build. If the run has no Storage or rebuild
  access, it refuses to apply that deletion rather than half-apply it, and tries again on the next
  tick.
- **A backstop.** It re-checks everything the endpoint should already have removed: handle,
  follows, blocks, and any profile a payment webhook might have written back. So a miss is
  caught on the next run.

## What it keeps, and why

- **Stories and series they wrote in the CMS, and their author page (ruling 34).** These stay up
  until Ikenna makes the editorial call.
- **Reports.** This covers reports they filed and reports about them (`content_reports`, the
  legacy `reports`). They are safety records, kept under the privacy policy. A report about one
  of their comments keeps its snapshot of up to 200 characters of that comment, and their uid.
- **Rate-limit windows.** They clear themselves.

## What the endpoint keeps (not the scrub's decision, listed for completeness)

- **Purchases and entitlements** (`bookstore_purchases`, legacy `purchases`, `memberships`,
  `ops/money_failures`). These are accounting records: tier, amount, provider references. A
  purchase is permanent; the account that could use it is gone.
- **The deletion record itself**, `deletions/{uid}`: uid and timestamps only.

## Where copies can linger after a deletion

| Where | What | For how long |
|---|---|---|
| Database backups (`calvary-scribblings-default-rtdb-backups`) | Everything as it stood the day before, in the daily archive | 30 days, then the archive expires |
| Storage soft delete | Deleted pictures (avatar, header, Open Pages images) are recoverable by us | 30 days |
| The sign-in account | Deleted outright by the endpoint. Firebase keeps no restorable copy; only the uid survives, in `deletions/{uid}` | Permanent (uid only) |
| Push tokens | `push_tokens/{uid}` is deleted by the endpoint. The token itself still exists on the phone and at Expo/Google until the app is removed, but nothing of ours points to it. A `push_receipts` entry (uid and token key) can exist for one announcer run | Until the next run (about 15 minutes) |
| Reports | Kept by decision (above): reporter uid, reported uid, and a snapshot of up to 200 characters | Permanent |
| Purchases and entitlements | Kept by decision (above) | Permanent |
| Stripe and Paystack | The subscription is cancelled, but the customer record (email, payment history) stays with the provider. The endpoint doesn't delete customers | The providers' own retention |
| GitHub Actions logs | **Fixed in W12.** Until 26 Sep the scrub printed each uid, and these logs are public. It now prints a random `del-xxxxxxxx` tag stored on the deletion record, and the past runs' logs were cleaned up. See `docs/W12-LOG-PRIVACY.md` | None from 26 Sep |

## Does the live path run this plan today?

**Yes.** The `account scrub` workflow runs `scrub.mjs --apply` every 15 minutes, and its recent
runs all succeeded (last checked 26 Sep, 01:05 UTC). It applies this plan to every
`deletions/{uid}` record whose sign-in account is gone.
- **18 deletion records** exist, from 23 to 25 Sep. All 18 have every step finished, the scrub
  included.
- The records don't say why an account was deleted, so **how many were under-18 deletions can't
  be told from here.** That's by design: the record carries no reason.
- The web's under-18 screen is live. The app has its own check (`lib/dobCheck.ts` in the app
  repo), and whether it calls this endpoint can't be seen from this repository.

## Rulings (Ikenna, 26 Sep 2026)

| # | Question | Ruling | Before W17 |
|---|---|---|---|
| **29** | Their comments and Square posts | **Deleted with the account**, not kept under "a deleted reader" | deleted |
| **30** | Other readers' replies under a deleted comment or post | **Stay**, beneath "This response was deleted." / "This post was deleted.", in their thread | deleted with it |
| **31** | Finished seasonal boards | **Their row comes off**, as today | row removed |
| **32** | Direct messages | **Only what they sent** is removed, as today | the same |
| **33** | Reader voices quoting them | **Come down** (record, images, page) | kept, link removed |
| **34** | Stories, series and author pages they wrote | **Stay** until Ikenna makes the editorial call | kept |

Proof: `tests/account/deletion.test.mjs` (the plan, pure) and `tests/account/deletion.emulator.test.mjs`
(the endpoint then the scrub, against the database emulator), with one test per ruling. The
drawing is pinned in `tests/ci/w17-deletion-rulings.test.mjs`.

## Readers deleted before these rulings — nothing touched, waiting on Ikenna

All 18 deletion records (23–25 Sep) finished their scrub under the old plan, and the 15-minute
scrub never revisits a finished record. `scripts/account/rulings-report.mjs` (read-only, counts
only) says what 29, 30 and 33 would do for them now:

| Ruling | Would remove or change | How it was counted |
|---|---|---|
| 29 | **0** comments, **0** replies, **0** Square posts of theirs are still up | new plan against today's data |
| 30 | **0** replies by other readers were removed that ruling 30 keeps (so **0** tombstones to write, **0** replies to restore) | new plan against the daily backup taken before each deletion |
| 33 | **0** reader voices: none is linked to a deleted reader today, and none was detached earlier | today's `cms_voices` against each backup |

**How far the 30 count reaches.** 17 of the 18 accounts were created and deleted on the same day
(11 of them were the W3 proof's throwaway accounts on 25 Sep), so no backup ever held them. The
only other record of what the old scrub removed was each run's log, and the nine runs that
scrubbed were the nine W12 deleted because they printed uids. Every surviving run found nothing
pending. The one reader who was in a backup had 2 seasonal-board rows and nothing else. So 0 is
exact for that reader, and a floor for the other 17.

## Still open

1. **Open Pages pieces** they wrote. Today the piece goes, with every comment on it, including
   other readers'. Rulings 29–34 don't cover pieces. Should a piece follow ruling 30 (the piece
   goes, but a thread of other readers' comments stays under a tombstone), or stay as it is?
