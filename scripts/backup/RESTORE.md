# Restore

What the backup recovers, what it does not, and exactly what to do when it matters.

Read this **before** you need it. The one thing that cannot be recovered later is the piece
that has to be recorded now — see [What only Ikenna can do](#what-only-ikenna-can-do).

---

## Taking a backup

```bash
node scripts/backup/export.mjs                  # → backups/<utc-timestamp>/
node scripts/backup/rehearse.mjs backups/<utc-timestamp>
```

The second command is not optional. A backup nobody has restored is a hope; the rehearsal
restores the tree into a scratch node, reads it back, compares it, deletes it, and checks
the three things that break on restored data even when every byte is perfect. It changes
nothing live. Add `--offline` for a free integrity-only pass.

**Keep the backups off this machine.** A backup that lives only in the Codespace dies with
the Codespace. `backups/` is gitignored — it holds every reader's email address and password
hash, and it must never enter git.

---

## What is in it

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

```bash
gunzip -c backups/<stamp>/rtdb.json.gz > /tmp/rtdb.json
# Review it first. This overwrites EVERYTHING at the root.
curl -X PUT -H "Content-Type: application/json" \
  --data-binary @/tmp/rtdb.json \
  "https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app/.json?access_token=$(node -e "import('./scripts/rules-pull.mjs').then(m=>m.mintToken()).then(t=>process.stdout.write(t))")"
```

Roughly a minute. **This is destructive** — it replaces the root. To restore one subtree,
`PUT` to that path instead; that is almost always what you actually want.

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

**Restore the objects; do not re-upload the files.** Cloud Storage soft delete keeps deleted
and overwritten objects for 7 days, and restoring an object preserves its identity:

```bash
gcloud storage restore gs://calvary-scribblings.firebasestorage.app/bookstore_epubs/<id>/master.epub
```

Re-uploading from `backups/<stamp>/epubs/` works and gets the right bytes back, but it mints
a **new generation** — and the generation *is* the reading-position pin
(`docs/reading-position-pin.md`). Every reader of that title drops from an exact resume
position to an approximate one and silently re-downloads the book. `MANIFEST.json` records
the original generation of each file so you can tell whether that has happened.

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

### Turn on automated database backups

Firebase console → **Databases & Storage** → **Realtime Database** → **Backups** tab → follow
the in-console workflow. Blaze is required and the project is already on Blaze. Firebase
documents the feature itself as no extra cost — you pay only Cloud Storage rates for the
files, which at 4 MB gzipped with the offered 30-day lifecycle policy is well under a dollar
a month. Enable Gzip (default) and the 30-day lifecycle.

This creates a second bucket. The project currently has exactly one, which is how the audit
established that no backup has ever been configured.

### Harden the bucket

Cloud console → **Cloud Storage** → the bucket → **Protection**:

- **Object Versioning: on.** At 787 MB the cost is pennies and it removes the 7-day cliff.
- **Soft delete: raise from 7 days to 30.** Seven days is the default nobody chose.

### Put a copy somewhere that is not Google

The 13 master EPUBs are 7.2 MB and they are the inventory. One copy in the live bucket plus
a 7-day undo window is not a backup of a business asset.

---

## Automating it

`export.mjs` needs a service account and nothing else, so it fits the pattern
`.github/workflows/covers.yml` already uses: materialise the key from
`secrets.FIREBASE_SERVICE_ACCOUNT`, run, shred the key. The one thing to settle first is
*where the output goes* — a GitHub Actions artifact is capped and expires, and the file
contains every reader's email address and password hash. That is a decision about where
reader data may live, not a scripting problem, which is why this round stops at the script.
