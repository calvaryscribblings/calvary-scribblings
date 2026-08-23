# The Workers that run outside this repo

Five Cloudflare Workers serve this site. **None of them is deployed from this repo** — each
one's live source is edited in the Cloudflare dashboard. That makes them the only production
code here with no review, no history, and no way to tell what is actually running.

Two are mirrored. Three are not.

| Worker | Mirror | What it does | Credential it holds |
|---|---|---|---|
| `calvary-newsletter` | ✅ `calvary-newsletter.worker.js` | subscribe / send / drafts / unsubscribe, scheduled publish | `FIREBASE_SECRET` (legacy all-access DB secret), `RESEND_API_KEY` |
| `calvary-hit-counter` | ✅ `calvary-hit-counter.worker.js` | `stories/*/hits`, `hitsByDay`, the scheduled `top_stories` rebuild | `FIREBASE_SECRET` (legacy all-access DB secret) |
| `calvary-auth` | ❌ **none** | every verification and welcome email the business sends | unknown |
| `calvary-og-image` | ❌ **none** | renders Open Graph preview images (`/api/og-image` is a 4-line proxy to it) | unknown |
| `calvary-age-verify` | ❌ **none** | referenced by the site; purpose unconfirmed | unknown |

The mirrors are byte-for-byte copies, kept honest by `scripts/worker-mirror-check.mjs`. A
mirror that has drifted from the dashboard is worse than none, because it looks like a
record and isn't.

## Pulling a Worker out of the dashboard

**This needs a Cloudflare credential, which is deliberately not in this repo or the
Codespace.** Whoever runs it must be logged in to the Cloudflare account.

```bash
# One of these two, first:
npx wrangler login                       # interactive; opens a browser
export CLOUDFLARE_API_TOKEN=…            # or a token with Workers Scripts: Read

# Then pull the Worker into a scratch directory:
npx wrangler init /tmp/pull-auth --from-dash calvary-auth

# Copy the entry point in AS FOUND — do not tidy it, do not fix it:
cp /tmp/pull-auth/src/index.js workers-external/calvary-auth.worker.js
git add workers-external/calvary-auth.worker.js
git commit -m "mirror calvary-auth AS FOUND, before any repair"

# Prove the mirror matches what is deployed:
node scripts/worker-mirror-check.mjs /tmp/pull-auth/src/index.js auth
```

> `wrangler download` does not exist. The command is `wrangler init … --from-dash <name>`;
> checked against wrangler 4.125.0.

**Commit the as-found version before changing anything.** That is how `calvary-hit-counter`
was brought in (`2b34921` mirrors it as found, `8e617d1` repairs it), and the reason is that
the as-found commit is the only record of what was actually running when something broke.
A repair folded into the same commit destroys that record permanently.

## Why this matters more than it looks

`FIREBASE_SECRET` is a **legacy Realtime Database secret**: it grants full read and write
across the entire database and bypasses every rule in `database.rules.json`. Two Workers use
it, as `?auth=<secret>` on plain REST calls. It exists in one place — the Cloudflare
dashboard — and there is no copy of it anywhere else.

`scripts/worker-mirror-check.mjs` is **not wired into CI**. Nothing detects drift between a
mirror and its dashboard source automatically; it has to be run by hand after every
dashboard edit.
