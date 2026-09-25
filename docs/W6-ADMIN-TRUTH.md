# W6: the admin tells the truth — before launch week

F4 from the 24 Sep audit (`docs/audit/2026-09-24/LEDGER.md`: ADM-02..07, 10, 22, 24), plus
comp-aware Delete. **The rule:** no admin action reports success unless everything it set out to do
succeeded. A partial failure says exactly what did and didn't happen, with a retry. Nothing that
failed to load looks empty.

Ruled by Ikenna (25 Sep), on the one open question: a story with no cover yet is refused a schedule
**less than 30 minutes ahead**. Later schedules are accepted and wait for the cover, as before.

## 1. Hide sticks (ADM-04)

**Before:** Hide wrote `published:false` only. The scheduled-publish Worker republished any
`published:false` story with a past `publishAt` on its next tick, and 49 live stories carry one.
So a Hide of any of them lasted up to fifteen minutes, with no message.

**Now:** Hide writes `hiddenAt` beside `published:false` (`hidePaths`, `app/lib/storyState.js`).
- The Worker's `publishDecision()` skips any story carrying `hiddenAt`.
- `hasStaticPage()` no longer prerenders a hidden story, so its page goes at the next build.
- Unhide clears `hiddenAt`. An edit of a hidden story leaves it alone. A fresh schedule, or
  "publish it now", clears it.

## 2. No coverless publish (ADM-05)

- **The schedule:** refused less than 30 minutes ahead for a story with no generated cover. The
  refusal says why and names the earliest allowed time, in London time (`scheduleRefusal`). The
  check runs only when the schedule is new or has changed, so editing a story that is already
  scheduled is not refused.
- **The Worker:** a due story that is still `coverHold`, or has no generated cover at all, is
  **skipped**. An alert is written once to `ops/publish_skips/{slug}`. /admin shows it at the top
  of the story list ("Not published — no cover"), with Dismiss. The publish that finally happens
  clears it.
- **Unhide:** a story with no generated cover is now held for its cover instead of going live.
  The reconciler publishes it with its cover.

## 3. Un-scheduling says what it does (ADM-06)

Unticking the schedule on a **scheduled** story now asks: *Publish it now*, or *Keep it hidden (it
will not publish)*. The save refuses until one is chosen, and the headline names what happened.
Before, it saved the story hidden and said "✓ Story updated."

**One status per story (ADM-07).** `storyStatus()` / `statusLine()` return Live since… / Scheduled
for… / Waiting for its cover / Hidden since…. The list, the counts and the editor all use them. A
live story is no longer offered a schedule, and no longer badged Scheduled with its View link
removed.

## 4. Publish, hide, unhide, delete: "live" only when the site says so (ADM-10)

The record write is reported the moment it lands ("Published in the database."). The rebuild
runs after that, and the save no longer waits for its 10-second settle. "✓ Published — and live on
the site." appears only when `/` is serving a **new Next build id**. Next stamps a fresh one on
every build, including a hook rebuild of the same commit (`app/lib/rebuildWatch.js`).
- A refused rebuild says so, with **Retry the rebuild**.
- No new build within 10 minutes says that, with the same retry.
- Follower notifications are counted ("N notified, N NOT notified"). They are sent only when the
  story goes live. Before, every *Update Story* on a live story notified every follower again.
- Scheduled and held saves don't rebuild. The Worker and the cover reconciler each rebuild when
  they publish.

## 5. The newsletter (ADM-02, 03, 22)

- **Confirmation:** the full send is two steps. *Send to 55 Subscribers…* opens a dialog: "Send to
  55 subscribers?", the subject, and "Mail cannot be recalled once it is sent." Cancel sits where
  the button was; Send is at the far end. With no subscriber count loaded, the button is
  disabled.
- **Honest results:** the Worker answers refusals with real statuses: 403 for a test to an address
  not on the allowlist, 409 for no subscribers, 502 when every batch was refused.
  `app/lib/newsletterOutcome.js` reads the body, not just `res.ok`.
- **Partial sends:** "Sent to 70 subscribers; 50 emails did NOT go." The failed addresses are kept
  on the `newsletter_sends` record. **Retry the ones that failed** (`/api/newsletter/retry` →
  Worker `/retry`) mails exactly those, and nobody who already has the issue.
- **Scheduling:** the field is labelled London time and sent as UTC ISO (`app/lib/londonTime.js`).
  The Worker reads a pre-W6 zoneless draft as London time, not UTC, so a BST schedule is no longer
  an hour late. Both copies are held to the same cases across both clock changes.
