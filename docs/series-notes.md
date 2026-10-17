# Readers' Notes for the Series: the contract

W46, rulings 157–166. **The web and the app both build against this file.** The code form is
`app/lib/series/notes.js` (paths, limits, words, pure rules). The rules are in
`database.rules.json`, and `tests/rules/w46-series-notes.test.mjs` proves them on the emulator.
The endpoint is `functions/api/series/notes.js`. Change any one of these and you change this file
with it.

`{inst}` is an instalment id and `{sid}` a series id.

## The rulings

| # | ruling | where it is enforced |
|---|---|---|
| 159 | one question of each kind: Take a side, Sit with this, The line | `publishableQuestions()`: all three or none |
| 160 | nobody sees an instalment's notes until they've finished it | **the rules**: every gated `.read` needs `series_finished/{uid}/{inst}` |
| 161 | the first answer opens the room, even one tap on a side | the endpoint writes `series_room_members` on any side, note or reply |
| 162 | Sit with this is spoiler-free and sits on the door for everyone | `series_questions_public` is public; the drafting prompt forbids events |
| 163 | the writer's answers are pinned, with a writer's mark | `writer: true` when uid = the series' `authorUid`; `sortNotes()` pins |
| 164 | the admin drafts the three questions from the text; the editor edits and publishes | `draft-questions` fills drafts only; `publish-questions` is a separate act |
| 165 | one reaction, Underline | `series_note_underlines` |
| 166 | notes are AI-checked as they're posted; flagged ones wait for review | the endpoint screens; flagged go to `series_notes_held` |

## The flag

`SERIES_NOTES_ENABLED` is in `app/lib/series/notes.js`. While it is false:

- no reader surface renders: no door, no room, no last-page sheet, no "This is my line";
- every reader action on the endpoint answers `404 not_enabled`;
- the founders' actions (`draft-questions`, `publish-questions`, `review`) and the admin section
  still work, so the questions can be drafted before the doors open.

## The data

**Who can write.** "Endpoint" means the Pages Function with the service account. Its writes are
not judged by the rules, and the rules refuse the same node to every client, **founders
included**. "Admins" means the two founder uids the rules already hold.

| path | value | read | write |
|---|---|---|---|
| `series_finished/{uid}/{inst}` | ms | owner | owner. Value `> 0` and `<= now`, only while the instalment is published and released |
| `series_questions_public/{inst}` | `{sit, publishedAt}` | **public** | admins (shape-checked, nothing else allowed) |
| `series_questions/{inst}` | `{sit, side:{text, options:{a,b,c?,d?}}, line, publishedAt}` | admins, or a reader with `series_finished` | admins (shape-checked) |
| `series_question_drafts/{inst}` | `{sit, side, line, updatedAt, draftedAt?, model?}` | admins | admins |
| `series_room_members/{inst}/{uid}` | ms joined | owner (no listing); admins | endpoint |
| `series_sides/{inst}/{uid}` | `'a'`–`'d'` | owner (no listing) | endpoint |
| `series_side_tallies/{inst}` | `{a:n, b:n, …}` | finished **and** member; admins | endpoint |
| `series_notes/{inst}/{noteId}` | the note (below) | finished **and** member; admins | endpoint |
| `series_notes_held/{inst}/{noteId}` | the note + `reason` | admins; the note's author (by id, or by `orderByChild('uid').equalTo(uid)`) | endpoint |
| `series_note_replies/{inst}/{noteId}/{replyId}` | the reply (below) | as notes | endpoint |
| `series_note_underlines/{inst}/{noteId}/{uid}` | `true` | finished and member (the whole instalment, so counts can be shown) | owner, finished and member, `true` or delete, on a live note |
| `series_note_reports/{inst}/{noteId}/{uid}` | `{at, reason?≤200}` | admins | owner, finished and member |
| `series_margin/{uid}/{inst}` | `{text≤400, cfi, epubVersion, savedAt}` | owner | owner |
| `series_notes_summary/{sid}` | the summary (below) | **public** | endpoint |

### A note

```
{ uid, kind: 'side'|'sit'|'line'|'else',
  side?: 'a'..'d',                        // kind 'side': the reader's side when they wrote it
  text: 1–500 chars,
  line?: { text ≤400, cfi, epubVersion },  // kind 'line' only
  author: { name, handle?, photoURL?, badge? },   // snapshot; badge = the island read count
  writer?: true,                           // uid === series/{sid}/authorUid (ruling 163)
  unscreened?: true,                       // screening could not run; posted live anyway
  createdAt }
```

