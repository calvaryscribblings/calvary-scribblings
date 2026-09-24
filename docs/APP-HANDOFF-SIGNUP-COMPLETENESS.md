# Hand-off to the app repo: signup completeness (24 Sep 2026)

Web repo, following `dc52f66d`. Ikenna's rulings:

1. The web enforces the platform's minimum age at signup, as the app does.
2. Apple and Google sign-ins choose a handle, as email signup does. **No handle is ever derived
   from an email address.**

The database rules below are **live**. They were deployed 24 Sep 2026, and `rules:check` shows
repo = live.

## 1. Minimum age: 18

The published pages state it, and they state only one age:

- `app/terms/page.js`: "You must be **18 years of age or older** to create an account and use the Service."
- `app/privacy/page.js`: "Story Island is intended for **adults aged 18 and over**."

On the web it lives in `app/lib/age.js` (`MIN_AGE = 18`). The check uses whole years on the
reader's own calendar day, and a 29 Feb birthday counts from 1 Mar. It runs **before any account
is created**. Only a reader who passes gets `ageConfirmed: true`, so on web records that field is
now true. Existing accounts were left as they are. Five stored dates of birth are under 18 (two
are a date in 2026, likely a picker default). All five are web-shaped, and none carries
`ageConfirmed`.

## 2. The completion step: the shape the app should match for Apple and Google

**Who gets it.** Any signed-in reader whose `users/{uid}` has **none** of `displayName`,
`username` or `handle`. It is keyed on those fields, not on whether the node exists: a node full
of `readStories` and `readerScore` still gets the step. A reader who has any of the three skips
it; 95 readers have a name and no handle, and they skip by ruling. On 24 Sep, 155 of 347 Auth
accounts had no identity (138 Google, 2 Apple, 13 password, 1 anonymous). 103 of them had
reading data.

**What it asks.** Name (prefilled from the provider), date of birth (the check in §1), and a
handle (the same field, checks and copy as email signup).

**What it writes: ONE root multi-path update of named leaves.** Anything already in the node is
not named, so it is not touched:

| path | value |
|---|---|
| `users/{uid}/displayName`, `/dob` | from the form |
| `users/{uid}/ageConfirmed` | `true` (only reachable after the age check) |
| `users/{uid}/createdAt`, `/joinDate` | the **Auth account's creation time** (ms), not the moment of completion |
| `users/{uid}/uid` | uid |
| `users/{uid}/handle`, `/handleLowercased`, `/username` | the handle, lowercase, all three identical |
| `usernames/{handle}` | uid |
| `user_search/{uid}` | `{ avatarUrl: '', displayName, isAuthor: false, username }` |

Nothing is written until the reader submits. Signing out or leaving writes nothing, and the step
comes back on the next sign-in. An under-18 date of birth writes nothing and signs the reader
out. **The Auth account is kept**, because the reader may already have reading data.

Code: `app/lib/profileCompletion.js` and `app/components/ProfileCompletion.js`.

## 3. The rename write

One update. A handle taken in the meantime refuses all of it, and nothing changes:

```
users/{uid}/handle            = new
users/{uid}/handleLowercased  = new
users/{uid}/username          = new
user_search/{uid}/username    = new
usernames/{new}               = uid
usernames/{old}               = null   ← ONLY when usernames/{old} === uid
```

Release the old claim **only if this reader holds it**. Releasing a claim someone else holds is
refused, and that sinks the whole rename. There is a live case: an app record from 18 Jul shows
`handleLowercased: lizbest`, while `usernames/lizbest` belongs to a different reader. A handle
can be changed but not cleared once set. Code: `renameHandle` in `app/lib/handle.js`.

## 4. Reserved names, enforced in the rules

Anything starting `calvary`, `storyisland` or `story_island`, plus `admin`, `administrator`,
`support`, `help`, `official`, `staff`, `team`, `editor`, `editors`, `moderator`, `mod`,
`system`, `root`, `security` and `founder`. The check ignores case.

- `usernames/$handle` refuses a **new** claim on a reserved name unless a founder makes it. A
  reader who already holds one keeps it; today that is `calvaryscribblings`, `calvaryfilms` and
  `calvaryradio`.
- The form's words (DRAFT): **"@{handle} is reserved for the island's own use. Choose another."**

## 5. The guard on the handle fields (live), and the strict rule (built, NOT deployed)

**Live, the GUARD.** `users/$uid/handle`, `handleLowercased` and `username` may never hold a
handle that **another uid** holds in `usernames/`, nor a reserved name this uid doesn't hold
(founders exempt). The check reads the data **after** the write, so a single atomic update
passes. It also works whatever order the app writes in: proved on production, a
`users/{uid}` object first and then the claim is still allowed.

**Consequence for old binaries.** An email-derived handle that another reader already holds now
refuses the app's whole-object `set(users/{uid}, …)`. Before, it was allowed, and that is how
the `lizbest` record came about. That is the ruling working, but an old binary's Google first
sign-in then leaves no profile. The web's completion step catches these readers on their next
web sign-in.

**Not deployed, the STRICT rule.** Each field must **be** a claim this uid holds.
`database.rules.handle-strict-fragment.json` holds it, and `tests/rules/handle-strict.test.mjs`
proves it. It is held back because it **refuses an app signup that writes `users/{uid}` before
`usernames/{handle}`**, and that order can't be seen from this repo. **Tell the web repo** when
the app claims first, or writes profile + claim + search row as one root update. The strict rule
then swaps in with a rules deploy.

## 6. What the app must change

1. **Apple and Google first sign-in: a handle step instead of an email-derived handle.** Name,
   date of birth (18+) and handle, written as in §2. Key the step on `displayName`, `username`
   and `handle` being absent, not on the node being absent, so the profile-less readers get it
   too. Their reading data must not be touched: write leaves, never the node.
2. **Signup and rename as ONE root multi-path update**, with the claim inside it (§2, §3). Then
   the strict rule can deploy.
3. **Rename parity.** Write all three handle fields plus the search row's `username`, and release
   the old claim only when this reader holds it.
4. **Reserved names.** Refuse the list in §4 before the write, with the message in §4 (DRAFT).
   The rules refuse it regardless.
5. **The age.** Keep `ageConfirmed: true` for readers who pass the 18+ check; the web now writes
   the same.

## 7. Copies of a handle that are stored as text (reported, not rewritten)

After a rename, these keep the old handle until they're next written:

- **@mentions in comment and post bodies.** They resolve `usernames/{text}` whenever they are
  viewed, so after a rename an old @mention points at whoever claims the old handle next.
- `leaderboard/{uid}/username`: refreshed on the reader's next score update.
- Notifications' `fromUsername`. The profile panel resolves `fromUid` first; the Square panel
  shows the stored text.
- Open Pages `authorHandle`: the stored snapshot is shown **in preference to** the live one.
- `cms_stories` and series `authorHandle`: typed in by the editor, resolved to a uid at render.

The Square byline, leaderboards, search, profiles and author cards resolve by uid and follow a
rename at once.
