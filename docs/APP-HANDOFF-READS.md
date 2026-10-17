# App hand-off: reads, counted once (W49 → A38)

Rulings 176–180, 17 Oct 2026. The web shipped them in W49. This is what the app must mirror.

## 1. Story reads: move from the Worker to `/api/hit`

**What happened.** The app counted story opens by POSTing to the `calvary-hit-counter` Worker
(`…workers.dev/?slug=…`). The Worker added one to `stories/{slug}/hits` on every call, with no
reader. From 3 to 17 Oct that was 229 of the 237 increments, and it is why a story's count
climbed when one person reopened it (ruling 180).

**Now.** Once Ikenna pastes the replacement into the dashboard, the Worker is count-only. It
still answers `{ "count": <number|null> }` with 200 to GET and POST, so every app version
already in the stores keeps showing the count. It writes nothing, so app opens don't count
until A38.

**A38: call `/api/hit` instead.**

```
POST https://calvaryscribblings.co.uk/api/hit?slug=<slug>
Content-Type: application/json
Authorization: Bearer <Firebase ID token>          ← signed in (the uid is taken from it)
{ "slug": "<slug>", "client": "ios"|"android", "clientVersion": "…", "updateId": "…" }

signed out: no Authorization header; add "readerId": "<a stable device id>" to the body.
            Never send the string "null" or "undefined": those count nothing.
→ 200 { "count": <number|null>, "counted": <boolean> }
```

- **Wait for Firebase Auth to settle before calling.** That means `onAuthStateChanged`'s first
  callback. The web had a bug: one reader was counted once under the device id (sign-in not yet
  restored) and again under the uid. A signed-in reader must always send the token.
- **The moment.** Call it at the moment a story counts its read on the web: the first page
  shown, or 12 seconds of foreground dwell. Once per open is fine; the server deduplicates.
- A token that fails to verify counts nothing. The server does not fall back to the device id.
- A counted read also writes today's `stories/{slug}/hitsByDay/{UTC day}`, which ranks
  `top_stories/weekly`. Until A38 ships, app reads do not reach that ranking.

## 2. Instalment reads (rulings 176, 179)

```
POST https://calvaryscribblings.co.uk/api/series/read
Authorization: Bearer <Firebase ID token>       ← required; the uid comes from it only
{ "inst": "<instalment id>" }
→ 200 { "count": <number|null>, "counted": <boolean> }
→ 401 signed_out · 404 not_found · 409 not_released · 403 no_access · 429 · 502/503
```

- Fire it once per open at the story moment (the first page shown, or 12 s on the page).
- **The credit (ruling 179)**, only when the answer is `counted: true`:
  - set `users/{uid}/readInstalments/{inst} = true` (owner-write, `true` only);
  - add one to `users/{uid}/readCount` (a transaction);
  - when the new readCount is a multiple of 10: `points/{uid}/total` + 5, a
    `points/{uid}/history` row `{ type: 'read', amount: 5, description: '{n} stories read milestone' }`,
    and a `library_notifications/{uid}` reward. These are the story read's own writes; the web
    code is `app/lib/readCredit.js`.
  - **Never** write an instalment into `users/{uid}/readStories`. Other surfaces read that node
    as story slugs.
- The streak (`userStreaks/{uid}`) and the badge checks run on every signed-in read moment, as
  they do for a story.
- Readers seeded from a saved place (ruling 178) get `counted: false`, so they are credited
  nothing. That is intended.

## 3. Showing it (ruling 177)

- `series_reads/{inst}` is public: read it directly. Don't read it from the notes summary, which
  only changes when notes do.
- The strings, from `NOTES_COPY` (`app/lib/series/notes.js`; the parity test picks them up):
  - `reads(n)`: "1 read", "1,204 reads" (en-GB grouping)
  - `roomCounts(r, n, m)`: "1,204 reads · 38 notes · 21 readers"
- The strip shows each instalment's reads beneath its numeral, and the note count stays beside
  it. The rail shows the reads under the title. The room's count line leads with the reads
  across the released instalments.

## 4. The author snapshot (W48's open item, W49 §7)

A note's `author` snapshot now carries `isAuthor: true` for a writer. If a reader's record is
gone, fall back to it, so a deleted writer keeps the Writer badge.
