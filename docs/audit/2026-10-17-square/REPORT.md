# W50 — The Square, audited before it's rebuilt (web)

17 Oct 2026, main at `a8cf32d6`. Read-only, apart from §0's seeding. No reader's name, handle or uid
appears in this report. Screenshots were kept local and are not in the repo.

Method: I read `app/square/page.js` (1,765 lines, the whole room in one client component),
`app/square/p/page.js`, `app/admin/square/page.js`, `scripts/square/horizon.mjs` and every
Square-related node in `database.rules.json`. I reproduced the reply flow and the layout on the
**emulator** (auth + database, `NEXT_PUBLIC_FB_EMULATOR=1 next dev`), as signed-in test readers at
390, 834 and 1280px. The browser clock was moved back to the last 20:30 London, so the room was
open and `createdAt` stayed in the past for the rules. The usage numbers come from a read-only
pass over the live database, which printed aggregates only.

---

## §0 Two checks from W49

**Hit-counter Worker: no match.** The live dashboard source (Cloudflare API `content/v2`,
12,090 bytes) is **byte-identical to the pre-W49 mirror** (`a8cf32d6~1`), not to the committed
replacement. `scheduled()` is identical in both. So the W49 replacement has **not been pasted**.
The live Worker still adds to `hits` and `hitsByDay` on every app POST. Nothing was changed.

**Instalment counts (ruling 178): they had not been seeded, so I seeded them.** The dry run showed
`series_reads` at 0 everywhere except `the-doherty-confessions-i1`, which was at 2 from live reads.
`--apply` then ran. A second dry run afterwards agrees on every instalment:

| instalment | readers with a saved place | ledger entries created | series_reads |
|---|---|---|---|
| beta-princess-i1 | 11 | 11 | 11 |
| beta-princess-i2 | 2 | 2 | 2 |
| beta-princess-i3 | 2 | 2 | 2 |
| diary-of-a-lagos-9-5er-i1 | 5 | 5 | 5 |
| diary-of-a-lagos-9-5er-i2 | 2 | 2 | 2 |
| diary-of-a-lagos-9-5er-i3 | 1 | 1 | 1 |
| the-doherty-confessions-i1 | 2 | 0 (both already in the ledger) | 2 |
| the-doherty-confessions-i2 | 1 | 1 | 1 |

---

## §1 What's built

### Rulings and the threads canvas

