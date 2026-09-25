# Push: the server half, and the go-live order

**Status (25 Sep 2026, W8): LIVE.** The rulings are applied, the test notification reached
Ikenna's phone (ticket ok, receipt ok), the seed is written, and the workflow's `schedule:` block
is armed. The W8 record is at the end of this file.

| Piece | Where | State |
|---|---|---|
| Rules: `push_tokens`, the two toggles, the announcer's books | `database.rules.json` | **deployed**, parity proven |
| Announcer (scan → claim → hold/cap → send → receipts → prune) | `scripts/push/` | **live** |
| Job | `.github/workflows/push-announce.yml` | **armed**, `*/15` |
| Heartbeat check | `scripts/launch-check.mjs` (W7) | red if `ops/push_announcer/lastRunAt` is > 45 min old |
| Test tool | `scripts/push-test.mjs <uid>` | run once in W8, to Ikenna's uid |

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

**RULED (instalment, 25 Sep):** title = the **series** name. Body = `{part} by {author} · {logline}`,
where `{part}` is the instalment's own title, so the part is named as the series names it
("Part Three", "Chapter I: It's Monday Again"). `data.url` = `/series/instalment/{id}`.

**RULED (sound, 25 Sep):** every push carries `sound: "default"` (iOS plays the phone's default
sound) and `channelId: "default"` (Android 8+ takes its sound from the channel). See *What the app
must add*.

**RULED (when, 25 Sep):** nothing before **08:00 London**. An item that goes live earlier is held
and goes out on the first run at or after 08:00; later items go at once. London's clock comes from
the tz database, so 08:00 is 07:00Z in summer and 08:00Z in winter.

**RULED (how many, 25 Sep):** at most **two per reader per London day**. Every reader gets every
announcement, so this is two per day: the count is what `push_announced` records as `sent` or
`partial` since London midnight. A third is recorded `capped` and **never sent**. It isn't carried
to tomorrow, where it would take one of tomorrow's slots.

Live examples, as the builder produces them:

| Title | Body |
|---|---|
| What the Light Remembers | New elegy by Tricia Ajax · The body forgets what it once could hold. |
| Completely Alone | New short story by Kalu Rebecca · You've left me completely alone in this marriage. |
| You've Been Using AI Wrong | New tech piece by Nzubechukwu Okere *(quote dropped: "buying")* |
| Beta Princess | Part Three by Monica Garcia · With her king reported dead… |
| Diary of a Lagos 9-5er | Chapter I: It's Monday Again by Tricia Ajax *(logline dropped: "₦2,200")* |

**Never a price, a purchase or the Book Store (iOS 3.1.1).** Three layers enforce it:
- The destination must match `/stories/…` or `/series/instalment/…`, or the send throws.
- A quote or logline carrying an amount, *buy/bought/price/purchase* or *book store* is dropped,
  and the body ends at the byline. 4 of the 183 live quotes would be dropped.
- A title carrying an amount, *purchase* or *book store* refuses the item. It's recorded as
  `refused` and never sent. No live title trips this. *The Price of Silence* would not.

### RULED (25 Sep, as drafted): the {form} table (`scripts/push/forms.mjs`)

Every category and subcategory the taxonomy can produce, with its live count. The suite fails if a
subcategory is added to `app/lib/taxonomy.js` without a row here.

| Category | Subcategory | Live stories | {form} | Reads as |
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

**Status of the open questions after W8:** 2 (sound/channel) and 3 (instalment titles) are ruled
and built. 4 is fixed (below). 5 is built: W7's launch check reads the heartbeat. 1 still stands.

---

## What the app must add (Android channel)

Every push names Android channel **`default`**. On Android 8+, the channel, not the message,
decides the sound and importance, and the channel is created by the app. Before an Android build
registers a push token, the app must run this once at start-up, before `getExpoPushTokenAsync`:

```ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'New stories',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}
```

- The id must be exactly `default`, because that's what the server sends
  (`ANDROID_CHANNEL_ID` in `scripts/push/lib.mjs`).
- **Android fixes a channel's importance and sound the first time it's created.** If a shipped
  build already created `default` with other settings, re-running this won't change them on
  devices that have it. Only a new channel id would, and that would need a server change to match.
  The app session should check what its current builds create.
- On 25 Sep every registered device was iOS (3 rows, app 1.7.0), so no Android reader is affected
  yet.
- iOS needs nothing: `sound: "default"` is in the payload.

---

## W8 record (25 Sep 2026)

- **Rulings applied** in `scripts/push/` (`lib.mjs`, `run.mjs`, `forms.mjs`, `frequency.mjs`),
  with tests in `tests/push/`. Each ruling was reverted on its own and watched failing:

  | Revert | pure suite | emulator suite |
  |---|---:|---:|
  | 08:00 hold removed | 5 fail | 2 fail |
  | 08:00 hold computed as UTC+1 (wrong in GMT) | 2 fail | 1 fail |
  | cap removed | 4 fail | 2 fail |
  | cap counted by UTC day | 2 fail | 0 |
  | instalment title back to the part | 2 fail | 1 fail |
  | instalment body back to "New instalment by …" | 4 fail | 1 fail |
  | `sound` dropped | 13 fail | 13 fail |
  | `channelId` dropped | 13 fail | 13 fail |

- **The cap, over the last 30 days (26 Aug – 25 Sep):** it would have stopped **0** items. The
  busiest London day had 2. For stories published without a schedule, the time is the display
  date's UTC midnight, which bunches items onto one day, so 0 is an upper bound. The **hold**
  would have delayed 13 of 25 items, mostly the 06:30 schedules, to 08:00.
- **Beta Princess author:** the push reads `series_instalments_detail/{id}/author`. Changed from
  `mgarcia91` to `Monica Garcia`: **`series_instalments_detail/beta-princess-i1/author`** and
  **`series_instalments_detail/beta-princess-i2/author`**. The value was re-read before and after
  each write, and no other field changed. `authorHandle` (`monica_garciaauthor`) and `authorUid`
  were left as they were, and i3 already read `Monica Garcia`.
- **Phone test:** one send to Ikenna's uid (1 iOS device). "Why Do Filmmakers Keep Working With
  the Same Actors?" / "New film piece by Chioma Okonkwo · Film collaboration is not easy, and when
  you find your people, you hold on to them." Ticket `01a0d90d-4365-724a-8ca7-31fee7d1c046`
  **ok**; receipt **ok**.
- **Seed:** dry run: 213 to mark, 2 pending (`phantom` 27 Sep, `did-you-enjoy-it` 29 Sep, both
  future schedules). Seed: the same 213 marked, `seededAt` 14:53:41Z. Dry run after: **due 0**.
  The audience is 1 device: the three token rows (three accounts) carry one phone's token.
- **Armed** by `95610c48`. First scheduled run: Actions run `36152851501`, 15:16Z, success.
  `due: 0`, audience 1, heartbeat `lastRunAt` 15:16:05Z. CI on `95610c48`: `rules and
  hygiene` green, `reader tests` green, `push announce` suite green.
