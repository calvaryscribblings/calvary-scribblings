# The reading-position pin

**Node:** `bookstore_reading_progress/{uid}/{titleId}`
**Shipped:** R11.22 (web half). The app half is the version check; neither half does anything alone.

A stored CFI is now written with a statement of **which copy of the file it was taken in**. A
reader that holds a different copy can tell, and falls back to `fraction` instead of seeking
coordinates that mean nothing in its own bytes.

## The record

```jsonc
{
  "fraction": 0.42,              // required, 0..1
  "updatedAt": 1755300000000,    // required, epoch ms
  "cfi": "epubcfi(/6/4!/4/2/2,/1:0,/1:12)",   // optional
  "epubVersion": "1785243569624430"           // optional — only ever alongside `cfi`
}
```

`$other` is closed on this record and always has been, so `epubVersion` needed a rules change
before it could be written at all. The validator is **`isString()`, length 1–128** — see
[Why the validator is loose](#why-the-validator-is-loose-on-purpose).

## What the pin is — and it is not a new fact

`epubVersion` is the **Cloud Storage `generation` of that title's `master.epub`**: the exact
string `POST /api/bookstore/stream` has returned as `version` since R9.10, and the one the app
already keys its on-device download cache by.

```
POST /api/bookstore/stream   { titleId }   →   { url, expiresAt, version, md5 }
                                                            └── this
```

It changes **when and only when the object is replaced**. It is not derived from the request,
the clock, the signature or the token: two calls a second apart return the same `version` and
different `url`s, and `tests/bookstore/stream-version.test.mjs` exists to keep it that way.

Nothing new is computed, hashed, stored or backfilled. Both surfaces are handed the pin by the
same endpoint on the same call that hands over the bytes, so neither has to trust anything the
other calculated — which is the property that makes this cheap.

> There was no existing "this book's file was replaced" field to reach for, which is worth
> recording because it looks like there should be. `epubPath` is the constant
> `bookstore_epubs/{titleId}/master.epub` — the same string before and after a re-upload. The
> title's `updatedAt` moves on *any* edit, so a price change would have invalidated every
> reader's position on every device. The generation was already the right fact, already served,
> and already in the app's hands.

## The rule for a reader

| stored `epubVersion` | your copy's version | do |
|---|---|---|
| matches yours | known | **seek the CFI** |
| differs | known | **fraction** — the file was replaced, or the position came from another copy |
| present | unknown | **fraction** — it cannot be certified, so it isn't |
| absent | anything | **seek the CFI** (see the asymmetry below) |

The web's half is `cfiIsOurs()` in `app/lib/bookstore/reading-position.js`, asserted in
`tests/bookstore/reading-pin.test.mjs`.

**The absent case is a deliberate asymmetry.** Every position stored before R11.22 is unpinned,
and refusing them all would demote every returning reader's place to an approximation, once and
visibly, to guard a hazard that only bites when the copies genuinely differ. Each record
re-pins itself on its reader's next save, so the unpinned population drains on its own. The app
is free to be stricter here — that choice is per-surface and the two do not have to agree.

## What the app needs to do

1. **When writing a position:** write `epubVersion` = the `version` you received from
   `/api/bookstore/stream` for the copy on screen. Same string, unmodified — not a hash of it,
   not `epubVersion(url, updatedAt)`, not a re-derivation. One namespace, one authority.
   Omit it if `version` was `null`; write it only alongside a `cfi`.
2. **When reading one back:** apply the table above against the version of the copy you have on
   disk (you already store it — it is your cache key).

That is the whole of it. If a position is written without the pin it behaves exactly as it does
today: readable, and read by `fraction`.

## The things deliberately not done

- **No content hash.** The generation already answers "same object, same bytes" for the object
  we serve, and hashing would mean a backfill over every master plus a per-open digest on the
  device to compare against. If belt-and-braces is ever wanted, the same response already
  carries `md5` (GCS's `md5Hash`) — it is not written into the record because a second
  authority for one fact is a second thing to disagree.
- **No "does the landing roughly match the fraction" check.** Ruled out by measurement on the
  app's side and not re-litigated here: a wrong-content landing can sit an order of magnitude
  *closer* in fraction terms than two honest devices legitimately differ by from pagination
  alone. Any check that measures the landing passes the dangerous case and fails safe ones.
- **No pin on samples.** The sample EPUB is a different, public object and no progress record is
  written for it at all (`app/reader/[slug]/book-reader.js` passes no progress node in sample
  mode).

## Why the validator is loose on purpose

`".validate": "newData.isString() && length 1..128"` — not a digits-only match on a generation,
even though that is what the web writes.

Both surfaces write this record with a whole-record `set`. A tight validator turns an unexpected
pin format into a **rejected write**, which fails the entire `set` and loses the reader's
position outright. A loose one turns the same case into a pin that simply does not match, which
every reader already handles by falling back to `fraction`. **Degrade, don't refuse.** The
value's provenance is this contract, not a regex — and `cfiIsOurs` treats anything it cannot
match as a mismatch, which is the safe direction.

There is a rules test asserting exactly this, so it cannot be "tightened" back into an outage by
someone reading the validator without the reason:
`tests/rules/database.test.mjs` → *"a foreign pin format is ACCEPTED by the rules"*.

## The one thing this cannot prove — worth checking before trusting it

A generation pins **our object**. Matching pins mean same bytes *if the copy you are reading came
from the object the pin names* — i.e. it was downloaded through `/api/bookstore/stream`.

If the app's copy of a title is produced by some other pipeline — bundled into the binary from a
publisher-supplied file, converted, or re-zipped in transit — then a matching pin would certify
bytes it never saw, and the pin would be worse than useless: confidently wrong. The good news is
that this fails **loudly rather than silently**: if the copies come from different pipelines, the
app's stored version will simply never equal ours, every cross-surface CFI falls back to
`fraction`, and that permanent non-match *is* the diagnosis. (A timestamp-shaped pin would have
matched anyway and hidden it — one more reason it is the generation.)

So: **if the app's reading copy is not the file it downloaded from `/api/bookstore/stream`, say
so** — the pin's meaning changes and a content digest becomes the right answer instead.

## Where the parts live

| part | file |
|---|---|
| the served fact | `functions/api/bookstore/stream.js` → `readObjectVersion()` |
| carried to the client | `app/lib/bookstore/stream.js` → `requestStreamUrl()` |
| held for the session | `app/reader/[slug]/book-reader.js` → `epubVersion` state, passed as `progress.pin` |
| written / checked | `app/lib/bookstore/reading-position.js` → `positionRecord()`, `cfiIsOurs()` |
| used | `app/reader/[slug]/ReadingRoom.js` → the auto-save effect and the restore lookup |
| the shape | `database.rules.json` → `bookstore_reading_progress/$uid/$titleId` |
| the tests | `tests/bookstore/reading-pin.test.mjs`, `tests/rules/database.test.mjs` |

Related: [`docs/cfi-exchange-protocol.md`](./cfi-exchange-protocol.md) — §6h, which proves the two
surfaces resolve the same CFI to the same place **when they hold the same bytes**. This document
is the other half of that sentence: knowing when they do.
