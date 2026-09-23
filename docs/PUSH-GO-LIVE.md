# Push: the server half, and the go-live order

**Status (23 Sep 2026):** the rules are **live**. The announcer is **built, tested and disarmed**.
**Nothing has been sent to anyone.** No Expo token exists, the seed has not been written, and the
workflow's `schedule:` block is commented out.

| Piece | Where | State |
|---|---|---|
| Rules: `push_tokens`, the two toggles, the announcer's books | `database.rules.json` | **deployed**, parity proven |
| Announcer (scan → claim → send → receipts → prune) | `scripts/push/` | built, dry-run proven against production |
| Job | `.github/workflows/push-announce.yml` | **disarmed**: tests on push, dispatch-only, no secret |
| Test tool | `scripts/push-test.mjs <uid>` | built, never run: founder uids only unless `--any-uid` |

---

## The steps for Ikenna, in this order

### 1. Expo: the access token and enhanced push security

1. At **expo.dev**, open the account, then **Access tokens**, then **Create token**. Name it
   `calvary-push-announcer`. Copy it once; Expo will not show it again.
2. In the same account, open **the app's project**, then **Credentials** (or **Settings**), then
   **Enhanced push security**, and switch it **on**. From then on Expo refuses any send that
   doesn't carry an access token for this account. A leaked device token stops being enough to
   push to that phone.
   - ⚠ Switch it on **after** creating the token. Anything else that sends to this project
     without a token will start failing, and that is the point. Nothing on the web side sends
     yet.

### 2. Where the token goes

- **GitHub:** repo, then **Settings**, then **Secrets and variables**, then **Actions**, then
  **New repository secret**, named `EXPO_ACCESS_TOKEN`. The job reads it there. No Cloudflare
  secret is involved (see *Why GitHub Actions*, below).
- **On the machine you test from:** `export EXPO_ACCESS_TOKEN=…` in that shell only. Don't write it
  to a file in the repo.

`FIREBASE_SERVICE_ACCOUNT` is already a repo secret (covers.yml and index-reconcile.yml use it).

### 3. On your phone

1. Install **build 33** (TestFlight) or **versionCode 17**. Launch it **signed in** as yourself.
2. Confirm that a row has landed. In the Firebase console (read-only is fine), go to Realtime
   Database, then `push_tokens`, then *your uid*. You should see one child holding
   `{token, platform, appVersion, updatedAt}`.
   - **If nothing appears, stop here.** The rules could not be checked against the app's
     `docs/push-handoff.md`, because that repo isn't visible from this container (see *Open
     questions*, item 1). An absent row means the app is writing a shape these rules refuse.
     Compare the two before changing anything.
3. Run the test (from a machine that has `serviceAccountKey.json`):
   ```
   EXPO_ACCESS_TOKEN=… node scripts/push-test.mjs <your uid>
   ```
   It prints your devices, then the exact title, body and URL it sends (the newest live story,
   in the ruled format), then one **ticket** and one **receipt** per device.
4. **The notification arrives. Tapping it opens that story in the app.**
5. **The receipt reads `ok`.** `DeviceNotRegistered` means the token is stale, so relaunch the app
   and run it again. `InvalidCredentials` means the app's FCM/APNs credentials in Expo are
   incomplete, which is an app-side fix.

### 4. The seed, and arming. Do both together, and only after step 3 passes

The seed marks every item already live as announced. **Run it right before arming**, not days
earlier. A story that goes live between the seed and the first run gets announced late. More
than 5 at once, and the run refuses outright.

1. Actions, then **push announce**, then **Run workflow**, mode `seed-dry-run`. Read the log:
   the number marked, and the list left **pending**. Pending should be only future-scheduled
   stories and unreleased instalments. On 23 Sep it was 211 marked, 4 pending (`alive`
   24 Sep, `why-do-filmmakers…` 25 Sep, `phantom` 27 Sep, `did-you-enjoy-it` 29 Sep).
2. Run it again with mode `seed`. **This writes, once.** A second seed is refused unless forced.
3. Run it with mode `dry-run`. It should read `due: 0`.
4. Arm it: uncomment the two `schedule:` lines in `.github/workflows/push-announce.yml`, then
   commit and push. **That commit is the switch.**
5. After the next scheduled story goes live, check `push_announced/story/<slug>`. It should read
   `state: sent` with a recipient count.

(I can't dispatch workflows from the Codespace: `gh workflow run` returns 403. Steps 1–3 can
also be run locally: `node scripts/push/announce.mjs --seed`, then the same with `--apply`, then
`node scripts/push/announce.mjs`.)

---

## Recon

### When an item becomes visible

