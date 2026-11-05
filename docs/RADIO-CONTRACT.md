# Calvary Radio: what this repo promises

> Reviewed 5 Nov 2026. Items marked pending wait on a ruling or a measurement.

Written in RADIO-C0 (5 Nov 2026) from the code at `aca3a176` and the rulings of 4 Nov 2026
(`docs/COPY-RULINGS.md`, 330–353), and corrected in RADIO-B1 after review. RADIO-B1 built §2, §3,
§5's room and §9's listening position as records and database rules (`app/lib/radio/schema.js`,
`scripts/radio/write-rules.mjs`). Everything else is still to build (§12).

Calvary Radio is a separate Expo app with its own repo. It carries Calvary Scribblings stories in
audio: live premieres, then on demand, with downloads for paying members. Its chat builds against
this file the way Story Island built against the story contract. This repo owns the records, the
rules, the access check, the admin and the web's listen player. Radio owns its player, its
download store and its screens.

The account Radio signs in with is the one Calvary account: see `docs/ACCOUNT-CONTRACT.md`.

**Nothing in this file is a key, a secret, story text, a reader's details, a price or anyone's
contract terms, and nothing added to it ever may be.**

---

## 1. What already exists, and what Radio rests on

| what | where | what Radio takes from it |
|---|---|---|
| A story's record | `cms_stories/{slug}`, public | title, author, `authorUid`, category, `published`, `publishAt` |
| A story's text | `story_bodies/{slug}`, founders only (ruling 255) | the production book reads it in a founder's browser, nowhere else |
| The index | `cms_stories_index/{slug}`, public | `readTime`, `publishedAtMs`, `opening`, for pickers and cards |
| Story access | `grantFor()` in `app/lib/storyAccess.js` | the text's access, which a story's audio follows after its first week (§3) |
| A Series instalment | `series_instalments/{id}` (public row), `series_instalments_detail/{id}` (released only) | `releaseAtMs`, `freeForGold`, `openToFree`, and the release rule on server time |
| Instalment access | `policyGrantForInstalment()` in `app/lib/series/access.js` | the instalment's access, which its audio defaults to |
| The locked-file pattern | `functions/api/bookstore/stream.js`, `functions/api/series/stream.js` | identity from a verified ID token, entitlement read with an admin token, a short-lived URL, `version` from the object |
| Proofs | `/proofs`, `functions/api/proofs/*`, `docs/PROOFS.md` | the writer's private preview, which grows a Radio half (§10) |
| The Square's evening | open 20:00–24:00 London (`app/lib/squareWrite.js`); the horizon runs at the 20:00 bell | the listen-along post (ruling 336) |
| Notifications | `app/lib/notificationKinds.js`, `announcements/{id}` | three new list-only kinds (§11) |
| Deletion | `OWNED_NODES` in `functions/api/account/_deletion.js` | every Radio node joins it (§9) |
| Server Claude calls | `functions/api/generate-quiz.js` | the pattern for drafting the pronunciation guide (§10) |
| The subrequest budget | `SUBREQUEST_BUDGET = 45` in `functions/api/_budget.js` | every Radio Function plans to it |

**Downloads on a lapsed membership: what this repo already says.**

- Nothing here locks a downloaded Series instalment. The web never stores one (`CAPS.book` is all
  zeros in `app/lib/shelf.js`).
- `docs/series.md` ("Cross-repo: offline entitlement re-check") leaves the decision to Story
  Island, whose code this repo can't see. **Whether Story Island's Series downloads lock on a
  lapse is asked as ruling 350.**
- The one platform precedent points the other way: saves made under a day pass persist after it
  lapses (`shelf.js`).

---

## 2. Collections, and the cadence

**A collection is a fortnight's batch.** It holds **10–15 recorded stories and two Series
instalments**, and it comes out **every other Thursday at 20:00 London**.

- That night its **stories open on demand**, and its **first instalment premieres**.
- The **second instalment premieres the following Thursday** at 20:00.
- So under this cadence **only instalments premiere**, and there's a premiere every Thursday.

