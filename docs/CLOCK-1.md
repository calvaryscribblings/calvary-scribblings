# CLOCK-1 — a reliable clock for the scheduled jobs (ruling 399)

Ruling 399, yes (Ikenna, 16 Nov 2026). Built and tested on `claude/clock-1` (CLOCK-1, then CLOCK-1.1,
which made the last two jobs safe to run twice, so the clock runs **all nine**). **Not live:** no
Worker uploaded, no cron, no token, nothing dispatched.

## Why

GitHub's scheduler stopped keeping time. Over the 7 days to 16 Nov 21:39 UTC (Actions run history,
`event=schedule`, read-only):

| workflow | schedule (UTC) | runs / slots | late (median · p90 · max)¹ | longest gap |
|---|---|---|---|---|
| account-scrub | `*/15 * * * *` | 302 / 672 (45%) | 3m · 7m · 14m | 9.9h |
| backup-liveness | `0 9 * * *` | 7 / 7 | 6m · 10.2h · 10.2h | 30.4h |
| covers | `*/15 * * * *` | 304 / 672 (45%) | 1m · 5m · 14m | 9.9h |
| index-reconcile | `*/15 * * * *` | 302 / 672 (45%) | 1m · 5m · 15m | 10.1h |
| launch-check | 6 crons (see file) | 16 / 16 | 14m · 8.8h · 10.3h | 29.7h |
| proofs-mail | `7,22,37,52 * * * *` | 302 / 672 (45%) | 2m · 9m · 14m | 10.4h |
| push-announce | `*/15 * * * *` | 293 / 672 (44%) | 5m · 10m · 15m | 9.9h |
| square-horizon | `5 * * * *` | 89 / 168 (53%) | 9m · 29m · 55m | 10.9h |
| withdrawals | `7 * * * *` | 89 / 168 (53%) | 9m · 29m · 54m | 9.9h |

¹ Each run measured from the latest slot at or before it. A run that is hours late is counted against
the slot just before it, so **the missing runs are the real measure**: until 12 Nov ~21:35 UTC the
*/15 jobs ran close to every slot; since then GitHub has run them about four times a day, with gaps
of 4–10 hours. push-announce ran 3 times on 16 Nov (P4-D1). The 20:00 London Square bell was missed
on 13, 14 and 15 Nov (no square-horizon run started in London hour 20), which is why that workflow
has 10 failed runs (its liveness step). The daily launch check ran at 13:59 and 14:35 instead of
08:05.

## Inventory — what each job does, and whether two runs together are safe

Every one of the nine already has a concurrency group with `cancel-in-progress: false`, so two runs
never overlap: the second waits. "Back to back" below is the case that matters.

| workflow | what it does | double run |
|---|---|---|
| account-scrub | finishes pending deletions from `deletions/{uid}` | **Safe.** A finished deletion carries `steps.scrub` and is skipped. The deploy hook fires only when a voice or Open Pages piece came down, which the second run won't find. |
| backup-liveness | reads the backup bucket, writes `ops/backup_liveness` | **Safe.** Read plus a heartbeat. |
| covers | renders and publishes held covers | **Safe.** Content-addressed upload, atomic flip; the second run finds nothing stale. Hook only when something went live. |
| index-reconcile | repairs drifted `cms_stories_index` records | **Safe.** Idempotent; the second run finds no drift. |
| proofs-mail | POSTs `/api/proofs/mail-tick` | **Safe.** Every email is claimed by create-only/compare-and-swap before it goes (`functions/api/proofs/_mail.js`). |
| push-announce | receipts, prunes, announces new stories | **Safe.** Each announcement is claimed by a transaction before the send (`scripts/push/store.mjs` `claim`); the 2-a-day cap is read fresh by each run, and runs never overlap. Receipts are cleared once read. |
| withdrawals | flips licences past their end, summons a build | **Safe.** The second run finds nothing due: no write, no hook. |
| square-horizon | at the 20:00 London bell, moves threads past 48h to `square_archive` | **Safe since CLOCK-1.1** (was held). Before, every `--apply` run in hour 20 swept with its own clock, so a second run at 20:40 moved threads that turned 48h old after 20:00, mid-session. Now everything the bell does is **as of 20:00 London** (plan, `archivedAt`, `lastBellAt`), so any run that night moves exactly the same posts, and the **night is claimed** in `square_horizon/bell` (a transaction) before anything moves: a second run stands down and leaves the heartbeat's bell fields alone. A run that fails marks the claim `failed` and the next run that hour retries at once; one that dies silently holds the night for the 15-minute lease (the job's timeout is now 10). Never after 21:00. |
| launch-check | emails the launch table (Mondays always, daily only when red) | **Safe since CLOCK-1.1** (was held). The gate and the check read `github.event.schedule \|\| inputs.clock`, so a dispatched run sends exactly the scheduled table. A scheduled or clock run claims its **occasion** (`ops/launch_check/slots/<London date-time>`, e.g. `2026-11-17-0805`) before emailing: `sent` stops every later run; a failed send is `failed` and a later run may retry; an all-green daily is recorded `quiet`. "Since the last check" now comes from that ledger (the last occasion judged and reported), so a run that stood down never narrows the next window. A run that stood down because the table already went out exits green, so GitHub doesn't send a second alarm. A dispatch by hand is unchanged. |

