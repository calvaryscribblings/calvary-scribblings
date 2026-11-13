# The vault: backups nobody can delete for 30 days

SAFETY-2P, 5 Nov 2026. A plan, written before anything is built. Rulings 267–275 (logged
4 Nov 2026 in `docs/COPY-RULINGS.md`, NOTIF-B2 section).

This file holds **no project IDs, bucket names or account emails**. Those live in
`~/calvary-private/vault/NAMES.md`, which never enters git. Where a step needs one, it says
which one (for example *the vault project ID*), and the private note gives the value.

---

## 1. What exists today, and why it isn't enough

| what | where it's copied today | the gap |
|---|---|---|
| The database | Firebase's scheduled backup, daily, into a bucket **in the site's own project** (30-day lifecycle) | The site's admin key holds `storage.admin` on that bucket. Anyone with the key can delete every archive in one call, and then the database. |
| The rules | the same archive (`…_rules.json.gz`), and git | as above for the archive; git is fine |
| The Storage files (about 1 GB, 2,500 objects) | nothing. The bucket's 30-day soft delete is the only undo | soft delete can be switched off, and objects purged, by the same key |
| The 326 MB of unused files (ruling 272) | nothing | as above. They're unreferenced by the database, so nothing would notice them going |
| The accounts (364 on 31 Oct) | nothing. `scripts/backup/export.mjs` would write them, but it has never run | there is no copy of any reader's sign-in anywhere |
| The Workers' code | two of nine are mirrored in `workers-external/`; the rest live only in the Cloudflare dashboard | a dashboard edit or deletion is unrecoverable |
| The manual copies (GATE-01, the W27 removed works, the EPUB replacements) | a private bucket in the site's project | the site's key holds `storage.admin` there too |

**The single point of failure is the site's key.** Every copy above sits in the site's own
project, where the key that runs the site can also delete it. The key was exposed three times
before SECURITY-R1. The vault fixes that one thing: a copy the site's key can't reach, that
nobody can delete for 30 days.

## 2. The shape of it

- **A separate Google Cloud project that Ikenna owns** (ruling 267). It isn't a Firebase project,
  and it has no link to the site's project except the read grants in §4.
- **One bucket, in Belgium** (`europe-west1`, ruling 267). The site's database and its backup
  archives are already in `europe-west1`, so copying them in costs nothing in transfer. The file
  bucket is in London (`europe-west2`); copying it across is a small inter-region charge (§9).
- **Standard storage.** Nearline would be cheaper per GB, but at these sizes the difference is
  pennies, and Standard has no retrieval fee and no minimum-duration charge on the day of a
  restore. (Nearline's 30-day minimum would match the retention exactly, so it is a fair
  alternative; the choice changes the bill by under a penny a month.)
- **Uniform access, public access prevention enforced, versioning off.** Nothing in the vault is
  ever overwritten: every object's name is unique by construction (§3). That also means a
  retention policy can never block a copy.
- **No IAM grant to the site.** The site's service account, the site's Workers, GitHub Actions
  and this Codespace hold **no credential for the vault** and no role in its project. That's what
  "the site's key can't reach" means, and it's checkable: the vault's IAM page lists every
  principal, and none of them is in the site's project.

### Nothing deletable for 30 days (ruling 268)

A **bucket retention policy of 30 days**. While it's in force, no object in the bucket can be
deleted or replaced until it is 30 days old: not by a lifecycle rule, not by the vault's own
service account, not by a project Owner. Uploading new objects is unaffected.

- **Weeks 1–2: unlocked.** The policy is on, but an Owner can still shorten or remove it. That's
  the trial: watch the copies arrive, run a restore (§7), and check the bill (§9).
- **After two weeks: locked.** Locking is permanent. The period can then be lengthened but never
  shortened or removed, and the bucket can't be deleted while any object in it is under 30 days
  old. Google also places a **lien** on the project, so the project can't be deleted either while
  the locked bucket exists. Ikenna included: that is the point of the ruling.

What the lock does **not** stop: someone with Ikenna's Google account could stop *new* copies
arriving (delete the scheduled job, remove the read grants). The 30 days of copies already in
the vault stay. So Ikenna's Google account should use **2-Step Verification with a passkey or
a security key** (step 1.0), and the vault watches itself (§6).

### How long copies are kept: a question for Ikenna

The retention policy sets the *minimum*. The *maximum* is a lifecycle rule that deletes objects
at a chosen age, and it matters for privacy: the privacy notice and `/delete-account` say a
deleted reader's data is removed "from our active systems" and may be retained "for a limited
period". The vault holds readers' records, uploads and sign-ins, so it must not keep them
forever.

**Recommendation: delete at 60 days.** That keeps a full 30 days of copies that can't be
deleted, plus 30 more, and it bounds how long a deleted reader's data outlives them in the vault
to 60 days. It costs nothing to choose differently; it's one number in the lifecycle rule
(step 1.6). Until Ikenna rules, the steps below set 60.

A live file that the lifecycle rule deletes from the vault is copied again on the next run
(§3), so expiry never leaves a live file without a copy for more than a day.

## 3. What goes in, and how often

Everything goes into the one bucket, under a prefix per kind. Names are unique: a date-stamped
name, or (for files) the source object's own generation number, which Cloud Storage never
reuses.

| prefix | what | how often | how it gets there | size today |
|---|---|---|---|---|
| `database/` | Firebase's own daily archive of the database **and its rules**, copied unchanged (`…_data.json.gz`, `…_rules.json.gz`) | daily | Storage Transfer Service, pulled by the vault (phase 1) | about 6 MB a day |
| `guard/` | the SAFETY-1 guard's backups of every scripted bulk write, copied unchanged | daily (same job) | the same transfer | small, irregular |
| `files/<generation>/<path>` | every object in the site's file bucket: covers, EPUBs (masters and samples), Series artwork, readers' avatars, headers and Open Pages images, editorial images, **the 326 MB of unused files** (ruling 272) | daily, new and changed objects only | the vault's puller (phase 2). In phase 1, a one-off full copy under `files-seed/<date>/` | about 1 GB in total |
| `files-manifest/<date>.json` | the list of every object in the file bucket that day: name, generation, size, MD5 | daily | the puller | about 0.5 MB a day |
| `manual/` | the site's private copies bucket (GATE-01, W27 removed works, EPUB replacements) | weekly | the puller. In phase 1, a one-off copy under `manual-seed/<date>/` | 11 MB |
| `accounts/<stamp>.json.age` | every account, with password hashes and salts, **and the project's password hash parameters**, in one file **encrypted to a key only Ikenna holds, offline** (ruling 270) | daily | the puller | under 1 MB a day |
| `workers/<name>/<sha256>.js` | each Cloudflare Worker's code, stored **only when it has changed** (ruling 273) | daily check | the puller, with a read-only Cloudflare token kept in the vault | about 17 MB once, then only changes |
| `rules/<date>/` | the live Storage rules (the database rules come with the database archive) | daily | the puller | a few KB |
| `radio/<path>` | **later:** Radio's audio, from R2 | when RADIO-B2 creates the bucket | the puller, with a read-only R2 token kept in the vault | grows with Radio |

**The files rule.** The puller copies an object when its `(name, generation)` isn't already in
the vault. A replaced file (a new master EPUB, a regenerated cover) has a new generation, so the
old copy stays and the new one is added beside it. A file deleted from the site stops being
copied and ages out of the vault by the lifecycle rule (§2). The manifest for a date says
exactly which generations were live that day, so a restore puts back the site as it was, not a
pile of every version ever made.

**Not in the vault, on purpose: secrets.** Cloudflare's environment values, GitHub's secrets,
the site's keys. A backup that carries live credentials is a breach waiting to happen, and each
of them can be reissued (`security/KEY-ROTATION.md`). The Workers' code goes in; their bindings'
*values* never do (CLAUDE.md, credential rule 5). The puller asks Cloudflare for script content
only.

## 4. How copies get there: the vault pulls, the site never pushes

The site holds **no vault credential**. Instead, the vault has identities of its own, and the
site's project grants them **read** access, nothing more:

| vault identity | what it is | what the site's project grants it |
|---|---|---|
| the vault's **Storage Transfer Service agent** | a Google-managed identity of the vault project. It acts only through transfer jobs defined in the vault project | Storage Object Viewer and Storage Legacy Bucket Reader on the **database-backup bucket** and, for the one-off copy, on the **file bucket** and the **private copies bucket** |
| the vault's **puller** service account (phase 2) | a service account in the vault project, with **no key**: Cloud Run lends it to the job | Storage Object Viewer on the **file bucket** and the **private copies bucket** (not the database-backup bucket: the transfer service copies that one, and the puller never reads it); a **custom role** on the site project holding exactly `firebaseauth.users.get`, `firebaseauth.configs.get` and `firebaseauth.configs.getHashConfig` (below); Firebase Rules Viewer |

**Why a custom role for the accounts.** The read-only *Firebase Authentication Viewer* role
lists users but **not their password hashes**: Google returns the hash and salt only to a caller
holding `firebaseauth.configs.getHashConfig`, and Viewer doesn't have it. The roles that do
(Firebase Authentication Admin and Editor) can also create, change and delete accounts. So the
puller gets a custom role with the three read permissions above and nothing else. The build round
proves it returns hashes and the hash parameters (§10).

Inside the vault:

- **The puller may only create and read objects**: Storage Object Creator, which "does not give
  permission to view, delete, or overwrite objects", plus Storage Object Viewer, so it can see
  which generations it already holds. Neither includes delete. A compromised puller can add junk,
  never remove a copy.
- **The transfer agent needs more**: Google documents Storage Legacy Bucket Writer (which
  includes delete) plus Storage Object Viewer for a destination bucket, and doesn't support Object
  Creator alone. The retention policy is what holds here: no identity, the agent included, can
  delete or replace an object under 30 days old, and the transfer is set never to delete
  anything (step 1.7).

**Why pull and not push.** If the site pushed, the site would have to hold a credential that
writes to the vault, and that credential would sit next to the key the vault exists to protect
against. Pulling turns it round: the worst a stolen site key can do to the vault is nothing.
The cost is the other direction: the vault can **read** the site. A vault identity that leaked
could read readers' data. That's why the puller has no key file (nothing to leak from a laptop
or a log), its grants are read-only and per bucket, and the vault project holds nothing else.