**A premiere needs no collection.** Beta Princess's four parts premiere on four Thursdays
**before** the first collection, each on its own record with no `collection` field.

```
radio_collections/c{n}          readable from its releaseAtMs          the batch
radio_audio/stories/{slug}      readable from its releaseAtMs          a recorded story
radio_audio/instalments/{id}    readable from its premiereAtMs         a recorded instalment
radio_live/instalments/{id}     open during the premiere               the live room (§5)
```

The key is `c` plus the number (`c1`, `c2`, …), never a bare number: RTDB turns keys 1, 2, 3
into an array (the PROOFS-R3 trap).

### `radio_collections/c{n}`

| field | type | meaning |
|---|---|---|
| `number` | integer | 1, 2, 3 … never reused, never renumbered |
| `releaseAtMs` | integer, epoch ms UTC | the collection's Thursday, 20:00 London. Its stories open on demand at this moment |
| `running` | object `o1…oN` → `{ kind: 'story' \| 'instalment', id }` | the **listening order on demand**: 10–15 stories and the two instalments, positions `o1…oN` with no gaps |
| `status` | `'draft' \| 'scheduled' \| 'withdrawn'` | a scheduled collection must hold its full count. `scheduled` is set before the 19:30 freeze (§8) |
| `schemaVersion`, `updatedAt` | integers | |

**Reading.** Anyone, signed in or not, reads a `scheduled` collection from `releaseAtMs` on the
RTDB server clock. Founders read every collection. Nobody lists the node: a client learns a
collection's key from its announcement (§11), or from a recording's `collection` field.

**Writing.** Founders only.

**Validation.** The record shape is closed and enforced by the rules. The counts (10–15 and 2,
for a scheduled collection) and the per-writer cap are checked by `validateCollection()`, which
the admin runs before saving.

**The picker (ruling 334).**

- The admin suggests stories ranked by reads (`hitsByDay`) and by responses, and mixes flash
  fiction and short stories.
- It refuses a third story by one writer (`MAX_PER_WRITER = 2`, one constant in
  `app/lib/radio/schema.js`).
- A story whose text isn't live, or that is retired (`cms_stories_retired/{slug}`), can't be
  picked.
- The suggestion is a list. An editor chooses.

---

## 3. Each recorded story and instalment

### `radio_audio/stories/{slug}` and `radio_audio/instalments/{instalmentId}`

| field | type | meaning |
|---|---|---|
| `collection` | `'c{n}'`, optional | its collection. Absent for an instalment that premieres outside one (Beta Princess) |
| `releaseAtMs` | integer, required | when it opens **on demand**. A story: its collection's `releaseAtMs`. An instalment that premieres: at or after its premiere ends (`premiereAtMs + durationMs`); the rules refuse anything earlier |
| `premiereAtMs` | integer, **optional** | when its premiere starts. Under the cadence, set on instalments only |
| `durationMs` | integer | **measured from the file** (below), never typed |
| `version` | string | the stored object's generation or ETag (§7). Changes when, and only when, the file is replaced. It's Radio's download-cache key, and the pin for a saved position |
| `narrator` | `{ name, uid? }` | the credit as printed. `uid` only when the narrator has an account and has agreed to be linked |
| `engineer` | `{ name, uid? }` | the same |
| `access` | instalments only: `{ releaseAtMs?, freeForGold?, openToFree? }`, optional | on-demand access, when it differs from the text's (below) |
| `readAlong` | string | the text's own web address: exactly `/stories/{slug}` or `/series/instalment/{id}` |
| `status` | `'draft' \| 'scheduled' \| 'withdrawn'` | |
| `schemaVersion`, `updatedAt` | integers | |

**Reading** (the rules):

- Anyone reads a `scheduled` record from its `premiereAtMs` if it has one, or else from its
  `releaseAtMs`, on the server clock.
- Before then, only founders and **the item's own writer** read it (Proofs, §10). The writer is
  `cms_stories/{slug}/authorUid` for a story, or `series_instalments_detail/{id}/authorUid`.
- `draft` and `withdrawn` records are founders only.
- Nobody lists the node.
- The object's storage path is **never** on the record, and the rules refuse any field outside
  the list above. Only the access check knows the path.

