# Restore

What the backup recovers, what it does not, and exactly what to do when it matters.

Read this **before** you need it. There are two places to restore from: the site's own daily
database archive (the everyday case, below), and **the vault**, a separate project the site's key
can't reach, for the day that archive is gone, wrong or untrusted. See [From the vault](#from-the-vault)
and `docs/VAULT.md`.

---

## 🚨 START HERE — there IS an automated backup, and it is the fastest way back

**The project is on the Blaze plan and Firebase's own scheduled Realtime Database backup is
enabled.** It has run daily since 23 Aug 2026, writing to the bucket
`calvary-scribblings-default-rtdb-backups` (30-day delete lifecycle). Nothing in this repo
takes that backup and nothing should: it is a console setting, and two backup systems means
two things to believe.

**It usually runs at 00:13 UTC, but not always.** It did every day until 28 Oct 2026. Then it
ran at 04:30, 03:26 and 01:00 UTC on 29, 30 and 31 Oct (SAFETY-1 listed the bucket). So pick an
archive by its `timeCreated`, never by assuming the hour, and when you need "just before the
damage", check that the archive you pick really is before it.

The same bucket also holds `guard/…`: the SAFETY-1 guard's backup of every scripted bulk write,
taken just before the write (see [Undoing a scripted write](#undoing-a-scripted-write)). It
expires after 30 days with everything else in the bucket. The liveness check and the drill read
only the `…_data.json.gz` archives.

> **This section exists because the opposite was written down and believed.** `export.mjs`
> asserted for twelve days that automated backups had never been enabled — the comment was
> written 48 minutes before they were switched on. On 4 Sep 2026 a probe damaged a live Open
> Pages piece, that comment was trusted, the record was restored from a stale mirror, and 267
> characters of Ikenna's writing were reported permanently lost. They were in that morning's
> backup. **Check the bucket before you conclude anything is gone.**

### Recovering ONE record (the common case, and what actually happened)

Almost every real incident is one bad write, not a dead database. Do not restore the whole
tree for it.

```bash
# 1. What have we got, and how fresh?
npm run backup:liveness

# 2. List the archives and pick the one from just before the damage, by its time.
node scripts/backup/restore-archive.mjs --list

# 3. Dry run: is the record in that archive, and does it differ from live? (hashes, no data)
node scripts/backup/restore-archive.mjs --object <archive> --path open_pages/<postId>

# 4. Put it back. The guard backs up what is live there now, verifies it, then writes,
#    and the script reads the path back and compares it to the archive by hash.
node scripts/backup/restore-archive.mjs --object <archive> --path open_pages/<postId> --apply
```

**Verify before and after.** Steps 3 and 4 print the archive's hash and the live hash of that path,
and the read-back after the write. That check was skipped on 4 Sep, and it is now part of the
command. If the path is not in the archive, the script refuses: restoring it would delete it.

(This section used to show a `node -e` that printed the record to the terminal and said to "write
just that path back with the admin SDK". Both are gone. Printing a reader's record puts it in a
log. A hand-written admin-SDK write is a write that bypasses the guard.)

### Restoring the WHOLE database

Rehearse it first; the drill is one command and it touches nothing live:

```bash
npm run backup:restore-drill      # restores the newest archive into the emulator and
                                  # compares every node against the archive
```

Last proven: **31 Oct 2026** (SAFETY-1). Archive `2026-10-31T01:00:49Z`, 6.01 MB gzip, 20.45 MB
inflated, 101 top-level nodes, whole tree canonically identical after the restore. Earlier: 4 Sep
2026, 19.09 MB, 76 nodes.

Since SAFETY-1 the drill also checks the restored tree **against live**, with read-only GETs. It
compares every node's record count, `story_bodies` against `cms_stories`, and ten random records
per major node by SHA-256. It prints counts and verdicts only, never a record or a key. `--no-live`
skips that half. On 31 Oct, 19 hours after the archive, 93 of 102 nodes had identical counts. The
rest had grown (e.g. `cms_stories` 252 → 270, one new node `series_note_replies`), and none had
shrunk. Of 113 sampled records, 111 were identical, 1 had changed with a later timestamp, and 1
(in `cms_stories`) had changed without one. That fits PROOFS-R1's text removal, which took
`content` off 41 `cms_stories` records that day and leaves no timestamp.

For real, the same archive goes back through the guard. See [The database](#1-the-database) below.

### Is it still running?

```bash
npm run backup:liveness           # fails loudly if stale, shrinking, or unreadable
```

`.github/workflows/backup-liveness.yml` runs this daily at 09:00 UTC and writes a heartbeat
to `ops/backup_liveness`. **GitHub disables cron schedules after 60 days of repo inactivity —
that is this system's real silent-failure mode.** If the repo goes quiet, check the heartbeat
by hand.

---

## Taking a backup

**Nothing to run.** Since SAFETY-2B every copy is taken by something scheduled, and none of them
lands on this machine:

- **The database and its rules**: Firebase's daily archive (above), and the vault's copy of it.
- **Everything else**: the vault's puller, daily (`docs/VAULT.md` §3): every file in the file bucket
  by generation with a daily manifest, the private copies bucket weekly, every account with the
  password hash parameters (encrypted with age to a key only Ikenna holds), each Worker's code,
  and the live Storage rules.

**`scripts/backup/export.mjs` is retired** (ruling 275, `scripts/RETIRED-SCRIPTS.md`). It never
ran, and it would have written every reader's email and password hash into the Codespace. A
backup nobody has restored is still a hope: the rehearsals are `npm run backup:restore-drill`
(the database, in the emulator) and the accounts test ([below](#the-accounts-test-the-drill-project)).
`scripts/backup/rehearse.mjs` read `export.mjs`'s output, so it has nothing to read now.

`backups/` stays gitignored: anything in it would hold readers' emails and password hashes.

---

## Undoing a scripted write

Since SAFETY-1, every script that writes to production goes through the guard
(`scripts/safety/guard.mjs`, CLAUDE.md "A bulk write goes through the guard"). Just before each
write it saves exactly the paths and Storage objects it is about to change to
`gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/batch-N.json`, and it
prints that location. To put them back:

```bash
node scripts/safety/restore.mjs gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/batch-N.json           # dry run
node scripts/safety/restore.mjs gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/batch-N.json --apply
```

A path that did not exist before the write is deleted again. A Storage object comes back
byte-exact with its download token, but as a new generation (§4). These backups last 30 days,
like the daily archives.

---

## What is in it

| What | Where | Recovers |
|---|---|---|
| Firebase's daily archive (`…_data.json.gz`, `…_rules.json.gz`) | the database-backup bucket, 30 days; and the vault's `database/` | every record in the database, and its rules |
| `files/<generation>/<path>` + `files-manifest/<date>.json` | the vault | every object in the file bucket (covers, EPUBs, Series art, avatars, Open Pages images, the unused files), and which generation was live on which day |
| `manual/…` | the vault, weekly | the private copies bucket (GATE-01, the W27 removed works, the EPUB replacements) |
| `accounts/<stamp>.json.age` | the vault, daily | every account (uid, email, providers, password hash and salt) **and the password hash parameters**, in one file only Ikenna's key opens |
| `workers/<name>/<sha256>.js` | the vault, when changed | each Cloudflare Worker's code |
| `rules/<date>/…` | the vault | the live Storage rules |

**How many accounts, and how many with a password?** Don't trust a number written here (this file
said 339 and 159; by 31 Oct they were 364 and 166). Count where they are: the puller's log for each
run prints `accounts`, `passwordAccounts` and `withPasswordHash` (Cloud Run → the job → **Logs**),
and Firebase console → Authentication → Users shows the total.

## What is **not** in it

- **Every secret** — Cloudflare Pages env, GitHub Actions secrets, the Workers' binding values,
  the site's keys. Left out deliberately: a backup carrying live credentials is a breach waiting to
  happen, and each can be reissued (`security/KEY-ROTATION.md`).
- **Cloudflare's zone settings** (DNS, the cache rule, routes). The vault's token can't read them.

---

## Restoring

### 1. The database

From the automated backup (the usual case):

```bash
node scripts/backup/restore-archive.mjs --list
node scripts/backup/restore-archive.mjs --object <archive> --all            # dry run: what differs
node scripts/backup/restore-archive.mjs --object <archive> --all --apply    # backup, verify, write
```

`--all` writes every top-level node the archive holds, one path per node, as one atomic update.
It never writes the root, so a node created since the archive was taken survives. Before writing,
the guard backs up everything live at those paths (about 20 MB), so the restore can itself be
undone with `scripts/safety/restore.mjs`. Rehearse the same command in the emulator first (the
usage is at the top of the script). SAFETY-1 ran it there on 31 Oct: 101 of 101 nodes read back
identical to the archive.

From the vault, the same command, after the archive is copied back under `from-vault/`: see
[From the vault → The database](#the-database-from-the-vault).

**The old instruction here was a raw `curl -X PUT` of the whole file at the database root, with
an access token minted on the command line. Never do that.** It replaces the root without a
backup of what it overwrites, and it puts a live token in the shell's history. CLAUDE.md: a bulk
write goes through the guard. To restore one subtree, use `--path`. That is almost always what
you actually want.

### 2. The rules

```bash
npm run rules:check     # never deploy over unexamined drift
npm run rules:deploy
```

Two minutes, and the most reliable part of the whole system.

### 3. The accounts

From the vault only: see [From the vault → The accounts](#the-accounts-from-the-vault). The hash
parameters travel inside every accounts file, so there is nothing to copy from the console.

> ⚠ Restoring accounts into a **new** project mints new uids. Every record in the database is
> keyed by uid, so purchases, points and comments would no longer match their owners. Restore
> into the **same** project unless you have decided to accept that, and if you have not, this
> is the moment to notice.

### 4. The master EPUBs

**Restore the objects; do not re-upload the files.** Since **25 Sep 2026 (W5)** the file
bucket's soft delete keeps every deleted **and every overwritten** object for **30 days**
(it was Google's default 7 before). Proven live that day on a throwaway object: overwritten,
then deleted, both generations listed as soft-deleted, the overwritten one restored
byte-exact.

```bash
# list what can come back (JSON API; no gcloud in the codespace — mintToken() is the credential)
GET  https://storage.googleapis.com/storage/v1/b/calvary-scribblings.firebasestorage.app/o?softDeleted=true&prefix=<path>
# restore one generation
POST https://storage.googleapis.com/storage/v1/b/calvary-scribblings.firebasestorage.app/o/<url-encoded path>/restore?generation=<gen>
```

⚠ **A restore MINTS A NEW GENERATION.** This file used to say that restoring "preserves its
identity". It does not: the W5 probe restored generation `…434836` and got back `…819244`.
The bytes and the MD5 are the same; the generation — which *is* the reading-position pin
(`docs/reading-position-pin.md`) — is not. So for a master EPUB a restore and a re-upload
cost readers the same thing: every reader of that title drops from an exact resume position
to an approximate one and silently re-downloads the book. Restore anyway (it is the faster,
exact-bytes path), and expect the pin to move. `MANIFEST.json` records each file's original
generation so you can tell that it has.

To restore an object that has since been overwritten, restore the old generation (it becomes
the live one) — the live object must be deleted first if it still exists, and that deletion is
itself soft-deleted, so nothing is lost by doing it.

### 5. The site

Cloudflare Pages redeploys from `main`. About five minutes, and nothing to do by hand.

---

## What breaks on restored data

The rehearsal checks all four.

1. **Reading positions.** Any EPUB that is re-uploaded rather than restored invalidates every
   reader's exact position for that title, on web and in the app.
2. **Founder access.** Two uids are hardcoded into `database.rules.json` and `storage.rules`.
   If those accounts are not restored with their original uids, the admin surface is
   unreachable and the fix needs a rules edit and a deploy *before* anyone can log in.
3. **`coverHold`.** A story restored with `published:false` + `coverHold:true` stays
   unpublished until `.github/workflows/covers.yml` next runs (every 15 minutes) — by design,
   because publication and cover land in one atomic patch. A restore is not "live again" the
   instant the data is back.
4. **Password accounts.** Inert without the hash parameters. Those are inside every vault
   accounts file, and `accounts-select.mjs` turns them into the CLI's flags.

---

## What only Ikenna can do

Everything above is a script. These are not, and none of them can be done from this repo.

### The password hash parameters — in every accounts backup now

This section used to say to copy them from the console by hand, because they "cannot be read
through any API". That was wrong: on 31 Oct 2026 the site's admin key read them through the
Identity Toolkit admin API (`projects.getConfig`, `signIn.hashConfig`). The vault's puller reads
them the same way, with its own read-only role, and stores them **inside the encrypted accounts
file**, beside the hashes they unlock. Nothing to record by hand.

### Turn on automated database backups — DONE (23 Aug 2026)

On since 23 Aug 2026: Gzip, 30-day lifecycle, bucket `calvary-scribblings-default-rtdb-backups`.
See the top of this file. (This section used to say the project had one bucket and no backup.
That stopped being true the day it was written.)

### Harden the bucket — DONE (W5, 25 Sep 2026)

- **Soft delete: 30 days** on `calvary-scribblings.firebasestorage.app` (was 7). Soft delete
  covers overwrites as well as deletions — proven live, see §4 — so Object Versioning is
  **not** switched on: it would keep every covers-worker overwrite forever unless a lifecycle
  rule pruned it, for no protection soft delete does not already give inside 30 days.
- ⚠ The 30 days applies to objects deleted **from 25 Sep 08:33 UTC on**. Objects already
  soft-deleted keep the expiry they were given: GATE-01's 18 `epubs/` objects still show
  `hardDeleteTime` 2 Oct 2026. Their bytes are also in the backups bucket below.
- **`calvary-scribblings-storage-backups`** (europe-west2, created W5): private backups that must
  outlive the codespace. Uniform access, public access prevention **enforced**, versioning on,
  30-day soft delete, no lifecycle rule (nothing expires). Not a Firebase bucket, so no
  `storage.rules` reach it: only IAM does. Holds `gate-01/<stamp>/` — the 18 EPUBs and
  `removed-fields.json` GATE-01 deleted, 19 files, each MD5-verified on upload.
  Since W39 (13 Oct 2026) it also holds `w27-removed-works/<stamp>/`: a lasting copy of the works
  W27 removed (records, bodies, six cover files), with every reader comment and reader identifier
  taken out. Nine objects, MD5-verified, each under a **temporary hold**, so even an admin's
  delete is refused until the hold is released. No rotation reaches this bucket: the only
  lifecycle rule in the project is the `age: 30` Delete on `calvary-scribblings-default-rtdb-backups`,
  and a lifecycle rule acts on its own bucket only. This bucket's lifecycle is `null`.

### A copy the site's key can't reach — the vault

This section used to say "put a copy somewhere that is not Google". The answer built is **the
vault** (`docs/VAULT.md`): another project, another owner boundary and a 30-day retention lock,
though still Google. Phase 1 (Ikenna, in the console) copies the database daily and seeded the
files; phase 2 (the puller) copies everything in the table above. Whether a second, non-Google copy
is wanted as well is a later ruling.

---

## From the vault

The vault is for the day the site's own archive is gone, wrong or untrusted (`docs/VAULT.md` §7).
**The site's key never touches the vault.** Each restore has two halves: Ikenna, signed in as
himself in Cloud Shell (he is Owner of both projects), copies what is needed from the vault into
the site's database-backup bucket under `from-vault/`; then the site's own scripts put it back,
through the guard, exactly as for a daily archive. `from-vault/` copies expire with the rest of
that bucket after 30 days, and nothing that checks the backup counts them as one
(`scripts/backup/archives.mjs`).

The names below (*the vault bucket* and so on) are in `~/calvary-private/vault/NAMES.md`. Set them
once at the top of the Cloud Shell session:

```bash
VAULT_BUCKET='<the vault bucket>'
SITE_BACKUPS='<the database-backup bucket>'
```

### The database, from the vault

```bash
# Cloud Shell, the vault project: pick the archive by its date, then copy it in.
gcloud storage ls "gs://$VAULT_BUCKET/database/" | grep _data.json.gz | tail -n 5
gcloud storage cp "gs://$VAULT_BUCKET/database/<archive>" "gs://$SITE_BACKUPS/from-vault/<archive>"
```

```bash
# The Codespace, with the site's key: the same restore as any archive.
node scripts/backup/restore-archive.mjs --list                                          # vault copies listed separately
node scripts/backup/restore-archive.mjs --object from-vault/<archive> --path <path>    # dry run
node scripts/backup/restore-archive.mjs --object from-vault/<archive> --path <path> --apply
```

### The files, from the vault

One file: copy `files/<generation>/<path>` in, then restore it with `--only <path>`. Everything as
it was on a date: copy that date's manifest and every generation it lists.

```bash
# Cloud Shell, the vault project.
DAY='<YYYY-MM-DD>'
gcloud storage cp "gs://$VAULT_BUCKET/files-manifest/$DAY.json" "gs://$SITE_BACKUPS/from-vault/files-manifest/$DAY.json"
gcloud storage cat "gs://$VAULT_BUCKET/files-manifest/$DAY.json" | jq -r '.objects[] | "\(.generation)/\(.name)"' > /tmp/want.txt
wc -l < /tmp/want.txt
while IFS= read -r p; do gcloud storage cp "gs://$VAULT_BUCKET/files/$p" "gs://$SITE_BACKUPS/from-vault/files/$p" --quiet; done < /tmp/want.txt
rm /tmp/want.txt
```

```bash
# The Codespace, with the site's key. Dry by default; --only <path> or --prefix <p> to narrow it.
node scripts/backup/restore-files.mjs --manifest from-vault/files-manifest/<date>.json
node scripts/backup/restore-files.mjs --manifest from-vault/files-manifest/<date>.json --apply
```

`restore-files.mjs` skips what is already identical, refuses bytes whose MD5 doesn't match the
manifest, puts each object back with its content type, cache headers and **download token** (so
stored URLs work again), and never deletes: a file newer than the manifest is counted and left. Each
batch goes through the guard's Storage half, so what it overwrites is backed up first. ⚠ As §4 says,
a restored object is a **new generation**: a restored master EPUB moves every reader's position pin.

### The accounts, from the vault

Same project only (§3 above, the uid warning). Import **only the accounts that need it**: importing
over a live uid replaces that account.

```bash
# Cloud Shell, the vault project. The key is typed from the card and never stored.
sudo apt-get install -y age jq
gcloud storage ls "gs://$VAULT_BUCKET/accounts/" | tail -n 3
gcloud storage cp "gs://$VAULT_BUCKET/accounts/<stamp>.json.age" /tmp/
read -rs AGE_KEY                     # type the AGE-SECRET-KEY-1… line from the card, then Enter
age -d -i <(printf '%s\n' "$AGE_KEY") -o /tmp/accounts.json /tmp/<stamp>.json.age; unset AGE_KEY
# /tmp/uids.txt: one uid per line, the accounts to put back.
git clone --depth 1 https://github.com/calvaryscribblings/calvary-scribblings.git ~/site && cd ~/site
node scripts/backup/accounts-select.mjs --accounts /tmp/accounts.json --uids /tmp/uids.txt --out /tmp/import.json
npx -y firebase-tools@15.24.0 login --no-localhost
npx -y firebase-tools@15.24.0 auth:import /tmp/import.json $(cat /tmp/import.json.flags) --project <the site project ID>
rm -f /tmp/accounts.json /tmp/import.json /tmp/import.json.flags /tmp/uids.txt /tmp/*.json.age
```

`accounts-select.mjs` reshapes the vault's records to the keys `auth:import` accepts (it refuses
anything else, and prints the whole record, hash included, when it does) and writes the hash flags
to a file, so the signer key is never typed or shown. Federated accounts (Google, Apple) re-link on
their own; password accounts need the hash flags.

### The Workers and the rules

**A Worker:** `gcloud storage cat "gs://$VAULT_BUCKET/workers/<name>/<sha256>.js"`, then paste it
into the Cloudflare dashboard (or upload it with the content API, as `scripts/workers/upload-newsletter.mjs`
does). Its bindings' values are re-entered from where they're kept; they aren't in the vault.
**The rules:** `npm run rules:check`, then `npm run rules:deploy`, as §2. The vault's
`rules/<date>/` copy is for the day git and the live rules both disagree with what was running.

### The accounts test (the drill project)

Once in the vault's two-week trial, before the lock, and then each quarter (`docs/VAULT.md` §7,
ruling 271). **One account only: the flagged live test reader** (`ops/live_test_reader`), and **never
the live site**: the test imports into a second, empty project, *the drill project* (its setup is
`docs/VAULT.md` §12, steps D.1–D.5), signs in with the test reader's password, and deletes it again.

**Why not the Auth emulator?** It proves the file decrypts, parses and imports, and the script runs
that half in CI (`npm run test:vault:emulator`). It **can't** prove the password: the emulator stores
an imported hash but never verifies one. Only a real project checks a password against an imported
hash, which is the whole point of the test.

```bash
# Cloud Shell. Decrypt as above, to /tmp/accounts.json. Then:
cd ~/site
read -rs DRILL_PASSWORD; export DRILL_PASSWORD     # the test reader's password, from ~/calvary-private
export DRILL_API_KEY='<the drill project Web API key>'
node scripts/backup/accounts-drill.mjs --accounts /tmp/accounts.json --target drill --drill-project '<the drill project ID>'
rm -f /tmp/accounts.json /tmp/*.json.age; unset DRILL_PASSWORD DRILL_API_KEY
```

It reads the test reader's uid from `ops/live_test_reader` (a read of one value), refuses any other
account, a founder, a missing or duplicated record, the site's own project, and a record with no
password hash; imports the one record with the file's hash parameters; checks uid, email and
providers; signs in; and deletes the imported account whatever happened. `DRILL PASSED` is the
result. It prints no uid, email or hash.

⚠ **The test reader has no password yet** (W17 made it sign-in-by-custom-token only, and
`tests/live/test-reader.mjs` refuses an account with any sign-in method). Giving it one is the first
step of the first drill, and that step must also change `ensureTestReader()`'s check to allow
exactly the password provider, or every live browser harness will refuse to start.
