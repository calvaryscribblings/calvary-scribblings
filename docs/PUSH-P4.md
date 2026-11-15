# Personal pushes (P4)

**Status (16 Nov 2026, P4-S1): switch-on is live, with ruling 381's gate.** Ikenna's founder test passed (steps 1–15, the two Square steps included), and switch-on reached main in P4-S1.
- **What switch-on did:**
  - `FOUNDERS_ONLY = false`: the drain, the instant send in notify and `/api/push/seen` act for every reader, not only the founders. Nothing else about a push changes: the same words, caps, hours (311 with 375) and drops (376).
  - `CARD_LIVE.PEOPLE` and `CARD_LIVE['YOUR WRITING']` true: the web's push settings page draws PEOPLE for everyone and YOUR WRITING for writers. THE SQUARE stays held until P7. The new-followers line reads "as they happen, except overnight" (379).
  - **No backlog went out.** While founders only, every other reader's entry was dropped as `founders_only` the first time the drain read it, before any timing, so none waited for 08:00.
- **381's gate: `PUSH_CAPS_MIN = 2`.** A62 writes `pushCaps: 2`, so personal pushes and the number-only push go only to phones on A62 or later; A60 and A61 phones (`pushCaps: 1`) keep story pushes only, which never read `pushCaps`. Until A62 reaches phones, no reader's device qualifies, founders' included, and every personal entry drops as `no_device`.
- The app's own cards come on in its own update (A62), not from this commit.
- **Rules: live** since 04:09 London (P4-B2, `npm run rules:deploy:db`).
- **Code: live.** P4-B1 is on main, and P4-B3 adds the instant send, priority, threads and the badge-only push (`a1e99d48`). **Armed in P4-B3** (founders only until switch-on): `PUSH_DRAIN_SECRET` is set on the Worker and on Pages Production, `P4_ARMED = true`, and the Worker's `* * * * *` cron is on.
- **The app: A60 live** since 05:38 London. It writes `pushCaps` and `installHash`, calls release, and creates the two channels. **One difference from this doc's plan:** for replies and mentions, A60 writes both `notify_prefs/{uid}/replies_mentions` and the old `users/{uid}/mentionNotifications`. The read (`prefOn`) agrees either way: notify_prefs's own value wins when present, and the old field is consulted only without one, so two equal values read the same.
- **Rulings 365–369: ruled yes** on 14 Nov (`docs/COPY-RULINGS.md`).
- **Rulings 375–377 (15 Nov), built in P4-B4:** messages, replies, mentions and quotes push at any hour (375); a push the reader has already seen is dropped (376); the settings page's moon note says so (377).
- **Founders only** (`FOUNDERS_ONLY`) until switch-on; `false` since P4-S1.

Replies, mentions, quotes, messages and follows leave for the reader's phone the moment the event
lands, as a standard app's do: the notify call sends its own push (P4-B3). Reactions and responses arrive as one grouped line per post or story, at most hourly, and the first
of a group goes at once. Every personal push is high priority, so a sleeping Android phone wakes for it. Messages, replies, mentions and quotes arrive at any hour (375).
Anything else that falls due between 00:00 and 08:00 London waits for 08:00, at most three per reader, oldest first (311, 366).
A push whose row the reader has already seen by the time it's due is dropped, and so is a message
whose conversation they've read since (376). A conversation pushes at once, then at most
every two minutes (367). No reader gets more than twenty a London day (369). Every push obeys the
reader's switch for its kind, their mutes and blocks, and a muted conversation. It reads exactly as
its row in the bell (365) and opens what the row opens. Story pushes are unchanged
(`docs/PUSH-GO-LIVE.md`, their 25 Sept rules, their */15 job).