**Phase 1 (Ikenna, console only, no code):** the project, the bucket, the retention policy, the
lifecycle rule, a daily transfer of the database archives, and a one-off copy of every file.
That alone closes the worst gap: from the first night, the database has a copy the site's key
can't delete.

**Phase 2 (the build round, then Ikenna in Cloud Shell):** the puller, a Cloud Run job run
daily by Cloud Scheduler, for files, accounts, Workers and rules. Its code lives in this repo
(it holds no secret), and Ikenna deploys it from Cloud Shell, which runs in Safari on the iPad.

## 5. The accounts key, made and kept on an iPad (ruling 270)

The accounts file is encrypted with **age** (age-encryption.org), to a **public key** that the
puller is configured with. Only the matching **private key** opens it, and only Ikenna holds it,
offline. The puller never sees the private key, so a copy of the vault alone can't be read.

**Making the key, on the iPad, offline.** It takes a terminal app, because no well-established
iPad app makes age keys on its own. Two free, open-source ones run `age-keygen`, the reference
tool:

- **a-Shell** (App Store), which installs extra commands with `pkg install`. Whether `age` is
  among them isn't in a-Shell's own documentation, so step 2 checks.
- **iSH** (App Store), a small Linux (Alpine) that installs `age` from Alpine's own packages. It's
  older (last updated 2023) and needs one extra line, so it's the fallback.

1. **Online:** install a-Shell. Open it and type `pkg install age`, then `age-keygen --version`.
   If that prints a version, go to step 3.
2. **Only if a-Shell has no `age`:** install iSH, open it and type, one line at a time:
   `echo https://dl-cdn.alpinelinux.org/alpine/v3.20/community >> /etc/apk/repositories`,
   then `apk update`, then `apk add age`. (If iSH says `apk` isn't found, its wiki's
   "Installing apk on the App Store version" page puts it back.) Then `age-keygen --version`.
3. Put the iPad in **Airplane Mode**, with Wi-Fi and Bluetooth off too.
4. Type `age-keygen` and nothing else. With no `-o`, it writes **nothing to disk**: it prints
   three lines on screen.
   - `# public key: age1…`. This one isn't secret.
   - `AGE-SECRET-KEY-1…`. This one is.