**Writing.** Founders only.

**The audio sits behind the platform's lock.** The file is private storage that no client can
read (a private R2 bucket, §7). The only way to it is a short-lived URL from the access check
(§4), exactly like `master.epub`.

**Duration is measured from the file.**

- It's measured in the editor's browser from the file being uploaded, before the upload: an
  `<audio>` element's `duration` after `loadedmetadata`.
- For a constant-bitrate MP3 it's also checked against `(bytes − tag bytes) × 8 / bitrate`.
- Duration and `version` land in one write, the way `wordCount` and `epubPath` do for an
  instalment (`docs/series.md`, "Reading time is derived, never typed").
- A replaced file means a re-measure.

**The bitrate** the files are delivered at is **Ben's call** as the audio engineer. Every estimate
in this file assumes **64 kbps mono** (8,000 bytes a second; about 24 MB for 50 minutes).

**Access on demand.**

- **A story's audio is free to every signed-in listener for its first week on Radio**, the seven
  days from its `releaseAtMs`. After that it has exactly its text's access: `grantFor(story,
  { tier })`, with the free week, the archive and poetry as they stand. **(Ruling 352, pending:
  written on the reviewer's suggestion.)** There is no per-story override.
- **An instalment's audio** defaults to the instalment row: `releaseAtMs`, `freeForGold`,
  `openToFree`, through `policyGrantForInstalment()`. An editor can override any of the three,
  **per instalment, in the Series admin**, as `radio_audio/instalments/{id}/access`. The
  override governs the audio only, never the EPUB. Absent means "as the text".
- **Audio never opens before its text.** The admin refuses a `premiereAtMs` or `releaseAtMs`
  earlier than the text's own release.

---

## 4. The access check

One Function, called by Radio, the web's listen player and Story Island alike. It's built on the
pattern of `functions/api/bookstore/stream.js`.

```
POST /api/radio/access
  credential:  Authorization: Bearer <Firebase ID token>
  body:        { kind: 'story' | 'instalment', id, want: 'listen' | 'download' }

→ 200 {
    listen:   { allowed: true|false, reason },
    download: { allowed: true|false, reason },
    lapsed:   true|false,
    url, expiresAt,              // only when `want` is allowed
    version, durationMs,
    premiere: { startMs, endMs, live: true|false } | null,
    serverNowMs                  // the server's clock, for the live point (§5)
  }
