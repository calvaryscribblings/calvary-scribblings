# The account scrub plan, in plain English

For Ikenna to sign off (ruling 14, 26 Sep 2026). This describes `scripts/account/scrub-plan.mjs`
as it stands at W11. Nothing in the plan was changed to write this.

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

- **Their comments and replies**, and every reply under a comment of theirs, **including other
  readers' replies**. A reply left behind would hang off nothing. *(Marked DRAFT in the code. The
  alternative is to keep the text under "a deleted reader".)*
- **Their Square posts**, live and archived, with the replies under them. *(DRAFT, same choice.)*
- **Their Open Pages pieces**, with the comments, likes and reports attached to them. *(DRAFT.)*
- **Their reactions, likes and poll votes on other people's work.** Each counter goes down by
  one, so "12 hearts" stops counting someone who is gone.
- **Notifications they caused in other readers' inboxes**, because those carry their name and
  picture.
- **Their reading records and their rows on the seasonal boards.** *(DRAFT for finished seasons:
  a closed contest's standings lose a row.)*
- **The DMs they sent.** The other reader's own messages, and their link to the conversation,
  stay, because those are the other reader's. *(DRAFT.)*
- **A backstop.** It re-checks everything the endpoint should already have removed: handle,
  follows, blocks, and any profile a payment webhook might have written back. So a miss is
  caught on the next run.

## What it keeps, and why

- **Published reader voices** (`cms_voices`). The voice is editorial and stays. Only its link to
  the account is removed. *(DRAFT: whether the voice itself should come down.)*
- **Reports.** This covers reports they filed and reports about them (`content_reports`, the
  legacy `reports`). They are safety records, kept under the privacy policy. A report about one
  of their comments keeps its snapshot of up to 200 characters of that comment, and their uid.
- **Stories and series they wrote in the CMS, and their author page.** These are editorial; *a
  ruling is still owed.*
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
| GitHub Actions logs | The scrub logs each uid with counts (no name, no email). **The repository is public, so these logs are public** | 90 days (GitHub's default) |

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

## Decisions waiting on the sign-off

1. **Replies, Square posts and Open Pages pieces:** delete them, or keep the text as "a deleted
   reader"?
2. **Other readers' replies** under a deleted comment: delete them with it (today), or keep them?
3. **Finished seasonal boards:** remove the row (today), or freeze closed seasons?
4. **DMs:** delete only what they sent (today)?
5. **Reader voices:** keep them without the link (today), or take them down?
6. **CMS stories, series and author pages** they wrote: keep them (today), pending the editorial
   ruling?