5. Write the `AGE-SECRET-KEY-1…` line down **on paper, by hand, twice**, on two cards. Check each
   card character by character against the screen. (Printing would send it through the printer's
   memory, and a photo goes to iCloud. Handwriting doesn't go anywhere.)
6. Copy the `age1…` public key into Notes. It goes into the puller's settings in phase 2, and it's
   safe to keep anywhere.
7. Type `clear`, copy any other word to the clipboard over whatever is there, and close the app
   (swipe it away).
8. Turn Airplane Mode off.
9. Keep the two cards in two different places that Ikenna controls: for example, a home safe and
   a bank deposit box or a trusted relative. Neither place is the iPad, iCloud, a photo, email or
   a password manager that syncs.

**Why paper.** Every digital place on an iPad syncs somewhere (iCloud Keychain, Photos, Notes,
the universal clipboard). Paper doesn't, and the key is 74 characters, which is copyable by hand.

**Using it** (a restore, or the test in §7): in Cloud Shell, in the vault project, Ikenna installs
`age` (`sudo apt-get install age`), types the key from the card for the length of one decrypt,
then deletes the plaintext and closes the session. §7 says how. To prove a card is right without
a restore, the build round adds a check: the puller also stores a tiny known file encrypted to
the same key, and decrypting it shows a fixed sentence.

**One key, two cards, no copy anywhere else.** If both cards are lost, the accounts backups
can't be opened, and the fix is a new key (this section again) from that day on. The database and
file backups don't depend on it.

## 6. The vault watches itself

The site can't read the vault, by design, so the site's own liveness check (`backup-liveness.yml`)
can't see it. Instead:

- **An email alert on failure** (phase 2, build round): Cloud Monitoring emails Ikenna when a
  transfer run or a puller run fails, and the puller fails as a whole when any part of it fails.
  Until then, step 1.11's check and the monthly look below are the watch.
- **A monthly look.** The first of each month, Ikenna opens the vault bucket and checks the
  newest object under `database/`, `files-manifest/` and `accounts/` is from the last day or two.
  Two minutes, and it's the one check that doesn't depend on any alert working.
- **A budget alert** on the vault's billing (step 1.2) catches a runaway copy.

## 7. Restoring from the vault

The everyday restore stays as `scripts/backup/RESTORE.md` describes: from the site's own daily
archive, through the SAFETY-1 guard. The vault is for the day that archive is gone, wrong or
untrusted.

**The database.**

1. In Cloud Shell in the vault project, Ikenna copies the chosen archive from the vault's
   `database/` into the site's database-backup bucket, under a `from-vault/` prefix. (He is Owner
   of both projects, so his own sign-in can do this. The site's key never touches the vault.)
2. From then on it's RESTORE.md: `restore-archive.mjs --object from-vault/<archive> --path …`,
   dry run first, then `--apply`, through the guard. (Build round: the script accepts a
   `from-vault/` object.)

**The files.**

- One file: copy `files/<generation>/<path>` back to `<path>` in the site's file bucket.
- Everything as it was on a date: a restore script (build round) reads `files-manifest/<date>.json`
  and copies each listed object back, dry by default, through the guard's Storage half.
- As RESTORE.md §4 already warns, a restored object is a **new generation**, so a restored master
  EPUB moves every reader's reading-position pin. The manifest records the old generation so the
  move can be seen.

**The accounts.**

1. In Cloud Shell in the vault project, copy the chosen `accounts/<stamp>.json.age` to the
   session's home directory.
2. Decrypt it with the private key from the card. The plaintext lives only in that Cloud Shell
   session; delete it and close the session when done.
3. Import with `firebase auth:import`, giving the hash parameters from the decrypted file. Import
   **only the accounts that need it**, never the whole file over live accounts. Same project only:
   a new project mints new uids, and every record in the database is keyed by uid (RESTORE.md §3).

**The accounts restore test, on a flagged test reader (ruling 271).**

- The test uses **one account: the live test reader** (`tests/live/test-reader.mjs`, uid kept
  only at `ops/live_test_reader`). It is flagged as a test account and is never a real reader.
  Build round: give it a password (kept in `~/calvary-private/`), so the test proves the password
  hashes, not just the record.
- The test script (build round) **refuses any account that isn't the flagged test reader**: it
  reads the uid from `ops/live_test_reader`, picks that one record out of the decrypted file, and
  stops if the record isn't there or anything else would be written.
- **First in the Auth emulator**: import the one record and check its uid, email and sign-in
  providers match. Nothing live is touched. That proves the file decrypts, parses and imports,
  and nothing more: **the emulator can't prove the password.** It stores an imported hash as it
  is but never checks it (its own sign-in compares a fake hash), so a real password fails there by
  design.
- **The proof of the hashes is a scratch project.** A second, empty Firebase project (*the drill
  project*, Ikenna's, free plan, Authentication only, no database and no app). The test imports
  the test reader's one record into it with the hash parameters, signs in with the password, and
  checks the uid and email match the vault's record. Nothing in the live site is written. The
  drill project's account is deleted at the end of each run.
- **The live site is never the test bed.** Importing over a live uid replaces that account (the
  CLI's documented behaviour), so a live import happens only in a real restore, for the accounts
  that need it.
- When to run it: once in the two-week trial, before the lock, and then each quarter.

**The Workers.** Paste the stored code back into the Cloudflare dashboard (or upload it with the
content API, as the newsletter Worker already is). The bindings' values are re-entered from where
they're kept now; they aren't in the vault.

**The rules.** `npm run rules:check`, then `npm run rules:deploy`, as now. The vault's copy is
for the day git and the live rules both disagree with what was running.

### The corrected restore guide (ruling 275)

When phase 2 is live, `scripts/backup/RESTORE.md` changes (build round). The changes are listed here
so the build round doesn't have to rediscover them:

- **`export.mjs` is retired** (to `scripts/RETIRED-SCRIPTS.md`). It never ran, it wrote readers'
  emails and password hashes into the checkout, and the puller replaces it.
- **The password hash parameters are not console-only.** RESTORE.md and `export.mjs` say they
  "cannot be read through any API". On 31 Oct the site's admin key read them through the Identity
  Toolkit admin API (`projects.getConfig`, `signIn.hashConfig`). The puller stores them inside
  the encrypted accounts file, so "record them by hand today" is replaced by "they're in every
  accounts backup".
- **The counts are stale**: 339 accounts and 159 password accounts became 364 and 166 by 31 Oct.
  The guide should say where to count, not a number.
- **The accounts test** is the drill project (§7), not the emulator, and the guide says why.
- **"Put a copy somewhere that is not Google"** becomes "the vault": another project and another
  owner boundary, though still Google. Whether a second, non-Google copy is wanted is a later
  ruling.
- **A vault section**: the three restores above, and the test.

## 8. What the vault does not do

- It doesn't protect against **Ikenna's Google account** being taken over for more than 30 days
  unnoticed: new copies could be stopped, and after 30 days old ones expire. Hence the passkey
  (step 1.0) and the monthly look (§6).
- It isn't a second provider. It's Google, in a separate project and billing boundary.
- It doesn't hold secrets (§3).
- It doesn't back up Cloudflare's zone settings (DNS, the cache rule, routes), which the
  current token can't read. A later round, if wanted.

## 9. What it costs each month, at today's sizes

Google bills in US dollars and converts to the billing account's currency. Rates are Google's
published list prices as read on 5 Nov 2026 (sources below). Sizes are from the SAFETY-2 inventory
of 31 Oct 2026. With a 60-day lifecycle (§2):

| item | how much | rate | a month |
|---|---|---|---|
| Storage held: database archives (60 days × about 6 MB) | 0.36 GB | Standard, `europe-west1`, $0.020 per GiB-month | $0.007 |
| Storage held: files (about 1 GB, plus replaced generations and, in the first 60 days, the phase-1 copy alongside the puller's) | 1–2.2 GB | the same | $0.02–0.04 |
| Storage held: accounts, manifests, Workers, rules, manual copies | about 0.15 GB | the same | $0.003 |
| Copying files from London to Belgium (each file once every 60 days, plus new files) | about 0.6 GB | $0.02 per GiB between European regions | $0.012 |
| Copying the database archives (both in Belgium) | about 0.2 GB | free within one region | $0 |
| Operations (about 2,000 copies and listings) | about 2,000 Class A | $0.005 per 1,000 | $0.01 |
| Storage Transfer Service, bucket to bucket | — | no charge for agentless transfers | $0 |
| Cloud Run job, a few minutes a day (phase 2) | about 9,000 vCPU-seconds | first 240,000 vCPU-seconds free per billing account | $0 |
| Cloud Scheduler, one job (phase 2) | 1 job | 3 jobs free per billing account | $0 |
| Secret Manager, two secrets (phase 2) | 2 versions | 6 active versions free | $0 |
| **Total** | | | **about $0.05–0.10 a month** |

Once, in the first month: the phase-1 copy of every file, about 1 GB from London, is about $0.02.

**Things that would move it.** Radio's audio is the only thing that grows fast: at 64 kbps mono a
50-minute recording is about 24 MB, so a collection of 15 stories and two instalments is roughly
0.3–0.4 GB, about $0.01 a month each to hold for 60 days, plus R2's own read charges. Google's
Always Free storage allowance doesn't apply in `europe-west1` (it covers three US regions only),
so none of the above is offset by it. The budget alert (step 1.2) is set at a level that a
mistake, not growth, would cross.

Sources: [Cloud Storage pricing](https://cloud.google.com/storage/pricing) (regional rates,
operations, data transfer between regions, the Always Free regions);
[Storage Transfer Service pricing](https://cloud.google.com/storage-transfer/pricing);
[Cloud Run pricing](https://cloud.google.com/run/pricing);
[Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing);
[Secret Manager pricing](https://cloud.google.com/secret-manager/pricing).

## 10. For the build round (the site's side, and the puller)

Nothing here is done in SAFETY-2P. **SAFETY-2B (13 Nov 2026) built items 1–9**: the puller is
`vault/puller/` (one file, no dependencies; the Cloud Run job runs it on the stock `node:22-slim`
image through `vault/puller/BOOTSTRAP.txt`, which checks its SHA-256 first); the restores and the
accounts test are in `scripts/backup/` and `scripts/backup/RESTORE.md`, "From the vault"; Ikenna's
deploy steps are §12. Items 10–13 stay as written.

1. **The puller** (`vault/puller/`, a Node Cloud Run job): files by `(name, generation)` with a
   daily manifest, the private copies bucket weekly, accounts and hash parameters encrypted with
   age to the configured public key (the plaintext only ever in memory), Worker code by SHA-256
   (content only, never settings), the live Storage rules. Dry run mode, counts-only logs
   (W12 log rules), and a non-zero exit when any part fails.
2. **The custom accounts role** (§4): `firebaseauth.users.get`, `firebaseauth.configs.get`,
   `firebaseauth.configs.getHashConfig`. Prove it returns the hashes and the hash parameters,
   counting fields only, before relying on it. Google's docs don't say whether
   `getConfig` fills `hashConfig` without `getHashConfig`; the third permission is there for that.
3. **The exact Cloud Shell commands** for Ikenna to deploy the job, set its schedule and its
   alert, and add the two vault secrets (the Cloudflare read token, later the R2 read token).
4. **The Cloudflare token:** a read-only token with Workers Scripts Read only, created by Ikenna,
   stored only in the vault's Secret Manager. Never in this repo, the Codespace or GitHub.
5. **`restore-archive.mjs`** accepts an archive copied in under `from-vault/`.
6. **The files restore script**, from a manifest, dry by default, through the guard.
7. **The accounts restore test** (§7): a password for the test reader, the refusing script, the
   emulator run, and the drill project run. Ikenna creates the drill project (one console page);
   the round writes its steps.
8. **RESTORE.md corrected and `export.mjs` retired** (ruling 275, §7 above).
9. **A CI pin** that no file in the repo carries a vault credential, and that `docs/VAULT.md`
   stays free of project IDs, bucket names and emails (this round adds the second half).
10. **Ruling 269 is its own round**: the site's key cut down to what the site uses. It touches
    the same IAM pages, so do it after phase 1 and not in the same sitting.
11. **Ruling 274** (`/age-verified` points at a Worker that doesn't exist) stays its own round.
12. **Radio's audio** joins the puller when RADIO-B2 creates the R2 bucket. Google's transfer
    service reads S3-compatible stores like R2 only through agents on a VM, so the puller copies
    from R2 itself, with an S3 client and a read-only R2 token kept in the vault's Secret Manager.
13. **Cloud Shell on the iPad** isn't on Google's supported list (it names desktop browsers;
    Safari's private mode is excluded). Step 1.13 tries it. If it doesn't work, the build round
    finds a deploy that needs only the console.

## 11. Ikenna's setup steps (phase 1)

Phase 1, all in Safari on the iPad, signed in to Ikenna's own Google account (the one that owns
the site's project). About 45 minutes, plus five minutes on day 14. Every step names the page it
was written against, as read on 5 Nov 2026. Where Google's page doesn't print an exact label,
the step says so and describes the control instead.

The values the steps refer to (*the vault project ID*, *the database-backup bucket* and so on)
are in `~/calvary-private/vault/NAMES.md`. Fill in its **actual** column as you go and send it
back to the round; nothing from it goes in this repo.

**1.0 Protect the account that owns everything.** Open myaccount.google.com and tap
**Security & sign-in**. Under "How you sign in to Google", tap **Turn on 2-Step Verification** if
it isn't on, and follow the steps. Then go to myaccount.google.com/signinoptions/passkeys, tap
**Create a passkey**, tap **Create a passkey** again, and unlock the iPad when asked. (A passkey on
the iPad is enough to start. A hardware security key as well is better, kept apart from the
accounts key's cards: see the third source.)
Source: [Turn on 2-Step Verification](https://support.google.com/accounts/answer/185839);
[Sign in with a passkey](https://support.google.com/accounts/answer/13548313);
[Use a security key for 2-Step Verification](https://support.google.com/accounts/answer/6103523).

**1.1 Create the vault project.** Open console.cloud.google.com, open the **Manage resources**
page (search "Manage resources" in the top bar) and tap **Create project**. In the **New project**
window:
- **Project name**: *the vault project name* (NAMES.md suggests one).
- **Project ID**: tap **Edit** under it and type *the vault project ID*. 6–30 characters, lowercase
  letters, digits and hyphens, starting with a letter. **It can never be changed**, so check it.
- **Parent resource**: **No organization**, if the field appears.
- **Billing account**: the account that pays for the site, or a new one if you'd rather the vault's
  bill was separate. Either is fine; a separate one makes the vault's cost obvious at a glance.
- Tap **Create**. When it's made, note the **project number** from the project's dashboard into
  NAMES.md.

Source: [Creating and managing projects](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects);
[Enable, disable, or change billing for a project](https://docs.cloud.google.com/billing/docs/how-to/modify-project).

**1.2 A budget alert.** Open **Billing**, then **Budgets & alerts** (if you see only **Cost
management**, it's under there), and tap **Create budget**.
- Pick **Alerts only** if offered, name it "Vault", tap **Next**.
- **Scope**: **Time range** **Monthly**; under **Projects**, tick only the vault project. **Next**.
- **Amount**: **Budget type** **Specified amount**, **Target amount** **5** (in the billing
  account's currency). **Next**.
- **Actions**: keep the three thresholds (50%, 90%, 100% of **Actual**). Tick **Email alerts to
  project owners**. Tap **Finish**.

The vault should cost pennies (§9), so any alert means something is wrong. A budget only sends
email: it never stops anything, so it can't interrupt a backup.
Source: [Create, edit, or delete budgets and budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets).

**1.3 Switch on the transfer service in the vault project.** In the top bar make sure the vault
project is selected. Open the **API Library** (search "API Library"), search **Storage Transfer
API**, open it and tap **Enable**. (Google's console guide doesn't say whether this is needed
before step 1.7; doing it first does no harm.)
Source: [Getting started with Google Cloud APIs](https://docs.cloud.google.com/apis/docs/getting-started).

**1.4 Create the vault bucket.** Still in the vault project, open **Cloud Storage** → **Buckets**
and tap **Create**.
- **Get started**: name it *the vault bucket*. **Continue**.
- **Choose where to store your data**: **Location type**: the single-region option (labelled
  "Region"; Google's page names the field, not the option). **Location**: **europe-west1**
  (Belgium). **Continue**.
- **Choose how to store your data**: a default storage class of **Standard**, not Autoclass.
  **Continue**.
- **Choose how to control access to objects**: tick **Prevent public access**, and pick
  **Uniform**. **Continue**.
- **Choose how to protect object data**: leave the **Soft delete policy** at its default (7 days).
  Leave object versioning **off**. **Don't** turn on object retention (the per-object lock): the
  vault uses a bucket policy instead, in step 1.5, and object retention can't be turned off once on.
- Tap **Create**. If a box asks you to confirm that public access will be prevented, confirm.

Source: [Create buckets](https://docs.cloud.google.com/storage/docs/creating-buckets);
[Bucket locations](https://docs.cloud.google.com/storage/docs/locations);
[Soft delete](https://docs.cloud.google.com/storage/docs/soft-delete);
[Object Retention Lock](https://docs.cloud.google.com/storage/docs/using-object-lock).

**1.5 The 30-day retention policy, unlocked (ruling 268).** Open the vault bucket and its
**Protection** tab. In the **Retention policy** section tap **Set Retention Policy**, choose
**days**, type **30**, and save. **Don't tap Lock.** While it's unlocked you'll see **Edit** and
**Delete** beside it; that's the trial. Put a reminder in Calendar for **14 days from today**:
"Lock the vault (step 1.14)".
Source: [Use and lock retention policies](https://docs.cloud.google.com/storage/docs/using-bucket-lock);
[Bucket Lock](https://docs.cloud.google.com/storage/docs/bucket-lock).

**1.6 Copies expire at 60 days.** Open the vault bucket's **Lifecycle** tab and tap **Add a rule**.
Choose the action that deletes objects (the API calls it `Delete`) and tap **Continue**. Choose the
age condition (`age`) and type **60** days. **Continue**, then **Create**. Google's page doesn't
print the console's names for the action and the condition, which is why they're described here.
The retention policy stops this rule from deleting anything under 30 days old. If Ikenna rules a
different period (§2), this is the only number that changes.
Source: [Manage object lifecycles](https://docs.cloud.google.com/storage/docs/managing-lifecycles);
[Object Lifecycle Management](https://docs.cloud.google.com/storage/docs/lifecycle).

**1.7 The daily database copy.** In the vault project open **Storage Transfer Service** (search
"Data transfer" or "Storage Transfer") and tap **Create transfer job**.
- **Source type** **Cloud Storage**, **Destination type** **Cloud Storage**, **Scheduling mode**
  **Batch transfers**. **Next step**.
- **Source**: in **Bucket or folder** type *the database-backup bucket* (it's in the site's project,
  so type it rather than browse). **Next step**.
- **Destination**: in **Bucket or folder** type *the vault bucket* followed by `/database/`.
  **Next step**.
- **Schedule**: **Run every day**, **Starting now**. **Next step**.
- **Settings**: **Description** "database, daily". **When to overwrite**: **If different**. **When
  to delete**: **Never**. Don't tick anything that deletes from the source or the destination.
- Tap **Create**.

Every archive has a unique name and is never changed, so "If different" never overwrites
anything. Because you own both projects, the console grants the transfer agent the bucket access
it needs as the job is created (step 1.10 checks). This copies the guard's backups (`guard/`)
too, which is wanted.
Source: [Create transfers](https://docs.cloud.google.com/storage-transfer/docs/create-transfers);
[Configure access to a source: Cloud Storage](https://docs.cloud.google.com/storage-transfer/docs/source-cloud-storage).

**1.8 A one-off copy of every file, the 326 MB of unused files included (ruling 272).** Create
another transfer job exactly as in 1.7, except:
- **Source**: *the file bucket*.
- **Destination**: *the vault bucket* followed by `/files-seed/2026-11-05/` (today's date).
- **Schedule**: **Run once**, **Starting now**.
- **Description** "files, one-off".

This is the files' only copy outside the site until the puller runs (phase 2). It ages out at 60
days (step 1.6), so **if phase 2 isn't live within 50 days, run this step again** with that day's
date in the folder.
Source: [Create transfers](https://docs.cloud.google.com/storage-transfer/docs/create-transfers).

**1.9 A one-off copy of the manual copies.** Once more as in 1.7, except **Source**: *the private
copies bucket*; **Destination**: *the vault bucket* followed by `/manual-seed/2026-11-05/`;
**Schedule** **Run once**, **Starting now**; **Description** "manual copies, one-off".
Source: [Create transfers](https://docs.cloud.google.com/storage-transfer/docs/create-transfers).

**1.10 Check who can reach what.** This step is the proof of ruling 267.
- In the **site's** project, open each of the three source buckets → **Permissions** tab. Each
  should list a principal ending `@storage-transfer-service.iam.gserviceaccount.com` whose number
  is the **vault's** project number, with **Storage Object Viewer** and **Storage Legacy Bucket
  Reader**. If one is missing: **Grant access**, paste that principal into **New principals**,
  **Select a role**, add the missing one, **Save**.
- In the **vault** project, open **IAM**. The only people listed should be you, and the only
  service accounts Google's own agents. **Nothing from the site's project.** In particular, the
  site's admin service account (`firebase-adminsdk-…`) must not appear.
- On the vault bucket's **Permissions** tab the transfer agent should hold **Storage Legacy Bucket
  Writer** and **Storage Object Viewer**, as Google documents for a destination, and nothing more.

If the agent's address is needed and you can't see it, Google's page for `googleServiceAccounts.get`
has a **Try it** panel: type the vault project ID under **Request parameters**, tap **Execute**,
and copy `accountEmail`.
Source: [Use IAM permissions](https://docs.cloud.google.com/storage/docs/access-control/using-iam-permissions);
[Configure access to a sink: Cloud Storage](https://docs.cloud.google.com/storage-transfer/docs/sink-cloud-storage);
[Configure access to a source: Cloud Storage](https://docs.cloud.google.com/storage-transfer/docs/source-cloud-storage);
[IAM roles for Cloud Storage](https://docs.cloud.google.com/storage/docs/access-control/iam-roles).

**1.11 Tomorrow: check the first copies landed.** Open the vault bucket. `database/` should hold
the night's `…_data.json.gz` and `…_rules.json.gz`, and `files-seed/2026-11-05/` about 2,500
objects (around 1 GB). In **Storage Transfer Service**, each job's last run should read as
succeeded. If a run failed, open it: the error names the object and the reason. Send the round
the counts, never file names.
Source: [Create transfers](https://docs.cloud.google.com/storage-transfer/docs/create-transfers).

**1.12 Make the accounts key, offline (ruling 270).** Follow §5 of this file, on the iPad: a-Shell
(or iSH), Airplane Mode, `age-keygen`, the private key on two handwritten cards, the public key into
Notes and then into NAMES.md. Nothing else to do with it until phase 2.
Source: [age, README](https://github.com/FiloSottile/age);
[age(1) manual](https://github.com/FiloSottile/age/blob/main/doc/age.1.ronn);
[a-Shell](https://github.com/holzschu/a-shell);
[iSH: installing apk on the App Store version](https://github.com/ish-app/ish/wiki/Installing-apk-on-the-App-Store-Version).

**1.13 Try Cloud Shell on the iPad.** In the vault project, tap **Activate Cloud Shell** at the top
of the console. When the terminal opens at the bottom, type `gcloud config list` and check it names
the vault project. Close it. Phase 2 deploys the puller from here, and Google lists desktop
browsers only (Safari's private mode is excluded), so this proves it works on the iPad first. If it
doesn't open, say so; the build round then deploys a different way.
Source: [Using Cloud Shell](https://docs.cloud.google.com/shell/docs/using-cloud-shell);
[Cloud Shell limitations](https://docs.cloud.google.com/shell/docs/limitations).

**1.14 Day 14: lock it (ruling 268).** Lock only when all three hold: the database copy has run
every night since step 1.7; the build round has restored one archive from the vault in a dry run
(§7); and the bill for the fortnight is pennies. Then open the vault bucket → **Protection** →
**Lock**. In the **Lock retention policy?** box, read the **Permanent** notice, type the bucket's
name in **Bucket name**, and tap **Lock policy**. **This can never be undone**: the 30 days can be
lengthened later but never shortened or removed, the bucket can't be deleted while it holds an
object under 30 days old, and Google places a lien that stops the vault project being deleted.
Source: [Use and lock retention policies](https://docs.cloud.google.com/storage/docs/using-bucket-lock);
[Bucket Lock](https://docs.cloud.google.com/storage/docs/bucket-lock);
[Project liens](https://docs.cloud.google.com/resource-manager/docs/project-liens).

**Phase 2 steps** are §12 below, written by the build round (SAFETY-2B) against the puller it built.

## 12. Ikenna's setup steps (phase 2)

Phase 2 deploys the puller (§10) into the vault project, gives it the read grants of §4, runs it
three times by hand and then puts it on a daily schedule with an alert. Allow about an hour and a
half, in Safari on the iPad, signed in to Ikenna's own Google account (Owner of both projects).
Every step names the pages it was written against, as read on 13 Nov 2026. Where a page doesn't
print a console label, the step says so and describes the control instead.

**Two routes, one result.** Each step that differs gives two versions:

- **A. In Cloud Shell**: paste-ready blocks. Use this if Cloud Shell opened in step 1.13. Google's
  limitations page lists "Apple Safari 8+" among supported browsers and excludes only Safari's
  private mode; it doesn't mention the iPad either way.
- **B. In the console**: tap by tap, for when Cloud Shell won't open or won't take a paste.

Both routes create the same things with the same names, so you can switch between them at any step.
Steps 2.3 and 2.4 happen in **the site's** project; every other step happens in the vault project.
Check which project the top bar shows before each step.

**Never paste a value from NAMES.md into this file, an issue, a commit or a chat with the round.**
Send the round counts and step numbers only.

---

**2.0 What this phase needs.** From `~/calvary-private/vault/NAMES.md`: *the vault project ID*,
*the site project ID*, *the vault bucket*, *the file bucket*, *the private copies bucket*, *the age
public key* (step 1.12), *the Cloudflare account ID* and *the alert email* (where the failure emails
go). From the build round's report: *the puller commit* (40 hex characters) and *the puller
SHA-256* (64 hex characters). Copy those two into NAMES.md too.

*The puller URL* is built from the commit, and it must be exactly this shape or the bootstrap
refuses to run:
`https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/` + *the puller commit* +
`/vault/puller/puller.mjs`.

**A. In Cloud Shell**, at the start of **every** Cloud Shell session in this phase, paste this block
with the values filled in from NAMES.md. Cloud Shell forgets shell variables when the session ends.

```bash
VAULT_PROJECT='<the vault project ID>'
SITE_PROJECT='<the site project ID>'
VAULT_BUCKET='<the vault bucket>'
FILES_BUCKET='<the file bucket>'
PRIVATE_BUCKET='<the private copies bucket>'
AGE_RECIPIENT='<the age public key>'
CF_ACCOUNT_ID='<the Cloudflare account ID>'
ALERT_EMAIL='<the alert email>'
PULLER_COMMIT='<the puller commit>'
PULLER_SHA256='<the puller SHA-256>'
REGION=europe-west1
PULLER_SA="vault-puller@${VAULT_PROJECT}.iam.gserviceaccount.com"
SCHEDULER_SA="vault-scheduler@${VAULT_PROJECT}.iam.gserviceaccount.com"
PULLER_URL="https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/${PULLER_COMMIT}/vault/puller/puller.mjs"
gcloud config set project "$VAULT_PROJECT"
```

Then, once, fetch the repo (it's public, so no sign-in; about 230 MB) and check the puller at the
pinned commit is the one the round reported:

```bash
cd ~ && git clone https://github.com/calvaryscribblings/calvary-scribblings vault-src
cd ~/vault-src && git checkout "$PULLER_COMMIT"
echo "$PULLER_SHA256  vault/puller/puller.mjs" | sha256sum -c
[ "$(tr -d '[:space:]' < vault/puller/puller.mjs.sha256)" = "$PULLER_SHA256" ] && echo "sha file matches"
grep -c '~~' vault/puller/BOOTSTRAP.txt
```

The third line must print `vault/puller/puller.mjs: OK`, the fourth `sha file matches`, and the last
`0`. (Step 2.7 uses `~~` to keep the bootstrap line in one piece; a `0` proves the line doesn't
contain `~~` itself. CI checks the same thing.) If any of the three fails, stop and tell the round.

**B. In the console**, keep NAMES.md open in another tab. You will also need the bootstrap line:
open `https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/` + *the puller
commit* + `/vault/puller/BOOTSTRAP.txt` in a new Safari tab. It is one line of about 800 characters
with **no spaces** in it. Step 2.7 copies it from there (press and hold, **Select All**, **Copy**).

Source: [Cloud Shell limitations](https://docs.cloud.google.com/shell/docs/limitations);
[How Cloud Shell works](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works).

**2.1 Switch on the APIs the puller and its schedule use.** In the vault project.

**A.**

```bash
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com monitoring.googleapis.com \
  logging.googleapis.com identitytoolkit.googleapis.com firebaserules.googleapis.com \
  --project="$VAULT_PROJECT"
gcloud services list --enabled --project="$SITE_PROJECT" \
  --filter="config.name:(identitytoolkit.googleapis.com firebaserules.googleapis.com)"
```

**B.** Open the **API Library** (search "API Library"), and for each of **Cloud Run Admin API**,
**Cloud Scheduler API**, **Secret Manager API**, **Identity and Access Management (IAM) API**,
**Cloud Monitoring API**, **Cloud Logging API**, **Identity Toolkit API** and **Firebase Rules API**:
search it, open it, tap **Enable** (if it shows **Manage** instead, it's already on). Then switch the
top bar to the site's project, open **APIs & Services** → **Enabled APIs & services**, and check
**Identity Toolkit API** and **Firebase Rules API** are listed.

The second command (or the site check in B) should list both APIs on the site's project. They are
already on there, because the site uses them; **confirm, don't change anything in the site project.**

Why the last two are switched on in the **vault** too: the puller calls them with the vault's
service account. Google's quota-project page says that for "client-based" APIs, "the project
associated with the service account is used as the quota project", and the API is checked for in
that project. It doesn't say which kind these two are. Switching them on in the vault grants nothing
to anyone and costs nothing, and it rules out an "API has not been used in project … or it is
disabled" refusal in step 2.8.
Source: [gcloud services enable](https://docs.cloud.google.com/sdk/gcloud/reference/services/enable);
[gcloud services list](https://docs.cloud.google.com/sdk/gcloud/reference/services/list);
[Quota project overview](https://docs.cloud.google.com/docs/quotas/quota-project).

**2.2 The puller's service account, with no key.** In the vault project.

**A.**

```bash
gcloud iam service-accounts create vault-puller --project="$VAULT_PROJECT" \
  --display-name="Vault puller" \
  --description="Runs the vault's daily copy. Never has a key."
```

**B.** Open **IAM & Admin** → **Service accounts** and tap **Create service account**. Name it
**vault-puller**. The console fills the ID in from the name; check it reads `vault-puller`, because
it can't be changed later. Description: "Runs the vault's daily copy. Never has a key." Tap **Done**,
not **Create and continue**: it gets **no role on the vault project**. Its only grants are the ones
in 2.3–2.6.

**Never create a key for it** (the **Keys** tab, **Add key**). Cloud Run lends the job the account's
identity, so the puller needs no key. Google's guidance is to treat keys "as an exception rather
than the norm". Google switches key creation off by default only for **organisations** created on
or after 3 May 2024. The vault project has no organisation (step 1.1), so nothing stops a key being
made. The rule is just: don't. Step 2.13 checks.
Source: [Create service accounts](https://docs.cloud.google.com/iam/docs/service-accounts-create);
[gcloud iam service-accounts create](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/create);
[Best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).

**2.3 The accounts role and the rules role, on the site's project.** In the **site's** project.
This is the custom role of §4: three read permissions, nothing else. Google's permissions reference
lists all three (`firebaseauth.users.get`, `firebaseauth.configs.get`,
`firebaseauth.configs.getHashConfig`). Its custom-roles support table marks all three
**SUPPORTED** for custom roles, so they belong in a custom role.

**A.**

```bash
gcloud iam roles create vaultAccountsReader --project="$SITE_PROJECT" \
  --title="Vault accounts reader" \
  --description="Reads accounts, their password hashes and the hash parameters. Nothing else." \
  --permissions=firebaseauth.users.get,firebaseauth.configs.get,firebaseauth.configs.getHashConfig \
  --stage=GA
gcloud projects add-iam-policy-binding "$SITE_PROJECT" \
  --member="serviceAccount:$PULLER_SA" \
  --role="projects/$SITE_PROJECT/roles/vaultAccountsReader" --condition=None --format=none
gcloud projects add-iam-policy-binding "$SITE_PROJECT" \
  --member="serviceAccount:$PULLER_SA" \
  --role=roles/firebaserules.viewer --condition=None --format=none
```

(`--format=none` stops gcloud printing the site's whole policy after each grant.)

**B.** In the site's project, open **IAM & Admin** → **Roles** and tap the button for a new custom
role (Google's page calls it **Create custom role**; the console may label it **Create role**).
- **Title**: Vault accounts reader. **Description**: "Reads accounts, their password hashes and the
  hash parameters. Nothing else." **ID**: `vaultAccountsReader`. It can't be changed later.
  **Role launch stage**: General Availability.
- Tap **Add permissions**. In the filter, type `firebaseauth.users.get` and tick it. Do the same for
  `firebaseauth.configs.get` and `firebaseauth.configs.getHashConfig`. Tap **Add**.
- Check the role lists **exactly three** permissions, then tap **Create**.

Then open **IAM & Admin** → **IAM**, tap **Grant access**. In the principal field, paste the
puller's address (`vault-puller@` followed by *the vault project ID* and
`.iam.gserviceaccount.com`). **Select a role**: under **Custom**, **Vault accounts reader**. Add a
second role: **Firebase Rules Viewer**. **Save**.

Firebase Rules Viewer (`roles/firebaserules.viewer`) can read rulesets and releases, and list
projects. It can't change rules.
Source: [Firebase Authentication permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth);
[Permissions support in custom roles](https://docs.cloud.google.com/iam/docs/custom-roles-permissions-support);
[Create and manage custom roles](https://docs.cloud.google.com/iam/docs/creating-custom-roles);
[gcloud iam roles create](https://docs.cloud.google.com/sdk/gcloud/reference/iam/roles/create);
[Firebase Rules roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaserules);
[Manage access to projects](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access);
[gcloud projects add-iam-policy-binding](https://docs.cloud.google.com/sdk/gcloud/reference/projects/add-iam-policy-binding).

**2.4 Read access to the two site buckets.** In the **site's** project. The puller gets
**Storage Object Viewer** on *the file bucket* and *the private copies bucket*, **on each bucket**,
not on the project. Not the database-backup bucket: the transfer from step 1.7 copies that one, and
the puller never reads it.

**A.**

```bash
for B in "$FILES_BUCKET" "$PRIVATE_BUCKET"; do
  gcloud storage buckets add-iam-policy-binding "gs://$B" \
    --member="serviceAccount:$PULLER_SA" --role=roles/storage.objectViewer --format=none
done
```

**B.** For each of the two buckets: **Cloud Storage** → **Buckets** → the bucket's name →
**Permissions** tab → **Grant access**. In **New principals**, paste the puller's address (as in
2.3). **Select a role** → **Cloud Storage** → **Storage Object Viewer**. **Save**.

Storage Object Viewer can view and list objects. It can't change or delete them.
Source: [Use IAM permissions (Cloud Storage)](https://docs.cloud.google.com/storage/docs/access-control/using-iam-permissions);
[gcloud storage buckets add-iam-policy-binding](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/add-iam-policy-binding);
[IAM roles for Cloud Storage](https://docs.cloud.google.com/storage/docs/access-control/iam-roles).

**2.5 Create-and-read on the vault bucket.** In the vault project. The puller gets
**Storage Object Creator** and **Storage Object Viewer** on *the vault bucket*. **Not** Storage
Admin, Storage Object Admin, or Storage Legacy Bucket Writer, which all include delete.

**A.**

```bash
for R in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "gs://$VAULT_BUCKET" \
    --member="serviceAccount:$PULLER_SA" --role="$R" --format=none
done
```

**B.** **Cloud Storage** → **Buckets** → the vault bucket → **Permissions** → **Grant access**.
**New principals**: the puller's address. **Select a role**: **Storage Object Creator**; **Add
another role**: **Storage Object Viewer**. **Save**.

Google describes Object Creator as "Allows users to create objects. Does not give permission to
view, delete, or overwrite objects." Neither role holds `storage.objects.delete`.
Source: [IAM roles for Cloud Storage](https://docs.cloud.google.com/storage/docs/access-control/iam-roles);
[Use IAM permissions (Cloud Storage)](https://docs.cloud.google.com/storage/docs/access-control/using-iam-permissions).

**2.6 The Cloudflare read token, kept only in the vault.** First in the Cloudflare dashboard, then
in the vault project. The token goes from Cloudflare's screen straight into Secret Manager. It never
goes into GitHub, the Codespace, this repo, Notes or a message.

*In Cloudflare.* Sign in at dash.cloudflare.com and select the account. Go to **Manage account** →
**Account API tokens** and tap **Create Token**. (An *account* token belongs to the account, not to
Ikenna's login, and it can only ever reach that one account. Cloudflare's compatibility matrix lists
Workers as supported. If the page isn't there, use **My Profile** → **API Tokens** instead, and
in its resource rule include only this one account.)
- Token name: "vault, Workers read".
- Start from scratch (a custom token), not a template. Add one policy: type **Account**,
  permission **Workers Scripts**, level **Read**. Cloudflare's permissions list names it
  "Workers Scripts Read: Grants read access to Cloudflare Workers scripts". Nothing else: no zone
  permissions, no Edit.
- **Token expiration**: leave it unset. An expiry would stop the Workers copy on that day; the alert
  in 2.12 would catch it, but there's no reason to plan a failure. **Client IP Address Filtering**:
  leave empty: the job has no fixed address set up for it.
- **Continue to summary**, check it reads Account / Workers Scripts / Read only, then **Create
  Token**. Cloudflare shows the token **once**. Tap its copy button. Don't close the tab yet.

The puller asks Cloudflare for exactly two things, the list of scripts and each script's content
(`…/workers/scripts/{name}/content/v2`). Cloudflare's reference lists Workers Scripts Read among the
permissions that endpoint accepts.

*The secret, in the vault project.* Replication: **automatic**. The token isn't readers' data, so
where Google keeps its copies doesn't matter for privacy. Automatic is Google's default, needs no
location choices on the iPad, and one region going down can't strand it.

**A.** Paste the first line, press Return, then paste the token and press Return. Nothing shows on
screen, and the token never enters the shell history:

```bash
read -rs CF_TOKEN
printf %s "$CF_TOKEN" | gcloud secrets create cloudflare-workers-read \
  --project="$VAULT_PROJECT" --replication-policy=automatic --data-file=-
unset CF_TOKEN
gcloud secrets add-iam-policy-binding cloudflare-workers-read --project="$VAULT_PROJECT" \
  --member="serviceAccount:$PULLER_SA" --role=roles/secretmanager.secretAccessor --format=none
```

**B.** Open **Security** → **Secret Manager** (search "Secret Manager") and tap **Create Secret**.
**Name**: `cloudflare-workers-read`. Paste the token into **Secret value**. Leave replication on its
automatic choice (Google's quickstart doesn't print that control's label). Tap **Create secret**.
Then, back on the list, tick the checkbox beside `cloudflare-workers-read` (don't open it). If the
info panel isn't showing, tap **Show Info Panel**. Tap **Add Principal**, paste the puller's address
into **New principals**, **Select a role** → **Secret Manager** → **Secret Manager Secret
Accessor**, **Save**.

Either way, then copy any other word over the clipboard and close the Cloudflare tab. The accessor
grant is on **this one secret**, not the project.
Source: [Create API token (Cloudflare)](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/);
[Account API tokens (Cloudflare)](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/);
[API token permissions (Cloudflare)](https://developers.cloudflare.com/fundamentals/api/reference/permissions/);
[Get Worker script content (Cloudflare)](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/);
[Create a secret (quickstart)](https://docs.cloud.google.com/secret-manager/docs/create-secret-quickstart);
[gcloud secrets create](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/create);
[Manage access to secrets](https://docs.cloud.google.com/secret-manager/docs/manage-access-to-secrets);
[gcloud secrets add-iam-policy-binding](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/add-iam-policy-binding).

**2.7 Create the job (don't run it).** In the vault project. The job is called `vault-puller`, in
`europe-west1`. It runs the stock Docker Hub image `docker.io/library/node:22-slim`. Google's Cloud
Run page says jobs can use "public images from Docker Hub", and advises it "only … for popular
container images such as Docker Official Images", which `node` is. There's no build and no
registry of our own. The container's **command** is four words: `node`, `-e`, the bootstrap line
from `vault/puller/BOOTSTRAP.txt`, and `--`. The bootstrap downloads the puller from *the puller
URL*, refuses it unless its SHA-256 is *the puller SHA-256*, and runs it. The job has **no
arguments**: a daily run is the plain run, and anything given as arguments (2.8 to 2.10) goes
straight to the puller after the `--`.

**Why the bootstrap is in the command, not the arguments.** Google's API reference says an
execution's override arguments "Will replace existing args". With the bootstrap in the command, an
override is just the puller's flag (`--check-accounts`), and the command stays as it is. The `--`
matters: after `node -e …`, node reads `--check-accounts` as one of **its own** options and stops
with "bad option" (tested). After `--`, node hands it to the puller.

Settings: **1 task**, **0 retries** (a failure must fail the execution, so the alert fires),
**60-minute task timeout**, **1 GiB memory**, service account **vault-puller**. It has eight plain
environment variables and one secret:

| name | value |
|---|---|
| `PULLER_URL` | *the puller URL* (2.0) |
| `PULLER_SHA256` | *the puller SHA-256* |
| `VAULT_BUCKET` | *the vault bucket* |
| `SITE_PROJECT_ID` | *the site project ID* |
| `SITE_FILES_BUCKET` | *the file bucket* |
| `SITE_PRIVATE_BUCKET` | *the private copies bucket* |
| `AGE_RECIPIENT` | *the age public key* |
| `CF_ACCOUNT_ID` | *the Cloudflare account ID* |
| `CF_API_TOKEN` | **secret** `cloudflare-workers-read`, version `latest` |

None of the eight plain values is a secret. Google warns that environment variables are visible to
anyone with Viewer on the project, which is why the token is a secret reference. Bucket names and
the age *public* key are fine there.

**Why `~~`.** gcloud splits a list flag such as `--command` at commas, and the bootstrap line
contains commas. Google's escaping topic says: "to include commas in your arguments, specify an
alternate delimiter", written `^DELIM^` at the very start of the value, where the delimiter "may
not appear in any value". So `--command="^~~^node~~-e~~<bootstrap>~~--"` is exactly four words. A
`^` later in the value (the bootstrap has one) "has no special meaning". The `grep -c '~~'` in 2.0
proved `~~` isn't in the line.

**A.**

```bash
cd ~/vault-src
gcloud run jobs create vault-puller \
  --project="$VAULT_PROJECT" --region="$REGION" \
  --image=docker.io/library/node:22-slim \
  --command="^~~^node~~-e~~$(cat vault/puller/BOOTSTRAP.txt)~~--" \
  --tasks=1 --max-retries=0 --task-timeout=60m --memory=1Gi \
  --service-account="$PULLER_SA" \
  --set-env-vars="PULLER_URL=$PULLER_URL,PULLER_SHA256=$PULLER_SHA256,VAULT_BUCKET=$VAULT_BUCKET,SITE_PROJECT_ID=$SITE_PROJECT,SITE_FILES_BUCKET=$FILES_BUCKET,SITE_PRIVATE_BUCKET=$PRIVATE_BUCKET,AGE_RECIPIENT=$AGE_RECIPIENT,CF_ACCOUNT_ID=$CF_ACCOUNT_ID" \
  --set-secrets=CF_API_TOKEN=cloudflare-workers-read:latest
```

No `--execute-now`: it's created, not run.

**B.** Open **Cloud Run**, tap **Deploy container** and choose **Job** if asked, to reach the
**Create job** form.
- Container image: `docker.io/library/node:22-slim` (Google's page names the step, not the field).
- Job name: `vault-puller`. **Region**: `europe-west1`. Number of tasks: **1**.
- Expand **Containers, Connections, Security** (Google's pages print it both that way and as
  "Containers, Networking, Security").
- **Container** tab: the container's **command** is the four words `node`, `-e`, the whole
  bootstrap line pasted from the tab opened in 2.0, and `--`. Leave the **arguments** empty. Google's
  page doesn't print these fields' labels or say whether the console takes one word per box. If it
  offers one box per word, use four boxes. If it offers a single text box, type `node -e `, paste
  the line, then type ` --`: the bootstrap has no spaces in it, so a box that splits at spaces still
  gets exactly four words. (Check the job's YAML tab afterwards if one is shown: `command` should
  list four items.)
- Memory: **1 GiB** (in the container's settings; Google's job pages don't print the field).
- **Variables & Secrets** tab: **Add Variable** eight times, with **Name** and **Value** from the
  table above. Then **Reference a secret**: name `CF_API_TOKEN`, **Secret**
  `cloudflare-workers-read`, version **latest**, exposed as an environment variable.
- **Security** tab: **Service account** → **vault-puller**.
- **Task capacity**: **Task timeout** 60 minutes; **Number of retries per failed task** **0**.
- If a box offers to run the job as soon as it's created, leave it unticked. Tap **Create**.

**On `latest`.** Google's secrets page recommends pinning a version number "instead of using
`latest`". The design keeps `latest` on purpose. Each execution starts a fresh container, and
environment variables "are resolved at instance startup time", so a rotated token is picked up by
the next run with no redeploy. To rotate: add a new version to the secret, then disable the old
one after the next successful run.
Source: [Create jobs](https://docs.cloud.google.com/run/docs/create-jobs);
[gcloud run jobs create](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/create);
[gcloud topic escaping](https://docs.cloud.google.com/sdk/gcloud/reference/topic/escaping);
[Configure containers for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/containers);
[Escape comma characters (Cloud Run)](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables);
[Environment variables for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables);
[Secrets for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets);
[Service identity for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/service-identity).

**2.8 First run: `--check-accounts` (the check the deploy runs first).** This proves the custom role
from 2.3 returns password hashes, salts and the hash parameters. It prints **counts only** and
writes nothing to the vault. **If it fails, stop here.** Don't do 2.9 or later until the round has
seen the counts.

It runs with an **override** of the job's arguments for this one execution: the single argument
`--check-accounts`, which the command's `--` hands to the puller (2.7).

**A.**

```bash
gcloud run jobs execute vault-puller --project="$VAULT_PROJECT" --region="$REGION" --wait \
  --args=--check-accounts
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vault-puller"' \
  --project="$VAULT_PROJECT" --freshness=1h --limit=10 \
  --format='value(severity,jsonPayload,textPayload)'
```

(The newest line comes first.)

**B.** **Cloud Run** → **vault-puller** → the expander arrow beside **Edit** → **Execute with
overrides**. Set the arguments to the one word `--check-accounts`. Leave everything else. Tap **Execute**. When the execution shows as finished, tap it, then its **Logs**
tab.

**What it must show.** A line with `"part": "check"`, `"ok": true` and `"proved": true`. On that
line, `withPasswordHash` and `withSalt` must both equal `passwordAccounts`, and `hashParameterFields`
must equal `hashParameterFieldsExpected`. Then a summary line with `"failed": 0`, and the execution
marked succeeded. Send the round that line's numbers. They're counts, never names.

**If it fails**, the error says which part, never a value:
- "the hash parameters were not returned" → the role is missing `getHashConfig`, or it was granted
  on the wrong project. Recheck 2.3.
- an HTTP 403 → a grant is missing (2.3), or an API is off (2.1).
- "configuration incomplete" → an environment variable is empty (2.7).
- a line with `"bootstrap": true` → *the puller URL* or *the puller SHA-256* is wrong (2.0).
- "bad option" → the command's last word `--` is missing (2.7).
Source: [Execute jobs](https://docs.cloud.google.com/run/docs/execute/jobs);
[gcloud run jobs execute](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/execute);
[Method: jobs.run (overrides)](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run);
[Logging and viewing logs in Cloud Run](https://docs.cloud.google.com/run/docs/logging);
[gcloud logging read](https://docs.cloud.google.com/sdk/gcloud/reference/logging/read).

**2.9 A dry run.** Everything is read and counted, and nothing is written to the vault.

**A.**

```bash
gcloud run jobs execute vault-puller --project="$VAULT_PROJECT" --region="$REGION" --wait \
  --args=--dry-run
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vault-puller"' \
  --project="$VAULT_PROJECT" --freshness=1h --limit=10 \
  --format='value(severity,jsonPayload,textPayload)'
```

**B.** As in 2.8, with the one argument `--dry-run`.

Each part (`files`, `accounts`, `workers`, `rules`) should log `"ok": true` with counts of what it
*would* write. `manual` appears only on its weekday, so a dry run on another day leaves it out. The
summary should read `"failed": 0`. The files count should be near the 2,500 of step 1.11. Send the
round the counts. Open the vault bucket: nothing new should be there.
Source: [Execute jobs](https://docs.cloud.google.com/run/docs/execute/jobs);
[gcloud run jobs execute](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/execute).

**2.10 The first real run.** It adds `--force-manual`, so the private copies bucket is copied today
rather than on its weekday. It takes a few minutes. The first run copies every file, about 1 GB.

**A.**

```bash
gcloud run jobs execute vault-puller --project="$VAULT_PROJECT" --region="$REGION" --wait \
  --args=--force-manual
```

**B.** As in 2.8, with the one argument `--force-manual`.

Then open the vault bucket. There should be new folders `files/`, `files-manifest/` (today's date),
`manual/`, `manual-manifest/`, `accounts/` (one `.json.age`), `accounts-check/`, `workers/` and
`rules/`. The summary log line should read `"failed": 0`. From now on, the phase-1 copies under
`files-seed/` and `manual-seed/` can simply age out (step 1.6).

**Check the key card opens the vault (§5).** `accounts-check/` holds one small file encrypted to the
same key as the accounts. In Cloud Shell: `sudo apt-get install -y age`, then
`gcloud storage cat "gs://$VAULT_BUCKET/accounts-check/*.txt.age" > /tmp/check.age`,
`read -rs AGE_KEY` (type the card's line, Enter), and
`age -d -i <(printf '%s\n' "$AGE_KEY") /tmp/check.age; unset AGE_KEY; rm /tmp/check.age`. It must
print *The vault's accounts key opens this file.* Do it once with each card.
Source: [Execute jobs](https://docs.cloud.google.com/run/docs/execute/jobs).

**2.11 The schedule: every day at 05:30 London time.** Cloud Scheduler calls the job's `run` method
with a Google **OAuth** token. Google's scheduler page says it "accepts OAuth tokens only for target
URLs hosted on `*.googleapis.com`", and that's what calling a Google API needs. The token comes
from a second small service account, **vault-scheduler**. It holds **Cloud Run Invoker** on **this
one job** and nothing else. (Google's gcloud example uses the project's default compute service
account. Its Terraform example uses a dedicated account bound on the job only, which is what this
step does.) The scheduled call sends no overrides, so it's the plain daily run.

**A.**

```bash
gcloud iam service-accounts create vault-scheduler --project="$VAULT_PROJECT" \
  --display-name="Vault scheduler" --description="Starts the vault puller. Nothing else."
gcloud run jobs add-iam-policy-binding vault-puller --project="$VAULT_PROJECT" --region="$REGION" \
  --member="serviceAccount:$SCHEDULER_SA" --role=roles/run.invoker --format=none
gcloud scheduler jobs create http vault-puller-daily \
  --project="$VAULT_PROJECT" --location="$REGION" \
  --schedule="30 5 * * *" --time-zone="Europe/London" \
  --uri="https://run.googleapis.com/v2/projects/$VAULT_PROJECT/locations/$REGION/jobs/vault-puller:run" \
  --http-method=POST \
  --oauth-service-account-email="$SCHEDULER_SA" \
  --description="The vault's daily copy"
gcloud scheduler jobs run vault-puller-daily --project="$VAULT_PROJECT" --location="$REGION"
```

**B.**
- Create the account as in 2.2, named **vault-scheduler**, description "Starts the vault puller.
  Nothing else.", **Done** with no project role.
- **Cloud Run**: tick the checkbox to the left of **vault-puller**. Don't open the job. In the
  information pane, open the **Permissions** tab, tap **Add principal**, paste the scheduler's
  address (`vault-scheduler@` followed by *the vault project ID* and `.iam.gserviceaccount.com`)
  into **New principals**. From **Assign roles**, choose **Cloud Run Invoker**. **Save**.
- Now open **vault-puller** → **Triggers** tab → **Add Scheduler Trigger**. **Name**
  `vault-puller-daily`; **Region** `europe-west1`; frequency `30 5 * * *`; **Timezone**: the
  Europe/London entry (Google doesn't print how the list words it). **Continue**. Under **Configure
  the execution**, pick **vault-scheduler**. **Create**.
- Open **Cloud Scheduler**. In the row for `vault-puller-daily`, tap **Actions** → **Force run**.

The last command (or **Force run**) proves the schedule's identity works today, instead of at 05:30
tomorrow. It starts a normal daily run. Every write is create-only, so a second run on the same day
just finds everything already there. Within a minute, **Cloud Run** → **vault-puller** should show a
new execution, and Cloud Scheduler's **Status of last execution** should read **Success**. A 403
there means the invoker grant is missing.

`Europe/London` follows British Summer Time, so the run is at 05:30 local time all year.
Source: [Execute jobs on a schedule](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule);
[gcloud scheduler jobs create http](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/create/http);
[Use authentication with HTTP targets](https://docs.cloud.google.com/scheduler/docs/http-target-auth);
[gcloud run jobs add-iam-policy-binding](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/add-iam-policy-binding);
[Access control for Cloud Run](https://docs.cloud.google.com/run/docs/securing/managing-access);
[gcloud scheduler jobs run](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/run);
[Schedule and run a cron job](https://docs.cloud.google.com/scheduler/docs/schedule-run-cron-job).

**2.12 The alerts: an email when a puller run fails, and when a transfer run fails (§6).** In the
vault project. First an email notification channel, then two alert policies on Google's own metrics:

- **Puller**: `run.googleapis.com/job/completed_execution_count` ("Completed Executions", GA,
  "Number of completed job executions and their result"), for `vault-puller`, where the `result`
  label is `failed`. With 0 retries, a puller that exits non-zero fails the execution.
- **Transfers**: `storagetransfer.googleapis.com/transferjob/error_count` ("Error count", **BETA**,
  "Number of errors encountered during the transfer, grouped by canonical error code"), for every
  transfer job in the vault project.

Each fires when the count over 5 minutes is above 0.

**A.**

```bash
CHANNEL=$(gcloud beta monitoring channels create --project="$VAULT_PROJECT" \
  --display-name="Vault alerts" --type=email \
  --channel-labels=email_address="$ALERT_EMAIL" --format='value(name)')
cat > ~/alert-puller.json <<'EOF'
{
  "displayName": "Vault: a puller run failed",
  "combiner": "OR",
  "conditions": [{
    "displayName": "vault-puller execution failed",
    "conditionThreshold": {
      "filter": "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"vault-puller\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\"",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "0s",
      "trigger": {"count": 1}
    }
  }]
}
EOF
cat > ~/alert-transfer.json <<'EOF'
{
  "displayName": "Vault: a transfer run had errors",
  "combiner": "OR",
  "conditions": [{
    "displayName": "storage transfer errors",
    "conditionThreshold": {
      "filter": "resource.type = \"storage_transfer_job\" AND metric.type = \"storagetransfer.googleapis.com/transferjob/error_count\"",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "0s",
      "trigger": {"count": 1}
    }
  }]
}
EOF
gcloud monitoring policies create --project="$VAULT_PROJECT" \
  --policy-from-file="$HOME/alert-puller.json" --notification-channels="$CHANNEL"
gcloud monitoring policies create --project="$VAULT_PROJECT" \
  --policy-from-file="$HOME/alert-transfer.json" --notification-channels="$CHANNEL"
```

**B.**
- **Monitoring** → **Alerting** → **Edit notification channels**. In the **Email** section tap
  **Add New**, type *the alert email* and a description ("Vault alerts"), **Save**.
- Back on **Alerting**, tap **Create policy** → **Select a metric**. Choose resource **Cloud Run
  Job**, metric **Completed Executions**, **Apply**. (If it's not listed, the **Active** button
  hides metrics with no recent data; turn it off.) **Add filter**: `job_name` = `vault-puller`;
  **Add filter** again: `result` = `failed`. **Rolling window**: 5 minutes; **Rolling window
  function**: the sum (Google's page names the field, not its choices). **Next**. **Condition
  type** **Threshold**, **Alert trigger** **Any time series violates**, **Threshold position**
  **Above threshold**, **Threshold value** **0**. **Next**. Open **Notifications and name**, tick
  the "Vault alerts" channel; **Alert name** "Vault: a puller run failed". **Create policy**.
- Again **Create policy** → **Select a metric** → resource Storage Transfer Job
  (`storage_transfer_job`), metric **Error count**. Turn **Active** off: no transfer has errored
  yet, so it won't be listed otherwise. **Apply**, no filter, the same window, trigger and channel.
  **Alert name** "Vault: a transfer run had errors". **Create policy**.

**Test the puller alert** with an execution that fails on purpose. It hands the puller an argument
it refuses, so it stops before reading or writing anything:

```bash
gcloud run jobs execute vault-puller --project="$VAULT_PROJECT" --region="$REGION" --wait \
  --args=--alert-test
```

(Console: **Execute with overrides**, the one argument `--alert-test`.) The puller logs "unknown
argument" and exits 2, and gcloud reports the execution failed, which is the point. The email should arrive within about ten minutes.
Google's metric list says data "is not visible for up to 120 seconds" after sampling.

**If no email comes**, the `result` value may be spelled differently. Google's metric list names
the label ("Execution result") but doesn't print its values. Open **Metrics explorer**, choose
**Cloud Run Job** → **Completed Executions**, group by `result`, and read the value shown for the
failed execution. Then edit the policy's `result` filter to match.

The transfer alert can't be tested without breaking a transfer, and Google doesn't say whether a
transfer that fails before copying anything counts as an "error" in this metric. The monthly look
(§6) and step 1.11's check stay the backstop.
Source: [Google Cloud metrics, P–Z (run, storagetransfer)](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z);
[Monitor Cloud Run](https://docs.cloud.google.com/run/docs/monitoring);
[Create alerting policies in the console](https://docs.cloud.google.com/monitoring/alerts/using-alerting-ui);
[Alerting policies in JSON](https://docs.cloud.google.com/monitoring/alerts/policies-in-json);
[gcloud monitoring policies create](https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/policies/create);
[gcloud beta monitoring channels create](https://docs.cloud.google.com/sdk/gcloud/reference/beta/monitoring/channels/create);
[Notification options](https://docs.cloud.google.com/monitoring/support/notification-options);
[Cloud Logging for Storage Transfer Service](https://docs.cloud.google.com/storage-transfer/docs/transfer-logs).

**2.13 Check who can reach what.** Like 1.10, this is the proof.

**A.**

```bash
gcloud iam service-accounts keys list --iam-account="$PULLER_SA" --managed-by=user
gcloud iam service-accounts keys list --iam-account="$SCHEDULER_SA" --managed-by=user
gcloud projects get-iam-policy "$SITE_PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members:vault-puller" --format="table(bindings.role)"
gcloud projects get-iam-policy "$VAULT_PROJECT" --flatten="bindings[].members" \
  --format="table(bindings.role,bindings.members)"
for B in "$FILES_BUCKET" "$PRIVATE_BUCKET" "$VAULT_BUCKET"; do
  echo "== $B"; gcloud storage buckets get-iam-policy "gs://$B" \
    --flatten="bindings[].members" --format="table(bindings.role,bindings.members)"
done
```

**B.** The same checks on the pages named below.

What each must show:
- **Keys** (A: the two `keys list` commands print nothing; B: **IAM & Admin** → **Service
  accounts** → each account → **Keys** tab is empty). **No user-managed key on either account.**
- **Site project, IAM**: the puller appears with exactly two roles, **Vault accounts reader** and
  **Firebase Rules Viewer**. The scheduler doesn't appear at all.
- **Vault project, IAM**: still only you and Google's own agents. **Neither** `vault-puller` nor
  `vault-scheduler` holds a project role, and **nothing from the site's project** is listed (no
  `firebase-adminsdk-…`).
- **The file bucket and the private copies bucket** (site): the puller with **Storage Object
  Viewer** only, beside the transfer agent from 1.10.
- **The vault bucket**: the puller with **Storage Object Creator** and **Storage Object Viewer**,
  and the transfer agent as in 1.10. Nothing else new.
- **The secret** (`cloudflare-workers-read` → **Permissions**): the puller with **Secret Manager
  Secret Accessor**.
- **The job** (`vault-puller`, ticked → **Permissions**): the scheduler with **Cloud Run Invoker**.
Source: [gcloud iam service-accounts keys list](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/list);
[gcloud projects get-iam-policy](https://docs.cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy);
[gcloud storage buckets get-iam-policy](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/get-iam-policy);
[Manage access to projects](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access);
[Access control for Cloud Run](https://docs.cloud.google.com/run/docs/securing/managing-access).

**2.14 Updating the puller later.** A new puller is a new commit. The round reports *the new puller
commit* and *the new puller SHA-256*, and only the two variables that name them change. The image,
the grants and the schedule stay as they are.

**A.** (After the 2.0 variables block.)

```bash
NEW_COMMIT='<the new puller commit>'
NEW_SHA256='<the new puller SHA-256>'
gcloud run jobs update vault-puller --project="$VAULT_PROJECT" --region="$REGION" \
  --update-env-vars="PULLER_URL=https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/$NEW_COMMIT/vault/puller/puller.mjs,PULLER_SHA256=$NEW_SHA256"
```

Use `--update-env-vars`, **never** `--set-env-vars`, which Google notes "will remove" every variable
not in the list.

**B.** **Cloud Run** → **vault-puller** → **Edit** (Google's jobs page prints it as **Edit and
deploy new revision**) → the **Container** tab → **Variables and secrets**. Change the **Value** of
`PULLER_URL` and `PULLER_SHA256` only, tap **Done**, then the save button (**Deploy** on Google's
page).

Then run 2.9 (a dry run) before the next scheduled run. If the round says **the bootstrap line**
changed too (rare), `git fetch` and `git checkout` the new commit in `~/vault-src` and run
`gcloud run jobs update vault-puller --project="$VAULT_PROJECT" --region="$REGION" --command="^~~^node~~-e~~$(cat vault/puller/BOOTSTRAP.txt)~~--"`
(console: replace the third word of the command).
Source: [Environment variables for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/environment-variables);
[gcloud run jobs update](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/update).

---

### The drill project (for the accounts restore test, §7)

A second, empty Firebase project. It gets Authentication with Email/Password, and nothing else: no
Analytics, no database, no Storage, no app. The test imports the test reader's one record into it,
never into the live site. These steps only set it up; how the drill runs is in
`scripts/backup/RESTORE.md`, "The accounts test". **No step here sets a password on any live
account.**

**D.1 Create it on the free plan.** At console.firebase.google.com, tap the button to create a new
Firebase project. Type *the drill project name*. If the console shows a project ID under the name
with a way to edit it, set it to *the drill project ID* from NAMES.md. (Google's page doesn't
describe the ID field. Either way, write the final ID into NAMES.md.) Accept the terms and tap
**Continue**. Leave **Gemini in Firebase** off and **Google Analytics** off. Tap **Create project**.
Don't link a billing account. Firebase describes Spark as the no-cost plan to "start out with", and
a project leaves Blaze for Spark when its billing is unlinked, so a project with no billing account
is on Spark. Don't add an app, a database or Storage.
Source: [Add Firebase to your JavaScript project](https://firebase.google.com/docs/web/setup);
[Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

**D.2 Turn on Email/Password sign-in.** In the drill project, open **Security** → **Authentication**
(the path Google's page prints) and tap **Get started**
if it's offered. On the **Sign-in method** tab, enable **Email/password** (not the email-link
option beneath it) and tap **Save**.
Source: [Authenticate with Firebase using password-based accounts](https://firebase.google.com/docs/auth/web/password-auth).

**D.3 Find its Web API key.** Firebase creates a "Browser key" when a project is created. The
Firebase console normally shows it as **Web API key** under **Project settings** (the gear) →
**General**, beneath the project ID. Google's page doesn't print that label. If the field says there
is no key, do D.2 first and reload; the key commonly appears once Authentication has been started.
If it's still missing, open the Google Cloud console with the drill project selected →
**APIs & Services** → **Credentials**, and use the key named **Browser key (auto created by
Firebase)**. Don't register a web app just to see it. Firebase says such a key isn't a secret, but
keep it in NAMES.md only, like every other value here.
Source: [Learn about using and managing API keys for Firebase](https://firebase.google.com/docs/projects/api-keys).

**D.4 Credentials for the drill, in Cloud Shell.** The drill script reads the site's database (for
the test reader's uid) and calls the Identity Toolkit API on the drill project, as Ikenna. That
takes Application Default Credentials with three scopes, and a **quota project**. Google's ADC
troubleshooting page says that with user credentials, "client-based" APIs need one, and that the
API must be on in that project. Use the drill project, where Authentication switched Identity
Toolkit on. (Check in the drill project's **APIs & Services** → **Enabled APIs & services** that
**Identity Toolkit API** is listed.)

```bash
DRILL_PROJECT='<the drill project ID>'
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email
gcloud auth application-default set-quota-project "$DRILL_PROJECT"
```

The login prints a link. Open it in a new tab, sign in as Ikenna, allow access, copy the code it
shows, and paste it back into Cloud Shell. `set-quota-project` needs `serviceusage.services.use` on
the drill project, which its Owner has. Google notes that "some cloud services may ignore this
quota project". If the drill's first call still says user credentials aren't supported, that's the
cause to report.

The credential file is written to `$HOME/.config/gcloud/application_default_credentials.json`, and
Cloud Shell keeps `$HOME` between sessions. So **when the drill is over**, run
`gcloud auth application-default revoke`, which revokes it and deletes the file.
Source: [gcloud auth application-default login](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/login);
[gcloud auth application-default set-quota-project](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/set-quota-project);
[gcloud auth application-default revoke](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/revoke);
[Troubleshoot your ADC setup](https://docs.cloud.google.com/docs/authentication/troubleshoot-adc);
[How Application Default Credentials works](https://docs.cloud.google.com/docs/authentication/application-default-credentials).

**D.5 `age` in Cloud Shell, and where the plaintext may live.** Install it at the start of each
drill session. Cloud Shell discards anything installed outside `$HOME` when the session ends:

```bash
sudo apt-get install -y age
age --version
```

(age's README lists `apt install age` for Debian 12+ and Ubuntu 22.04+.) **The decrypted accounts
file never goes in `$HOME`.** Cloud Shell keeps `$HOME` for 120 days after the last visit. Put it
under `/tmp`, which goes when the session's VM is discarded (after an hour idle, or when the session
ends). Even so, delete it yourself with `rm` the moment the drill is done, then close the session.
Google doesn't say whether Cloud Shell's `/tmp` is held in memory or on disk, so the explicit
delete is the part to rely on.
Source: [How Cloud Shell works](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works);
[age, README](https://github.com/FiloSottile/age).