Rulings 365–369 (ruled yes 14 Nov) are each one constant in `app/lib/pushP4.js`: `PUSH_QUOTED_WORDS` (365), `MORNING_CAP` (366), `CONVERSATION_INTERVAL_MS` (367),
`CHANNEL_FOR_PREF` (368, the app's names) and `DAILY_CAP` (369). Ruling 375 is `ANY_HOUR_KINDS`;
376 is the `seen` step of `decide` (below).

### Rulings 375–377 (15 Nov, P4-B4)

- **375.** `holdsForMorning(kind)` is false for `message`, `reply`, `mention` and `quote`, so their
  `dueTime` never moves to 08:00. Everything else keeps 311's hold and 366's three. Caps and
  intervals are unchanged (367, 369, 310, 318). **At deploy:** an entry the drain had already moved
  to 08:00 (`later` writes the entry's `dueAt`) keeps 08:00 and counts as one of that morning's three.
  Nothing is sent at deploy time, and nothing is dropped as stale at 08:00 because the kind no
  longer waits. `decide` honours a stored `dueAt` only when it is exactly 08:00 London and later
  than the computed due time, so a conversation's two minutes never pass for one.
- **376.** When an entry falls due, `decide` drops it (`seen`) if the reader's `seenAt` is at or after
  the row's newest event (`record.at`). For a message, a conversation read since counts too: its
  unread count, `dm_conversations/{uid}/{convId}/unread`, is 0. That count is written by the
  **sender's** client, just after the message and after notify is called, so at the instant send it
  can still read 0 from an earlier read. The drain believes it only 15 seconds after the message
  (`DM_READ_GRACE_MS`, a chosen number). The instant send never reads it, and pays no subrequest.
  The badge and every other reason are unchanged.
- **377.** The moon note on `/notifications/settings`: "Messages, replies and mentions reach you at
  any hour. Anything else that comes between midnight and 08:00 London waits until 08:00, when the
  first three arrive. The rest stay in your notifications." The app's copy follows in its own update.

---

## How it works (P4-R0's option d)

```
reader acts ─► /api/notify ─► inbox/{uid}/{id}            (as before)
                         ├──► push_queue/{uid}~{id}       (same PATCH as the old notes: no new subrequest)
                         └──► after the response (waitUntil): drainNow, the drain's own pass over
                              exactly what was just queued, with the budget left   (P4-B3, at once)

a list writes seenAt ─► /api/push/seen ─► push_queue/{uid}~_badge ─► drainNow     (P4-B3, badge-only)

push-drain-ping Worker, cron * * * * *  ──►  POST /api/push/drain  (Bearer PUSH_DRAIN_SECRET)
     THE BACKSTOP: held pushes (08:00), the hourly groups, 367's two minutes, the badge's minute,
     and whatever the instant send's budget couldn't fit. Calls again while { more: true }, at most
     20 times a minute
                         │ reads the due entries, decides each (app/lib/pushP4.js decide)
                         │ CLAIM: one PATCH (push_state, the queue marks) before Expo
                         │ one Expo request (EXPO_ACCESS_TOKEN); tickets → push_receipts
                         └ FINISH: one PATCH (receipts, dead devices, heartbeat, lease)

push-announce job, */15 ─► receipts (story + personal), DeviceNotRegistered removes every row for
                           that device, 60-day prune, personal leftovers older than 2 days
launch check           ─► red when ops/push_drain/lastRunAt is > 5 min old, once P4_ARMED
```

### The pieces

| File | What |
|---|---|
| `app/lib/pushP4.js` | Every number and decision, pure: the switches, London's clock, `dueTime`, `decide`, `devicesFor`, `prefOn` (359, 362), `prefWrites` |
| `app/lib/pushWords.js` | The words, the bell's own (`fromInbox`, `headline`, `secondLine`); the money guard; the badge (`buildList` + `unreadCount`) |
| `functions/api/_notify.js` | `deliver` enqueues each delivered pushing record in its one PATCH, reserved before admission (`patchCost`) |
| `functions/api/notify.js` | The comment event tells the author of the reply answered (`replyToId`), falling back to `parentId` |
| `functions/api/push/drain.js` | The sender, one pass (`drainPass`) behind two doors: the cron's `POST /api/push/drain` and the instant `drainNow`. `?dry=1`: reads and decides, writes nothing, calls nobody. `personalMessage`, `badgeMessage`, `pushIds` |
| `functions/api/push/seen.js` | `POST /api/push/seen` (ID token): queues the reader's badge-only push and sends it at once (P4-B3) |
| `app/lib/pushSeenClient.js` | The web's call to it, after `useBell` saves `seenAt` |
| `functions/api/push/release.js` | `POST /api/push/release { installId }`: a phone gives up every row carrying its hash |
| `scripts/notify/write-rules.mjs` → `database.rules.json` | `push_queue`, `push_state` (no client), `ops/push_drain` (founders read), `pushCaps` and `installHash` on a device row |
| `scripts/push/{lib,run,store}.mjs` | `everyRowFor`, receipts expanded to every account, `prunePersonal` |
| `scripts/launch-check.mjs` | The drain's heartbeat row |
| `app/lib/useBell.js` | `seenAt` written with the server's timestamp |
| `app/notifications/settings/page.js` | Stories per 359, replies and mentions per 362; PEOPLE and YOUR WRITING drawn at switch-on (`CARD_LIVE`), THE SQUARE held until P7 |
| `functions/api/account/_deletion.js` | `push_state` deleted with the account |
| `workers-external/push-drain-ping.worker.js` | The ~15-line Worker; no secret in it |

### The decision, in order (`decide`)

1. The record is gone → drop. Not a personal kind → drop.
2. Founders only, and not a founder → drop (`founders_only`).
3. No eligible device → drop (`no_device`). A device is eligible when this account's row is that
   token's **newest** row across every account (a phone signed into a second account belongs to the
   second), and the row carries `pushCaps >= PUSH_CAPS_MIN`: 2 since ruling 381, which A62 writes (A60
   and A61 write 1). A60 shares runtime 1.6.0 with older builds, so `appVersion` can't tell them apart.
4. The reader's switch is off → drop. The switch reads `prefOn`: replies and mentions, with no value
   of their own in `notify_prefs`, are off when `users/{uid}/mentionNotifications` is false (362).
5. Nothing new since this record last pushed → drop (`nothing_new`).
6. The due time: the record's newest event; for a group already pushed, no sooner than the last push
   plus the interval (an hour for reactions and responses, two minutes for a conversation). In the
   quiet hours, 08:00 London (`held`), except for a message, a reply, a mention or a quote (375). An
   entry already moved to 08:00 before 375 keeps it. Later than now → `later`, and the entry's
   `dueAt` is moved.
7. Seen by now → drop (`seen`, 376): `seenAt` at or after the row's newest event, or, for a message,
   its conversation's unread count at 0 once 15 seconds have passed.
8. More than two hours past due → drop (`stale`, a chosen number). Never sent late.
9. Re-checked at send time: the named actors blocked either way or muted, or the conversation muted
   → drop (`silenced`). A held push can be eight hours old.
10. Twenty already today (London) → drop (`daily_cap`). A held push, and three held already sent
   this morning → drop (`morning_cap`). It stays in the list.
11. Send.

### At most once

The claim PATCH marks each handled entry `{ state, claimedFor: its at, claimedAt }` and records the
push in `push_state` **before** Expo is called. A later run deletes any entry whose `claimedFor`
equals its `at`. A run that claimed and then died is never repeated, and one Expo attempt is made, no
retry. If notify rewrites an entry after the claim (a new event), its `at` moves, so it's new.
`tests/notify/p4-drain.emulator.mjs` proves both crash shapes.

### The words (365)

The title is the row's headline and the body its second line. A row without a second line pushes
its headline as the body. A message names the sender and the count, never the words. A reply,
mention or quote carries the quoted words its row quotes (`PUSH_QUOTED_WORDS`; false keeps titles
only). The story pushes' guard applies: a second line with an amount, a purchase or the Book Store is
dropped, and a headline with one refuses the push. `data.url` is the row's href; `/notifications`
when a row has none.

### The badge

The bell's own count: inbox records and story announcements newer than `inbox_state/{uid}/seenAt`,
without anyone the reader mutes or blocks (`badgeFor`). A reader with no `seenAt` gets no badge field
(the icon is left as it is). The app writes `seenAt` with the server's timestamp when its list
opens; the web now does too. It costs 1 query per sending reader plus 1 shared announcements query
per call.

What it can't count: anything that never reached `inbox/` (since A58 the app calls `/api/notify`
for every event), and anything read on another device after the push left (the app sets its own
number when it opens).

