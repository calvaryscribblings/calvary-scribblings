# The Full Audit — web half, 24 September 2026

A read-only audit of the web repo and the live site against [`docs/PREMIUM-BAR.md`](../../PREMIUM-BAR.md).
It found **184 findings: 14 P0 · 65 P1 · 83 P2 · 22 P3**. Each is a row in [`LEDGER.md`](LEDGER.md), and each cites the bar line it fails.
The walk list for real devices and dashboards is [`WALK-LIST.md`](WALK-LIST.md). The saved-stories data hand-off for
the app session is [`HANDOFF-SAVED-STORIES.md`](HANDOFF-SAVED-STORIES.md).

**Chosen vs derived:**
- **Measured:** contrast ratios, target sizes, characters per line and lab timings.
- **Chosen, not derived:** the lab network and CPU profiles. They copy Lighthouse's defaults.
- **Not available:** field data. PSI is out of quota, and no key has CrUX enabled (SPD-01).
- **Not verified here:** everything marked "from code" in the ledger. Those items were not triggered live, because triggering them would have been a write.

**The repo is public.** The `admin/` screenshots show a founder's email address. The `gate/` screenshots show paid Series
text, unpublished bodies and reader uids. Both folders are held on the audit machine and not committed; the ledger marks
them ‡. For the same reason this report doesn't name the exposed objects or the deploy hook.

---

## Top 10 P0/P1

1. **The membership webhook is misconfigured on Production (MON-01, P0).** A bad-signature probe gets **500 "Server
   misconfigured"**; the Book Store's webhook answers 400. Opened today, a Stripe member would pay, get no tier, and
   sit on "SETTING UP…" for good (MON-09). Fix: set the secret and the endpoint. Size S.
2. **The membership lifecycle can bill or grant wrongly (MON-02, 03, 05, 14, P0/P1).**
   - A Gold member pressing Platinum is billed for two subscriptions.
   - A late webhook can hand back Gold to someone who cancelled.
   - Deleting an account before the grant lands leaves the subscription billing a deleted reader.
   - The `writeMembership` race from August is still open.
3. **No money failure reaches a person (MON-04, P0).** Every failure after signature verification answers the
   provider 200 and writes one `console.error` that nobody keeps. A paid reader with no book or tier is invisible to us
   and to Stripe or Paystack.
4. **The archive promise and the gate don't match (GATE-02, P0).** `/membership` sells "The archive opens", but the
   story gate is a build constant set to off, and no step in the runbook or contract turns it on. On 30 Sept everyone
   still reads the archive free. If the gate *is* turned on, there are open security findings against it (GATE-01, GATE-03;
   details redacted in W1 and held off git).
5. **A deploy hook is written into this public repo (ADM-35, P0) — CORRECTED IN W1.** Probed on 24 Sep, the hook
   in the Worker mirror, and the only other one ever committed, answer 404 "does not exist": both were rotated on
   26 Aug, so nothing live was exposed. The live failure ran the other way: every scheduled publish since 26 Aug has
   POSTed that dead URL, and nothing noticed. W1 moves it to a secret and logs a miss.
6. **Two one-tap data traps in the admin (ADM-01, ADM-08, P0).**
   - Row Publish puts a book on sale with no EPUB.
   - A "New Story" titled like an existing one silently overwrites it.
7. **Admin state doesn't tell the truth (ADM-04 to 07, 10, P1).**
   - Hide is undone by the next cron tick on the 48 live stories that carry an old publishAt.
   - A scheduled story can go live without a cover.
   - Un-scheduling silently hides.
   - Live stories open with "Schedule Story" showing.
   - Failed rebuilds still read "✓ Published".
   - The newsletter sends to all 55 subscribers on one tap with no confirmation, reports failed sends as sent, and
     schedules an hour late in BST (ADM-02, 03, 22).
8. **Failure and slowness have no designed state across the spine** (BS-01/02, LIB-01, SRCH-01, STORY-04, SER-01,
   HOME-05, SQ-03, ACC-06, BS-13, SPD-08/09/10, P1). Each fails in its own way:
   - the Book Store draws a blank page with no nav
   - My Library's Books tab tells an owner they own nothing
   - Search says the island is empty
   - the library lists say "0 stories"
   - Series says "Loading…" forever
   - 404s are Next's white Arial page
   - the curtain's tab bar is inert
   - offline first visits get the browser's raw error page

   The cause is one pattern repeated: a `get()` that never settles, with no deadline.
