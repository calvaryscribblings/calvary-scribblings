# Rotating the Firebase admin key

**SECURITY-R1, 20 Oct 2026.** This round found every consumer and prepared the switch. It changed no
secret and revoked nothing. Ikenna creates the new key and updates the consumers; the next round verifies
them all before the old key is disabled and deleted.

> **Never paste the new key, or any part of it, into a Claude session.** Every step below that touches
> a key value is done by Ikenna in a browser. Claude only ever needs the **key ID**, which is public:
> Google publishes it for anyone at
> `https://www.googleapis.com/service_accounts/v1/metadata/x509/firebase-adminsdk-fbsvc@calvary-scribblings.iam.gserviceaccount.com`.

---

## 1. The exposed key

| | |
|---|---|
| Service account | `firebase-adminsdk-fbsvc@calvary-scribblings.iam.gserviceaccount.com` |
| **Exposed key ID** | **`673d4716d544da64396fc5873058d0a500db792b`** |
| Created | 9 Jun 2026 (its published certificate's start date) |
| Expires | never |

**Same key, compared by `private_key_id` only:**

- Codespaces secret `FIREBASE_SA_KEY`: **yes**, `673d4716…`
- `serviceAccountKey.json` (repo root, git-ignored): **yes**, `673d4716…`
- GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT`: **unknown from here.** See §2.
- Cloudflare Pages `FIREBASE_PRIVATE_KEY`: **unknown from here.** See §2.
- Cloudflare Worker `calvary-auth` `FIREBASE_PRIVATE_KEY`: **unknown from here.** See §2.

**It was exposed three times, not once.** The full value went into three Claude Code sessions, the same way
each time (§7):

| date | session | round |
|---|---|---|
| 25 Sep 2026 09:42 UTC | `fc8b8673` | W8 |
| 17 Oct 2026 12:28 UTC | `28f459dc` | W49 live check |
| 20 Oct 2026 06:51 UTC | `45faee6e` | CARDS-R2.2 |

### The account holds more keys than this one

Google publishes six certificates for the account:

| key ID | from | to |
|---|---|---|
| `dde682e7715438044c2869c63b9737589c7091c1` | 30 Mar 2026 | never |
| `bdb8dbd9c050105cab7b3595b1b850b977ebb50a` | 4 Apr 2026 | never |
| `16eceae36b235fba870a4e75acd490cc74b2e46a` | 2 May 2026 | never |
| **`673d4716d544da64396fc5873058d0a500db792b`** | **9 Jun 2026** | **never** (the exposed one) |
| `29649aa65358f72a560364a1356832f83218d429` | 2 Apr 2026 | 2 Apr 2027 |
| `68652bb6be59ba883e42544c38cb253a28e99b45` | 2 Apr 2026 | 2 Apr 2027 |

So the Actions, Pages and `calvary-auth` secrets may each hold a *different* key from the Codespace's.
The Keys tab shows which keys are user-managed. This round could not list them: the account itself is
refused `keys.list` (403). Only `673d4716…` is known to be exposed. **Delete only that one.** Retiring
the other never-expiring keys is worth a later round, but it is not this one.

---

## 2. Which key each consumer holds, without exposing it

**Everything, read-only: the Metrics tab.** Google Cloud console → **IAM & Admin → Service accounts** →
`firebase-adminsdk-fbsvc@…` → **Metrics** tab → **Authentication traffic per key** chart. Click a key ID
in the legend to isolate it. It needs the Monitoring Viewer role. Google says the data is "usually
available within a few minutes", and it is kept for six weeks. Disabled keys are not included.

How to read it: the Actions jobs authenticate every 15 minutes, so their key shows a steady 15-minute
pulse. The Pages Functions authenticate when readers read, so their traffic follows reader activity.
`calvary-auth` authenticates only when a signup asks for a verification email. **Look at this before
step 1 and write down which keys have traffic.** That is the baseline.

**Per consumer:**

- **GitHub Actions `FIREBASE_SERVICE_ACCOUNT`.** The secret can't be read back, but a one-shot workflow can
  print its key ID. The key ID is public, so printing it is safe even though Actions logs on this repo are
  public. The Codespace's token cannot push workflow files (no `workflow` scope), so add this one on
  GitHub: **Code → `.github/workflows` → Add file → Create new file**, name it `admin-key-id.yml`, and
  commit it to `main`.

  ```yaml
  name: admin key id
  on: workflow_dispatch
  permissions: {}
  jobs:
    id:
      runs-on: ubuntu-latest
      steps:
        - name: Print the key ID (public) and nothing else
          env:
            KEY: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          run: |
            printf '%s' "$KEY" | jq -r '"private_key_id=" + .private_key_id'
  ```

  Then run it from **Actions → admin key id → Run workflow**. `verify-admin-key.mjs` finds the latest
  successful run and reports that key ID against every Actions consumer.

- **Cloudflare Pages `FIREBASE_PRIVATE_KEY`** and **Worker `calvary-auth`**: `secret_text` values are
  write-only, by Cloudflare's design. There is no way to read the key ID back. Use the Metrics tab before
  the switch. After it, you know by construction, because you pasted the new key there yourself.

---

## 3. Every consumer

All of them use the **same service account**. A different one would have to show in its client email, and
none does where that can be checked. The `calvary-auth` email is `secret_text` and can't be checked; see
row 5.

| # | Consumer | Secret name | Where it's set | Format | What breaks without it |
|---|---|---|---|---|---|
| 1 | Codespaces | `FIREBASE_SA_KEY` | **github.com → Settings → Codespaces → Secrets.** This is a *user-level* secret, not a repo one. Its repository access must include `calvary-scribblings`. | **base64 of the whole key file**, one line | `.devcontainer/devcontainer.json` decodes it into `serviceAccountKey.json`, and only when a Codespace is **created or rebuilt**. `scripts/launch-check.mjs` and `scripts/dictionary/coverage.mjs` also read it directly. |
| 2 | `serviceAccountKey.json` | none (a file) | repo root of the Codespace, git-ignored | raw JSON | About 70 scripts under `scripts/`, `npm run rules:deploy*` / `rules:pull` / `rules:check`, `tests/live/test-reader.mjs` (mints the test reader's sign-in), and `scripts/backup/export.mjs`. All are run by hand. |
| 3 | GitHub Actions | `FIREBASE_SERVICE_ACCOUNT` | **repo → Settings → Secrets and variables → Actions** | **raw JSON**: paste the file's contents as they are | Every */15 job: `covers.yml` (covers + publishing held stories), `account-scrub.yml` (finishing deletions), `index-reconcile.yml`, `push-announce.yml` (story pushes). Also `withdrawals.yml` (hourly), `square-horizon.yml`, `backup-liveness.yml` (daily 09:00 UTC), `launch-check.yml` (Mondays), `rules-and-hygiene.yml` (the rules drift check, only on pushes that change rules; skipped with a warning if unset) and `w33-proof.yml` (by hand). |
| 4 | Cloudflare Pages, project `calvary-scribblings`, **Production** | `FIREBASE_PRIVATE_KEY` (secret, encrypted) | **dash.cloudflare.com → Workers & Pages → calvary-scribblings → Settings → Variables and Secrets** | **The `private_key` PEM only**, not the whole JSON. Paste it as `jq -r .private_key key.json` prints it, with real line breaks. The JSON-escaped form with literal `\n` also works: every signer goes through `normalisePem()` in `functions/api/bookstore/_lib.js` or its own `.replace(/\\n/g, '\n')`. | Nearly every live endpoint. `/api/story` answers 502, so gated stories won't open. The Stripe and Paystack webhooks for **books and memberships** can't grant purchases. Also book streaming, account deletion, Square posts, DM images, comment screening, Open Pages moderation, quiz attempts, the hit counter, the rate limiter (fails closed, so `/api/rebuild` refuses), Series reads and notes, and the admin lookups. **Takes effect only on the next deployment.** |
| 4a | the same project | `FIREBASE_CLIENT_EMAIL` (plain text) | same page | the account's email | **Unchanged.** The new key belongs to the same account. |
| 5 | Cloudflare Worker `calvary-auth` (source is **not** in this repo; it's deployed directly) | `FIREBASE_PRIVATE_KEY`, plus `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PROJECT_ID` (all secret) | **dash.cloudflare.com → Workers & Pages → calvary-auth → Settings → Variables and Secrets** | PEM, real line breaks (its code also accepts `\n`) | `/send-verification`: new readers' email-verification links, through `/api/auth/send-verification`. `/welcome` doesn't use the key. Its client email is `secret_text`, so whether it is even this account can't be checked from here. |

**Not this key. Listed so nobody rotates them by mistake, and so nobody assumes they're covered:**

- `FIREBASE_SECRET`, the **legacy Realtime Database secret**, in Workers `calvary-hit-counter`,
  `calvary-newsletter` and `calvary-beta-signup`. It is a different credential. Rotating the
  service-account key does not affect it.
- Worker `calvary-og-image` (`FIREBASE_DB` is a URL) and Worker `publish` (a GitHub token only) hold no
  Firebase admin credential.
- `scripts/backup/RESTORE.md` *describes* using the key (`mintToken()`) but holds none.

---

## 4. The switch, in order

Google: "we recommend that you disable the key, then wait until you are sure that the key is no longer
needed" before deleting it, and "You cannot undelete a deleted key." A disabled key can be re-enabled.

- [ ] **0. Baseline.** Open the Metrics tab (§2) and write down which key IDs show traffic. Ask Claude to
  run `node scripts/security/verify-admin-key.mjs`. Everything should pass on `673d4716…` or show n/a.
- [ ] **1. Create the new key.** Google Cloud console → **IAM & Admin → Service accounts** → select project
  `calvary-scribblings` → click `firebase-adminsdk-fbsvc@…` → **Keys** tab → **Add key** → **Create new
  key** → Key type **JSON** → **Create**. The file downloads once and can't be downloaded again. Note its
  new key ID; it is the new row on the Keys tab.
  - *If creation is refused:* the org policy constraint `iam.disableServiceAccountKeyCreation` may be
    enforced. Google enforces it by default for organisations created on or after 3 May 2024. Changing it
    needs `orgpolicy.policy.set` (Organization Policy Administrator), or an exemption through a
    `disableServiceAccountKeyCreation` tag set to `not_enforced`. If the project sits under no
    organisation, the constraint doesn't apply.
  - *On an iPad*, Cloud Shell (the `>_` icon at the top of the console) is the easiest place to handle the
    file. Upload it there and use:
    `base64 -w0 key.json` for row 1,
    `cat key.json` for row 3,
    `jq -r .private_key key.json` for rows 4 and 5.
    Run `clear` after each copy.
- [ ] **2. Update every consumer** (§3), in any order. Until the old key is disabled, both keys work.
  1. Actions `FIREBASE_SERVICE_ACCOUNT`: raw JSON.
  2. Codespaces `FIREBASE_SA_KEY`: base64. Then **rebuild the Codespace** (Command Palette →
     *Codespaces: Rebuild Container*). A changed Codespaces secret is not in a running shell, and
     `serviceAccountKey.json` is rewritten only on create or rebuild.
  3. Pages `FIREBASE_PRIVATE_KEY`: PEM with real line breaks. Then **redeploy**: Deployments → latest
     production deployment → ⋯ → *Retry deployment*.
  4. Worker `calvary-auth` `FIREBASE_PRIVATE_KEY`: PEM. Check its `FIREBASE_CLIENT_EMAIL` is
     `firebase-adminsdk-fbsvc@calvary-scribblings.iam.gserviceaccount.com`; overwrite it with that value
     if unsure.
- [ ] **3. Check each one works on the new key.** Ask Claude to run, with the new key ID:
  `node scripts/security/verify-admin-key.mjs --expect <new key id> --probe-pages`
  - Run **admin key id** (§2) first, so Actions is checked by key ID and not only by job results.
  - Then wait about 20 minutes, so every */15 job has run once on the new secret.
  - `calvary-auth`: sign up a test address (or trigger a verification email), and see the new key's
    traffic in Metrics.
  - Metrics: the new key shows traffic from every consumer.
- [ ] **4. Disable the old key.** The console cannot disable a key ("you cannot use the Google Cloud
  console to disable a key"), so use Cloud Shell:
  ```
  gcloud iam service-accounts keys disable 673d4716d544da64396fc5873058d0a500db792b \
    --iam-account=firebase-adminsdk-fbsvc@calvary-scribblings.iam.gserviceaccount.com \
    --project=calvary-scribblings
  ```
  To undo: the same command with `enable`.
- [ ] **5. Check again.** Run the same `verify-admin-key.mjs --expect <new key id> --probe-pages`. Watch the
  */15 jobs stay green for an hour. Open a gated story on the site. Keep it disabled at least until the
  next **Monday launch check** and one **daily backup-liveness** run have both passed. Anything that
  breaks now was still on the old key: re-enable it, fix that consumer, and repeat from step 3.
- [ ] **6. Delete the old key.** Keys tab → the row whose ID is `673d4716d544da64396fc5873058d0a500db792b` →
  the **Delete** (bin) icon. Match the full ID, because there are four never-expiring keys.
  **Irreversible.**
- [ ] **7. Clean up.** Delete the downloaded JSON from the iPad's Files and from Cloud Shell
  (`rm key.json`).

---

## 5. The verification script

`scripts/security/verify-admin-key.mjs` prints only pass, fail or n/a, the consumer, and the key ID. It is
read-only, with one opt-in exception: `--probe-pages` asks the live site for one story, and that adds one
to `story_clients/<day>/story/key-verify__noversion`. The label keeps it out of `unknown`, the bucket the
app-migration work waits on.

| consumer | how it's checked |
|---|---|
| Codespaces secret and file | Decodes the value, mints a token, does a shallow database read, and checks the private key pairs with Google's published certificate for its key ID. |
| Actions | The last completed run of each workflow that uses the secret. For `rules-and-hygiene` it checks the `rules:check` step, not the whole CI run. It reads the key ID from the **admin key id** run, if there is one. |
| Pages | The email is compared (plain text, never printed) and the key's type checked. `--probe-pages` exercises the key itself: `/api/story` answers 502 when the mint fails. |
| `calvary-auth` | The bindings are checked by name and type only. Every use of the key sends an email, so it is never probed. |

**Result against the old key, 20 Oct 2026 20:12 UTC:**

```
PASS  Codespace secret FIREBASE_SA_KEY (base64)     kid=673d4716d544da64396fc5873058d0a500db792b  token minted, database read; published cert pairs
PASS  Codespace file serviceAccountKey.json         kid=673d4716d544da64396fc5873058d0a500db792b  token minted, database read; published cert pairs
PASS  Actions FIREBASE_SERVICE_ACCOUNT · covers.yml  kid=—  last schedule run 2026-10-20T20:04:35Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · account-scrub.yml  kid=—  last schedule run 2026-10-20T20:08:40Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · index-reconcile.yml  kid=—  last schedule run 2026-10-20T20:03:31Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · push-announce.yml  kid=—  last schedule run 2026-10-20T19:51:45Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · withdrawals.yml  kid=—  last schedule run 2026-10-20T19:21:53Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · square-horizon.yml  kid=—  last schedule run 2026-10-20T19:17:52Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · backup-liveness.yml  kid=—  last schedule run 2026-10-20T09:10:53Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · launch-check.yml  kid=—  last schedule run 2026-10-19T00:57:47Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · rules-and-hygiene.yml  kid=—  step "rules:check" in push run 2026-10-20T03:26:43Z: success
PASS  Actions FIREBASE_SERVICE_ACCOUNT · w33-proof.yml  kid=—  last workflow_dispatch run 2026-10-03T20:18:06Z: success
N/A   Cloudflare Pages · calvary-scribblings (prod)  kid=—  configured (email matches, key is secret_text); not exercised: pass --probe-pages
N/A   Cloudflare Worker · calvary-auth              kid=—  configured (both secret_text); unreadable and not probed: every use sends mail
12 pass, 0 fail, 2 n/a
```

---

## 6. Where the old key is, outside the secret stores

None of these was removed this round. **Once the key is deleted, every copy is inert.** That is the
remedy, not deleting the copies.

- **Claude Code transcripts in this Codespace**, three files, each holding the full base64 value:
  `~/.claude/projects/-workspaces-calvary-scribblings/fc8b8673-….jsonl`, `28f459dc-….jsonl`,
  `45faee6e-….jsonl`. Those sessions' content was also sent to Anthropic's API.
- **VS Code local history in this Codespace**, two full copies of the key file saved on 9 Jun 2026:
  `~/.vscode-remote/data/User/History/-1893e4c3/vhBq.json` (the old
  `calvary-scribblings-next/serviceAccountKey.json`) and
  `~/.vscode-remote/data/User/History/55a6edf9/yQ5v.json`.
- `serviceAccountKey.json` at the repo root: expected, and git-ignored.

**Searched and clean:**

- git history on every ref: the key ID and key material appear nowhere. The only committed private key is a
  sample bundled inside wrangler's `cli.js`, in `node_modules` committed by `22970b0d`, which no branch
  contains.
- the working tree.
- both release assets: the `shorelines-playtest-1` zip holds images and `MANIFEST.md`; `video-v2` is an mp4.
- the latest run of every workflow that uses the key, and its latest failed run where one still has logs.
  GitHub masks the secret, and no key material appeared in any form.

---

## 7. What printed it, and the fix

All three exposures ran the same line in a scratch script:

```js
JSON.parse(process.env.FIREBASE_SA_KEY)
```

`FIREBASE_SA_KEY` is base64, so the parse throws. On an uncaught `JSON.parse` error, Node (v24 here)
prints **the whole input** as the error's source line, under `<anonymous_script>:1`. The message after it,
`Unexpected token … "eyJ0eXBlIj"... is not valid JSON`, is truncated, which makes the leak look like ten
characters. It is the entire key.

The fix:

- `scripts/security/service-account.mjs` does every credential parse inside a `try/catch`. Its errors name
  the source and say "value withheld". Fed the real secret through the exact R2.2 mistake, it prints
  817 bytes, and none of them come from the secret.
- `scripts/launch-check.mjs`, `scripts/dictionary/coverage.mjs` and `scripts/bookstore/author-copy.mjs`
  parsed env credentials with a bare `JSON.parse`. They now use it.
- `CLAUDE.md` carries the rule: credential values are never printed, `FIREBASE_SA_KEY` is base64, and
  parsing goes through this loader.

---

## 8. Chosen, not derived

- **The order of updates in step 2.** Any order works while both keys are valid.
- **How long to keep the old key disabled before deleting it** (step 5: until a Monday launch check and a
  daily backup-liveness run have passed). Google says only "wait until you are sure".
- **`--probe-pages` is opt-in and labelled `key-verify`.** The round's brief said read-only; this is the
  only way to exercise the Pages key from outside.
- **The `admin-key-id.yml` workflow is described here, not committed.** The Codespace token can't push
  workflow files.
- **Only the three loaders that parse env credentials were moved to the safe loader.** About 70 scripts
  still `JSON.parse(readFileSync('serviceAccountKey.json'))`. That file is decoded JSON and parses
  cleanly, so this is a narrower risk; the `CLAUDE.md` rule covers new code.
