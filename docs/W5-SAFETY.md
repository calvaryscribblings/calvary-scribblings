# W5: safety — reports that reach a person, the under-18 check, storage that can be restored

Ruled by Ikenna, 24–25 Sep 2026. Web repo; the app's half follows in its next round.

## 1. The report queue — `content_reports`

**Before:** the app wrote reports of story comments, DMs and profiles to the legacy `reports/`
node. No admin page reads it, so the app's "our team will review" was not true for those three.
(Live on 25 Sep, `reports/` held exactly one record: a June report of a Square post, written by
a founder. Nothing else.)

**The web had no report of these three kinds to move.** The web's only report buttons are the
Square's (`square_reports`, R33.2) and Open Pages' (`open_pages_reports`). Story comments,
DMs and profiles have no Report control on the web. That is an open question for Ikenna, not
something this round built.

### The write shape — for the app

`content_reports/{contentKey}/{reporterUid}`. Write it with `set()` once. A second write is
refused, not merged.

| field | value |
|---|---|
| **key** `contentKey` | `comment_{storySlug}_{commentId}` · `dm_{convId}` · `user_{uid}` (a reply uses its own id) |
| **key** `reporterUid` | the signed-in reader's uid |
| `kind` | `'comment'` \| `'dm'` \| `'user'`. It must match the key's prefix |
| `reason` | string, 1–40 chars |
| `reporterUid` | the same as the key |
| `offenderUid` | the comment's author / the message's **sender** / the profile's uid. It is never the reporter |
| `contextPath` | comment → `comments/{slug}/{commentId}` (legacy nested reply: `comments/{slug}/{commentId}/replies/{replyId}`) · dm → `dm_messages/{convId}/{messageId}` · user → `users/{uid}` (it must equal `'users/' + offenderUid`) |
| `snapshot` | string ≤ 200. **For a DM: the first 200 UTF-16 units of that message's `text`, verbatim.** Don't trim it, don't add an ellipsis, and don't cut a surrogate pair in half (drop a trailing high surrogate). The rules check that it is a prefix of the message. |
| `note` | optional string ≤ 300: the reporter's own words |
| `createdAt` | ms, ≤ now + 5 min (`Date.now()` or `ServerValue.TIMESTAMP`) |

No other field is accepted. The web's builder is `app/lib/contentReports.js` (`buildReport`,
`contentKeyFor`, `snapshotOf`), and it matches the app's spec field for field.

**What the rules enforce for a DM (the ruling):** the key must be the reporter's own
conversation with the offender. `contextPath` must be one message in it, sent by the offender,
and `snapshot` must be a prefix of that message. So a report can't carry the thread, two messages
joined together, words nobody sent, or a conversation the reporter isn't in.

⚠ **One consequence of keying a DM by conversation:** a reader can report one message per
conversation, ever. A second report of a later message in the same conversation is refused as
an overwrite. This is the app's spec as given, so it stays. If Ikenna wants per-message reports,
the key becomes `dm_{convId}_{messageId}`, and that needs a rules change on both sides.

