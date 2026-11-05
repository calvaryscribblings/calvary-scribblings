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
| the vault's **puller** service account (phase 2) | a service account in the vault project, with **no key**: Cloud Run lends it to the job | read on the same three buckets; a **custom role** on the site project holding exactly `firebaseauth.users.get`, `firebaseauth.configs.get` and `firebaseauth.configs.getHashConfig` (below); Firebase Rules Viewer |

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

Nothing here is done in SAFETY-2P.

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

**Phase 2 steps** (the puller's service account, its custom role on the site project, Secret
Manager, the Cloudflare read token, the job, its schedule and its alert, and the drill project)
are written by the build round against the puller it builds (§10), in the same form as these.