---

## Budgets, measured (`npm run test:notify:emulator`, under the 50-subrequest shim)

| Call | Subrequests (plan 45) |
|---|---:|
| notify, 1 recipient (a Square reply) | **10**, as before: the queue entry rides the old-note PATCH |
| notify, a message (no old note) | **11**: the one PATCH, reserved |
| notify, 8 recipients (a reply to a reply naming 6, on a writer's story) | **39**, as before |
| drain, empty queue | ≤ 3 (token, query, heartbeat) |
| drain, 1 push | **21** (the lease before the read, P4-B3) |
| drain, 8 readers due at once | 3 sent in 41, 3 in 41, 2 in 31 (`more` carries the rest) |
| notify + its instant send, 1 recipient | **29** in one request |
| seen + its badge-only send | **17** |
| release | ≤ 3 |

Throughput is about **3 readers per drain call**: each reader costs about 7 reads (switches, old
field, state, mutes, blocks, seenAt, badge) and each push about 7 more, beside a reserve of 4. The
Worker calls up to 20 times a minute, so up to ~60 readers a minute. At today's scale (14 phones) the
08:00 batch is one call. At ten times that, a 300-push morning would take about 5 minutes. The
whole-node-read mode in P4-R0 would halve it; it isn't built, because a minute's idle cost stays at 2
subrequests and no bandwidth.

Cloudflare: 1,440 Worker invocations and 1,440+ drain requests a day, about 3% of the free plan's
100,000.

---

## Instant (P4-B3 item 1)

When notify's writes are done, it hands the keys it just queued to `drainNow`, inside
`context.waitUntil`, so the response goes first and the event isn't slowed. `drainNow` is the
drain's own pass (`drainPass`): the same lease, the same reads, the same `decide`, the same claim
before Expo, the same finish. There is no second sender. It reads only what this call queued (one
indexed query: those entries carry `dueAt` = the call's own clock), and it spends only the budget
notify left. It starts only with room for one whole entry (`INSTANT_FLOOR`, 22). Whatever it can't
fit, or finds the lease held for, stays queued for the cron. It never writes `lastRunAt`, which
stays the proof that the cron runs. It writes `ops/push_drain/lastInstant` instead.

**The lease now comes before the read**, in both doors. Two passes can now start in the same second,
and a pass that read first could act on entries another pass finished while it waited. The cron
pays one more query for it when the queue isn't empty (a 1-push drain is now 21 subrequests, not 20).
`tests/notify/p4-instant.emulator.mjs` runs notify's instant send and the cron together, five
times, and gets exactly one push each time.

Dormant until `P4_ARMED`, and only where both drain secrets are set (`sendsNow`). A preview
deployment has neither, so it never sends.

**Measured** (emulator, Expo stand-in, 2 s chosen bound):

| Event | At once | By the cron |
|---|---|---|
| 1 recipient (a Square reply) | **1**, ~0.1–0.4 s from the notify call to the push leaving; 29 subrequests in all | none |
| A Square post mentioning 2–4 readers | the first reader | the rest, within the minute |
| 5–6 mentions | none (notify leaves < 22) | all |
| 8 recipients (reply-to-reply + 6 mentions + the writer) | none (notify uses 39, leaving 6) | all 8: 3 + 3 + 2 per call |

Most events have one recipient (a reply, a message, a reaction, a follow), so they go at once.
One event that tells several readers sends to the first at once, and the cron takes the rest
within a minute.

## On the phone (P4-B3 items 2 and 3)

- **`priority: 'high'`** on every personal push. Expo's docs say normal-priority messages "won't open
  network connections on sleeping devices" on Android. iOS's default was already high.
- **`threadId`** per thread, by what the record opens: a conversation, a Square post's thread, an Open
  Pages piece, a story (follows share one thread). iOS stacks a thread's pushes together.
- **`collapseId` and `tag`** (the same value) per **grouped** record only (`INBOX_KINDS[kind].group`:
  messages per conversation, reactions per post, responses and story reactions per story, follows).
  On iOS, `collapseId` replaces the line already shown. On Android, `tag` does. So "Ada and 4 others
  liked your post" replaces the earlier line. A reply, a mention or a quote never replaces another.
- All three ids are hashed (`t…`/`g…` + 32 hex). They pass through Apple and Google, and a
  conversation id holds two uids.

## Read once, the number clears everywhere (P4-B3 item 4)

`POST /api/push/seen` with the reader's ID token, called after a list writes `seenAt`. It writes
`push_queue/{uid}~_badge` (kind `_badge`, not an inbox kind) and sends it at once through
`drainNow`. The drain counts the reader's unread rows as they stand (`badgeFor`, the bell's own
count) and sends `{ to, badge, priority }`. There is no title, no body and no sound.

- **iOS devices only.** Expo's request format lists `badge` as iOS only, so an Android row gets nothing.
- **At most one a minute per reader** (a chosen number, `BADGE_INTERVAL_MS`). A read inside the minute
  rewrites the entry, the drain moves it to the minute's end, and the cron sends the count as it
  stands then.
- **Not held for 00:00–08:00** (it shows nothing and only clears a number), and **not one of the
  twenty** (369). A reader who has never opened a list gets none (`never_seen`). A reader whose
  ordinary push goes in the same pass gets that push's badge instead (`covered`).
- Dormant until armed; founders only while `FOUNDERS_ONLY` (nothing is written for anyone else).
- The web calls it from `useBell.markSeen`, after `seenAt` saves. The app calls it in A61.

**Checked against Expo's docs:** they list `badge` (iOS) and say only `to` is required, but they
don't say what a message with neither title nor body does. Apple's documentation for an `aps`
payload holding only `badge` (the number changes, nothing is shown) couldn't be read from here.
**The founder test must confirm it on the phone:** the number changes, and no banner, sound or
blank notification appears.

## Founders only (on until switch-on)

`FOUNDERS_ONLY = true` in `app/lib/pushP4.js` on main until switch-on; switch-on (P4-S0) sets it `false`. The drain drops every entry whose reader isn't in
`app/lib/founders.js` (`founders_only`) **before any read**. A founder gets every push as a reader
would, on every device whose newest row is theirs and carries `pushCaps`. So the first live personal
pushes reach only Ikenna's phones, and only those running A60.

The queue fills from the moment notify ships. Entries the drain never reaches are pruned by the job
after two days; entries it does reach are dropped as `founders_only`. Nothing is sent late at
switch-on: anything more than two hours past due is stale.

---

## Order of go-live

1. **Rules**: DONE, live 04:09 London 14 Nov (P4-B2).
2. **Web**: DONE. P4-B1 is on main, and P4-B3 adds instant, priority, threads and seen. All of it is dormant.
   **A60**: DONE, live 05:38 London.
3. **Secrets**: `EXPO_ACCESS_TOKEN` was set by Ikenna. `PUSH_DRAIN_SECRET` is set in P4-B3 on the Worker
   and on Pages Production.
4. **Cron on** (the Worker's `* * * * *`), founders only. `P4_ARMED = true` is committed first, which also wakes
   the instant send and `/api/push/seen`, then the cron is added. The launch check watches the heartbeat from then on.
5. **Founder test**: a reply, a mention, a message, a reaction twice within the hour, and at night
   a message (at once, 375) and a reaction (the 08:00 hold), on Ikenna's A60 phone. Check: the words,
   the route opened, the badge, the channel, and that a push seen before it's due never arrives (376).
6. **Switch-on**, one commit: `FOUNDERS_ONLY = false`, `CARD_LIVE.PEOPLE` and
   `CARD_LIVE['YOUR WRITING']` true, and the bell suite's ruling-337 expectations with them. The app's
   cards come on in the app's own update at switch-on, not in A60. **Built in P4-S0** on
   `claude/p4-switch-on`; **live in P4-S1** (16 Nov), with 381's `PUSH_CAPS_MIN = 2`.

## Ikenna's manual steps (to be checked against current Expo and Cloudflare docs before he gets them)

1. **Expo:** create a second access token for the drain (e.g. `calvary-push-drain`), so it can be
   revoked without touching the story job's. Enhanced push security stays on.
2. **Cloudflare Pages**, project `calvary-scribblings`, **Production** environment, Variables and
   Secrets, two **Secrets** (not plain text):
   - `EXPO_ACCESS_TOKEN`: the drain's Expo token.
   - `PUSH_DRAIN_SECRET`: a long random string (48+ characters), generated on his own machine.
   - Nothing on Preview, so a preview deployment's drain refuses (503).
   - A new Pages secret takes effect on the next deployment.
3. **Cloudflare Workers**: create a Worker named `push-drain-ping`, paste
   `workers-external/push-drain-ping.worker.js` as it is, and add the Secret `PUSH_DRAIN_SECRET`
   (the same value). Add the cron trigger `* * * * *` **only at step 4 of go-live**. The account
   uses 2 cron triggers today; check the Free plan's limit.
4. **`security/KEY-ROTATION.md` §9** lists every home of these three values.

## What A60 does (the app half)

- Write `pushCaps: 1` (A62 writes 2, ruling 381) and `installHash` (SHA-256, lower-case hex, of a random install id of 32–128 URL-safe characters it keeps to itself) on its own device row.
- On reaching the signed-out state, whatever the cause, call `POST /api/push/release { installId }`.
- Create the Android channels `people` and `your_writing` (its names, 368) before a push can name them.
- The PEOPLE and YOUR WRITING cards writing `notify_prefs`. Stories per 359: on only when both fields are on, and switching sets both. Replies and mentions per 362.
- Set its own icon number when it opens (it does); write `seenAt` with the server's timestamp (it does).

## Tests

| Suite | What |
|---|---|
| `tests/ci/p4-push.test.mjs` (`test:ci`) | The switches, London's clock every 5 minutes across both clock-change days, the gates, every drop reason, the caps, devices, 359 and 362, the words through the bell, the money guard, the badge |
| `tests/notify/p4-drain.emulator.mjs` (`test:notify:emulator`) | notify enqueues within budget at 1 and 8 recipients; `replyToId` and its fallback; the drain's secrets and dry mode; **the 08:00 hold** for a reaction (02:00 → 07:59 nothing → 08:00 sent); **375** (a message and a reply at 02:00 go at 02:00; an entry held before the change keeps 08:00); **376** (a held push seen at 06:00 dropped at 08:00; a conversation read inside its two minutes sends nothing) and **the hourly group** (10:00 sent, 10:20 waits, 11:00 names both) under an injected clock; 366, 367, 369; stale; **no duplicate after a crash between claim and send** (two shapes); **a block added during the hold**; founders only; newest row and pushCaps; DeviceNotRegistered; 8 readers within 45 a call; the release endpoint |
| `tests/rules/p4-push.test.mjs` (`test:rules`) | Every client (owner, stranger, founder, signed out) out of `push_queue`, `push_state` and the lease; `pushCaps` and `installHash` validated; `seenAt` as the server's timestamp; 359's two-field write |
| `tests/push/*` (`test:push`, `test:push:emulator`) | `everyRowFor`; a personal receipt and a story ticket each clearing a device under two accounts; leftovers pruned |
| `tests/notify/p4-queue.emulator.mjs`, `tests/ci/p4-b5.test.mjs` (P4-B5) | **373**: eight recipients all sent with the clock unmoved (notify 40 with the queue send, then drain calls of 3 + 3 + 2, each ≤ 35); Square mentions 2, 4 and 6 all at once; the wake-up names nobody; the cron at the same moment sends nothing twice; a failed queue send loses nothing; a held lease retries inside the minute, then leaves it to the cron; no binding is exactly as before; wake calls write `lastWake`, never `lastRunAt` |

---

## Ruling 373: every recipient at once (P4-B5, built on `claude/p4-queue`, not deployed)

**Ruling 373:** when one event notifies several people, all of them get the push at once.

**Why the instant send alone can't.** One notify call is one request, planned to 45 subrequests.
notify spends about 4 per recipient fanning out, and the drain about 14 per recipient sending (a
reader's 7 reads and an entry's 7). So the instant send takes one recipient at most, and from five
Square mentions (or eight on a story) none: 39 of 45 are gone before it starts. Before P4-B5 the
rest waited for the minute cron. Measured on 170a1432: Square mentions 2, 3 and 4 gave 1 at once;
5 and 6 gave 0; the eight-recipient comment gave 0.

**How it works.**
- notify keeps one subrequest back when the deployment has a queue binding (`PUSH_WAKE`). After its
  instant pass has finished and given the lease back, and only if that pass left entries behind
  (`wakesDrain`: out of budget, the lease held, `more`, or a failure), it sends **one** message,
  the word `drain`, to the queue. The message names nobody: no uid, no key, no words.
- `push-drain-ping` is the queue's consumer. Its `queue()` handler runs **the cron's own loop**
  (`drainLoop`), each call a fresh `POST /api/push/drain` with its own 45, marked `?via=wake` so
  the drain writes `ops/push_drain/lastWake` and never `lastRunAt` (the cron's heartbeat stays
  the cron's). The drain reads its own queue, as it does for the cron.
- **Nothing is sent twice**, whoever calls: the drain's lease comes before its read, and every
  entry is claimed before it is sent (P4-B1, P4-B3). Two callers at the same moment: one gets
  409 and sends nothing.
- **Lease held (409), the drain unreachable or a 5xx:** the Worker retries the batch in 15 seconds,
  at most 3 tries (`WAKE_ATTEMPTS`, `WAKE_RETRY_S`; the Worker keeps its own copy of both, and
  `tests/ci/p4-b5.test.mjs` holds them equal), then acknowledges it. Whatever is left, the cron
  takes within the minute.
- **The queue send fails:** caught and logged as a code. The entries stay queued; the cron sends them.
- **No binding** (a preview, a test, or before the queue exists): notify is exactly as before.
- The cron stays the safety net, unchanged.

**Measured** (`tests/notify/p4-queue.emulator.mjs`, under the 50-subrequest shim): eight
recipients — notify 39 subrequests + 1 for the queue send = 40; then three drain calls sending
3 + 3 + 2, each at most 35; all eight with the clock unmoved. Square mentions 2, 4 and 6: every one at
once (1 + 1, 1 + 3, 0 + 6). The Worker makes one subrequest per drain call, at most 20.

### Cloudflare's free plan

- **Queues are on the Workers Free plan** since 4 Feb 2026
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/)):
  "10,000 operations/day included", and "In most cases, it takes 3 operations to deliver a message:
  1 write, 1 read, and 1 delete." Retention is "24 hours (non-configurable)"
  ([pricing](https://developers.cloudflare.com/queues/platform/pricing/)). "Each retry incurs a read
  operation."
- **What that buys.** One message per event that overflows the instant send, none for an event
  with one recipient. About 3,300 such events a day, fewer if retries are needed (each retry +1).
- **If a day's operations run out.** Cloudflare's docs don't say what `send()` does then (checked:
  pricing, limits, JavaScript APIs, 15 Nov 2026). Every outcome falls back to today's behaviour: a
  send that throws is caught and the entries wait for the cron; a message accepted and never
  delivered leaves them for the cron too; a late delivery finds them already sent and sends nothing.
  **So pushes for multi-recipient events arrive within the minute, as before P4-B5; none is lost or
  doubled.** The counter resets daily.
- Whether a queue `send()` counts toward the 50 subrequests isn't documented either; notify keeps
  one back for it.
- Drain calls made for the queue are Pages requests and count toward the free plan's 100,000 a day,
  as the cron's do (3 per eight-recipient event, about 1 per 3 readers).

### Deploy steps (the next round, after switch-on is on main)

Inside 00:00–19:30 London. Each step is proven by what was deployed, read back from Cloudflare's API
(names, types and settings only; never a binding's value, never `env_vars`), never by calling the
live site. Until step 4, nothing behaves differently: the Worker's `queue()` is never called without
a queue, and notify sends nothing without the binding.

1. **Upload push-drain-ping's code, content only.**
   `node scripts/workers/upload-push-drain-ping.mjs --expect=<main's commit before P4-B5>` (dry run:
   downloads, backs up to `calvary-private`, requires live to equal the mirror at that commit), then
   the same with `--apply`. It PUTs `/accounts/{account_id}/workers/scripts/push-drain-ping/content`:
   "Replace Worker script content without touching config or metadata"
   ([API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/update/)).
   That page doesn't name cron triggers or secrets, so read them back too.
   **Proven by:** the script's read-back (`content/v2`) byte-identical to the mirror; the Worker's
   schedules still `* * * * *` (`GET …/workers/scripts/push-drain-ping/schedules`, "Get the schedules
   (Cron Triggers) for a Worker script",
   [API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/));
   its secrets still `PUSH_DRAIN_SECRET`, `secret_text` (`GET …/secrets`,
   [API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/)).
   ⚠ That endpoint's schema allows a `text` field holding the value, so the response is reduced
   to `name` and `type` in the reading process before anything is printed. And
   `ops/push_drain/lastRunAt` still advancing each minute (read-only, times only).
2. **Create the queue `push-wake`.** `npx wrangler queues create push-wake`
   ([wrangler](https://developers.cloudflare.com/workers/wrangler/commands/queues/)), or
   `POST /accounts/{account_id}/queues` with `queue_name`
   ([API](https://developers.cloudflare.com/api/resources/queues/methods/create/)).
   **Proven by:** `GET /accounts/{account_id}/queues/{queue_id}` (or `wrangler queues info push-wake`):
   the name, and no consumers yet.
3. **Add push-drain-ping as its consumer**, without deploying the Worker:
   `npx wrangler queues consumer add push-wake push-drain-ping --batch-size 10 --batch-timeout 0 --message-retries 2 --max-concurrency 1`,
   or `POST /accounts/{account_id}/queues/{queue_id}/consumers` with `script_name: "push-drain-ping"`,
   `type: "worker"` and settings `batch_size: 10, max_wait_time_ms: 0, max_retries: 2, max_concurrency: 1`
   ([API](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/create/)).
   - **Batch timeout 0** delivers at once: the batching page's table gives `max_batch_timeout`
     "5 seconds" default, "0 seconds" minimum, "60 seconds" maximum
     ([batching](https://developers.cloudflare.com/queues/configuration/batching-retries/)).
     A second fetch of the docs found no minimum stated; if 0 is refused, use 1.
   - **Retries 2** is three tries, as the Worker counts them (it acknowledges on its third anyway).
     "Messages that reach the configured maximum retries will be deleted from the queue": with no
     dead-letter queue, that is right, because the cron still holds the entries.
   - **Concurrency 1**, against Cloudflare's general advice to leave it unset
     ([concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)):
     two loops at once would only meet the drain's lease and spend retries.
   **Proven by:** `GET /accounts/{account_id}/queues/{queue_id}/consumers`
   ([API](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/list/)):
   `script_name` and the four settings exactly as above; and step 1's schedules and `lastRunAt` again.
4. **Bind the queue to the Pages project, Production only.** Dashboard: Workers & Pages → the
   project → Settings → Bindings → Add → Queue; variable name `PUSH_WAKE`, queue `push-wake`, in the
   **Production** environment only ([Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/):
   "Redeploy your project for the binding to take effect."). The docs' steps for Queues don't show
   the environment choice, so check that Preview has no `PUSH_WAKE` after saving.
   **Proven by:** the project read back from the Pages API
   ([API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/)) and filtered, in the reading process, to
   `deployment_configs.{production,preview}.queue_producers` only (never `env_vars`, which return
   `plain_text` values): Production has `PUSH_WAKE → push-wake`, Preview has none.
5. **Push `claude/p4-queue` to main.** Its deploy carries the code and, being a new deployment,
   takes the binding.
   **Proven by:** CI green on the commit; the Pages deployment for that commit succeeded;
   `lastRunAt` still advancing; then, after the first real event with two or more recipients,
   `ops/push_drain/lastWake.at` equal to that event's minute (read-only, times and counts only).
   On the phones: a Square post by a third account mentioning both founders reaches both within
   seconds, not at the next minute.

**To undo:** remove the Pages binding and redeploy (notify is as before), or remove the consumer
(the message waits out its 24 hours unread; the cron sends everything). The Worker's previous code is
in `calvary-private` from step 1: `upload-push-drain-ping.mjs --restore=<file> --apply`.