9. **CI has been red on both gates for 25 days (CI-01 to 07, P1).** The causes are all small:
   - a Square test that only passes 20:00–24:00 London time
   - a stale selector
   - a harness still pointing at a constant removed in R50
   - a probable port collision
   - `next` pinned below a critical fix (no live exposure under static export)

   Until it is green, CI can't catch a regression.
10. **Mobile speed misses the bar (SPD-02/03/05, P1), in lab only.** LCP fails on 8 of 10 URLs on a mid-range profile.
    - /public-library LCP is 8.8s, and its desktop CLS is **0.613**, six times the limit.
    - Top Readers avatars are 1.5–3.6 MB each, drawn at 40px.
    - The Series poster is a 2.2 MB PNG.
    - Every page ships about 1.1 MB of JS, including Firebase, before first paint.

Just outside the ten:
- **Square mentions and DM search are dead for every non-founder (SQ-01/02).** It is the same admin-root read that R46
  fixed in Search, and a mistyped @handle can double-post.
- **The auth modal (ACC-01/03/04)** shows raw Firebase errors, has no dialog semantics or autocomplete, and its 18+
  notice measures 1.67:1.
- **A reading-history privacy finding (SAVE-03; details redacted in W1).**

---

## Known threads: current state

**Story-access gate, server side.** It is **off**: `GATING_ENABLED=false` and `SERIES_TIER_GATE_ENABLED=false`, both build-time constants that no clock or flag touches.
- A live signed-out `/api/story` returns `access:full, reason:gating_off`. The static HTML carries full bodies.
- The path-by-path table of where a body can be read is **redacted (W1)**: it is a reproduction of unfixed security findings in a public repo, and is held off git.
- If the gate were on at 30 Sep 00:00 London, **165 of 187** published stories would be members-only: 68 short, 62 news, 22 flash and 13 inspiring. The 17 poems stay free, and 5 more stay free through the window and the floor. **Today the honest answer is none, because the gate is off.**
- Series with the gate on: I1 (Gold/Platinum), I2 and I3 (Platinum), Diary I1 (Gold/Platinum). Passes are excluded.

> **Redacted (W1, 24 Sep 2026).** The table of body paths (GATE-01, 03, 04, 07) is held off git until those findings are fixed.

**Does the app call `/api/hit` and `/api/story`? No.**
- There are 48 days of `story_clients` data, 8 Aug to 24 Sep. Every `/api/hit` bucket is `web`, apart from 2 `unknown` on 16 Aug.
- `/api/story`: 4,246 web and 4 unknown in 30 days.
- No app client has ever appeared. T3 stays blocked (docs/OWED-APP-ENDPOINT-SILENCE.md).

**Money in test mode, per flow.**
- **Unit suites:** membership 275/275, purchases 582/582, account 58/58. The emulator deletion test was not run.
- **Live refusal probes:** all correct apart from MON-01.
- **Production:**
  - `memberships`: 1 canary record
  - `paystack_membership_index`: empty
  - `bookstore_purchases`: 8 records, all test, **not cleared**

| flow | built | walked end-to-end ever | blocking P0s |
|---|---|---|---|
| Subscription, Stripe | yes | **never**; the prod webhook can't receive events | MON-01 to 07 |
| Subscription, Paystack | yes | partly (R10.5 test card); disable and dunning never walked | 02, 03, 04, 05, 07 |
| Pass, Stripe / Paystack | yes | never | 01, 04, 07 |
| Book purchase (both rails) | yes | test mode (the 8 records) | 04, 08 |
| Refund | books yes; memberships and passes **no** (MON-12) | one damaged test refund on record | 04, 08 |
| Deletion with a subscription | yes | never with a real subscription | 05 |

No real subscription checkout could be run from here. Memberships are not on sale on Production (409), and no provider
keys exist in this environment. The operator walk is in WALK-LIST.md.