The clock dispatches all nine. The `held:` mechanism stays in `clock.mjs` for the next job found
unsafe.

One thing a double run can still double is **GitHub's own failure notification**. If
backup-liveness is red, both its runs fail and GitHub mails each one. The same goes for the
horizon's liveness step. These are GitHub's alarms, not the site's emails, and they fire only
when something is already wrong.

### The shared claim (`scripts/ops/once.mjs`)

`claimed` → `done`/`sent`/`quiet` (final) or `failed` (free again at once). A `claimed` record past
`LEASE_MS` (15 min) is free again. Both jobs' workflows time out at 10 minutes, under the lease.
Both write through the guard: `square-horizon` already did, and `launch-check` now opens
`openGuard('launch-check')` for its one claim, with `GUARD_SERVICE_ACCOUNT` set to the key it already
has. `ops/launch_check` is a new node. It has no rules entry, so clients are denied by default and
only the Admin SDK writes it, which needs no rules deploy.

## What was built

- `workers-external/calvary-clock/clock.mjs`: the pure half. `SCHEDULES` (the workflows' own crons,
  copied), a POSIX cron reader, and `due(now, state)`, which returns what to fire at this minute.
  A slot fires when it's the newest one inside a 10-minute catch-up window, newer than the record,
  and not from before the clock's first tick. So a repeated minute fires nothing, a late minute
  fires its slot once, and a long outage fires each job once (the newest slot) rather than a
  backlog. Anything older is left to GitHub's schedule.
