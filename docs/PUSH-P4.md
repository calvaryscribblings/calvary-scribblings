# Personal pushes (P4)

**Status (14 Nov 2026, P4-B1): BUILT, NOT DEPLOYED.** Built and tested on branch `p4-b1`. Nothing is
on main, no rules are deployed, nothing has been sent. The drain sends only to the founders' own
devices until switch-on (`FOUNDERS_ONLY`), and the launch check expects nothing of it until the
Worker's cron is on (`P4_ARMED`).

Replies, mentions, quotes, messages and follows reach the reader's phone within about a minute.
Reactions and responses arrive as one grouped line per post or story, at most hourly, and the first
of a group goes at once. Nothing arrives between 00:00 and 08:00 London: what falls due then waits
for 08:00, at most three per reader, oldest first (366). A conversation pushes at once, then at most
every two minutes (367). No reader gets more than twenty a London day (369). Every push obeys the
reader's switch for its kind, their mutes and blocks, and a muted conversation. It reads exactly as
its row in the bell (365) and opens what the row opens. Story pushes are unchanged
(`docs/PUSH-GO-LIVE.md`, their 25 Sept rules, their */15 job).

Rulings 365–369 are built as written and await Ikenna's word. Each is one constant in
`app/lib/pushP4.js`: `PUSH_QUOTED_WORDS` (365), `MORNING_CAP` (366), `CONVERSATION_INTERVAL_MS` (367),
`CHANNEL_FOR_PREF` (368, the app's names) and `DAILY_CAP` (369).

---

## How it works (P4-R0's option d)

```
reader acts ─► /api/notify ─► inbox/{uid}/{id}            (as before)
                         └──► push_queue/{uid}~{id}       (same PATCH as the old notes: no new subrequest)

push-drain-ping Worker, cron * * * * *  ──►  POST /api/push/drain  (Bearer PUSH_DRAIN_SECRET)
     calls again while { more: true }, at most 20 times a minute
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
| `functions/api/push/drain.js` | The sender. `?dry=1`: reads and decides, writes nothing, calls nobody |
| `functions/api/push/release.js` | `POST /api/push/release { installId }`: a phone gives up every row carrying its hash |
| `scripts/notify/write-rules.mjs` → `database.rules.json` | `push_queue`, `push_state` (no client), `ops/push_drain` (founders read), `pushCaps` and `installHash` on a device row |
| `scripts/push/{lib,run,store}.mjs` | `everyRowFor`, receipts expanded to every account, `prunePersonal` |
| `scripts/launch-check.mjs` | The drain's heartbeat row |
| `app/lib/useBell.js` | `seenAt` written with the server's timestamp |
| `app/notifications/settings/page.js` | Stories per 359, replies and mentions per 362; PEOPLE and YOUR WRITING built, held by `CARD_LIVE` |
| `functions/api/account/_deletion.js` | `push_state` deleted with the account |
| `workers-external/push-drain-ping.worker.js` | The ~15-line Worker; no secret in it |

### The decision, in order (`decide`)

1. The record is gone → drop. Not a personal kind → drop.
2. Founders only, and not a founder → drop (`founders_only`).
3. No eligible device → drop (`no_device`). A device is eligible when this account's row is that
   token's **newest** row across every account (a phone signed into a second account belongs to the
   second), and the row carries `pushCaps >= 1`, which only A60 writes. A60 shares runtime 1.6.0 with
   older builds, so `appVersion` can't tell them apart.
4. The reader's switch is off → drop. The switch reads `prefOn`: replies and mentions, with no value
   of their own in `notify_prefs`, are off when `users/{uid}/mentionNotifications` is false (362).
5. Nothing new since this record last pushed → drop (`nothing_new`).
6. The due time: the record's newest event; for a group already pushed, no sooner than the last push
   plus the interval (an hour for reactions and responses, two minutes for a conversation). In the
   quiet hours, 08:00 London (`held`). Later than now → `later`, and the entry's `dueAt` is moved.
7. More than two hours past due → drop (`stale`, a chosen number). Never sent late.
8. Re-checked at send time: the named actors blocked either way or muted, or the conversation muted
   → drop (`silenced`). A held push can be eight hours old.
9. Twenty already today (London) → drop (`daily_cap`). A held push, and three held already sent
   this morning → drop (`morning_cap`). It stays in the list.
10. Send.

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
| drain, 1 push | **20** |
| drain, 8 readers due at once | 3 sent in 40, 3 in 40, 2 in 30 (`more` carries the rest) |
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

## The wake-up (P4-B1 item 4): left out

Not built. Whether a Pages Function can `fetch` its own hostname, and whether that request reaches the
drain, can't be proved without a deploy, and this round deploys nothing. It would also cost one
subrequest and one request per event. The minute cron already meets "about a minute" (worst ~60 s,
typically ~30 s). Measure it in the ship round with one founder push if seconds matter.

---

## Founders only (on until switch-on)

`FOUNDERS_ONLY = true` in `app/lib/pushP4.js`. The drain drops every entry whose reader isn't in
`app/lib/founders.js` (`founders_only`) **before any read**. A founder gets every push as a reader
would, on every device whose newest row is theirs and carries `pushCaps`. So the first live personal
pushes reach only Ikenna's phones, and only those running A60.

The queue fills from the moment notify ships. Entries the drain never reaches are pruned by the job
after two days; entries it does reach are dropped as `founders_only`. Nothing is sent late at
switch-on: anything more than two hours past due is stale.

---

## Order of go-live

1. **Rules** (`npm run rules:deploy:db`) **before A60 ships.** Today's device rule refuses any child it
   doesn't list, so A60's `pushCaps` and `installHash` writes would be refused until then.
2. **Web** (merge `p4-b1`): notify enqueues, the drain and release go live. Without their secrets
   the drain answers 503.
3. **Ikenna's manual steps**, below.
4. **Cron on** (the Worker's `* * * * *`), founders only. In the same commit, `P4_ARMED = true`, so the
   launch check watches the heartbeat from then on.
5. **Founder test**: a reply, a mention, a message, a reaction twice within the hour, and one at
   night (the 08:00 hold), on Ikenna's A60 phone. Check: the words, the route opened, the badge, the
   channel.
6. **Switch-on**, one commit: `FOUNDERS_ONLY = false`, `CARD_LIVE.PEOPLE` and
   `CARD_LIVE['YOUR WRITING']` true, and the bell suite's ruling-337 expectations with them. The app
   turns on its own cards in A60.

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

- Write `pushCaps: 1` and `installHash` (SHA-256, lower-case hex, of a random install id of 32–128 URL-safe characters it keeps to itself) on its own device row.
- On reaching the signed-out state, whatever the cause, call `POST /api/push/release { installId }`.
- Create the Android channels `people` and `your_writing` (its names, 368) before a push can name them.
- The PEOPLE and YOUR WRITING cards writing `notify_prefs`. Stories per 359: on only when both fields are on, and switching sets both. Replies and mentions per 362.
- Set its own icon number when it opens (it does); write `seenAt` with the server's timestamp (it does).

## Tests

| Suite | What |
|---|---|
| `tests/ci/p4-push.test.mjs` (`test:ci`) | The switches, London's clock every 5 minutes across both clock-change days, the gates, every drop reason, the caps, devices, 359 and 362, the words through the bell, the money guard, the badge |
| `tests/notify/p4-drain.emulator.mjs` (`test:notify:emulator`) | notify enqueues within budget at 1 and 8 recipients; `replyToId` and its fallback; the drain's secrets and dry mode; **the 08:00 hold** (02:00 → 07:59 nothing → 08:00 sent) and **the hourly group** (10:00 sent, 10:20 waits, 11:00 names both) under an injected clock; 366, 367, 369; stale; **no duplicate after a crash between claim and send** (two shapes); **a block added during the hold**; founders only; newest row and pushCaps; DeviceNotRegistered; 8 readers within 45 a call; the release endpoint |
| `tests/rules/p4-push.test.mjs` (`test:rules`) | Every client (owner, stranger, founder, signed out) out of `push_queue`, `push_state` and the lease; `pushCaps` and `installHash` validated; `seenAt` as the server's timestamp; 359's two-field write |
| `tests/push/*` (`test:push`, `test:push:emulator`) | `everyRowFor`; a personal receipt and a story ticket each clearing a device under two accounts; leftovers pruned |