→ 401 { code: 'signed_out' }
→ 403 { code: 'not_released' | 'tier_too_low' | 'lapsed' | 'premiere_only_listen' | 'day_pass' }
→ 404 { code: 'not_found' }        // missing, draft, withdrawn, or not yet readable
→ 502 { code: 'unavailable' }      // any read failed: FAIL CLOSED
```

**What it keeps from `stream.js`, unchanged.**

- The uid comes from the verified ID token, never the body.
- Membership is read with the admin token: `users/{uid}/membership` and `memberships/{uid}`
  together.
- An unknown answer is a refusal (502), never a grant.
- Object metadata is read only **after** entitlement, so a refused caller learns nothing about
  the file.
- `version` is the object's own identifier, a string, never derived from the request. An
  explicit `null` means do-not-cache.
- `/api/` stays in the service worker's pass-through list.
- The cost is about 8 subrequests (token lookup, admin mint, four reads, the text record, the
  object metadata), well inside 45.

**Listening.**

- **During a premiere** (`premiereAtMs ≤ now < premiereAtMs + durationMs`), every signed-in
  listener may listen (`reason: 'premiere'`), whatever their tier.
- **On demand**, from `releaseAtMs`, the item's own access decides (§3): `radio_week` (a story's
  first week, pending 352), `free_week`, `poetry`, `tier`, `free_to_read`, `gold_taste`,
  `platinum`, or a refusal.

**Downloading.**

- **Never during a premiere** (`premiere_only_listen`). That would hand over the whole file
  early (§6).
- **Otherwise** it's allowed when listening is allowed **and** the listener holds a paying
  membership **by subscription**.
- **A day pass doesn't download** (`day_pass`). The pass is read only to word the refusal, as in
  the Series. **(Ruling 351, pending: written on the reviewer's suggestion.)**

**`lapsed`** is true when `memberships/{uid}` shows a paid subscription that is no longer active.
It's answered on every call, whatever `want` is.

**Radio's download store (ruling 349, pending: written on the reviewer's suggestion):**

- Radio **re-checks every downloaded item whenever the app is online**, one call per item.
- A file whose check answers `download.allowed: false` (a lapse included) stops playing. It stays
  on the device, locked, until a check answers yes again.
- A file that has gone **30 days without a successful check** stops playing until the next one
  (`DOWNLOAD_RECHECK_MAX_MS` in `app/lib/radio/schema.js`).

**Abuse limits.** These go through `functions/api/_ratelimit.js`, failing closed: 60 calls a
minute and 2,000 a day per uid. Nothing logs a token or a URL.

---

## 5. Premieres and the live room

- **When:** every Thursday at 20:00 London, one instalment's `premiereAtMs` (§2).
- **Who:** every signed-in listener during the premiere. Afterwards it's on demand under the
  instalment's own access (§3, §4).
- **What:** the instalment's own file, played from its start at `premiereAtMs`. There is no
  separate programme file.

**A trusted server time.** A phone's clock can be wrong by minutes, so the live point is never
computed from it.

- The access check returns `serverNowMs`.
- A signed-in client can also read `.info/serverTimeOffset` from the RTDB, the same clock the
  rules use.
- The live point is `serverNow − premiereAtMs`.

### The room is keyed by premiere

There's one room per record that premieres: `radio_live/instalments/{id}`, or
`radio_live/stories/{slug}` should a story ever premiere. It's **open** from `premiereAtMs` until
`premiereAtMs + durationMs + 10 minutes` (`LIVE_GRACE_MS`), on the server clock, and only while
the record is `scheduled`.

```
radio_live/instalments/{id}/listeners/{uid} = true
  read:   that listener only
  write:  that listener only, while the room is open; leaving (remove) is allowed at any time,
          so onDisconnect().remove() always lands
radio_live/instalments/{id}/hearts/{uid} = { n, at }
  read:   that listener only
  write:  that listener only, while the room is open; never removed by a client
  shape:  at == the server's now; n starts at 1 and goes up by exactly 1;
          at least 1 second since the last; n ≤ 6,000
radio_live/instalments/{id}/counts = { listeners, hearts, at, final? }
  read:   every signed-in listener
  write:  no client, founders included; the server job only
