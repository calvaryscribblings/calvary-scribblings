# OWED — a heartbeat for the index reconciler

**Status:** on the board, not built. Raised R49, written up R50.
**Blocked on:** a `database.rules.json` change and a rules deploy against production —
a separate decision from the round that built the job.

---

## The reasoning, which is the backup watcher's

> **A disabled cron produces no run at all.** Silence is what a healthy night looks like **and**
> what a dead schedule looks like. They are the same observation.

`.github/workflows/index-reconcile.yml` runs `*/15` and repairs `cms_stories_index` records the
scheduled-publish cron writes short. It goes red when it finds something it cannot fix, which is
tempting to read as self-announcing. **It is not**, for exactly the reason above.

**GitHub disables cron schedules after 60 days without repo activity.** That is the real
silent-failure mode for everything scheduled here — `.github/workflows/backup-liveness.yml` and
`square-horizon.yml` both carry a heartbeat for this reason, and `backup-liveness.yml` says so
in its own header after R36 declared 267 characters of Ikenna's writing permanently lost on the
strength of a comment nobody had checked.

**And the 60-day window is precisely when it matters.** Publishing is *editorial* — stories go
out through the CMS at about four a week whether or not anyone pushes to this repo. So a quiet
spell in the repo is not a quiet spell in the index: it is exactly the period in which drift
accumulates with the reconciler switched off and nobody watching.

## What partly covers it today, stated honestly

`tests/ci/search-index.test.mjs` asserts **on live data** that every published story carries an
opening line. It is what caught the original defect, and it runs under `npm run test:ci` in
`rules-and-hygiene.yml`.

So the drift is not invisible — **it is invisible until somebody pushes.** That is a worse
guarantee than a heartbeat and a better one than nothing. It is also correlated with the failure
it is meant to catch: the same 60 days of quiet that disable the cron are 60 days in which
nobody pushes.

## What to build

Mirror `ops/backup_liveness` exactly:

```jsonc
// database.rules.json
"ops": {
  "backup_liveness": { /* … unchanged … */ },
  "index_reconcile": {
    // Founder-only read: this is an operational record, not reader-facing.
    ".read": "auth != null && (auth.uid === '<founder-1>' || auth.uid === '<founder-2>')",
    // ".write": false because the WRITER IS AN ADMIN SDK and bypasses rules entirely.
    // A true here would open the node to any authenticated client for no benefit.
    ".write": false
  }
}
```

Then one step at the end of the reconcile job, on every scheduled run including a clean one —
**a heartbeat that only writes when it found something is not a heartbeat**, it is a log:

```
ops/index_reconcile = { at: <epoch ms>, repaired: <n>, refused: <n>, sha: <commit> }
```

**The check on the checker** is then a human reading that node — or, better, the daily
`backup liveness` job asserting the timestamp is younger than an hour and going red if not,
which folds this into an alarm that already exists and is already watched.

## Until it exists

The Actions run history for `index-reconcile` is the only place to see whether the job is still
firing. Worth an eye after any long quiet spell in the repo.

## Related

- `scripts/reconcile-index.mjs` — the job, and its three rails
- `tests/reconcile/reconcile.test.mjs` — the instrument check
- `docs/WORKER-PUBLISHEDATMS-PASTE.md` — the source fix the reconciler does **not** replace
