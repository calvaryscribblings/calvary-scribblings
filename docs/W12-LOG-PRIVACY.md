# W12: nothing that names a reader goes into a public log

## The leak

The repository is public, and so are its GitHub Actions logs, which GitHub keeps for 90 days.
Scanning all 5,735 runs against the real identifiers (every account ID, email, push token, handle
and full name) found one real leak: **the 15-minute account scrub printed deleted readers'
account IDs.** Nine runs, between 23 Sep 22:22 and 25 Sep 02:51 UTC, named 17 of the 18
deleted readers.

The code could print more than that:
- **The account scrub** printed each deleted reader's uid, and would have printed a live
  subscription's Stripe or Paystack reference.
- **The push announcer** printed `uid/tokenKey` on a failed ticket, Expo ticket IDs on a failed
  receipt, and each notification's words. A byline can name a reader who writes.
- **The launch check's Signals row** printed `ops/money_failures` keys, which carry a uid or a
  provider reference.
- **The covers job** named a follower's uid when a notification failed.

None of those four other lines ever fired: the push announcer never had a ticket error.

The only other hits were in the push-triggered test suites (153 reader-test runs and 137
rules-and-hygiene runs). They contain the two founders' uids, which are hardcoded in the public
`database.rules.json`, and the house name "Calvary Scribblings". No reader appears in them, so
their logs were kept.

## The fix (4d4ed9b5, de7a3a26)

**Counts only.** Scheduled jobs print no account ID, push token or token key, email, handle,
name or provider reference.
- **The scrub** prints `deletions/{uid}/logRef`, a random `del-xxxxxxxx` written the first
  time it mentions a record. It means nothing without the database. A report-only run has
  nothing to write the tag with, so it prints `record #n (untagged)`.
- **The push announcer** tallies errors by code, masking any free text, and prints message
  lengths instead of message text.
- **The launch check** prints a count and "see ops/money_failures".

**A guard.** Every script step in every scheduled workflow runs as
`node … 2>&1 | node scripts/ops/log-guard.mjs` under `shell: bash`, so pipefail keeps the
script's own exit status. The guard:
- masks anything shaped like an account ID, a push token or an email before the log sees it;
- fails the step if it had to mask anything.

The shapes are in `scripts/ops/redact.mjs`. The guard is only a second layer; the scripts are
written to print counts.

**The test.** `tests/ci/w12-log-privacy.test.mjs`, in `npm run test:ci`, covers three things:
- the guard's shapes, including the house's ordinary output it must pass untouched;
- the wiring of every scheduled workflow;
- the scrub, the push announcer and the launch check driven with identifier-shaped fixtures.

It caught a false positive on the way: `notificationsInOthersInboxes`, one of the scrub's own
count names, is 28 mixed-case letters, exactly the shape of a uid. The guard would have failed
real scrub runs.

Every guarded script was run read-only against production through the guard before the push,
with 0 hits:
- scrub
- push announcer, dry run and frequency report
- index reconcile
- square horizon and its liveness check
- withdrawals
- launch check
- backup liveness
- covers design lock and plan

## The cleanup (Ikenna's decision, 26 Sep)

The Codespace's GitHub token can't write to Actions (403). A one-shot workflow therefore did
the deletion with its own token, granted `actions: write` for that job only.
- **It deleted logs only.** Each run keeps its record and its pass/fail; all nine still read
  "success".
- **It had guardrails.** It refused any run that wasn't an account-scrub run from before the
  fix, and it failed unless every log was gone.
- **It has been removed** from the repo.

Checked independently afterwards:
- run logs and every job log for the nine return 404;
- no annotation carries an ID;
- the two retained artifacts hold no identifier.

A full rescan of every run (5,738 in all, 5,720 with readable logs) confirmed none is left:
- **Account scrub:** 198 runs. The 9 purged ones have no logs, and none of the other 189 contains
  an account ID.
- **Every other scheduled workflow** is clean too.
- **The remaining hits** are the push-triggered test suites, with the founders' public uids and
  the house name only.
- **Unreadable:** 6 test-suite runs from before W12 have empty log archives, and 2 were still in
  progress, both test suites.
