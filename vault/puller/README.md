# The vault's puller

SAFETY-2B. The design is `docs/VAULT.md` (§3 what it copies, §4 how it reaches the site, §10 the
build). Ikenna's deploy steps are §12 of the same file.

| file | what it is |
|---|---|
| `puller.mjs` | the whole job: one file, no dependencies. `node puller.mjs --dry-run` / `--check-accounts` / `--force-manual` / `--only <parts>` |
| `puller.mjs.sha256` | its SHA-256. The job refuses a puller that doesn't match the `PULLER_SHA256` it was given |
| `BOOTSTRAP.txt` | the one line the Cloud Run job runs (`node -e <it> --`): fetch `puller.mjs` at a full commit, check it, run it |

**Changing the puller** means a new commit, a new `puller.mjs.sha256` (CI fails without it:
`sha256sum vault/puller/puller.mjs | cut -d" " -f1 > vault/puller/puller.mjs.sha256`), and
Ikenna pointing the job's `PULLER_URL` and `PULLER_SHA256` at that commit (VAULT.md, step 2.14).
The running job never follows `main`: it runs the commit it was given.

Tests: `npm run test:vault` (the puller against fakes, its age output opened by the reference
library, the bootstrap), and `tests/ci/safety-2b-vault-credentials.test.mjs`.