A held note has the same shape plus `reason`, one of the closed categories: `abuse`, `hate`,
`threat`, `sexual`, `personal-data`, `spam`, `other`. A held **reply** is kept in the same node
with `kind: 'reply'`, `noteId` (its parent) and `replyTo?`.

**The author snapshot is a fallback.** Surfaces resolve identity from the live record at render,
the way the Square does (`app/lib/squareIdentity.js`, R33.2). The snapshot is used only when that
record cannot be read.

### A reply

```
{ uid, text: 1–300 chars, author, replyTo?: replyId, createdAt,
  removed?: true }   // removed: the row stays and the text becomes ''
```

There is one level of replies. `replyTo` names a reply in the same thread, and its author's
handle is shown as "Replying to @name".

### The summary: `series_notes_summary/{sid}`

```
{ inst, ordinal,                  // the instalment the door leads with
  sit,                            // its published Sit with this question
  sitAnswers, notes, readers,     // that instalment's counts
  lastAt,                         // the newest live note in the series (the door's light)
  latestNotes: [ms ≤50],          // newest note timestamps, series-wide ("{n} new")
  faces: [≤4 {photoURL} | {initials}],
  byInst: { [inst]: { ordinal, notes, readers, kinds:{side,sit,line,else}, lastAt } },
  stampsByInst: { [inst]: [ms…] } }    // bookkeeping for latestNotes
```

It holds **counts, timestamps and faces, never a word a reader wrote**. That is what lets the door
and the sealed room draw with no gated read. `byInst` is an addition to the brief's list: the
instalment strip and the wax seals need a count for every instalment and every question.
`kinds.side` counts sides taken, because a tap is an answer (161). The endpoint recomputes the
changed instalment from its gated nodes on every change rather than incrementing, so the counts
cannot drift.

## The endpoint: `POST /api/series/notes`

Send `Authorization: Bearer <Firebase ID token>`. The uid comes **only** from the token. The body
is JSON `{ action, inst, … }`.

Every **reader** action, in order:

1. the flag is on (otherwise `404 not_enabled`);
2. the token verifies (otherwise `401 signed_out`);
3. the rate limit passes (otherwise `429 limit` with `Retry-After`, or `503 limiter_unavailable`;
   the limiter fails closed);
4. the instalment is published and released (otherwise `409 not_released`);
5. `app/lib/series/access.js` grants it, the same policy as `/api/series/stream` (otherwise
   `403 no_access`);
6. `series_finished/{uid}/{inst}` exists (otherwise `403 not_finished`).

| action | body | does | answers |
|---|---|---|---|
| `side` | `{inst, option}` | records or changes the side, moves the tally (ETag-conditional), joins the room, refreshes the summary | `{ok, side, tally}` |
| `note` | `{inst, kind, text, line?}` | checks, screens, then writes live or held; joins; refreshes the summary | `{ok, noteId, status:'live'\|'held'\|'unscreened', note}` |
| `reply` | `{inst, noteId, text, replyTo?}` | as `note`, under a live note | `{ok, replyId, status, reply}` |
| `remove` | `{inst, noteId, replyId?}` | your own, or any for a founder. A note goes with its replies, underlines and reports; a held note can be removed by its author; a reply keeps its row with the text stripped | `{ok}` |
| `review` | `{inst, noteId, decision:'approve'\|'remove'\|'dismiss'}` | founders. Approve moves held → live; Remove deletes; Dismiss clears the reports | `{ok}` |
| `draft-questions` | `{inst}` | founders. Reads the instalment's EPUB with the service account and asks the quiz's model for three questions in the house register; writes **drafts only** | `{ok, draft}` |
| `publish-questions` | `{inst}` | founders. The drafts, if all three are ready, become `series_questions` and `series_questions_public` in one write, and the summary follows | `{ok, questions}` |

`publish-questions` is an addition to the brief's list. The summary is endpoint-only, and the
door has to learn the new Sit question in the same act that publishes it.

`side` needs the instalment's published questions, otherwise `409 no_questions`. So does a `note`
of kind `side`, `sit` or `line`. A note of kind `else` does not.

**Screening** (ruling 166) uses Haiku (`SCREENING_MODEL`) with a closed list of categories. It
looks for abuse, hate, threats, sexual content, personal data and spam. **Spoilers are fine**,
because the room is sealed. If screening cannot run (no key, a timeout, an error), the note
**posts live, marked `unscreened: true`**. A moderation failure never blocks a reader; that is the
rule in `functions/api/comments/screen.js`.