| Item | Visible when | How it gets there | Writes at that moment? |
|---|---|---|---|
| Story | `published !== false` and `publishAt` absent or past | CMS publish (saved `published:true`) | yes, the CMS |
| | | Scheduled: saved `published:false` + future `publishAt`; the **calvary-newsletter Worker** flips it | yes, the Worker (outside this repo) |
| | | Cover hold: `published:false` + `coverHold`; **covers.yml** publishes it with its cover | yes, the reconciler |
| | | Unhide | yes, the CMS |
| | stops: Hide (`published:false`), delete | | |
| | a re-save after publish keeps `published` as it was (`app/admin/page.js:768`) | | an edit, **not** a new item |
| Instalment | `status==='published'` and `releaseAtMs <= now` and series `status==='published'` | admin sets status + date | **no**: release is clock-driven |

There are four writers, one of them external, and one transition that nothing writes at all. So
no hook can see every case, and the announcer is a **scan**: visible, with no
`push_announced/{kind}/{id}` entry, means due. Any entry, in any state, means never again.
Edits, hide-then-unhide and retries therefore cannot re-send.

### The scheduled job: GitHub Actions, recommended over a Worker

- **It imports; it doesn't transcribe.** The payload, the {form} table and both visibility
  predicates are this repo's modules. A Worker can't import `app/lib`, and the last hand-copy in a
  Worker (the index projection) drifted. That drift is why `index-reconcile.yml` exists.
- **Review and history.** The Workers are edited in the Cloudflare dashboard, and three of the
  five have no mirror. This job is a file in the repo.
- **Credentials.** There's no Cloudflare credential in this container. `FIREBASE_SERVICE_ACCOUNT`
  is already a GitHub secret, and the only new secret is `EXPO_ACCESS_TOKEN`.