**CI.** Both gating workflows (rules-and-hygiene, reader-tests) have been red since 30 Aug 20:13Z. The failing steps
and their fix-or-quarantine calls are CI-01 to CI-06: fix five, quarantine the two PROOF cases in cover-arrival. All
seven crons are green.

**Admin CMS.**
- **Saves that report success over a partial failure:**
  - story publish with a failed rebuild or notification
  - Hide, Unhide and Delete, which never rebuild
  - every Voices action
  - newsletter send and test (200 with an error body)
  - newsletter draft delete
  - Book Store file clean-up
  - six load failures that render as empty lists
- **The good part:** the story save itself is one atomic multi-path write and refuses malformed HTML.
- **State model:** there are four fields and no single status line, and the list, the editor, the cron and the header count disagree.
- **Preview as a reader:** none, except Book Store Sections.
- **Destructive confirmations:** the full table is in the ledger rows ADM-02/16/23/28/30/31. The newsletter send has none.
- **iPad:** 843 of 843 controls on /admin are under 44px. No layout was designed between 768 and 1180.

**Saving stories on the web.** Saves are device-local IndexedDB only, with no server node, so the app can't read them.
The data shapes and what My Library › Stories could show from existing server data are in HANDOFF-SAVED-STORIES.md.

**Square, web, against the 2 Sept rulings.**

| ruling | web state |
|---|---|
| 48-hour horizon | **met**: hourly worker, bell at 20:00 London, the archive is kept, nothing is deleted |
| pinned post survives | **met** (unpinning an old thread archives it without warning, SQ-12) |
| full identity (picture, name, handle, badge) | **met** on posts, replies, quotes and the permalink |
| 500/300 limits with a late counter | **met** (the edit counter is broken, SQ-05) |
| three permission switches | built as pin / remove / images; **no post or reply switch** (SQ-18, ruling) |
| images only for granted readers | no Square image upload exists; DM images ignore the grant and fail (SQ-02) |

Listener leaks and the structure of `app/square/page.js` (1,713 lines, one component): SQ-16.

**Home: the Seasonal strip against Just added, on the web.** There is no overlap at any width. The strip sits exactly 32px
below the author line, and it has been hidden since 14 Sep by its 14-day tail. The app still shows it (HOME-02).

---

## Per surface: the gaps between today and a competing standard

**Home (/public-library)**
1. It has no error or offline state; skeletons stay up for good (HOME-05).
2. On desktop the layout jumps at CLS 0.613, and mobile LCP is 8.8s (SPD-03, SPD-02).
3. Avatars are 1.5–3.6 MB each (SPD-05).
4. Top Readers handles collide with the scores (HOME-01).
5. Headings aren't balanced, and some text is faint and tiny (HOME-03, HOME-06).

**Search**
1. It can't tell "not loaded" from "empty" (SRCH-01).
2. Counts and meta are set at about 2.3:1 and 8px (SRCH-03).
3. The field has no visible focus, and targets are 33–40px (SRCH-04).
4. Typing costs about 256ms per key on a mid-range phone (SPD-07).

**Square**
1. Mentions and DM search are dead for readers (SQ-01, SQ-02).
2. Every write fails silently, with no retry (SQ-04).
3. "Loading…" never ends offline (SQ-03).
4. Reduce Motion is ignored (SQ-06), and targets are 16–34px (SQ-08).
5. Offline shows the raw browser page (SPD-10).

**Book Store**
1. The page is blank until Firebase answers, with no designed failure, and the 404 appears on a read error (BS-01, BS-02).
2. 20 of 22 books can't be reached without a pointer (BS-05).
3. The touch furniture is 13–27px (BS-06, BS-07).
4. It has no oldstyle figures and no balanced titles (BS-10).
5. After a purchase it says "in your Library" before it is, and owners can buy again (MON-10, MON-11).

**My Library**
1. The Books tab is an endless skeleton offline, or "you own nothing" (LIB-01).
2. Saves stay on one device (SAVE-01).
3. It has no ordered history and no prose reading position (SAVE-02, SAVE-04).
4. Controls are 7.5px type on 19–23px targets (LIB-02).
5. Rows go ragged (LIB-03).