**Words for every refusal** are in `NOTES_ERRORS` in `app/lib/series/notes.js`.

### The limits (W46)

These are charged through `functions/api/_ratelimit.js` (fixed windows, fail closed):

| bucket | per reader / minute | per reader / day | everyone / day |
|---|---|---|---|
| `note` + `reply` (screened) | 10 | 80 | 5,000 |
| `side` | 20 | 200 | — |
| `remove` | 30 | 300 | — |
| `draft-questions` | — | — | 40 |

## What the rules cannot do, stated

- **`series_finished` cannot prove a reader read to the end.** It is the reader's own write. Its
  rule forbids future times and unreleased or unpublished instalments. A reader who forges it can
  read the three **question texts** for an instalment that has released, and nothing more. The
  room still needs membership, which only the endpoint grants after the access policy and the
  finished check.
- **The rules do not apply the tier policy to the question texts.** Same reason. The notes, the
  tallies and the replies are behind membership, and the endpoint checks the policy before it
  grants membership.
- The underliners of a note are visible to the other finished members of that instalment's room.
  That is needed to show "Underline · n" and to sort by Most underlined, and it matches how the
  Square stores reactions.

## For the app

- Write `series_finished/{uid}/{inst}` with the server timestamp on reaching the last page,
  **before** showing the sheet. The reads that follow depend on it.
- Read the door from `series_notes_summary/{sid}` and `series_questions_public/{inst}` only.
- Join the room, post, reply and remove through the endpoint. Underline and Report are direct
  writes.
- "This is my line" writes `series_margin/{uid}/{inst}`. It is private until a reader posts it as
  a `line` note.
- "Read it in its place" on the web is `/series/read/{inst}?at={cfi}&v={epubVersion}`. A line
  whose `epubVersion` is not the current file's opens at the reader's own place instead, because
  a CFI is only trusted in the bytes it was taken in (`docs/reading-position-pin.md`).

## W48: launch-morning fixes (17 Oct 2026)

- **The line with an empty margin (ruling 175).** When `series_margin/{uid}/{inst}` holds no line,
  the composer on The line shows `NOTES_COPY.lineFirst` above the field and a `chooseInBook`
  button beneath it, and Post stays visibly disabled until a line is attached. The button opens
  `/series/read/{inst}?from=notes` (`chooseLineHref`), which is the reader's own place with no `?at=`. The
  draft stays on the device, per question, as before. Once the margin holds a line, the composer
  behaves as it did in W46. The endpoint is unchanged: a line note still needs its line.
- **The way back.** With `?from=notes`, the notice after "This is my line" is
  `lineSaved` + a `backToNote` link to `/series/{slug}/notes?i={inst}&compose=line`
  (`backToNoteHref`). The notice stays up, because a link must not time out. The room opens The
  line's composer once when it sees `?compose=line`, with the new line attached and the draft in
  the field, then drops the parameter.
- **The author line is the Square's.** It has the same Avatar (the writer's ring comes from the
  identity's own `isAuthor`), the name, and `UserBadge` with the live `readCount` and `isAuthor`.
  The badge and its title follow the reader into the room, and a writer shows the Writer badge.
  This applies to notes, replies, "Why they chose", and the line view. The line view now lists,
  under each line, the readers who chose it. The series' own writer keeps the WRITER mark
  (ruling 163) in place of the badge (`authorMark` in roomModel.js). Identities still come from
  `squareIdentity`, with the stored snapshot as the fallback. The snapshot carries no `isAuthor`,
  so a deleted writer's old notes fall back to a reader's badge.
- **"Underlined · n".** Once underlined, the button reads `underlined(n)`, as on the approved
  canvas.

For the app: mirror all four. The strings are in `NOTES_COPY` (`lineFirst`, `chooseInBook`,
`lineSaved`, `backToNote`, `underlined(n)`). In the app the disabled Post must also *look* disabled.

## W49: instalment reads in the room (17 Oct 2026, rulings 176–179)

- `series_reads/{inst}` is public and read directly by the room: the strip and the rail show
  `NOTES_COPY.reads(n)` beneath each numeral, and the hero line is
  `NOTES_COPY.roomCounts(reads, notes, readers)`. The door keeps `heroCounts`.
- Counted by `POST /api/series/read` (Bearer token; once per reader; published, released and
  readable only), and fired by the Series reader at the first page or 12 s. It is not behind
  `SERIES_NOTES_ENABLED`. The contract is `app/lib/series/reads.js`; the app's half is
  `docs/APP-HANDOFF-READS.md`.
- The author snapshot now carries `isAuthor` (W48's open item).