| Ruling or behaviour | State | Where |
|---|---|---|
| 48h horizon, archive at the opening bell, thread by thread | **Built, live** | `scripts/square/horizon.mjs:117–152`, `.github/workflows/square-horizon.yml:59–60`. Last bell **16 Oct 19:16 UTC (20:16 London)**. Last run 17 Oct 17:15 UTC. 4 records in the room, 300 in `square_archive`. |
| Pinned post and its replies survive | **Built** | `horizon.mjs:149` (pinned protects its thread). The 4 live records are 2 pinned roots with one reply each. |
| `/square/p?id=` resolves from the archive | **Built** | `app/square/p/page.js:98–100` reads the room, then `square_archive`. |
| An archive a reader can browse | **Not built** | Only a direct permalink reaches an archived post. |
| Full identity (picture, name, handle, island badge) everywhere | **Partly** | Feed, replies, quoted card and closed preview use `identityOf()` (`page.js:1366`). **DMs** draw `users/{uid}` fields with no badge (`page.js:651–656, 703–708`). **Notifications** draw the stored `fromName` / `fromAvatarUrl` copies (`page.js:837–844`). |
| Three switches (images / pin / remove), set from an admin panel | **Partly** | Switches and panel: `app/admin/square/page.js:33–37`; rules: `users/$uid/canPin…`. Pin and remove work. **`canPostImages` grants nothing**: there's no upload path (`page.js:897–910`). Live holders: 2 / 2 / 2. |
| 500 for posts, 300 for replies, counter at 80% | **Built** | `app/lib/squarePostBody.js` (`refusalFor`, `showCounter`). Rules: `square_posts/$postId/text`. All four inputs are covered. |
| Report made real | **Built for posts**, never used | `page.js:1305–1314` writes to `square_reports`. The queue is in `/admin/square`. **0 reports filed, ever.** |
| Blocking | **Not built** in the Square | `blocked_users` is read only by Open Pages comments (`app/open-pages/[id]/page-client.js:253`). |
| Replies nest one level with "Replying to @name" | **Not built** | Replies render one flat level under the root (`page.js:1694–1739`). A reply to a reply has no composer (see §2). |
| Fold after two behind "View N more replies" | **Not built** | Every reply is always drawn (4 of 4 in the test). |
| A removed reply leaves "This reply was removed." | **Not built** | A reply with no children is **hard-deleted** (`page.js:1297`). A withdrawn record says "The author withdrew this reply." (`squarePostBody.js:201`), **even when a moderator removed it**. |
| Your own reply shows at once | **Built, by accident of the SDK** | `push()` fires the local child event straight away. Nothing marks the reply as pending. |
| Oldest first | **Built** | `page.js:1348` |
| A failed reply shows "Not sent." with Try again and Remove | **Not built** | The `catch` only writes to the console (`page.js:1180`). |
| Same on web and app | Unknown here | The app's Square is A40. |
| Opens 20:00 London, with a countdown while shut | **Built, client-side only** | `page.js:60–74, 1480–1528`. The room is open 20:00–24:00. |
| Saturday community event (a story picked days before) | **Not built** | Nothing in the code. |
| Notifications for the event | **Not built** | The push server's channel is `stories` only. The Square has no push at all. |
| DMs stay | **Built, but nobody can start one** | `page.js:527–769`. "+ New" searches the `users` root, which only founders may read. **Permission denied** at all three widths. |
| A reported DM shows a moderator only that message and the snippet | **Half built** | The rules (`content_reports`, `kind: 'dm'`, snapshot prefix check) and `/admin/reports` are built. **The web DM panel has no Report control**; `app/lib/contentReports.js` is imported only by the admin page. 0 DM reports. |

### The R33 security findings

| Finding | State | How |
|---|---|---|
| Forged author fields | **Closed** | Rules: `authorUid === auth.uid` on create; `authorName`, `authorAvatarUrl`, `authorHandle`, `isAuthor` and `authorReadCount` are each validated against the reader's record (`database.rules.json:467–` `square_posts`). The page also resolves identity at render. |
| Self-pinning | **Closed** | Rules: `pinned: true` needs `canPin`. |
| Cascade-deleting others' replies | **Closed** | Client: a root with replies is withdrawn, not deleted (`page.js:1291`). Rules: only the author or `canRemovePosts` may write the record. |
| Open reaction counts | **Not closed** | `likeCount` / `fireCount` / `clapCount` carry `.write: auth != null` and allow ±1 per write (`database.rules.json:487–`). Nothing ties a count to `square_reactions`, so any signed-in reader can push a count up without limit, one write at a time. |
| Future-dated posts | **Mostly closed** | `createdAt <= now + 300000`. But the author may rewrite `createdAt` on any later write, which can keep a thread inside the horizon indefinitely. Past-dating is unrestricted. |
| Advisory limits | **Mostly closed** | Text caps are in the rules. Still open: `poll/*` other than `votes` is unvalidated (no `$other` under `poll`, `rules:499`); the 5-minute edit window exists only in the client (`page.js:295`); the `user_square_posts` mirror allows 10,000 characters. |
| Client-only opening hours | **Not closed** | No rule reads the time. 1 record in the last 30 days was written before 20:00 London. |
| No rate limits | **Not closed** | Posts, replies, reactions, notifications and DMs are all direct client writes. |
| Report doing nothing | **Closed for posts** | `square_reports` and `/admin/square`. DMs: see above. |
| No blocking or muting | **Not closed** | Nothing in the Square or the DMs. |
| Fragment links | **Partly** | "Copy link" uses `/square/p?id=` (`page.js:308`). Still on `/square#id`, which is dead once a post is archived: the notifications panel (`page.js:829`), `/profile` (`app/profile/page.js:226`) and `/user` (`app/user/page.js:143`). |

---

## §2 What's broken

### The reply, exactly

I reproduced every case on the emulator at 1280px and at 390px (iPhone 13 profile). The results
were identical at both widths.