- **Testable.** The whole pass runs against the RTDB emulator in CI.
- **The costs:** latency of up to ~15–20 min (`*/15`, and GitHub's scheduler is best-effort).
  And GitHub **disables schedules after 60 days of repo inactivity**. A disabled cron produces
  no run, so it fails **silently**. `ops/push_announcer/lastRunAt` is written every run as the
  heartbeat, but **a liveness check on it is not built** (the same gap index-reconcile has).

### Who reads `storyNotifications` / `mentionNotifications`

**Nobody, anywhere in this repo.** No reader in `app/`, `functions/`, `workers/`,
`workers-external/` (both mirrored Workers) or `scripts/`, and **0 of 310** live user records
carry either field, because every write was refused. The app can't be checked from here.

- `storyNotifications` now has a reader: the announcer's audience (absent counts as on).
- `mentionNotifications` is **stored and still does nothing.** Nothing sends mention pushes. The
  toggle is no longer refused, but it controls nothing until a mention sender exists.
- `users/{uid}` is **world-readable** (`.read: true`), so both switches are public. That's
  harmless, but they can't be hidden without moving them out of `users/`, because read grants
  cascade.

---

## The payload

**RULED (story):** title = the story's title. Body = `New {form} by {author} · {trailer quote}`,
byline first. With no quote, the body ends at the byline. `data.url` = `/stories/{slug}`. No images.

**DRAFT (instalment):** title = the instalment title. Body =
`New instalment by {author} · {series} — {logline}`. `data.url` = `/series/instalment/{id}`.

Live examples, as the builder produces them:

| Title | Body |
|---|---|
| What the Light Remembers | New elegy by Tricia Ajax · The body forgets what it once could hold. |
| Completely Alone | New short story by Kalu Rebecca · You've left me completely alone in this marriage. |
| You've Been Using AI Wrong | New tech piece by Nzubechukwu Okere *(quote dropped: "buying")* |
| Part Three *(DRAFT)* | New instalment by Monica Garcia · Beta Princess — With her king reported dead… |
| Chapter I: It's Monday Again *(DRAFT)* | New instalment by Tricia Ajax · Diary of a Lagos 9-5er *(logline dropped: "₦2,200")* |

**Never a price, a purchase or the Book Store (iOS 3.1.1).** Three layers enforce it:
- The destination must match `/stories/…` or `/series/instalment/…`, or the send throws.
- A quote or logline carrying an amount, *buy/bought/price/purchase* or *book store* is dropped,
  and the body ends at the byline. 4 of the 183 live quotes would be dropped.
- A title carrying an amount, *purchase* or *book store* refuses the item. It's recorded as
  `refused` and never sent. No live title trips this. *The Price of Silence* would not.

### DRAFT: the {form} table (`scripts/push/forms.mjs`)

Every category and subcategory the taxonomy can produce, with its live count. The suite fails if a
subcategory is added to `app/lib/taxonomy.js` without a row here.

| Category | Subcategory | Live stories | Proposed {form} | Reads as |
|---|---|---:|---|---|
| Flash Fiction | *(none)* | 0 | flash fiction | New flash fiction by … |
| Flash Fiction | Romance | 3 | flash fiction | New flash fiction by … |
| Flash Fiction | Horror | 2 | flash fiction | New flash fiction by … |
| Flash Fiction | Humour | 3 | flash fiction | New flash fiction by … |
| Flash Fiction | Drama | 9 | flash fiction | New flash fiction by … |
| Flash Fiction | Thriller | 0 | flash fiction | New flash fiction by … |
| Flash Fiction | Slice of Life | 5 | flash fiction | New flash fiction by … |
| Short Story | *(none)* | 0 | short story | New short story by … |
| Short Story | Romance | 4 | short story | New short story by … |
| Short Story | Horror | 7 | short story | New short story by … |
| Short Story | Humour | 3 | short story | New short story by … |
| Short Story | Drama | 38 | short story | New short story by … |
| Short Story | Thriller | 6 | short story | New short story by … |
| Short Story | Slice of Life | 5 | short story | New short story by … |
| Short Story | Mystery | 1 | short story | New short story by … |
| Short Story | Sci-Fi | 0 | short story | New short story by … |
| Short Story | Historical | 2 | short story | New short story by … |
| Short Story | Fantasy | 3 | short story | New short story by … |
| Poetry | *(none)* | 0 | poem | New poem by … |
| Poetry | Love | 3 | love poem | New love poem by … |
| Poetry | Grief | 3 | poem | New poem by … |
| Poetry | Elegy | 1 | elegy | New elegy by … |
| Poetry | Political | 4 | poem | New poem by … |
| Poetry | Nature | 1 | poem | New poem by … |
| Poetry | Spiritual | 2 | poem | New poem by … |
| Poetry | Spoken Word | 2 | spoken word poem | New spoken word poem by … |
| News & Updates | *(none)* | 0 | article | New article by … |
| News & Updates | Op-Ed | 4 | op-ed | New op-ed by … |
| News & Updates | Essay | 0 | essay | New essay by … |
| News & Updates | Music | 5 | music piece | New music piece by … |
| News & Updates | Film | 17 | film piece | New film piece by … |
| News & Updates | Tech | 22 | tech piece | New tech piece by … |
| News & Updates | Science | 1 | science piece | New science piece by … |
| News & Updates | Business | 0 | business piece | New business piece by … |
| News & Updates | Finance | 0 | finance piece | New finance piece by … |
| News & Updates | Sport | 3 | sport piece | New sport piece by … |
| News & Updates | Politics | 4 | politics piece | New politics piece by … |
| News & Updates | Culture | 7 | culture piece | New culture piece by … |
| Inspiring | *(none)* | 0 | inspiring piece | New inspiring piece by … |
| Inspiring | Personal Essay | 5 | personal essay | New personal essay by … |
| Inspiring | Essay | 3 | essay | New essay by … |
| Inspiring | Overcoming | 2 | inspiring piece | New inspiring piece by … |
| Inspiring | Faith | 0 | inspiring piece | New inspiring piece by … |
| Inspiring | Ambition | 1 | inspiring piece | New inspiring piece by … |
| Inspiring | Loss & Recovery | 2 | inspiring piece | New inspiring piece by … |
| Novel | *(none)* | 0 | novel | New novel by … |
| Novel | Novel | 0 | novel | New novel by … |
| Novel | Novella | 0 | novella | New novella by … |
| Novel | Serial | 0 | serial | New serial by … |

---

## Frequency: what one push per item would have cost

Last 30 days (24 Aug – 23 Sep), measured against production:

- **24 announcements**: 22 stories + 2 instalments. That's **5.6 per reader per week**.
  Everyone with notifications on gets every one; there's no per-reader targeting.
- Worst rolling 7 days: **7**. Busiest day: **2** (on 3 days).
- By category: short 10, news 7, flash 3, poetry 2, series 2.
- Most scheduled stories land at **06:30 London**, so that's when most pushes would arrive.

For comparison, the mass-diff refusal is 5 per run. `node scripts/push/announce.mjs --frequency`
re-measures.

---

## Open questions

1. **`docs/push-handoff.md` could not be read.** Only the web repo is visible to this
   container's GitHub credential. So the rules were written from the brief:
   `{token, platform, appVersion, updatedAt}`, owner-only write, admin-only read. **Diff them
   against the handoff's block before step 3.** In particular:
   - (a) the rules refuse **any fifth field**;
   - (b) `platform` must be `ios` or `android`;
   - (c) the token must match `ExpoPushToken[…]` or `ExponentPushToken[…]`;
   - (d) the `tokenKey` may be at most 200 characters;
   - (e) **the owner cannot read their own row back**, as the brief specified. If the app does a
     read-before-write, that read will fail;
   - (f) `updatedAt` may be at most one day in the future.
2. **`sound` and `channelId` are unset.** On iOS the notification arrives silently, with the banner
   only; on Android it goes to Expo's default channel. Rule whether pushes should make a sound, and
   check which channel the app creates.
3. **Instalment titles are bare** ("Part Three"). The series is in the body, but a collapsed iOS
   banner shows the title first. `Beta Princess: Part Three` would read better, but the brief
   rules title = the instalment title.
4. `series_instalments_detail/beta-princess-i1` and `-i2` store the author as **`mgarcia91`** (a
   handle); i3 has "Monica Garcia". Both are released and seeded, so they'll never be sent, but
   Voices and search print it.
5. **Heartbeat check not built.** `ops/push_announcer/lastRunAt` exists; nothing alarms when it
   goes stale.
