# W1 — deploy hooks: what Ikenna does in the dashboards

This codespace has no Cloudflare credential and cannot read or set GitHub secrets. Every step
marked **(Ikenna)** is yours; the rest is verification that I, or anyone, can run afterwards.

## What was found (24 Sep 2026)

- The Worker mirror `workers-external/calvary-newsletter.worker.js` held a literal deploy-hook URL.
  **It is dead.** POSTing it returns `404 "The deploy hook you have specified does not exist"`.
  So is the only other hook ever committed to this repo. Both were rotated on 26 Aug.
  **Nothing live was ever published in git after that rotation.**
- The live `calvary-newsletter` Worker almost certainly still POSTs that dead URL after every scheduled
  publish. That means no rebuild has been triggered by a scheduled flip since 26 Aug, and nothing noticed:
  `fetch()` does not throw on a 404. Scheduled stories still got pages, because the build pre-renders
  any story with a `publishAt`. But every baked list waited for an unrelated deploy.
- The covers reconciler publishes cover-held drafts with **no** rebuild. A new story saved without a
  cover had no page until the next deploy.

W1 changes the code on both paths to read the hook from a secret. The dashboard half is below.

## Where a deploy hook is used or needed

| who fires it | when | where the URL lives | name |
|---|---|---|---|
| `/api/rebuild` (admin Save, Voices, Book Store, forum) | a human publishes | Pages project → Settings → Variables | `DEPLOY_HOOK_URL`, `CMS_DEPLOY_HOOK_URL`, `OPEN_PAGES_DEPLOY_HOOK_URL` (set 26 Aug; **unchanged**) |
| `functions/api/open-pages/moderate.js` | an Open Pages piece auto-publishes | same Pages variables | `OPEN_PAGES_DEPLOY_HOOK_URL` (**unchanged**) |
| `calvary-newsletter` Worker, cron | a scheduled story flips live | **Worker secret (new)** | `CMS_DEPLOY_HOOK_URL` |
| `.github/workflows/covers.yml` | the reconciler publishes a held story | **Actions secret (new)** | `CMS_DEPLOY_HOOK_URL` |
| `.github/workflows/withdrawals.yml` | a scheduled Book Store withdrawal | Actions secret (existing name) | `BOOKSTORE_DEPLOY_HOOK_URL`, possibly **never set** (see step 6) |

## The steps, in order

1. **(Ikenna)** Cloudflare → Workers & Pages → **calvary-scribblings** (the Pages project) → Settings →
   Builds → **Deploy hooks** → *Add deploy hook*. Name it `cms-runners`; branch **`main`** (production).
   Copy the URL. It is shown **once**, so keep it only until step 4.
2. **(Ikenna)** Cloudflare → Workers & Pages → **calvary-newsletter** (the Worker) → Settings →
   Variables and Secrets → *Add* → type **Secret** → name `CMS_DEPLOY_HOOK_URL` → paste → Deploy.
3. **(Ikenna)** Same Worker → *Edit code*. Find the one line containing `deploy_hooks/df2479ae`, inside
   `processScheduled`. Replace the whole `if (published) { … }` block with the code between
   `if (published) await fireDeployHook(env);` and the end of `async function fireDeployHook`, taken from
   `workers-external/calvary-newsletter.worker.js` in this repo. Deploy.
   *Edit just that block rather than pasting the whole file.* The mirror has no drift check in CI, and a
   whole-file paste would overwrite any dashboard edit the mirror doesn't know about.
4. **(Ikenna)** GitHub → the repo → Settings → Secrets and variables → Actions → *New repository secret*
   → `CMS_DEPLOY_HOOK_URL` → the same URL from step 1. Then forget the URL.
5. **(Ikenna) Trigger one build and confirm it deployed.** Run `curl -X POST "<the URL>"` once from any
   terminal. Cloudflare → the Pages project → Deployments shows a new build from `cms-runners`; wait for
   it to read **Success**. (The covers workflow is not a reliable trigger here: it fires the hook only
   when it actually publishes a story.)
6. **(Ikenna)** While in GitHub secrets: check that `BOOKSTORE_DEPLOY_HOOK_URL` **exists**. If it doesn't,
   scheduled Book Store withdrawals flip the record and never rebuild the shop. Its value should be the
   Pages project's `DEPLOY_HOOK_URL`, the Book Store hook.
7. **Only then delete the old hook.** `df2479ae-…` and `6667c809-…` are **already gone** (404 on 24 Sep).
   **(Ikenna)** Confirm neither appears in the Deploy hooks list. There is nothing else to delete.

## Verifying afterwards (anyone)

- **Scheduled flip:** the next one is **Fri 25 Sep 06:30 BST** (`why-do-filmmakers-keep-working-with-the-same-actors`).
  After 06:30, the site's Next build id changes (`curl -s https://calvaryscribblings.co.uk/ | grep -o '"buildId":"[^"]*"'`
  or the `/_next/static/<id>/` path), and the Pages Deployments list shows a build from `cms-runners`.
  **If it doesn't, the Worker's Logs tab says which: `CMS_DEPLOY_HOOK_URL is not set`, or `refused: HTTP n`.**
  Then 27 Sep (`phantom`) and 29 Sep (`did-you-enjoy-it`).
- **A human publish:** hide and unhide any story in /admin. The notice reads "rebuild started", and a
  deployment appears. This path uses the Pages variables and is untouched by W1.
- **The covers path:** the next time a new story is saved without a cover, the covers run's summary shows
  `rebuild fired`.