```

**Counting.** No client ever counts listeners or sums hearts by reading every child: with `n`
listeners each reading `n` children and every change, that grows with the square of the
audience. The rules make it impossible, because nobody can read another listener's key.

- **A server job** writes **one listener count and one hearts total per open room, each
  minute** to `counts`.
- **Clients read only `counts`**, plus their own taps. A listener's display is the last `counts`
  plus their own hearts since its `at`.

**The job, and what it costs.**

- **Where it runs:** a Cloudflare Worker cron at `* 19-22 * * 4` (every minute, 19:00–22:59 UTC
  on Thursdays). That covers 20:00 London in both summer and winter time, with a premiere of up to
  about two hours. It holds the admin credential the Workers already use, and none is new.
- **Requests: 240 invocations a Thursday** (4 hours × 60), about 34 a day averaged over the week.
  That's counted against the 100,000-a-day Workers allowance whether or not Cloudflare counts
  cron runs as requests, the cautious reading. On the free plan an account has a small number of
  cron triggers. **Ikenna checks** that one is free, or the build round adds the schedule to the
  existing Worker.
- **Subrequests per run:**
  - an OAuth mint (1);
  - one indexed query for records whose `premiereAtMs` is in the last 4 hours (1);
  - then for each open room, a shallow read of `listeners` (1), a read of `hearts` (1) and a write
    of `counts` (1).
  - Total: **2 + 3 × rooms**, which is 5 under the cadence, well inside 45.
- **Database reads per premiere:** about 60 runs, each with 2 reads per room plus the query, so
  **about 180 reads and 60 writes**. The data downloaded per run is about 35 bytes per listener
  (shallow) plus about 60 bytes per heart record. At 500 listeners that's about 48 KB a minute,
  about 3 MB a premiere.
- **Per listener:** one `counts` update a minute (well under 100 bytes), instead of every other
  listener's every change.

**Closing the room.** The job's first run after a room's window ends:

- removes `listeners` and `hearts` whole;
- writes `counts` one last time with `final: true`.

So no uid outlives the night, and the numbers stay.

**Connections.** Every listener in the room holds a database connection. The Spark plan allows
**100** at once, and Blaze allows **200,000** per database. **Blaze applies:**
`scripts/backup/RESTORE.md` records the project on Blaze, with Firebase's scheduled RTDB backup
running daily since 23 Aug 2026, and that backup is available on Blaze only. The listener count,
not the connection limit, is what to watch.

**The listen-along post (ruling 336).**

- On a premiere night, the first Square post after the 20:00 opening is a house post that points
  at **the premiering instalment**.
- It's written server-side by the job that acts at the bell: the counts Worker's first run at or
  after `premiereAtMs`, since it's already awake.
- A Square post is `$other: false`, so the post's new field
  (`attachedPremiere: { kind: 'instalments', id }`) needs its rules child **first**.

---

## 6. The premiere lock

**The problem.** A plain file can't stop a player fetching ahead: hand a listener the URL at 20:00
and a modified client has the whole instalment at 20:01. Every Function request counts against
the account's **100,000-a-day Workers allowance**, which the whole site shares. A live HLS
playlist is re-fetched every few seconds by every listener.

**Each method's cost per listener, for a 50-minute premiere (3,000 seconds, 64 kbps mono):**

| method | requests through a Function, per listener | at 200 listeners | holds the live point |
|---|---|---|---|
| Live HLS, playlist and segments through a Function (6-second segments) | about 500 playlist reloads + 500 segments ≈ **1,000** | ≈ 200,000: twice the day's allowance | the server, exactly |
| Live HLS, playlist through a Function, segments direct from storage | ≈ **500** | ≈ 100,000: the whole day | the server, to one segment |
| Live HLS with 30-second segments, playlist through a Function | ≈ **100** | ≈ 20,000 | the server, to 30 s; 30 s+ behind live |
| CBR MP3 through a Function, capped at the live point plus a lead of L seconds | ≈ **1 + 3,000 / L**: about 11 at L = 300, about 51 at L = 60, *if the player re-requests cleanly when a capped range ends* | ≈ 2,200 at L = 300 | the server, to L seconds |
| Plain file, opened only during the premiere; Radio's player seeks to the live point | **1–3** (the access check, plus one per re-join) | ≈ 200–600 | Radio's player. A modified client can fetch ahead |

Rejoins, network changes and the web's own traffic add to every row. Only the last two rows leave
room for a growing audience.

**The measurement.** This is the one thing nobody can know from here: how Radio's actual player
behaves on a capped range.

- **The endpoint.** The first storage build (RADIO-B2) ships a test endpoint,
  `POST /api/radio/test-stream`. It serves a 50-minute constant-bitrate MP3 of house test audio
  (a tone and spoken timestamps, never a story) at the bitrate Ben chooses, with the server-side
  cap: `206 Content-Range: bytes 0–N/*`, where `N` = the bytes at the live point plus L seconds.
- **Who can use it.** Founders and the live test reader only.
- **What it counts.** Requests per session, the furthest byte it served against the live point,
  and nothing else. Counts only: no tokens, no uids.
- **What Radio's player runs, on one iPhone and one Android phone.**
  - Join at 0:00 and play to the end.
  - Join at 20:00 (a late join that must seek to the live point).
  - Lock the screen for 5 minutes mid-play.
  - Switch from Wi-Fi to mobile data once.
- **What Radio reports, per phone.** Requests per listener, any audible gap or stall, the time
  to first audio, and whether the player ever got ahead of the live point by more than L.

**The rule (ruling 348, pending: written on the reviewer's suggestion).** If the capped
constant-bitrate MP3 costs **a few requests per listener** (at most 10 over 50 minutes, on both
phones), with no audible gap, the **server holds the live point**. Otherwise, **Radio's player
holds it**: the server opens the file only during the premiere (the access check mints a URL only
for the premiere's window and for no longer than it has left), and Radio's player seeks to the
live point from `serverNowMs` and offers no seeking ahead of it.

---

## 7. Storage for the audio

| | Cloudflare R2 | Firebase Storage (Google Cloud Storage) |
|---|---|---|
| **Charges for downloads** | none for data out, on any plan | charged per GB sent to the internet, beyond a small free allowance |
| **Size of the problem** | A collection of 10–15 stories and two instalments, at 64 kbps mono, is a few hundred MB per full listen. Downloads for members multiply it, and audio is the heaviest thing the platform will ever serve. | the same volume, billed |
| **Reach from a Function, inside 45 subrequests** | A Pages binding reads the object and its metadata without a `fetch`. A presigned URL is signed locally (0 subrequests). | An OAuth mint (1) + a metadata read (1). The signed URL is local (`signGetUrl`, 0). Proven in `stream.js`. |
| **Short-lived URLs** | S3-style presigned GET, any expiry up to 7 days | V4 signed URL, any expiry up to 7 days (300 s today) |
| **A capped range, if the server holds the live point (§6)** | the binding takes a range directly | needs a Function `fetch` per request (1 subrequest each) |
| **Backup to the vault (ruling 267: a Google Cloud project in Belgium)** | needs a copy job (S3 API → GCS), e.g. an Actions job with read-only R2 credentials | native: a Storage Transfer job, Google to Google, same region |
| **What exists today** | nothing: R2 isn't enabled on the account | the bucket, its rules, `signGetUrl`, the 30-day soft delete |

**Recommendation: R2.** The cost that grows with Radio's success is downloads, and R2 charges
none. Its binding also makes the server-held live point (§6) cheapest if the measurement allows
it. The price is one copy job to the vault, which the vault needs for Workers code anyway
(ruling 273).

**Setup only Ikenna can do:**

1. Enable R2 on the Cloudflare account (it asks for a payment method even inside the free tier).
2. Create one **private** bucket for the audio, with no public domain and no `r2.dev` URL.
3. Add an R2 binding to the Pages project (Production and Preview), named in the build round.
4. Create an R2 API token scoped to that bucket, **Object Read only**, for presigning. Add its
   two values as Pages **secrets** under the names the build round gives. Their values are
   never pasted into a chat.
5. Create a second read-only token for the vault copy job, as an Actions secret.
6. Set the bucket's CORS to allow GET and HEAD from `https://calvaryscribblings.co.uk` (the web's
   listen player).
7. The vault itself (ruling 267) is already owed. The audio copy lands there when it exists.

---

## 8. Releases never need a deploy

- **Story pages** learn about their audio **when the page loads**. The listen player reads
  `radio_audio/stories/{slug}`, which the rules hide until its `releaseAtMs`. The static page
  holds nothing about audio, so the player appears on the server clock with no build, no hook and
  no Function per view (ruling 265's principle).
- **Instalment pages** do the same with `radio_audio/instalments/{id}`, which becomes readable at
  its `premiereAtMs`. The player shows "Live now" during the premiere and plays on demand from
  `releaseAtMs`.
- **Every release is set before the 19:30 freeze.** On each Thursday, the collection (on a
  collection night), the premiering instalment's record and every story's record are written and
  `scheduled` before 19:30 London. From 19:30 until the room closes, nothing about them is
  edited. Releasing is the clock, not a write.
- **Withdrawing** an item (`status: 'withdrawn'`) is a database write. The rules hide it at once,
  the access check refuses it, and the player hides on its next load.

---

## 9. Listening position, links and deletion

### Continue listening (built in RADIO-B1)

```
listening_position/{uid}/stories/{slug}
listening_position/{uid}/instalments/{id}
  = { positionMs, durationMs, version, updatedAt }
  read/write: that listener only
  shape:      0 ≤ positionMs ≤ durationMs; durationMs ≤ 4 hours;
              version is the file's version, 1–64 characters; updatedAt == the server's now
```

- Radio, the web's player and Story Island all read and write the same record, so a listener
  picks up on any of them.
- It's written when playback pauses, and at most once every 15 seconds while playing.
- A position whose `version` isn't the file's current `version` restarts at the item's start,
  the same pin discipline as `docs/reading-position-pin.md`.
- A finished item (within 30 s of the end) is removed, not kept at 100%.

### Links (ruling 335)

- **The Story Island link for an instalment** is the web's own address:
  `https://calvaryscribblings.co.uk/series/instalment/{instalmentId}`. Radio links to exactly
  this.
- **What the association files need.** Add a component `"/": "/series/instalment/*"` to
  `public/app-association/apple-app-site-association.json` after the Book Store exclusion. On
  Android, the same path prefix goes in the app's intent filter (assetlinks covers the whole
  domain already).
- **What the app needs.** Story Island must render an instalment **natively** from that path. If
  it opens the URL externally instead, claiming it is a link loop (`docs/APP-DEEP-LINKS.md` §3).
  It also follows the claim rules there: a signed-out or locked reader sees at least what the web
  shows, and a destination it can't render goes back to the browser.
- **Order.** `docs/APP-DEEP-LINKS.md` §4 lists `/series` as never claimed. Ruling 335 changes
  that for `/series/instalment/*` only, and the doc is updated in the same round. **The web file
  ships only after a Story Island build that renders the path is live.** iOS caches the file at
  install, so a claim that arrives before the app can render it can't be taken back.

### Deletion

Every node Radio adds joins the account-deletion scrub in the round that adds it:

| node | treatment |
|---|---|
| `listening_position` | **deleted whole**: in `OWNED_NODES` since RADIO-B1, so `tests/account/deletion.test.mjs` holds it there |
| `radio_live/*/*/listeners/{uid}`, `radio_live/*/*/hearts/{uid}` | removed whole by the closing run at the end of each room (§5), so none outlives the night. The deletion endpoint also nulls the reader's two keys in any room still open, from RADIO-B8, the round that writes rooms |
| `radio_audio/*` `narrator.uid` / `engineer.uid` | the credit's `uid` is removed on deletion; the printed name is a credit on published work and stays until Ikenna makes the editorial call, as a deleted writer's stories do (ruling 34, `docs/ACCOUNT-SCRUB-PLAN.md`) |
| `account_apps` (ACCOUNT-CONTRACT §5) | deleted whole, in `OWNED_NODES`, in the round that adds it |

---

## 10. The production book

**What it is.** It's built in the admin, at `/admin/radio/book?c={n}` (or for one instalment),
and saved as a PDF from the browser's own print dialog. The story text goes from `story_bodies`
(founders only) into the founder's browser and onto paper. **It never passes through a session,
a log, a Function's output or this repo.** The page sends nothing anywhere. It reads and prints.

**The page:**

- **A5 pages** (`@page { size: A5 }`).
- Reading text in **Literata 14.5 pt**. Titles in **Cormorant**.
- Three inks: **black is read aloud**, **violet is guidance** (pronunciations, notes, the say
  lines), **grey is page furniture** (running heads, page and paragraph numbers).
- **Numbered paragraphs that never split across a page** (`break-inside: avoid`). A paragraph
  longer than a page is the one exception, and the cover sheet lists it.
- **A violet "say" line** above the paragraph where a guide word **first** appears: the word,
  then how to say it, from the confirmed guide.
- **The house opening line** above the first paragraph. **Its wording is to be confirmed from
  Radio's approved sample** and is a placeholder until then.
- **The closing line** after the last paragraph: "That was [Title], by [Author], read by
  [Narrator], for Calvary Radio."
- **A cover sheet** with the listening order and each item's minutes at **9,300 words per
  finished hour** (155 words a minute; Miss Lady's 342 words are 2.2 minutes), with the total.

**The pronunciation guide and director's notes** are drafted by Claude **on the server**, as
quizzes are.

- A founder-only Function on the `generate-quiz.js` pattern: a verified founder token, the body
  read from `story_bodies` with the admin token, the model called with a tool schema
  (`{ guide: [{ word, say, note? }], notes: [{ paragraph, note }] }`), and the draft stored under
  `radio_book/c{n}/{slug}`, founders only.
- It returns the draft, never the text, and logs counts only.
- Ikenna checks every draft before it reaches a writer.

**Writers confirm pronunciations and hear their recordings in Proofs (ruling 347, pending:
written on the reviewer's suggestion).**

- **Pronunciations (ruling 331).** The writer of each picked story sees the checked guide for
  their own story in `/proofs` and confirms it, or reports a correction through the existing
  report path.
- **A writer has three days to confirm.** After that, Ikenna's checked guide stands and recording
  goes ahead. **(Ruling 353, pending: written on the reviewer's suggestion.)**
- **Recordings (ruling 333).** The finished recording appears in the writer's Proofs at least
  **three days** before it goes out: its `releaseAtMs` for a story, its `premiereAtMs` for an
  instalment. It plays through the access check, which grants the item's own writer before
  release. They have those three days to report.
- Proofs keeps its existing rules: a writer sees only their own, and everyone else gets 404.

---

## 11. Notifications

These are list only, with no push (ruling 345). Each is one new kind in
`app/lib/notificationKinds.js` with `push: LIST_ONLY`, so the settings screen gains no switch
(ruling 337).

| kind | where it goes | when |
|---|---|---|
| `collection` | `announcements/{id}`, one shared item: `{ kind: 'collection', id: 'c{n}', at }` | at the collection's `releaseAtMs` |
| `premiere` | `announcements/{id}`, **one per premiere**: `{ kind: 'premiere', id: 'instalments/{id}', at }` | at the instalment's `premiereAtMs`, including Beta Princess's four |
| `recording_live` | `inbox/{writerUid}` | when a writer's recording goes out: a story at `releaseAtMs`, an instalment at `premiereAtMs` |

The announcement records hold ids only, like stories and instalments do today. The bell draws
the title live.

---

## 12. Build rounds, in order

Each ships alone, and each leaves production working if the next never comes.

1. **RADIO-B1: records and rules. BUILT (this round).**
   - `app/lib/radio/schema.js`, the shapes and validators.
   - `scripts/radio/write-rules.mjs`, which generates the rules (`--check` in CI).
   - The rules: server-time reads, the room's window, server-written counts,
     `listening_position`.
   - `listening_position` in `OWNED_NODES`.
   - `tests/rules/radio-b1.test.mjs` and `tests/ci/radio-b1.test.mjs`.
   - No UI and no data.
2. **RADIO-B2: storage and the measurement.** It needs Ikenna's R2 setup (§7).
   - The test endpoint and its counts.
   - Radio runs the measurement and reports. **Ruling 348 is made on its numbers.**
3. **RADIO-B3: the access check.**
   - `POST /api/radio/access` with premieres, the story week (352), downloads (351) and lapse.
   - A shim test within 45 subrequests.
4. **RADIO-B4: the admin.**
   - `/admin/radio`: collections, the picker (ruling 334), uploads with duration measured in the
     browser, credits, premiere times.
   - The per-instalment audio access override in the Series admin.
5. **RADIO-B5: the production book.**
   - The print page.
   - The founder-only drafting Function.
   - The review screen for the guide and notes.
6. **RADIO-B6: Proofs.** Pronunciation confirmation with its three days, and recording preview
   (rulings 331, 333, 347, 353).
7. **RADIO-B7: the web's listen player.**
   - On story and instalment pages (ruling 332).
   - Continue listening.
   - A hand-off note for Story Island's player.
8. **RADIO-B8: premiere night.**
   - The counts Worker and its closing run.
   - The listen-along post, with its rules child first (ruling 336).
   - The three list kinds (ruling 345).
   - The deletion endpoint's room keys.
9. **RADIO-B9: instalment links.** `/series/instalment/*` in the association file, after a Story
   Island build renders it (ruling 335).
