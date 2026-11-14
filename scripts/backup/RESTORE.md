# Restore

What the backup recovers, what it does not, and exactly what to do when it matters.

Read this **before** you need it. The one thing that cannot be recovered later is the piece
that has to be recorded now — see [What only Ikenna can do](#what-only-ikenna-can-do).

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

```bash
node scripts/backup/export.mjs                  # → backups/<utc-timestamp>/
firebase emulators:exec --only database --project demo-calvary-restore \
  "node scripts/backup/rehearse.mjs backups/<utc-timestamp>"
```

The second command is not optional. A backup nobody has restored is a hope. The rehearsal
restores the tree into a scratch node **in the database emulator**, reads it back, compares it,
deletes it, and checks the three things that break on restored data even when every byte is
perfect. Add `--offline` for an integrity-only pass with no emulator.

(Until SAFETY-1 the round trip wrote the whole tree, every reader record included, under
`_restore_rehearsal/<stamp>` in the **live** database. A failed delete there would have left a
full copy of the database in production. Run without the emulator, it now skips the round trip
and says so.)

**Keep the backups off this machine.** A backup that lives only in the Codespace dies with
the Codespace. `backups/` is gitignored — it holds every reader's email address and password
hash, and it must never enter git.

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

> Note: this section describes `export.mjs`, the PORTABLE off-Google copy. The automated
> Firebase backup above covers the database and rules only — `export.mjs` exists for the two
> things it does **not** cover, **auth accounts** and **the EPUBs**.

| Part | Size today | Recovers |
|---|---|---|
| `rtdb.json.gz` | 13.3 MB → 4.0 MB | Every reader record, purchase, comment, point, quiz submission, the whole catalogue |
| `auth-users.json` | 339 accounts | Identities, emails, provider links, password hashes and salts |
| `epubs/` | 13 files, 7.2 MB | The master EPUBs — the sellable inventory — each verified against Cloud Storage's own MD5 |
| `MANIFEST.json` | — | Checksums, counts, and each EPUB's Cloud Storage **generation** |

## What is **not** in it

- **Password hash parameters.** See below. Without them the 159 password accounts cannot be
  re-imported and every one of those readers must reset.
- **The other ~774 MB of Storage** — covers, avatars, open-pages images. Covers regenerate
  from `scripts/covers/`; nothing else here is irreplaceable.
- **The five Cloudflare Worker sources.** They live in a dashboard. See
  `workers-external/README.md`.
- **Every secret** — Cloudflare Pages env, GitHub Actions secrets, `FIREBASE_SECRET`. Left
  out deliberately: a backup carrying live credentials is a breach waiting for a lost disk.

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

From an `export.mjs` copy, the same applies: the write goes through the guard. Put the copy's
`rtdb.json.gz` where the script can read it, or open a guard yourself (`openGuard` →
`guard.update({ <node>: value, … })`).

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

```bash
npx firebase auth:import backups/<stamp>/auth-users.json \
  --hash-algo=SCRYPT \
  --hash-key=<from the console> \
  --salt-separator=<from the console> \
  --rounds=<from the console> \
  --mem-cost=<from the console> \
  --project calvary-scribblings
```

Flags verified against `firebase auth:import --help` (firebase-tools 15.24). **Without the
four console values the password hashes are inert.** Federated accounts (180 of 339 — Google
and Apple) re-link on their own and do not need them.

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
4. **Password accounts.** Inert without the hash parameters. 159 readers.

---

## What only Ikenna can do

Everything above is a script. These are not, and none of them can be done from this repo.

### Record the password hash parameters — **do this today**

Firebase console → **Authentication** → **Users** → the **⋮** menu above the user list →
**Password hash parameters**. Copy `hash_config` — algorithm, base64 signer key, salt
separator, rounds, memory cost — and store it wherever the backups are stored.

This is the single highest-value five minutes in this document. It cannot be read through
any API, and without it the account export is a list of names.

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

### Put a copy somewhere that is not Google

The 13 master EPUBs are 7.2 MB and they are the inventory. One copy in the live bucket plus
a 30-day undo window (7 days before W5) is still not a backup of a business asset.

---

## Automating it

`export.mjs` needs a service account and nothing else, so it fits the pattern
`.github/workflows/covers.yml` already uses: materialise the key from
`secrets.FIREBASE_SERVICE_ACCOUNT`, run, shred the key. The one thing to settle first is
*where the output goes* — a GitHub Actions artifact is capped and expires, and the file
contains every reader's email address and password hash. That is a decision about where
reader data may live, not a scripting problem, which is why this round stops at the script.
