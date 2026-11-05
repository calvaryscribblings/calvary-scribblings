# Calvary Radio: what this repo promises

> **DRAFT. Not yet reviewed.** Written in RADIO-C0 (5 Nov 2026) from the code at `aca3a176` and
> the rulings of 4 Nov 2026 (`docs/COPY-RULINGS.md`, 330–348). Nothing here is built yet. Until
> it has been reviewed, Radio's chat may plan against it but must not ship against it. Where a
> line rests on a ruling still owed, it says **pending**.

Calvary Radio is a separate Expo app with its own repo. It carries Calvary Scribblings stories in
audio: live premieres first, then on demand, with downloads for paying members. Its chat builds
against this file the way Story Island built against the story contract. This repo owns the
records, the rules, the access check, the admin and the web's listen player. Radio owns its
player, its download store and its screens.

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
| Story access | `grantFor()` in `app/lib/storyAccess.js` | the text's access, which a story's audio inherits (§3) |
| A Series instalment | `series_instalments/{id}` (public row), `series_instalments_detail/{id}` (released only) | `releaseAtMs`, `freeForGold`, `openToFree`, and the release rule on server time |
| Instalment access | `policyGrantForInstalment()` in `app/lib/series/access.js` | the instalment's access, which its audio defaults to |
| The locked-file pattern | `functions/api/bookstore/stream.js`, `functions/api/series/stream.js` | identity from a verified ID token, entitlement read with an admin token, a short-lived URL, `version` from the object |
| Proofs | `/proofs`, `functions/api/proofs/*`, `docs/PROOFS.md` | the writer's private preview, which grows a Radio half (§10) |
| The Square's evening | open 20:00–24:00 London (`app/lib/squareWrite.js`); the horizon runs at the 20:00 bell | the listen-along post (ruling 336) |
| Notifications | `app/lib/notificationKinds.js`, `announcements/{id}` | three new list-only kinds (§11) |
| Deletion | `OWNED_NODES` in `functions/api/account/_deletion.js` | every Radio node joins it (§9) |
| Server Claude calls | `functions/api/generate-quiz.js` | the pattern for drafting the pronunciation guide (§10) |
| The subrequest budget | `SUBREQUEST_BUDGET = 45` in `functions/api/_budget.js` | every Radio Function plans to it |

**Downloads on a lapsed membership: what this repo already says.** Nothing here locks a
downloaded Series instalment. The web never stores one (`CAPS.book` is all zeros in
`app/lib/shelf.js`), and `docs/series.md` ("Cross-repo: offline entitlement re-check") leaves
the decision to Story Island, which this repo can't see. The one platform precedent points the
other way: saves made under a day pass persist after it lapses (`shelf.js`). So §4's lapse
behaviour is a proposal, not an inheritance.

---

## 2. Collections

A **collection** is one week's programme. It holds stories and **two Series instalments**, in a
running order.

```
radio_collections/c{n}          public once announced     the collection
radio_audio/stories/{slug}      public once premiered     a recorded story
radio_audio/instalments/{id}    public once premiered     a recorded instalment
```

The key is `c` plus the number (`c1`, `c2`, …), never a bare number: RTDB turns keys 1, 2, 3
into an array (the PROOFS-R3 trap).

### `radio_collections/c{n}`

| field | type | meaning |
|---|---|---|
| `number` | integer | 1, 2, 3 … never reused, never renumbered |
| `premiereAtMs` | integer, epoch ms UTC | the premiere's start: a Thursday, 20:00 London (§5) |
| `announceAtMs` | integer, epoch ms UTC | when the collection becomes readable and goes into readers' lists (ruling 345) |
| `running` | object `o1…oN` → `{ kind: 'story' \| 'instalment', id, offsetMs }` | the running order. `offsetMs` is the item's start from `premiereAtMs`, derived from the durations before it plus the house's gaps |
| `endAtMs` | integer | `premiereAtMs` + the last item's offset + its duration. Derived, written with the running order |
| `status` | `'draft' \| 'scheduled' \| 'withdrawn'` | `scheduled` is set before the 19:30 freeze (§8) |
| `updatedAt` | integer | |

The rule reads `announceAtMs <= now` on the RTDB server clock, the same way
`series_instalments_detail` reads `releaseAtMs`. Before then only founders can read the record.
No cron makes it visible.

**The picker (ruling 334).** The admin suggests stories ranked by reads (`hitsByDay`) and by
responses, mixes flash fiction and short stories, and refuses a third story by one writer
(`MAX_PER_WRITER = 2`, a chosen number in one constant). Any story whose text isn't live, or that
is retired (`cms_stories_retired/{slug}`), can't be picked. The suggestion is a list. An editor
chooses.