- `tick.mjs`: one tick. **Dry run unless `CLOCK_MODE` is exactly `live`.** In dry run it logs
  `would dispatch <file> for <slot>` and sends nothing. In live mode it claims the slots in the
  record **before** dispatching, then sends `POST /repos/…/actions/workflows/<file>/dispatches`
  `{ref: 'main', inputs}`. A refusal or no answer releases that claim (only if it's still this
  tick's), so the next tick inside the window tries again. It logs file names, slot times and
  status codes only.
- `worker.mjs`: the entry. `scheduled()` ticks a single Durable Object (`ClockState`) at
  `event.scheduledTime`; `fetch()` answers `GET /heartbeat` and 404s everything else. The record is
  a Durable Object, not KV. KV can read up to a minute stale in another location, and each tick can
  land anywhere, so a KV record could fire a slot twice.
- All nine workflows gain a `clock` input. It never reaches a run script: it's read only as an
  `env:` value or an `if:` (the test checks this). What each run does is set by the inputs the clock
  sends, each the value its scheduled run uses: `apply: 'true'` for scrub, covers, index, withdrawals
  and the horizon; `mode: 'apply'` for push-announce. launch-check's gate reads the `clock` cron. The
  horizon's liveness step also runs on clock runs.
- **The off switch still works.** A workflow whose `schedule:` is commented out (how push-announce
  and square-horizon are disarmed) makes the parity test fail while the clock still lists it. So
  disarming means taking it out of `clock.mjs` (or holding it) in the same commit.
- `app/lib/clock.js` + a launch-check row, **Job: clock (workflow dispatch)**. It shows NOT YET DUE
  until `CLOCK_ARMED`. Once armed it is red unless the heartbeat is `live`, has ticked within
  5 minutes, and GitHub accepted a dispatch within 20 minutes. A newer refusal is named by its
  status: an expired token reads `401`.
- `tests/ci/clock-1.test.mjs` + `tests/ci/clock-11.test.mjs` (`npm run test:clock`, also in
  `test:ci`): 101 tests. The parity test covers all nine. The horizon tests cover two runs at once,
  back to back, a first run at 20:59, a failed first run, a silently dead run, 21:05, and an
  author's deletion between the first read and the claim. The launch tests cover two runs at once,
  back to back, a failed send, a dead run, a quiet daily, a dispatched daily run and a dispatched
  Monday run, with the workflow's own shell branch executed. The mutation check: 10 mutations in
  CLOCK-1 and 20 more over both fixes, each caught.

## Cron triggers

The account has **3** cron triggers today: `calvary-hit-counter` (hourly), `calvary-newsletter`
(*/15) and `push-drain-ping` (every minute). This token can't read the plan (`/subscriptions` answers
403), but a fourth fits either way: the Free plan allows 5 per account and Paid allows 250. The
fallback isn't needed. If it ever is, run the tick inside push-drain-ping's existing minute
(`scheduled()` calls the drain, then the clock's tick, with the DO binding added to that Worker).

Durable Objects: the SQLite-backed kind is on the Free plan. One object gets about 1,440 ticks a day,
with one storage write per tick plus a claim on minutes that fire.

## Going live, in order

**1. Ikenna: the token.** GitHub → Settings → Developer settings → Fine-grained tokens → new token.
Resource owner: the account that owns this repository. Repository access: **only this
repository**. Permissions: **Actions: Read and write** (Metadata: read is added automatically).
Nothing else. Expiry: the longest allowed. Set a reminder a week before it lapses,
because an expired token reads as `401` on the launch check's clock row.

**2. Ikenna: the secret.** This step waits until step 3 has created the Worker. Then go to the
Cloudflare dashboard → Workers → `calvary-clock` → Settings → Variables and Secrets → add a
**Secret**, `GITHUB_DISPATCH_TOKEN`, and paste the token. Never paste it anywhere else.

**3. The upload round (CLOCK-2), outside 19:30–00:00 London.**
1. Merge `claude/clock-1` to main **before 19:30**. The workflow files must carry the `clock` input on
   main, or GitHub refuses each dispatch with 422.
2. `scripts/workers/upload-clock.mjs` (to write, modelled on `upload-push-drain-ping.mjs`) uploads
   the three modules with the Durable Object binding `CLOCK → ClockState`, a `new_sqlite_classes`
   migration, and `CLOCK_MODE` **unset**, then reads them back. **No cron yet.**
3. Ikenna adds the secret (step 2).
4. Turn on the cron `* * * * *`, still in dry run. Watch the Worker's logs for an hour. Each due slot
   should appear once (`would dispatch covers.yml for …`), never twice, and `GET /heartbeat` should
   show `mode: dry-run` and a fresh `tickAt`. All nine should appear, including
   `square-horizon.yml` at :05 and `withdrawals.yml` at :07.
5. Set `CLOCK_MODE = live`, **before 19:30** London, so the first live square-horizon bell is the
   one you're watching rather than the first thing to happen. In the same session, commit
   `CLOCK_ARMED = true` and `CLOCK_HEARTBEAT_URL` in `app/lib/clock.js`, and push it before 19:30.

**4. How we'll know it works.**
- That evening: one sweep at the bell, as of 20:00. `square_horizon/bell` reads `done` for tonight,
  and GitHub's own `:05` run, whenever it lands, logs `TONIGHT'S BELL HAS ALREADY RUNG`.
  `lastBellAt` is exactly 20:00 London.
- The next 08:05 (or Monday 00:10): at most one email. `ops/launch_check/slots/<date-0805>` reads
  `sent` (red) or `quiet` (green), and GitHub's late run logs `already sent by another run` /
  `already quiet`.
- Actions: each of the nine shows `workflow_dispatch` runs at its own minutes, every slot.
  `push-announce` gets 96 a day, not 3. GitHub's late scheduled runs still appear alongside them;
  those are the fallback and are harmless (the inventory above).
- `ops/push_announcer/lastRunAt` never older than ~15 minutes. The launch check's push-announcer row
  (45-minute stale limit), red most days lately, goes green.
- The launch check's clock row is green. A day later, re-run the lateness measurement
  (dispatch runs against slots) and expect ~100% of slots within a minute or two.
- Then decide whether the workflows' own `schedule:` blocks should stay. Ruling 399 says they stay,
  as the fallback.