**Story pages and lists**
1. Prose runs at 82–88 characters per line (STORY-01).
2. The lists use two columns at every width, with covers blurred by 5× upscaling (STORY-02).
3. The lists read "0 stories" while loading or on failure (STORY-04).
4. The Save pill measures 1.96:1 (STORY-06).
5. Dates are in US order, and the hero ignores Reduce Motion (STORY-10, STORY-07).

**Series**
1. Its own nav dead-ends: no tabs, and no previous or next instalment (SER-03, SER-04).
2. It shows "Loading…" forever (SER-01).
3. The Reading Room's Cormorant actually draws a fallback serif (SER-02).
4. The author credit is inconsistent between instalments (SER-05).

**Membership**
1. The return banner can't tell processing from lost or signed out (MON-09).
2. Upgrading double-bills (MON-02).
3. Dates follow the device locale (MEM-02).
4. The copy promises an archive the gate doesn't close (GATE-02).

**Account**
1. The auth modal shows raw Firebase errors, has no dialog or label semantics or autocomplete, and its age notice is illegible (ACC-01, ACC-03, ACC-04).
2. Settings and Profile show blank boards (ACC-06).
3. It uses an older purple chrome with no TabBar (ACC-15).

**Admin CMS (primary: iPad)**
1. It needs one state model shown as one status line (ADM-04 to 07, 12).
2. There is no preview as a reader (ADM-14).
3. Completion receipts aren't honest (ADM-03, 10, 11, 31).
4. It isn't designed for the iPad: 843 of 843 targets are under 44px, and 820 breaks the newsletter and Book Store pages (ADM-17 to 20, 32).
5. Irreversible actions have no guard rails (ADM-01, 02, 08, 15).

---

## Proposed fix rounds, in order

| # | round | contents | depends on | size |
|---|---|---|---|---|
| F0 | **Today, operator only** | Rotate the deploy hook (ADM-35). Set the membership webhook secret and endpoint (MON-01). Check the Stripe API version (MON-06). | none | S |
| F1 | **CI green** | CI-01, 02, 04, 05, 08, 09; quarantine CI-06; decide CI-03 (bump next, or allowlist with an expiry). | ruling on CI-03 | S–M |
| F2 | **Money P0s** | MON-02, 03, 04 (5xx plus a `money_review/` node and email), 05, 14, 12 (at least the operator note), 15, 17; banners MON-09, 10, 11, 19; runbook MON-07. Then the operator walk (WALK-LIST 4–13) on a test preview, then MON-08. | F0, F1; rulings on refunds, partial refunds and naira cancel | L |
| F3 | **Gate and privacy** | Rule on GATE-02 first. Then either the copy rewrite, or: GATE-01 (legacy Series copies), GATE-04 (strip unpublished bodies), GATE-06 (runbook), and the page-client read change from GATE-03. Also SAVE-03 (close `storyReads` reads) and a rules deploy. | GATE-02 ruling; any gate flip also needs the T3 ruling | S (copy) to L (gate) |
| F4 | **Admin guards and truth** | ADM-01, 08, 04, 05, 06, 09, 02, 03, 22, 23, 10, 11, 25, 13; one status line (ADM-07, 12). | F1 | M |
| F5 | **States round** | One shared "deadline + designed error + Retry" helper (the PL-12 pattern) applied to BS-01/02/03, LIB-01, SRCH-01/02, STORY-04, SER-01, HOME-05, SQ-03, ACC-06/07, ADM-24; root `app/not-found.js` (BS-13); SW offline (SPD-09/10); curtain tab bar (SPD-08, **before 30 Sept**). | F1 | M–L |
| F6 | **Square readers** | SQ-01, 02 (or remove DMs by ruling), 04, 05, 16, 17, 12, 06. | F1; DM ruling | M |
| F7 | **Auth and account** | ACC-01, 02, 03, 04, 05, 08, 12, 13, 14, 10; MEM-02/03 (en-GB dates sitewide). | none | M |
| F8 | **Speed** | SPD-05 (image derivatives), SPD-06, SPD-03/04 (reserved boxes), SPD-07, then SPD-02 (Firebase off the first-load path, the larger job). Add a web-vitals beacon (SPD-01) so the next audit has field data. | F1 | M–L |
| F9 | **Type, touch, contrast, motion sweep** | `text-wrap` balance/pretty and `oldstyle-nums` sitewide (HOME-03, BS-10, LIB-09, MEM-04); 44px targets (BS-07, STORY-05, SQ-08, SRCH-04, LIB-02, MEM-05, ACC-14, HOME-04); AA contrast (HOME-06, SRCH-03, SQ-07/09, BS-09, SER-07, STORY-06, LIB-10); Reduce Motion (BS-11, STORY-07, SQ-06, ACC-08); STORY-01 measure; STORY-02 grid; BS-05/06 keyboard access. | F5 (same files) | M |
| F10 | **Admin on iPad** | ADM-17, 18, 19, 20, 21, 32 (layout and targets); ADM-14 (preview); ADM-15 (dirty-state guard); ADM-26/27/28. | F4 | M–L |
| after launch | parity and data | SAVE-01/02/04 (synced saves, history, one progress node), SER-03/04/05, SPD-11, the no-emoji sweep. | rulings | M |

