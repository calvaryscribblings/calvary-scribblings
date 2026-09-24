# Hand-off to the app repo: date of birth off the public record (24 Sep 2026)

## Why

`users/{uid}` is world-readable (`".read": true` at `users/$uid`), and `user_search` lists every
uid. So anyone could read every reader's date of birth next to their name and handle. RTDB reads
cascade, so a child of a readable node **cannot** be made private. Private fields have to live in
their own node.

## The private node: `users_private/{uid}` (live)

| field | type | written by |
|---|---|---|
| `dob` | string, `YYYY-MM-DD`, at most 32 chars | web signup and web completion step, **the app from now on** |
| `email` | string, at most 320 chars | nothing today (one legacy record was moved here) |
| `country` | string, at most 64 chars | nothing today (from a legacy nested `profile` object) |

Rules, deployed 24 Sep 2026 (`rules:check` shows repo = live):

- **Read:** the owner and the two founders. Nobody else, and never signed out.
- **Write:** the owner, their own fields only, as **leaf writes** (`users_private/{uid}/dob`).
  A founder *session* can't write a reader's fields; the server writes through the Admin SDK.
- **Delete:** the owner may remove their whole node. Account deletion
  (`POST /api/account/delete`) removes it too; it is in `OWNED_NODES`.
- An unknown child is refused.

This follows the repo's existing `bookstore_publishers_private` convention.

## Where the app must now write and read dob

1. **Signup.** Write `users_private/{uid}/dob`, **not** `users/{uid}/dob`. Best as part of the
   same root multi-path update as the profile (the web does exactly this:
   `signupUpdate` in `app/lib/handle.js`).
2. **The launch repair** (filling profile leaves for a node with no `displayName`): the same.
   dob goes to `users_private`.
3. **Profile edits:** if the app lets a reader change their date of birth, write it to
   `users_private/{uid}/dob`.
4. **Age checks and anything else that reads dob:** read `users_private/{uid}/dob` (the reader
   is signed in, so the owner read applies). **`users/{uid}/dob` is now always absent.** Every
   existing value was moved on 24 Sep 2026, and the sweep below removes any new one. A read of
   the old path returns null, so an age gate that reads it would treat every reader as unknown.
5. `ageConfirmed` stays on `users/{uid}`: it is a yes/no and not personal data.

## Until the app ships this: the sweep

Old binaries still write `dob` into `users/{uid}` at signup, and that write is **still allowed**.
`scripts/account/private-fields.mjs` runs on every tick of the account scrub
(`.github/workflows/account-scrub.yml`, `*/15`). It finds any private field on the public record
and moves it to `users_private/{uid}`, in one update per reader. It moves top-level `dob` and
`email`, plus `profile/dob`, `profile/email` and `profile/country`. The public copy is the most
recent write and wins. It skips uids with a `deletions/{uid}` record, and touches nothing else.

**How long a new dob can sit on the public record:** until the next scrub run finishes. GitHub
runs the `*/15` schedule late, and it can skip ticks:

- The scrub's first 11 scheduled runs had gaps of 8 to 29 minutes, and each took about 1.5 minutes.
- During this round **the schedule skipped two ticks**: runs at 00:16Z and then 01:05Z, a
  **50-minute** gap.
- The proof throwaway's old-shape dob was written at 00:35:51Z and removed by the 01:05:56Z run
  (finished 01:07:27Z): **about 31 minutes on the public record**.

**Worst observed: about 52 minutes** (a 50-minute gap plus a run). GitHub gives no upper bound.
The scrub job also waits on its test job, so a red suite stops the sweep until it is fixed. The
real fix is the app writing to `users_private`, then the refusal rule below.

## The refusal rule (built, NOT deployed)

`database.rules.users-private-strict-fragment.json` removes the `dob` and `email` grants from
`users/$uid` (they then fall to `$other`, `.validate: false`) and refuses `dob`, `email` and
`country` inside `profile`. `tests/rules/private-strict.test.mjs` proves it, including the reason
it waits: **an old binary's signup, which carries `dob` inside the object, is refused whole.**
Tell the web repo when an app release writes dob to `users_private` and old binaries are out of
use. The fragment then deploys, and the sweep becomes a no-op.

## What the app must change (summary)

- dob to `users_private/{uid}/dob` at signup, in the launch repair and in any profile edit.
- Age checks read `users_private/{uid}/dob`.
- Account deletion on the client (if still used) removes `users_private/{uid}` too; the owner may
  delete it whole.
- Then ask for the refusal rule to be deployed.