**Read and resolve:** anyone with `users/{uid}/canRemovePosts` (both founders hold it), the same
as `square_reports`. The reporter can read their own report back. Resolving writes `resolved`,
`resolvedBy` (it must be the moderator's own uid) and `resolvedAt` at the `contentKey` level. No one
can edit or delete a report, including moderators.

**Account deletion keeps reports** (the scrub's KEEP policy: safety records, per the privacy
policy). That covers reports a deleted reader filed and reports about them.

### /admin/reports

Linked from the /admin header. It lists newest first, can be filtered by All · Comments ·
Messages · Profiles, and has a Resolve button. Comments link to the story, and profiles link to
`/user?id=`. **A DM row has no link at all:** it shows the reported message and the reporter's
note, and the page never reads `dm_messages`.

## 2. The under-18 check — `app/lib/dobCheck.js`, `app/components/DobCheck.js`

⚠ **The app's `lib/dobCheck.ts` (a62f412) is in a repo this container can't see** (CLAUDE.md,
"THERE IS NO APP SOURCE IN THIS REPO"). This was built from the ruling as stated, not
transcribed from the app. The statuses and cases are the web's. Run the app's harness against
`tests/ci/dob-check.test.mjs`, and reconcile any status name that differs.

| status | when | what happens |
|---|---|---|
| `exempt` | a founder uid | nothing, ever |
| `missing` | no dob, `null`, `''` | nothing. Left alone, by ruling |
| `ok` | 18 or over | nothing |
| `under_18` | a valid date under 18 | the reader must confirm |
| `unreadable` | not `YYYY-MM-DD`, an impossible date, in the future, over 130 years old, or not a string | the reader must confirm |

The stored date is `users/{uid}/dob` if an old binary wrote one (the 15-minute sweep lets that
public copy win), otherwise `users_private/{uid}/dob`.

**Confirming:** a dialog asks for the date again.
- **An adult date:** one update writes `users_private/{uid}/dob` and removes `users/{uid}/dob`.
  Leaving the public copy would let the sweep put the old date back.
- **An under-18 date:** a second screen repeats the date and offers *Delete my account* or *I
  entered the wrong date*. Deleting runs `runDeleteFlow` → `POST /api/account/delete`, the same
  endpoint and steps as the Delete account modal, including signing in again when the server
  asks. Then the reader lands on `/account/deleted`.
- A reader who still needs the completion step is left to that step, which already asks for
  the date of birth and refuses an under-18 one. `/settings`, `/delete-account`, `/account`,
  `/privacy` and `/terms` are exempt.

**Live on 25 Sep:** of 312 accounts, **5 are under 18**, **0 are unreadable**, 153 have no date
(left alone), 152 are adults, and 2 are founders. The five see the dialog on their next web visit.

**The copy is a DRAFT** (`DOB_COPY`). The app's DRAFT copy wasn't visible from here.

## 3. Storage that can be restored

**Found on 25 Sep:** `calvary-scribblings.firebasestorage.app` had **7-day soft delete**
(Google's default) and **versioning off**. The RTDB-backups bucket also had 7-day soft delete and
a 30-day delete lifecycle.

**Done:**
- **The file bucket's soft delete is now 30 days** (effective 2026-09-25T08:33:11Z). It covers
  overwrites as well as deletions. Versioning stays off, because soft delete already gives the
  same protection inside 30 days without keeping every covers-worker overwrite forever.
- **A new private bucket, `calvary-scribblings-storage-backups`** (europe-west2): public access
  prevention enforced, uniform access, versioning on, 30-day soft delete, and no expiry.
- **The GATE-01 backup was copied there:** `gate-01/2026-09-25T04-14-24-391Z/` holds 18 EPUBs and
  `removed-fields.json` (19 files, 3,281,978 bytes). Every file's MD5 was checked against what
  Cloud Storage recorded.

**The live proof** was a throwaway object, `_probe/w5-restore-….txt`:
1. Uploaded v1, then overwrote it with v2. v1 was listed as soft-deleted (hard-delete 25 Oct).
2. Deleted the object. The live GET returned 404, and both generations were listed as soft-deleted.
3. Restored v1. The body was back byte-exact and the MD5 matched. **The generation changed**
   (`…434836` → `…819244`).
4. Deleted it again.

**What can now be restored:**
- Any object in the file bucket that was deleted or overwritten on or after 25 Sep 08:33 UTC,
  for 30 days. That covers master EPUBs, samples, covers, avatars, Open Pages and DM images.
- GATE-01's 18 objects: still soft-deleted in the file bucket until **2 Oct 2026** (they keep
  their 7-day expiry), and held **indefinitely** in the backups bucket.
- The RTDB: daily, 30 days (unchanged).

**What still can't be restored:** anything deleted before 18 Sep, and anything whose soft-delete
window has passed. **A restore is never the same generation**, so every reader of a restored
EPUB loses their exact reading position (`scripts/backup/RESTORE.md` §4, now corrected).

## 4. The save toast — `app/lib/saveToast.js`, `app/components/SaveToast.js`

- Saving a story (the story page's *Save for offline*) shows **Saved to My Library** with **View**
  (→ /my-library).
- Every removal shows **Removed from My Library** with **Undo**. That covers the story page, its
  full-shelf list, and My Library. Undo puts back the same shelf record (so the same `savedAt`)
  and the same cover bytes, from IndexedDB, with no network. `removeSaved()` now returns what it
  took, and `restoreSaved()` puts it back.
- One toast at a time: a new toast replaces the old one and its Undo. It stays 5 seconds and
  pauses while hovered or focused. Escape dismisses it.
- It sits in a polite live region that is always mounted, so screen readers announce it.
- It rises 12px and fades in. Under Reduce Motion it only fades.
- It stacks **above the cookie banner** (z-index 10000 vs 9999). The browser suite found that on
  a first visit the banner covered the toast and its Undo couldn't be pressed.
- **The copy is a DRAFT**, using the words as given in the brief.

## 5. The pull quote — `app/lib/pullQuote.js`

The rule, from the brief (the app's `lib/pullQuote.ts`, 469dcc0, isn't visible from here):
curly doubles outside, curly singles inside, ’ for apostrophes, and never wrapped twice. Every
surface that prints an opening line already draws its own “ ”, so `resolveOpeningLine()` now
returns the inner words normalised. That covers the Window, Opening Lines, Quick Look, the back
cover and curated sections.

The Awakening, live, now reads: *“A green and yellow parrot, which hung in a cage outside the
door, kept repeating over and over: ‘Allez vous-en! Allez vous-en! Sapristi! That’s all
right!’”* The stored field is unchanged.

## Tests

- `tests/rules/content-reports.test.mjs` (16): reporter-only create, no overwrite (reporter or
  moderator), moderators read and resolve, readers can't read others' reports, and a DM report
  can't expose the thread.
- `tests/ci/content-reports.test.mjs` (5), `dob-check.test.mjs` (21), `save-toast.test.mjs` (3),
  `pull-quote.test.mjs` (5).
- `tests/safety/w5.spec.mjs` (`npm run test:safety`): the admin page, the under-18 dialog, and the
  toast with Undo and Reduce Motion, in Chromium against the emulators.
- Every protection was checked by reverting it and watching its test go red.

## Walk for Ikenna (live)

1. **/admin/reports.** An empty queue is fine.
2. **Save a story** (*Save for offline* on any story page). You should see *Saved to My
   Library* with View.
3. **Remove it** (tap the saved pill → Remove). You should see *Removed from My Library*. Tap
   Undo and it's back on the shelf.
4. **/bookstore:** The Awakening's opening line reads cleanly (single quotes inside, one pair
   of doubles outside).