- **Sent once:** a Send on a draft **locks** it (`status: 'sending'`). A clean send removes it. A
  failed or partial one is kept as `failed`, with the counts, and is never re-sent by a tick.
  *Save Draft* keeps an existing schedule, and there is an explicit *Unschedule*.
- **Draft saves and deletes:** both check the database's answer. A refused write says "NOT saved"
  or "NOT deleted".
- **History:** `newsletter_sends` **had no rule**, so the admin's History tab was denied for every
  account, and the swallowed denial read "No newsletters sent yet." Founders can now read it, and
  it shows a failed count with Retry.

## 6. Voices, and the Book Store's file clean-up

- **Voices** (`app/admin/voices/page.js`, `app/lib/voicesOutcome.js`): no action waits on the
  rebuild. A failed write says "…was not saved: <error>. Nothing was changed, and no rebuild was
  asked for." The success line appears only once the rebuild is accepted. A refused rebuild says
  the live site does not show the change yet, with **Retry the rebuild**. Draft-to-draft saves no
  longer ask for one. Errors are red, not the success box's colour.
- **File clean-up after a Delete:** every Storage removal is recorded as removed, already gone
  (404) or failed. "Title deleted, but 1 of its 3 files could not be removed: <path>…" comes with
  **Retry the failed files**. The retry re-reads the deletion record, so it can never remove a
  held master.

## 8. Delete counts comps

**Ruled 25 Sep: keep R21.** Delete is never refused (R21 ruling 1), and whenever anyone holds a
book its master EPUB and cover stay (ruling 2). The brief's premise, that Delete already refused
for buyers, was mistaken. The real hole: the holder count was readership, which excludes comps
(W3b), so a title held only as a comp read as unowned and **lost its master**.
- **The count:** every active entitlement in `bookstore_purchases`, whatever its source
  (`holdersOf()` in `app/lib/bookstore/purchaseSource.js`). A browser can't list that node, so the
  new founders-only `GET /api/bookstore/holders?titleId=` counts it and returns two integers,
  never a uid.
- **The dialog:** it names the holders and the comps, e.g. "One reader holds this book (a
  complimentary copy). They keep it…", and suggests: "If you only want the book off the shelf,
  withdraw it instead."
- **Fail closed:** an unreadable count refuses the delete ("Couldn't check who holds this book, so
  nothing was deleted. Retry.").

## 7. Failed loads are drawn (ADM-24)

Every admin page now draws a failed read as the house failure panel (`Unavailable`) with Retry,
through `app/components/AdminLoad.js`. It checks in a fixed order: failed, then loading, then
empty, then the rows, so the empty copy can only follow a successful read. Pages: Book Store,
Voices, publishers, series, square (per section), submissions, exercises, reports, authors (per
section, and it names any unreadable author records), quizzes, analytics (per card), forum,
quiz-resets and extract-text. Each read runs under the 12-second deadline, so a hung read becomes
"slow" instead of a spinner forever.

Two related fixes:
- **Publishers:** the edit form no longer opens with blank private fields when their read fails.
  Saving that form would have written the blanks back.
- **Quizzes:** "No quiz yet for this story" no longer shows while the quiz is still loading. It
  invited generating over a quiz that exists.

The CMS story list and the newsletter's loads are covered below.

The CMS story list and the newsletter's subscriber count, drafts and history show the house
failure panel with Retry. They load under the 12-second deadline.

## Tests

Totals: ci 819 (the new w6 files include w6-admin-loads 24, w6-bookstore-delete, w6-bookstore-cleanup
and w6-voices), bookstore 603, newsletter 100, account 58, rules 446. Lint went from 137 to 135 errors,
and the baseline is locked there.

- `tests/ci/w6-worker.test.mjs` (23) drives the **real Worker** (its `fetch` and `scheduled`
  handlers) against an in-memory database and a fake Resend. It covers hidden and coverless
  stories, refusals, a 120-subscriber send with a refused middle batch and its retry, the draft
  lock, and a zoneless BST draft sent at 08:00 UTC, not 09:00.
- `tests/ci/w6-cms.test.mjs` (20) and `tests/ci/w6-newsletter.test.mjs` (13).
- `tests/rules/w6-admin.test.mjs` (6) covers `newsletter_sends` and `ops/publish_skips`.
- Every protection was reverted once and its test went red (18 code mutations and 1 rules
  mutation).