---

## 3. Each recorded story and instalment

### `radio_audio/stories/{slug}` and `radio_audio/instalments/{instalmentId}`

| field | type | meaning |
|---|---|---|
| `collection` | `'c{n}'` | its collection |
| `premiereAtMs` | integer | `premiereAtMs` of the collection plus the item's `offsetMs`. Readable from this moment |
| `durationMs` | integer | **measured from the file** (below), never typed |
| `version` | string | the stored object's generation or ETag (§7). Changes when, and only when, the file is replaced. It's Radio's download-cache key, and the pin for a saved position |
| `narrator` | `{ name, uid? }` | the credit as printed. `uid` only when the narrator has an account and has agreed to be linked |
| `engineer` | `{ name, uid? }` | the same |
| `access` | instalments only: `{ releaseAtMs, freeForGold, openToFree }`, optional | on-demand access, when it differs from the text's (below) |
| `readAlong` | string | the text's web address: `/stories/{slug}` or `/series/instalment/{id}` |
| `status` | `'draft' \| 'scheduled' \| 'withdrawn'` | |
| `updatedAt` | integer | |

The rule denies a read until `premiereAtMs <= now` (server clock), except to founders and, for a
story, its own writer (Proofs, §10). The object's storage path is **never** on the record. Only
the access check knows it.

**The audio sits behind the platform's lock.** The file is private storage that no client can
read (`allow read: if false`, or a private R2 bucket). The only way to it is a short-lived URL
from the access check (§4), exactly like `master.epub`.

**Duration is measured from the file.** It's measured in the editor's browser from the file
being uploaded, before the upload: an `<audio>` element's `duration` after `loadedmetadata`. For
a constant-bitrate MP3 it's also checked against `(bytes − tag bytes) × 8 / bitrate`. Duration and
`version` land in one write, the way `wordCount` and `epubPath` do for an instalment
(`docs/series.md`, "Reading time is derived, never typed"). A replaced file means a re-measure.

**Access, defaulting to the text's.**

- **A story's audio** has exactly its text's access: `grantFor(story, { tier })`, with the free
  week, the archive and poetry as they stand. There is no per-story override. A story recorded
  from the archive is a Gold listen on demand, as its text is a Gold read.
- **An instalment's audio** defaults to the instalment row: `releaseAtMs`, `freeForGold`,
  `openToFree`, through `policyGrantForInstalment()`. An editor can override any of the three,
  **per instalment, in the Series admin**, as `radio_audio/instalments/{id}/access`. The
  override governs the audio only, never the EPUB. Absent means "as the text".
- **The release time** of on-demand listening is the end of the premiere (§5), or the text's own
  release time if that's later. Audio never opens before its text.

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
    premiere: { startMs, endMs, live: true|false },
    serverNowMs                  // the server's clock, for the live point (§5)
  }
→ 401 { code: 'signed_out' }
→ 403 { code: 'not_released' | 'tier_too_low' | 'lapsed' | 'premiere_only_listen' }
→ 404 { code: 'not_found' }        // missing, draft, withdrawn, or before premiereAtMs
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

- **During the premiere** (`startMs ≤ now < endMs`), every signed-in listener may listen
  (`reason: 'premiere'`), whatever their tier.
- **After it**, the item's own access decides (§3): `free_week`, `poetry`, `tier`,
  `free_to_read`, `gold_taste`, `platinum`, or a refusal.

**Downloading.**

- It's never allowed during the premiere (`premiere_only_listen`). That would hand over the
  whole file early (§6).
- After the premiere it's allowed when listening is allowed **and** the listener holds a paying
  membership by subscription. **Pending:** whether a day pass counts. The Series precedent says
  it doesn't: the subscription decides, and a pass is read only to word the refusal.

**`lapsed`** is true when `memberships/{uid}` shows a paid subscription that is no longer active.
It's answered on every call, whatever `want` is, so Radio can recheck its downloads with one call
per item.

**Proposed for Radio's download store (pending a ruling).**

- Radio rechecks each downloaded item at least once every 7 days while online, and on every open
  when online.
- When an item's answer is `download.allowed: false` with `lapsed: true`, Radio locks that file:
  it stays on the device but doesn't play until the membership is renewed.
- Offline past the 7 days, it keeps playing until the next online check.
- This is the opposite of the day-pass shelf precedent (§1), so it needs a ruling before Radio
  builds it.

**Abuse limits.** These go through `functions/api/_ratelimit.js`, failing closed: 60 calls a
minute and 2,000 a day per uid. Nothing logs a token or a URL.

---

## 5. Premieres