1. **A reply that @mentions someone is saved, but the reader is told nothing and it gets posted
   twice.** This is the bug a reader will actually meet. `reply()` saves the record, then awaits
   `sendNotifications()` before it clears the box (`page.js:1176–1179`). For each `@word`,
   `sendNotifications` looks up `usernames/<word>` **exactly as typed**. The index is lowercase,
   so `@Bee` misses. On a miss it falls back to reading the whole `users` root (`page.js:1085`),
   which the rules allow **only founders** to read. That read throws `Permission denied`, the
   catch at `:1180` logs it, and `setReplyText('')` / `setReplyTo(null)` never run. The box stays
   open with the text still in it and no message. Pressing Reply again **posts a duplicate**:
   measured, 2 identical replies saved. A lowercase `@bee` that is in the index goes through
   cleanly. **`post()` has the same flaw** (`page.js:1146`), and for a root post it also fans out
   one notification per follower before the box clears.
2. **Replying to a reply does nothing.** Every reply carries a "reply" button (`ReactionBar`,
   `page.js:1376`). Pressing it sets `replyTo` to the reply's id, and the label turns to
   "cancel". But a composer is only ever drawn for a root (`replyTo === p.id`, `page.js:1675`), so
   no box appears (1 textarea before, 1 after). If one were drawn, a grandchild would still be
   invisible, because only roots fetch children (`page.js:1343, 1348`).
3. **A refused reply flashes into the thread, vanishes, and says nothing.** I tested this with a
   reader whose stored `username` isn't theirs in the index, which is a legacy record shape;
   `authorHandle` then fails its rule. The SDK draws the reply locally, the server refuses it, the
   reply disappears, and the text stays in a live box with no message.
4. **Offline, the reply hangs and blocks posting too.** The reply is drawn locally with nothing to
   mark it pending. The Reply button sticks on "…" and **the main Post button sticks on
   "POSTING…"**, because both share one `posting` flag (`page.js:865`). Closing the tab loses
   the write without a word.
5. **No folding, no "Replying to @name".** Both are absent (§1).
6. **The phone keyboard: I couldn't prove a defect, with one caveat.** Text fields are at 16px, so
   there is no zoom. Emulation can't raise a real keyboard. When I shrank the viewport to 55%
   after focus, the reply box stayed below the fold and the fixed tab bar (64px, z 900) held the
   bottom of the visible area. There is no `visualViewport` handling on this page. Check this on a
   real phone in the rebuild.

Smaller faults in the same flow: `replyText` is shared, so text typed under one post follows the
reader to the next post they open; and the reply notification fires before the mention loop can
fail, so the author is notified of a reply that the reader believes failed.

### Everything else, worst first

1. **No one but a founder can start a DM.** "+ New" reads the `users` root: `Permission denied`
   at 390, 834 and 1280 (`page.js:598`). The last DM in the whole database is from **7 Apr 2026**.
2. **@mention autocomplete is dead for readers.** `MentionDropdown` reads the `users` root, which
   throws an uncaught `Permission denied` on every keystroke after `@` (`page.js:205`). No
   dropdown appears. It also filters on `username`, which newer records may not carry.
3. **Notification links are fragments** (`/square#id`, `page.js:829`). They break once a post is
   archived. They're also dead for an open room, because nothing scrolls to the anchor after the
   async feed loads.
4. **The notification copy is wrong in places.** `square_quote` has no label, so the row reads as
   a bare name (`page.js:797–813`). `fire` renders an emoji, against the house no-emoji rule
   (`:804, :811`). `clap` and `like` both read "liked your post".
5. **The cookie banner (z 9999) covers the DM panel's "+ New" at 390px** on a first visit, and it
   intercepts the tap.
6. **A moderator's removal is labelled as the author's own withdrawal** ("The author withdrew…").
7. **Poll: "Closes just now" for a poll that closes days away.** `timeAgo` is fed a future time
   (`page.js:284`).
8. **"N in the room" counts open tabs, not the room.** Presence is written on page load whether the
   room is open or shut (`page.js:977–979`). There were 3 entries at 19:00 London, while the room
   was shut.
