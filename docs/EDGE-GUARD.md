# EDGE-2: when the edge guard refuses a build

`npm run build` ends with `scripts/generate-edge-guard.mjs`. On Cloudflare's build it reads the live
site's `/_edge/ledger.json`, works out which removed pages may still have a preserved copy at the
edge, and writes `out/_routes.json`, so the guard Functions answer those addresses 404. The design
is in `app/lib/edgeGuard.mjs`.

**If the guard step fails, the whole build fails and nothing is deployed.** The live deployment keeps
serving, so a failed guard is never an outage, only a deploy that didn't happen. What a missed
deploy costs is any story that went live since the last good build: it has no static page until a
build succeeds, and its 404 page draws it through `/api/story` in the meantime (UNRELEASED-1).

## The escape hatch that is gone

`EDGE_LEDGER=none` (bootstrap: don't read the live ledger) is **refused when `CF_PAGES` is set**
(EDGE-2.1, `refusalOnPages`). It exists only for builds that are never deployed: CI, where
`scripts/ci/edge-ledger-throwaway.mjs` sets it with a throwaway key. Don't add it to the Pages
project; that build would refuse anyway.

## What a refusal says, and what to do

Every line below appears in the Pages build log. None of them prints a key or a slug.

| Build log says | Cause | Do this |
|---|---|---|
| `EDGE_LEDGER_KEY is missing or shorter than 32 characters` | the Pages variable is gone or was changed | Restore the variable (Production **and** Preview). A *new* value means the next build cannot read back the live ledger's guarded entries (`read back: other-key`) and falls back to the bootstrap seed. After 8 Nov 2026 03:13 UTC that covers only stories hidden in the last 8 days, not deleted stories or the other families (bookstore, series, voices). Changing the key loses the carried guard list, so treat it as a rotation and note it. |
| `EDGE_LEDGER=none on a Cloudflare Pages build` | someone set `EDGE_LEDGER` in the Pages project | Remove that variable and retry the deployment. |
| `[build-read] the live deployment's edge ledger … FAILED` after 4 attempts, or `HTTP 5xx` / `malformed ledger` | the live site couldn't be read, or served a ledger this code doesn't understand | **First choice: retry the build** once the site answers (the live site is what's being read, so if it is down the build waits on it). **If the live ledger itself is bad**, use one of the two routes below. |
| `functions/_middleware…`, `a top-level dynamic route…`, `_routes.json: …` | a code change broke a routing invariant | Fix the code; this is a normal failing build, nothing live is wrong. |
| `404.html is missing` | `next build` produced no 404 page | Fix the code. |

### Route 1: roll back to the last good deployment that has the guard

Cloudflare dashboard → Workers & Pages → `calvary-scribblings` → Deployments → the last green
**production** deployment **with the guard** → ⋯ → *Rollback to this deployment*. (API:
`POST /accounts/{account}/pages/projects/calvary-scribblings/deployments/{id}/rollback`.)

- The first ones with the guard are `806516ac` (6d31b82d, 3 Nov 2026) and `89dacb5f` (43a9ae8f).
  Anything older has **no ledger**, and the next build after a rollback to it bootstraps from the
  seed. After 8 Nov 2026 03:13 UTC that covers only stories hidden in the last 8 days, so deleted
  stories and removed bookstore, series and voices pages go unguarded until their preserved copies
  expire (7 days).
- A rollback is consistent with the guard: the rolled-back deployment serves its own ledger, every
  page it has is live again, and the next build guards whatever it then lacks.
- It also rolls back **content**. Stories that went live after that deployment lose their static
  page until the next good build (their 404 page still draws them through `/api/story`).

### Route 2: push a guard change

When the live ledger can't be fixed by a rollback (say every guarded deployment serves one this code
rejects), change `scripts/generate-edge-guard.mjs` or `app/lib/edgeGuard.mjs` and push. Prove it with
`npm run test:edge` and `npm run test:edge:proof`. Keep three things:

1. The ledger never names a non-live page in the clear (Ikenna's ruling, EDGE-2 Phase 1).
2. A production build never quietly skips the guard. If a change makes it start from an empty guard
   list, say so in the commit, and know that pages removed in the last 8 days become reachable again
   from preserved copies until those expire.
3. One push at a time, inside the release window.

## Reading a good build's log line

```
[edge-guard] live ledger: live site; read back: ok. pages served: N (…). guarded: G (routed R, rules X/100).
```

`guarded` is the true count. The published ledger holds more sealed entries than that: it pads with
decoys to a multiple of `LEDGER_PAD` (8), so 70 guarded is 72 sealed entries.