- **When:** weekly, **Thursdays at 20:00 London**: `premiereAtMs` on the collection. 20:00 is
  also when the Square opens, which ruling 336 builds on.
- **Who:** every signed-in listener during the premiere, then on demand under each item's own
  access (§3, §4).
- **The running order** plays item after item at `premiereAtMs + offsetMs`. Each item is its own
  file. There is no separate programme file.

**A trusted server time.** A phone's clock can be wrong by minutes, so the live point is never
computed from it.

- The access check returns `serverNowMs`.
- A signed-in client can also read `.info/serverTimeOffset` from the RTDB, the same clock the
  rules use.
- The live point is `serverNow − premiereAtMs`, mapped through the running order to an item and
  an offset into it.

**The listener count and the hearts.** These are written by listeners, read by every signed-in
listener, and refused outside the premiere.

```
radio_live/c{n}/listeners/{uid} = true
  .read:     auth != null
  .write:    auth.uid == $uid
             && premiereAtMs <= now && now < endAtMs + 10 min      (from radio_collections/c{n})
  .validate: newData.val() === true || !newData.exists()
  Radio sets it on join with onDisconnect().remove(). The count is the number of children.

radio_live/c{n}/hearts/{uid} = { n, at }
  .read:     auth != null
  .write:    auth.uid == $uid && the same window
  .validate: at == now
             && n == (data.exists() ? data.n + 1 : 1)
             && (!data.exists() || now >= data.at + 1000)
             && n <= 6000
  At most one heart a second per listener. The total is the sum of n.
  No shared counter, so no transaction contends on a hot node.
```

**After the premiere** a closing job writes the totals to `radio_collections/c{n}/live`
(`{ listenersPeak, hearts }`, numbers only) and removes `radio_live/c{n}` whole, within 24 hours.
No uid outlives the night (§9).

**The listen-along post (ruling 336).**

- On a premiere night, the first Square post after the 20:00 opening is a house post that points
  at the collection.
- It's written server-side by the job that already acts at the bell. That's either the
  scheduled-publish Worker's first tick at or after 20:00, or the Square horizon's 20:05 run. The
  build round picks one and says why.
- A Square post is `$other: false`, so a new field (`attachedPremiere: { collection }`) needs its
  rules child **first**.
- Otherwise the post reuses `attachedStory`'s shape, pointing at the collection's first item.

---

## 6. The premiere lock

**The problem.** A plain file can't stop a player fetching ahead: hand a listener the URL at 20:00
and a modified client has the whole collection at 20:01. Every Function request counts against
the account's **100,000-a-day Workers allowance**, which the whole site shares. A live HLS
playlist is re-fetched every few seconds by every listener.

**Each method's cost per listener, for a 50-minute premiere (3,000 seconds):**

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

- **The endpoint.** The first build (RADIO-B2) ships a test endpoint,
  `POST /api/radio/test-stream`. It serves a 50-minute constant-bitrate MP3 of house test audio
  (a tone and spoken timestamps, never a story) with the server-side cap:
  `206 Content-Range: bytes 0–N/*`, where `N` = the bytes at the live point plus L seconds.
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

**The rule (ruling 348, pending: written on the suggestion in the brief).** If the capped
constant-bitrate MP3 costs **a few requests per listener** (at most 10 over 50 minutes, on both
phones), with no audible gap, the **server holds the live point**. Otherwise, **Radio's player
holds it**: the server opens the file only during the premiere (the access check mints a URL only
for `startMs ≤ now < endMs` and for no longer than the premiere has left), and Radio's player
seeks to the live point from `serverNowMs` and offers no seeking ahead of it.

---

## 7. Storage for the audio