**Before 30 Sept, at minimum:** F0, F1, F2, the F3 ruling plus the copy or gate, the F4 P0s (ADM-01, ADM-08), and SPD-08.

---

## Questions for Ikenna

1. **The archive (GATE-02).** On 30 Sept, is the archive free, with the membership copy rewritten? Or is it gated, knowing
   the open GATE-03 finding stands until T3? And may T3 go ahead without app adoption data, since the app has
   never called either endpoint?
2. **The Series gate (GATE-06, GATE-01).** When does `SERIES_TIER_GATE_ENABLED` flip, and a ruling on GATE-01 (details held off git).
3. **Money rulings (MON-04, 12, 13, 16, 18).**
   - Does "200 means received" stand once there is real money?
   - Does a refund of a membership or pass end it?
   - Does a partial book refund revoke the book?
   - Can naira launch with cancel by email only?
   - Should deletion refund unused time?
4. **Clearing the 8 test purchases (MON-08).** Say the word, and provide `PAYSTACK_TEST_SECRET_KEY`.
5. **CI-03.** Bump `next` before launch, or allowlist the audit until after 30 Sept?
6. **Square (SQ-18, SQ-02).** Did the "three switches" ruling mean pin / remove / images (as built), or post / reply / images?
   Are DMs part of launch?
7. **Privacy (SAVE-03).** A ruling on reading-history visibility (details held off git).
8. **Saves (SAVE-01).** Should saved stories follow a reader across devices, which would be a new server node? If not,
   record the web and app divergence.
9. **Speed data (SPD-01).** Create a Google API key with PSI and CrUX, or build our own real-user beacon?
10. **Smaller calls:**
    - Apple sign-in on the web (ACC-09).
    - Is "Program" the exception to British English (HOME-07)?
    - Tab labels in system sans (SRCH-05).
    - Non-house faces in the typesetter (SER-08).
    - A founder badge (SQ-19).
    - Centred or left-aligned shelf (LIB-04).
    - Should deletion wipe the device shelf (LIB-07)?
    - Should an under-18 Google Auth account be deleted (ACC-11)?
    - Should the second founder send newsletters (ADM-33)?
    - Should the app follow the web's 14-day programme tail (HOME-02)?

---

## Cleanup (production)

- **Two throwaway accounts** were created through the live sign-up flow (`@example.com`). Both were deleted through
  `/api/account/delete`, one of them via the site's own modal, which walked the real flow.
- **Re-read afterwards:** `users`, `users_private`, `usernames`, `user_search`, `memberships`, purchases, presence,
  leaderboard and streaks are all null, and Auth reports user-not-found. Only the designed `deletions/{uid}` audit records
  remain.
- **One real verification email** was sent to an example.com address. A mocked request escaped through the service worker.
- **Not checked:** whether one account's three story opens raised those stories' public read counters.
- **Founder sessions:** custom-token sign-ins for the admin screenshots wrote nothing to RTDB. Every write frame was
  blocked at the socket, and 0 were seen.
- **No purchases, subscriptions, posts, saves to shared nodes or admin actions** were made.