9. **The story picker downloads the whole `cms_stories` node**, bodies and unpublished records
   included (`page.js:1059`). Already known from W1 and still unfixed.

**Layout:** at 390, 834 and 1280px, in six states (open signed in, open signed out, closed, empty,
DM panel, notifications panel), **nothing overflows**. `scrollWidth === clientWidth`, and W48's
card-width check found 0 elements outside the screen, long unbroken tokens included.
**Loading** has its W2 deadline and Unavailable state. **Empty** reads "No posts yet. Be the first
to say something." **Closed** draws the countdown and a dimmed "Last night in the Square". Apart
from the `Permission denied` errors above, the console was clean in every state.

---

## §3 How it's used (live, last 30 days: 17 Sep – 17 Oct)

| London night | roots | replies | quotes | reactions | DMs | distinct posters |
|---|---|---|---|---|---|---|
| Fri 18 Sep | 10 | 0 | 0 | 2 | 0 | 1 |
| Sat 19 Sep | 7 | 8 | 0 | 12 | 0 | 4 |
| Sat 26 Sep | 19 | 32 | 3 | 71 | 0 | 7 |
| Sat 3 Oct | 7 | 10 | 0 | 14 | 0 | 4 |
| Sat 10 Oct | 1 | 1 | 0 | 1 | 0 | 2 |

- **95 records (44 roots, 51 replies) from 9 distinct posters, on 5 nights.** Nothing has been
  posted since 10 Oct.
- **Saturday against the rest:** every night with real conversation was a Saturday (4 nights:
  8.5 roots, 12.8 replies and 4.3 posters on average). The one other night was a single poster
  writing 10 roots with no replies.
- **Stories:** 1 root of 44 (2%) carries an attachment, and it is an Open Pages piece. **No story
  was attached.** 11 more roots name a story in the text only.
- 0 polls. 1 record written before 20:00 London.
- **DMs: 0 in 30 days.** All-time: 10 messages in 3 conversations, the last on 7 Apr.
- **Readers who open the Square without posting: not recorded.** `square_presence` is live-only
  and keeps no history.

Reactions are counted from `square_reactions` / `square_archive_reactions` and attributed to the
night of the post they're on.

---

## §4 What it would take

### The data model and rules, on one page

| Node | Shape | Read | Write |
|---|---|---|---|
| `square_posts/{id}` | `text, authorUid, createdAt, parentId?, quotedPostId?, attachedStory{7}?, attachedOpenPage{3}?, poll{question,options,closesAt,votes/{uid}}?, pinned, unpinnedAt, edited, withdrawn, withdrawnAt, likeCount/fireCount/clapCount`, plus stored identity copies (`authorName, authorHandle, authorAvatarUrl, authorInitials, authorReadCount, isAuthor, authorPlatformAvatar`). `$other: false`. Indexed on `parentId`, `createdAt`. | public | author creates/edits/deletes; `canRemovePosts` any write; `canPin` may change pin fields only; counts: any signed-in reader ±1 |
| `square_reactions/{post}/{like\|clap\|fire}/{uid}` | `true` | public | own uid |
| `square_likes/{post}/{uid}` | legacy | public | own uid |
| `square_archive`, `square_archive_reactions` | same shapes, moved by the bell | public | none (Admin SDK) |
| `square_horizon` | `lastBellAt, lastRunAt, lastRunHour, remaining, sweptAtLastRun` | public | none (Admin SDK) |
| `square_presence/{uid}` | bool/number | public | own uid |
| `user_square_posts/{uid}/{id}` | mirror of each post (text ≤ 10,000) | public | owner; founders may edit |
| `square_reports/{post}/{reporter}` | `reason, note, reporterUid, postAuthorUid, createdAt`, plus `resolved*` | `canRemovePosts`; a reporter reads their own | reporter, create once |
| `reports/{post}/{uid}` | legacy, unvalidated | founders | anyone, own uid |
| `notifications/{uid}/{id}` | `type, createdAt, fromUid, fromName, …, read` | owner | anyone, if `fromUid === auth.uid`; only the owner flips `read` |
| `dm_conversations/{uid}/{a_b}` | `unread, lastAt` | owner | either participant |
| `dm_messages/{a_b}/{id}` | `text ≤ 5000, senderUid, createdAt, imageUrl?` | participants | participants, create only |
| `content_reports/dm_{a}_{b}/{reporter}` | snapshot-checked DM report | `canRemovePosts` | reporter |
| `blocked_users/{uid}` | owner-private | owner | owner |
| `users/{uid}/canPin, canRemovePosts, canPostImages` | booleans | public | founders |

