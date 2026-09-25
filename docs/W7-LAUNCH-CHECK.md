# W7: launch checks — know at midnight whether every switch worked

`node scripts/launch-check.mjs` prints a table. Every row is **GREEN**, **RED** or **not yet due**
(a switch whose date hasn't come), and every row prints the evidence it read. `--email` mails the
table to Ikenna; `.github/workflows/launch-check.yml` does that on schedule. The check is
read-only against production. The only thing it sends is the email.

## The rows

| row | what it asks | before 30 Sept | after |
|---|---|---|---|
| Free week | signed-out `/api/story` for the newest archive story, this week's newest, and the newest poem | not yet due if all are `full/gating_off`; **red** if the gate is already on | green only if archive → `preview/archive`, this week → `full/free_week`, poem → `full/poetry` |
| Rebuilt since midnight | `/build.json` (new, stamped by `scripts/stamp-build-info.mjs`): `builtAt` ≥ the latest London midnight | checked daily (the Worker rebuilds after every London midnight) | same |
| Archive page is preview-only | the archive story's built HTML against a sample of its ending taken from `story_bodies` (`endingOf`, `scripts/check-built-gate.mjs`) | not yet due (the page carries the body and locks itself at the switch) | red if the ending is in the HTML |
| Series | signed-out `/api/series/stream` for the first released Platinum-only instalment | not yet due if it opens; red if refused early | green on 401/403 |
| Book Store | `/bookstore` answers 200, and published titles exist | not yet due (the curtain lifts by date) | green with both |
| Memberships | `/api/ops/launch-status`: booleans only (sale flag; each rail's live key, live prices/plans and webhook secret) | not yet due, with the booleans printed | green only if every one is true |
| Job: scheduled publish | `ops/publish_heartbeat.lastTickAt` (new, written by the Worker each tick) | stale after 40 min | same |
| Job: account scrub | `ops/account_scrub.lastRunAt` (new, written after each applied run) | stale after 45 min | same |
| Job: push announcer | `ops/push_announcer.lastRunAt` | not yet due while its cron is commented out | stale after 45 min once armed |
| Signals | `ops/money_failures` (unresolved, `lastAt` after the last check) and `ops/publish_skips` (`at` after the last check) | red on any new one | same |

"Since the last check" is the previous launch-check workflow run's start time, read from GitHub
(read-only). If there is none, it is 24 hours ago.

## Without a new secret

The Resend key lives only in the Pages project, and this codespace can't set GitHub secrets. So
the workflow mails through **`POST /api/ops/launch-email`**:
- **Recipient:** fixed server-side (`LAUNCH_ALERT_EMAIL`, else Ikenna's address), never read from
  the request.
- **Subject:** must begin "[launch] ".
- **Auth:** it and `/api/ops/launch-status` authorise via `functions/api/ops/_opsAuth.js`: either
  a founder's ID token, or a five-minute JWT the check signs with the service-account key Actions
  already holds. That JWT is verified against Google's published keys for this project's account.
  Nothing new to rotate, and no new sign-in account.

## The schedule, in London time

GitHub's cron is UTC-only, so each London time is written as the UTC cron(s) it can be.
`scripts/launch-check-gate.mjs` keeps the right one, using the cron string that fired
(`github.event.schedule`), so a run GitHub delays still counts.

| London | cron (UTC) | valid when |
|---|---|---|
| 30 Sept 00:10 | `10 23 29 9 *` | London date is 2026-09-30 and BST |
| 30 Sept 08:05 | `5 7 30 9 *` | London date is 2026-09-30 and BST |
| Monday 00:10 (BST) | `10 23 * * 0` | London is on BST |
| Monday 00:10 (GMT) | `10 0 * * 1` | London is on GMT |

The first Monday run is 28 Sept, and the switch runs follow. A red row fails the job **after**
the email goes, so the Actions tab shows it as well.

## Tests

`tests/ci/w7-launch-check.test.mjs` (25):
- every row forced green, red and not yet due;
- London midnight in BST, in GMT, and on the night the clocks change;
- the gate, including "never both Monday crons" and "not again next year";
- the signed token: accepted, and refused for another account, a stale token, a tampered payload
  or an unknown key;
- `launch-status` returning booleans only (a live key must not leak);
- `launch-email`'s fixed recipient and subject rule.

Sixteen mutations, each went red.