| | Cloudflare R2 | Firebase Storage (Google Cloud Storage) |
|---|---|---|
| **Charges for downloads** | none for data out, on any plan | charged per GB sent to the internet, beyond a small free allowance |
| **Size of the problem** | A 50-minute evening at 64 kbps mono is about 24 MB per listen. Downloads for members multiply it, and audio is the heaviest thing the platform will ever serve. | the same volume, billed |
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
  `radio_audio/stories/{slug}`, which the rules hide until `premiereAtMs`. The static page holds
  nothing about audio, so the player appears at the premiere on the server clock with no build,
  no hook and no Function per view (ruling 265's principle).
- **Instalment pages** do the same with `radio_audio/instalments/{id}`.
- **Every release is set before the 19:30 freeze.** The collection, its running order and every
  item's record are written and `scheduled` before 19:30 London on premiere day. From 19:30 to
  the end of the premiere nothing about it is edited. Releasing is the clock, not a write.
- Withdrawing an item (`status: 'withdrawn'`) is a database write the access check honours at
  once, and the player hides on its next load.

---

## 9. Listening position, links and deletion

### Continue listening

```
listening_position/{uid}/stories/{slug}
listening_position/{uid}/instalments/{id}
  = { positionMs, durationMs, version, updatedAt }
  .read/.write: auth.uid == $uid
  .validate: positionMs and durationMs are numbers, 0 ≤ positionMs ≤ durationMs;
             version is a string ≤ 64 chars; updatedAt == now
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
| `listening_position` | **deleted whole**: added to `OWNED_NODES`, so `tests/account/deletion.test.mjs` will refuse the rules file until it is |
| `radio_live/c{n}/listeners/{uid}`, `radio_live/c{n}/hearts/{uid}` | removed whole by the closing job within 24 hours (§5); the endpoint and `scripts/account/scrub.mjs` also null the reader's two keys under any `radio_live/*` still open |
| `radio_audio/*` `narrator.uid` / `engineer.uid` | the credit's `uid` is removed on deletion; the printed name is a credit on published work and stays until Ikenna makes the editorial call, as a deleted writer's stories do (ruling 34, `docs/ACCOUNT-SCRUB-PLAN.md`) |
| `account_apps` (ACCOUNT-CONTRACT §4) | deleted whole, in `OWNED_NODES` |

---

## 10. The production book

**What it is.** It's built in the admin, at `/admin/radio/book?c={n}`, and saved as a PDF from
the browser's own print dialog. The story text goes from `story_bodies` (founders only) into the
founder's browser and onto paper. **It never passes through a session, a log, a Function's
output or this repo.** The page sends nothing anywhere. It reads and prints.

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
- **A cover sheet** with the running order and each item's minutes at **9,300 words per
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
written on the suggestion in the brief).**

- **Pronunciations (ruling 331).** The writer of each picked story sees the checked guide for
  their own story in `/proofs` and confirms it, or reports a correction through the existing
  report path. Recording waits for the confirmation.
- **Recordings (ruling 333).** The finished recording appears in their Proofs at least **three
  days** before its premiere. It plays through the access check, which grants the story's own
  writer before release. They have those three days to report.
- Proofs keeps its existing rules: a writer sees only their own, and everyone else gets 404.

---

## 11. Notifications

These are list only, with no push (ruling 345). Each is one new kind in
`app/lib/notificationKinds.js` with `push: LIST_ONLY`, so the settings screen gains no switch
(ruling 337).

| kind | where it goes | when |
|---|---|---|
| `collection` | `announcements/{id}`, one shared item: `{ kind: 'collection', id: 'c{n}', at }` | at `announceAtMs` |
| `premiere` | `announcements/{id}`: `{ kind: 'premiere', id: 'c{n}', at }` | at `premiereAtMs` |
| `recording_live` | `inbox/{writerUid}` | when a writer's recording premieres |

The announcement records hold ids only, like stories and instalments do today. The bell draws
the title live.

---

## 12. Build rounds, in order

Each ships alone, and each leaves production working if the next never comes.

1. **RADIO-B1: records and rules.**
   - The three record shapes and their validators in `app/lib/radio/schema.js`.
   - The rules: server-time reads, the `radio_live` window, `listening_position`.
   - The emulator suite, and `listening_position` in `OWNED_NODES`.
   - No UI and no data.
2. **RADIO-B2: storage and the measurement.** It needs Ikenna's R2 setup (§7).
   - The test endpoint, `POST /api/radio/test-stream`, and its counts.
   - The house test file.
   - Radio runs the measurement and reports. **Ruling 348 is made on its numbers.**
3. **RADIO-B3: the access check.**
   - `POST /api/radio/access` with the premiere window, lapse and download answers.
   - A shim test within 45 subrequests.
   - Founders and the test reader only until a collection exists.
4. **RADIO-B4: the admin.**
   - `/admin/radio`: collections, the picker (ruling 334), uploads with duration measured in the
     browser, credits.
   - The per-instalment audio access override in the Series admin.
5. **RADIO-B5: the production book.**
   - The print page.
   - The founder-only drafting Function.
   - The review screen for the guide and notes.
6. **RADIO-B6: Proofs.** Pronunciation confirmation and recording preview (rulings 331, 333,
   347).
7. **RADIO-B7: the web's listen player.**
   - On story and instalment pages (ruling 332).
   - Continue listening.
   - A hand-off note for Story Island's player.
8. **RADIO-B8: premiere night.**
   - The closing job.
   - The listen-along post, with its rules child first (ruling 336).
   - The three list kinds (ruling 345).
9. **RADIO-B9: instalment links.** `/series/instalment/*` in the association file, after a Story
   Island build renders it (ruling 335).