Writers outside the client: the horizon worker, an hourly GitHub Action with an Admin SDK.
**There is no Square endpoint, no rate limit and no server check on hours.**

### What each fix touches, and what must come first

1. **First: one way to find a reader by handle without the `users` root.** This unblocks the
   mention fallback (the duplicate-reply bug), autocomplete and "+ New" DM. Lowercase the mention
   before the `usernames` lookup and drop the `users` fallback. For search-as-you-type, use
   `user_search` (W46's index). Client-only; no rules change. **Ship this first, alone.** It fixes
   the live reply bug and DMs tonight.
2. **The reply state machine** (pending → sent / "Not sent." + Try again / Remove), with no
   notification awaited inside the send. Separate `posting` per composer and per-post reply text.
   Client-only. Needs ruling: does Remove delete the local draft only? It should, since nothing
   reached the server.
3. **One-level nesting, "Replying to @name", and the fold.** This needs a data decision before any
   UI work. Either a reply-to-a-reply keeps `parentId = root` and gains a `replyToId` (or a
   `replyToUid`), or `parentId` points at the reply and the horizon learns grandchildren.
   **Recommend `parentId` = root + a new `replyToId`.** The horizon already moves threads by
   root, and the 300 cap keys on `parentId`. A new key needs **a rules child first**
   (`$other: false`, W1). The app must write and read the same field, which makes this an A40
   dependency.
4. **"This reply was removed."** Stop hard-deleting replies: always write a tombstone
   (`withdrawn` + who removed it: `removedBy: 'author'|'moderator'`). Rules child first. The
   horizon carries it like any record. Then the copy can tell author from moderator.
5. **Rate limits, opening hours, reaction counts and blocking at write time.** None can be done in
   rules alone (R36: rules can't count over time). This needs a **Pages Function for Square
   writes** (`functions/api/square/post.js`), with posts closed to direct client writes once both
   clients use it. Ordering: Function live → web on it → app on it (A40) → tighten the rules. Do
   it in that order, or the app's writes start failing. Reaction counts move server-side, or
   become derived from `square_reactions` at render. Hours go in the Function.
6. **Blocking and muting.** Read-side for the feed (the Open Pages model); a write barrier for DMs.
   The write barrier needs either the Function or a public "blocked-by" index, and that index
   leaks who blocked whom. **Needs a ruling** on whether DM blocking may be server-side only.
   **DM Report button**: the plumbing exists (`app/lib/contentReports.js`); only the control is
   missing.
7. **Links.** Point the notifications panel, `/profile` and `/user` at `/square/p?id=`. Client-only,
   and independent of everything else.
8. **The Saturday event.** Entirely new: an event record (story, date, picked-by), a pick/vote
   flow days before, a room treatment on the night, and a push. The push needs a **new channel**,
   because 'stories' is ruled. That is a server-side push job like the `stories` announcer, and an
   app release for the channel. Comes after 1–5; the room should work before it's promoted.
9. **Images (`canPostImages`).** Needs a Function to mint uploads, because storage rules can't read
   RTDB. Its own round, as R43 said.
10. **Archive browsing.** Read-only over `square_archive` (public), so it can come any time.

### What the app will need to mirror (for A40)

- The handle-lookup fix and the same lowercase rule for mentions.
- The reply states and copy ("Not sent.", Try again, Remove), oldest first, the fold at two, and
  "View N more replies".
- The `replyToId` field (or whatever is ruled) and "Replying to @name", written by both clients
  before the rules require it.
- The tombstone shape and copy for removed replies.
- The Square write Function, once it exists. The app must move to it **before** direct writes are
  closed.
- `/square/p?id=` for every link and notification.
- DM Report and blocking, with the same `content_reports` shape.
- The event push channel and its UI, when the event is built.
