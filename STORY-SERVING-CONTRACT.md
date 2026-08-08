# The story-serving contract

**Status:** LIVE. `functions/api/story.js` ships and phase T1 is complete — bodies
are dual-written, the node is untouched, and gating is therefore active for nobody
yet (§7). The app session implements the client half against this document.

Revised R11.10 after the app-side recon: `readTimeMinutes` (§4.0b), the `updateId`
/ `runtime` telemetry fields (§1.3), the flag-driven reader-mode ruling (§4.4) and
the iOS platform note (§4.5).

**Audience:** the Story Island app session (calvary-app repo) and this repo.

**Modelled on** the `functions/api/bookstore/stream.js` handoff, and deliberately
so: that one worked because it stated the *wire shape*, the *typed refusals* and
the *one field that was load-bearing* before either side wrote a line. Where this
document says a field is always present, it is always present. Where it says a
null is a fact rather than an omission, branch on it.

---

## 0. The one-paragraph version

`POST /api/story` takes a slug and (optionally) a Firebase ID token, and returns
either the whole story body or a preview of it. Which one you get is decided
entirely server-side.

A story is free if **any** of these holds: it is under 7 days old, it is one of
the 5 newest stories, it is poetry, or the reader's tier is Gold or better.
Otherwise the reader gets the first 30% of it.

**A gate is never a refusal.** A reader who is not entitled still gets `200` with
a preview — the refusal codes in §5 are for things that actually went wrong, not
for "you can't read this".

---

## 1. Endpoint

```
POST /api/story
```

Lives at `functions/api/story.js` (a Cloudflare Pages Function — see CLAUDE.md
rule 2; Next.js Route Handlers are not built into the deployed output).

`GET` is not supported and returns `405`. The selector could ride in a query
string, but the credential could not: an ID token in a URL lands in access logs,
`Referer` headers and shared links. One method, one place.

### 1.1 Credential

Same two-slot arrangement as `stream.js`, same precedence, for the same reason —
the native client sets a header, the web client sends a body field, and a caller
sending both means the header:

1. `Authorization: Bearer <Firebase ID token>` — **preferred**
2. body `{ idToken }` — fallback

**THE CREDENTIAL IS OPTIONAL, AND THIS IS THE FIRST PLACE THIS ENDPOINT DIVERGES
FROM `stream.js`.** `stream.js` opens a book somebody bought, so no token means no
answer. This endpoint serves a magazine. A signed-out reader is entitled to every
story inside the free window and to a preview of everything else, and answering
them `401` would paywall the front page of the site. So:

- **No token at all** → treated as a signed-out reader, tier `free`. `200`.
- **A token that is present and does not verify** → `401 signed_out`. This is
  *not* the same case. A token that has expired means a reader who *thinks* they
  are signed in, and silently downgrading them to free would show a paying member
  a paywall with no way to understand it. They get told to sign in again.

### 1.2 Selector

Body `{ slug }`. The `cms_stories` RTDB key *is* the slug — there is no second
namespace. `storySlug` and `id` are accepted as aliases so a caller reaching for a
familiar name gets the story rather than a `400`.

Validated against `/^[A-Za-z0-9_-]{1,200}$/` before it is interpolated into an
RTDB path. This is a path-traversal guard, not a taste check.

### 1.3 Telemetry fields (optional, and never load-bearing)

Body `{ client, clientVersion, updateId, runtime }` — e.g.

```jsonc
{ "client": "story-island-ios", "clientVersion": "2.4.0",
  "updateId": "8f1c…",           // Expo Updates.updateId — the OTA bundle
  "runtime": "1.2.0" }           // runtime version — the native shell
```

**Logged and counted only.** No entitlement decision, no response shape, and no
transition behaviour (§7) reads these.

**`updateId` is the field that makes T2's number real, and it was added because
`clientVersion` cannot do the job alone.** The fleet updates over the air, so
`clientVersion: '2.4.0'` is the *same string* on a device carrying today's OTA
bundle and on one that has not fetched an update in a month. T3 is gated on "what
share of traffic is on the new path", and the OTA lane is exactly where that share
moves — a version string would have counted a stale bundle as adopted and cut the
node under it.

`runtime` separates a native rebuild from an OTA push, so a change that requires an
App Store round-trip is distinguishable from one that does not.

All four are truncated server-side (64/32/64/32 chars) and are never interpolated
into a path.

### 1.4 Full request example

```http
POST /api/story
Authorization: Bearer eyJhbGciOi…
Content-Type: application/json

{ "slug": "the-number-thirteen", "client": "story-island-ios", "clientVersion": "2.4.0" }
```

---

## 2. `publishedAtMs` — the field the whole gate stands on

**Epoch milliseconds, UTC, a NUMBER.** Not an ISO string. A string compares
against `Date.now()` as a string and would never expire — the exact trap
`activePass()` in `app/lib/membership.js` already carries a warning about, and the
one this codebase has been bitten by before.

It is written onto `cms_stories/<slug>/publishedAtMs` by the backfill (P1) and by
the composer for every story from then on. Its derivation, in precedence order:

1. **`publishAt`** when present — an ISO instant written by the scheduled-publish
   path. It is the real publication moment and it wins outright.
2. **`date` parsed as `"Mon D, YYYY"`** → that day at `00:00:00.000Z`.
3. **`date` parsed as `"Mon YYYY"`** (dayless) → the **1st of that month** at
   `00:00:00.000Z`.

Rule 3 is a deliberate imprecision and it is safe by measurement, not by hope:
every dayless record on the node is Jan–Mar 2026, months outside any window we
would plausibly set. Day precision only matters within a window-length of the
boundary; everything older is gated regardless of which day of the month we
picked.

### 2.1 What the app must not do with it

`publishedAtMs` **also rides in `cms_stories_index`** (see §8) so list surfaces can
badge a story without fetching its body. That copy is for **presentation only**.

> **DO NOT COMPUTE ENTITLEMENT ON THE CLIENT.** Not from the index copy, not from
> the copy in this endpoint's own response — even though the window length is
> derivable from either (see §3.1, which says so plainly rather than pretending
> otherwise). The device clock is settable: the membership module already accepts
> that risk for a £1 pass on the reasoning that "nothing is paywalled and the caps
> are shelf slots on the reader's own device." That reasoning expires the moment
> something *is* paywalled, which is now. The server clock decides, and the client
> renders the answer it is given.

The client renders what `access` says (§4). It does not second-guess it.

---

## 3. The entitlement rule

Evaluated server-side, in this order, on every request. The first branch that
matches wins.

```
publishedAtMs  = story.publishedAtMs                 (number, §2)
freeUntilMs    = publishedAtMs + FREE_WINDOW_MS      (server constant: 7 days)
now            = server clock

1.  story missing, or published === false            →  404 not_found        (§5)
2.  story is reader-mode                             →  200 access:'reader'  (§4.4)
3.  category === 'poetry'                            →  200 access:'full'   reason:'poetry'
4.  now <= freeUntilMs                               →  200 access:'full'   reason:'free_window'
5.  slug is in the most-recent-5 floor               →  200 access:'full'   reason:'recent_floor'
6.  tierAtLeast(effectiveTier(scalar, detail), 'gold') → 200 access:'full'   reason:'tier'
7.  otherwise                                        →  200 access:'preview' reason:'archive'
```

**FOUR WAYS TO BE FREE, AND THEY ARE ORed, NOT ANDed.** Whichever rule leaves a
story free wins. Branches 3–6 are independent grants; only a story that fails all
of them reaches branch 7. Written as a precedence chain rather than a boolean so
that `reason` can say *which* grant opened it — a reader told "free this week"
and a reader told "poetry is always free" are being told different true things.

### 3.1 `FREE_WINDOW_DAYS = 7`

**Settled 2026-08-07 and firm.** The revenue arithmetic does not work at 30, and
the floor of the window is the newsletter cycle — a story is free for as long as
the issue that carried it is the current issue. Seven days is that cycle, not a
guess at reader tolerance.

**The constant is NOT a secret, and an earlier draft of this document was wrong to
imply it was.** That draft said the window is "never sent to a client as a
duration" and offered `freeUntilMs` as a safe absolute instant instead. But every
`200` carries `publishedAtMs` *and* `freeUntilMs`, and one subtraction yields the
duration exactly. There was never anything hidden.

Stating it properly, because the difference decides how the code is organised:

> **The rule against client-side window arithmetic (§2.1) is a contract term, not
> a security boundary.** A client that reimplements the window can only lie to
> itself — it still cannot obtain a body, because the body comes only from this
> endpoint and this endpoint decides `access` on the server clock. What
> client-side arithmetic buys you is a second implementation that drifts, and a
> reader whose device clock is wrong seeing a lock on a story they can open.

So the constant lives in `app/lib/storyAccess.js` — one definition, imported by the
endpoint, by the index projection that computes the `gated` badge (§8), and by the
tests that assert those two agree. A constant duplicated to keep it "off the
client" would have been the worse failure, and it would have been justified by a
secret that does not exist.

As of 2026-08-08 the window alone leaves 7 of 137 gateable stories free.

### 3.2 The most-recent-5 floor

**The five newest gateable stories are always free, regardless of age.**

A seven-day window assumes a story a week. When publishing pauses — a quiet
fortnight, a holiday, a contributor falling through — the window empties and a
reader arriving at the site is offered *nothing at all* to read for free. That is
not a gate, it is a closed shop, and it costs us the reader who was about to
become a subscriber.

**This is not a hypothetical.** Simulated day-by-day against the live corpus over
1 April – 8 August 2026 (130 days), the floor fires on **26 of them — 20%** — and
across **9 April → 2 May, twenty-four consecutive days, it would have been the
only thing keeping any story free at all**: zero stories were inside the seven-day
window for that entire span. On 8 August 2026 it adds nothing, because seven
stories are inside the window. That is the shape it is supposed to have. It is
dormant at healthy cadence and it catches the gap.

**"Gateable" is the operative word.** The five slots are counted over stories that
could otherwise be gated — published, not reader-mode, not poetry. A floor whose
slots are spent on poetry (already free by branch 3) or on reader-mode stories
(not served here at all) would protect fewer than five stories and quietly fail at
the one job it exists to do.

Resolved server-side by an ordered query on `cms_stories_index`
(`orderBy="publishedAtMs"&limitToLast=N`), filtered to gateable, truncated to 5.
This requires `publishedAtMs` in the index projection and `"publishedAtMs"` in
that node's `.indexOn` — see §8.

**The floor set is cached in the Function isolate for 60 seconds**, because it is
identical for every reader and every slug and changes only when a story publishes
or is withdrawn. A stale floor errs by keeping a story free for up to a minute
longer than it should, which is the recoverable direction. It never errs the other
way, because a *newly* published story is inside the seven-day window regardless.

### 3.3 Poetry is exempt entirely

**`category === 'poetry'` is always `access:'full'`.** No window, no floor, no
tier.

Because it cannot be previewed without being mutilated. Measured over the live
corpus on 2026-08-08: of the 15 published poetry records, one is an EPUB
(reader-mode, §4.4) and the other **14 carry no stanza markup whatsoever** — not
one `.poem-stanza`, not one structural boundary. They are flat runs of `<p>`
elements in which a `<p>` is a *line*, not a paragraph. A 30% cut over those
blocks does not end a preview at a stanza break; it stops a poem mid-breath at an
arbitrary line, and there is no marker in the HTML that would let the cutter do
otherwise.

**This is stated to readers as a feature, and it should be, because it is one:**
poetry on Calvary Scribblings is free to read, always. That is a better sentence
than any paywall we could build over it, and it is also the honest one — we are
not withholding poetry out of generosity so much as declining to publish a broken
preview of it.

If stanza markup ever lands across the verse corpus, this exemption becomes a
policy choice rather than a technical necessity, and *that* is the conversation to
have then. Today it is not a choice.

### 3.4 The archive floor is `'gold'`

**Branch 6 uses `effectiveTier(scalar, detail)` from `app/lib/membership.js`
verbatim** — the pure module, imported, not reimplemented. That is the entire
reason that file holds no imports: "the tier a reader is entitled to must be
computed the same way on the server that writes it and the client that renders it,
and two copies of that arithmetic is how a member sees Gold on one surface and
Free on the next." A day pass therefore opens the archive for the hours it is
alive and closes it again when it lapses, with no extra code here.

`scalar` is read from `users/<uid>/membership`, `detail` from
`memberships/<uid>`, **both with an admin token, never with the caller's**. Same
rule as `stream.js`: the entitlement decision never passes through a client that
could lie about it. The uid comes from the *verified* token, never from the body.

**The tier required is `'gold'`, as a single named constant `ARCHIVE_MIN_TIER`.**
There is deliberately no per-story `minTier` override in v1. When one is wanted,
it goes on the story record and this line becomes
`tierAtLeast(tier, story.minTier || ARCHIVE_MIN_TIER)` — one line, one place. It
is stated here so nobody adds a second gating field somewhere else and discovers
the two disagree.

**The membership read is skipped entirely when branches 3–5 already granted
access.** Not an optimisation for its own sake: it means a signed-out reader on a
free story costs zero RTDB membership reads, and it means a membership outage
(§5.4) cannot degrade a story that was free to everyone anyway.

### 3.5 Hidden stories are `404`, not `403`

`published === false` returns `not_found`. A `403` would confirm the slug exists,
which is a disclosure about unpublished editorial work. There is no reader-facing
difference between "never existed" and "not for you to know about yet", and the
one that leaks less wins.

---

## 4. Response shape

`200` always carries these keys. Keys marked **always** are present on every
`200`, `null` when unknown — an explicit null is a fact the app can branch on, an
omitted key is a guess. That ruling is inherited from `stream.js`'s `version`
field and it is the same ruling here.

```jsonc
{
  "slug":           "the-number-thirteen",   // always
  "access":         "full",                  // always: 'full' | 'preview' | 'reader'
  "reason":         "free_window",           // always: see §4.5
  "publishedAtMs":  1780531200000,           // always (number; null only if unparseable)
  "freeUntilMs":    1783123200000,           // always (number; null when publishedAtMs is null)
  "readTimeMinutes": 6,                      // always (number; null on access:'reader')
  "content":        "<p>Dayo was afraid…",   // access:'full' only
  "preview":        "<p>Dayo was afraid…",   // access:'preview' only
  "previewOf":      { "paragraphs": 3, "of": 47 },  // access:'preview' only
  "readerHref":     null,                    // always (string only when access:'reader')
  "degraded":       false                    // always (boolean; see §5.4)
}
```

### 4.0b `readTimeMinutes` — for the WHOLE story, never for what was sent

**Always present. A number on any prose response; `null` on `access:'reader'`.**

Added R11.10 because the app was computing it client-side from whatever body it
held, and that is wrong in both of the ways it can be wrong:

- **On a preview** it understates — 30% of the prose reads as 30% of the minutes,
  so the one number that tells a reader whether they have time for this story is
  derived from the part we deliberately withheld.
- **On a T3 tombstone** (§7) it collapses to `1 min read`, because the tombstone is
  one sentence.

Both make the story look slighter than it is, at the exact moment we are asking
someone to decide whether to read it. So the server sends it, computed from the
full body it already has in hand. **One call, one truth** — deliberately not a
second `cms_stories_index` read.

> **⚠ IT PRESERVES THE RAW-HTML-TOKEN QUIRK, AND THAT IS NOT A BUG.**
>
> It is produced by `indexReadTime()` in `app/lib/storyIndex.js` — the same
> function the index projection uses, itself a byte-for-byte reimplementation of
> the app's `lib/storyDerived.ts:37`. It counts raw HTML tokens at 220 wpm, so
> markup counts as words: `<p>` is one token, `<a href="…">` is two.
>
> A story page that "corrected" this would disagree with the app's own search,
> profile → myStories and author-list surfaces, which render the index's number,
> on **every** story. Cross-platform parity outranks correctness here. If it is
> ever fixed it is fixed in `storyDerived.ts`, `storyIndex.js`, the Worker mirror
> and this endpoint **in one change**.

`null` on `access:'reader'` is a stated fact, not an omission: that body is an
EPUB this endpoint never opens, so it has nothing to count.

### 4.1 `access: 'full'`

`content` is the **complete story body HTML**, byte-for-byte what
`cms_stories/<slug>/content` holds today. `preview` and `previewOf` are **absent**
— not empty strings. A client that receives `access:'full'` renders `content` and
nothing else.

### 4.2 `access: 'preview'`

`preview` is the cut body: a prefix of the same HTML, closed cleanly, safe to drop
straight into the same prose container. `content` is **absent**.

`previewOf` states the cut in the story's own units — `{ paragraphs: 3, of: 47 }`
— so the client can say "3 of 47 paragraphs" or draw a progress mark without
counting DOM nodes and without knowing the cutter's rules.

**How the preview is cut** (this repo's side, stated so the app can trust its
shape):

**1. The paragraph predicate is the drop-cap tagger's.** The cutter walks the
body's blocks using **the same first-prose walk** as `app/lib/dropcap.js` — its
`DROPCAP_EXCLUDED_SELECTORS` list and its `isFrontmatter` heuristics, extracted
into a shared predicate so the two cannot drift. Front-matter (content notes,
epigraphs, section numerals, `.intro-note`, `.poem-numeral`, blockquotes) is
**carried into the preview but does not count against the budget**. A reader whose
preview is three content warnings and an epigraph has been shown nothing, and a
cutter that counts them has technically honoured its budget while delivering zero
prose. The budget counts *prose* blocks, which is precisely what that predicate
already knows how to find.

**2. The budget is 30% of prose blocks**, rounded up, minimum 1, capped at
`total - 1` so a preview is never silently the whole story.

**3. The one-block advance past dangling connectives.** A 30% cut lands wherever
it lands, and where it lands on a block that does not *finish* — one ending on a
conjunction, a preposition, a comma, a colon, a semicolon, an em dash, an ellipsis
or an unclosed opening quote — the preview stops the reader mid-thought. That is
not a cliffhanger, it is a stutter, and it reads as a bug rather than as an
invitation.

So: if the last included block ends on a dangling connective, **advance by exactly
one block. Once. Never twice.** The single-step rule is the whole discipline here
— a loop that kept advancing until it found a satisfying ending would, on a story
written in long chained sentences, walk most of the way to the end and give the
archive away one comma at a time. One step is enough to turn a stutter into a
stop; if the next block also dangles, the reader gets a slightly awkward break,
which is a far cheaper failure than an unbounded preview.

The advance is capped at `total - 1` like the budget itself.

**4. The hard validation gate on malformed HTML.** The cutter **refuses** to
produce a preview it cannot prove well-formed. It does not patch, it does not
close tags it did not open, it does not fall back to a naive character slice, and
above all **it does not fall back to serving the full body** — a body that fails
validation would otherwise become a paywall bypass, and the worse the HTML the
more reliably it would work.

A body that fails validation returns `500 preview_failed` (§5.5) and is **loud in
the logs**, because it is our bug and there is no reader action that fixes it.
The same validation runs at compose time (the admin cannot save a body that
cannot be previewed) and in an audit script over the existing corpus, so the
endpoint's refusal is the last line of defence rather than the first.

Guarantees the app may rely on:

- `preview` is **well-formed HTML** — every tag opened inside it is closed inside
  it. The cutter never splits a block mid-tag. This is a guarantee and not a
  best-effort: the alternative is the gate above.
- `preview` is a **prefix**, never a summary, never rewritten, never elided with
  an ellipsis the server invented. The words in it are the story's own opening
  words in their own order.
- `preview` is **never empty** on a story that has a body. A story whose entire
  body reads as front-matter still yields its first block rather than nothing.
- `previewOf.paragraphs` counts **prose blocks included**, not total elements, so
  it matches the number the budget was computed against.

### 4.3 How the remainder arrives — **it does not**

**There is no second call, no range request, no delta, and no "unlock" endpoint.**
When a reader becomes entitled — they sign in, buy a day pass, upgrade — the
client **re-calls `POST /api/story` with the same slug** and gets `access:'full'`
with the whole body. It then replaces the preview wholesale.

This was the live design decision and it went the boring way on purpose. A
remainder-delta means the server must guarantee `preview + remainder === content`
byte-for-byte forever; any drift in the cutter, any editorial re-save between the
two calls, and the reader gets a duplicated or missing paragraph *in the middle of
the story*, which is both the least visible failure to us and the most jarring one
to them. A whole-body re-fetch is a few KB gzipped and cannot desynchronise.

So: **`access` is a property of a response, not of a story.** The same slug can
answer `preview` at 10:00 and `full` at 10:01 with nothing about the story having
changed. Do not cache `access`. Do not persist it. Re-ask.

### 4.4 `access: 'reader'` — the carve-out, stated rather than hidden

**READER-MODE IS FLAG-DRIVEN. `readerMode === true || bookReader === true` is the
whole definition.** Reader-mode stories return `access:'reader'` with
`readerHref: "/reader/<slug>"`, **no `content` and no `preview`**.

#### The ruling on `category: 'novel'` (R11.10)

**`category: 'novel'` without a flag — and `category: 'poetry'` with an `epubUrl`
and no flag — is a DATA ERROR, not a supported shape.** Clients must route on the
flags alone and **must not** implement a category fallback.

Measured across all 176 live records before ruling: **zero** carry the category-only
shape, so the ruling breaks nothing. What the data showed instead is the argument
*for* it — four published stories are `readerMode: true` with `category: 'short'`,
so the category has never been the reliable signal and the flag has been doing the
work all along. Against that, the cost of *not* ruling was six call sites in the app
widening to carry a fallback no record needs.

**The server still routes the erroneous shape to `/reader` anyway, and that is not a
contradiction.** It logs `DATA ERROR` with the slug and then answers `'reader'`,
because the alternative — serving a novel as prose, finding no HTML body, returning
`502` — breaks a reader to make a point about a record they did not write. Server
defensiveness is not contract support: absorbed in one place it is a repairable
blip, but implemented on four codebases the shape becomes load-bearing and the
ruling is dead. That is why the fallback belongs *here* and nowhere else.

They are not gated by this endpoint and this endpoint does not pretend to gate
them: their bytes are an EPUB at a **public Firebase Storage download URL** on the
`epubUrl` field. Withholding the HTML while the EPUB is one unauthenticated GET
away is theatre, and shipping theatre as though it were a gate is worse than
shipping neither — it makes us believe a door is shut.

Gating those bodies means moving the EPUB behind a signed URL exactly as
`bookstore/stream.js` already does for `master.epub`, which is its own round with
its own storage-rules change. Ten published stories are in this state today. This
field is how the app finds out, and `readerHref` is where it sends the reader.

### 4.5 `reason` — the vocabulary

`reason` exists so a surface can word itself honestly. "Free this week", "your
Gold membership" and "read the opening" are three different sentences and a single
boolean cannot pick between them.

| `reason`       | with `access` | means                                          |
|----------------|---------------|------------------------------------------------|
| `free_window`  | `full`        | inside the 7-day window; free to everyone       |
| `recent_floor` | `full`        | one of the 5 newest; free regardless of age     |
| `poetry`       | `full`        | poetry, always free (§3.3)                      |
| `tier`         | `full`        | outside every grant; the reader's tier opened it|
| `archive`      | `preview`     | outside every grant, tier `free`                |
| `reader_mode`  | `reader`      | body lives at `readerHref`                      |

`free_window` and `recent_floor` are both "free right now" but they are not the
same sentence to a reader: one has an end date worth naming, the other does not.
`freeUntilMs` is populated on both, but on `recent_floor` it is **in the past** —
the window genuinely has expired and something else is holding the door. A client
that renders "free until {freeUntilMs}" without checking `reason` will print a
date that has already gone.

**The app must tolerate an unknown `reason` string** by falling back to `access`
alone. New reasons will be added; `access` is the closed set, `reason` is not.

#### Platform note: the iOS preview card is non-transactional

Confirmed by the app session (R11.10). On iOS the preview card carries **no
purchase path** — the external Stripe link was stripped for the v1 submission under
App Review guideline 3.1.1, and it is not coming back.

Two consequences worth writing down rather than rediscovering:

- **`reason` is wording, not conversion, on that platform.** The vocabulary above
  still earns its place — "free this week", "poetry is always free" and "your Gold
  membership" are three different true sentences — but on iOS it is choosing how to
  describe a state, not how to sell against it.
- **The `degraded: true` no-upsell rule (§5.4) costs iOS nothing**, because there is
  no upsell there to suppress. It remains a **hard rule for web**, where there is
  one and where it does convert. A rule that is free to obey on one surface is not
  thereby optional on the other.

### 4.6 Caching

The response carries `Cache-Control: private, no-store` **on every path,
including the anonymous preview**. `access` varies by reader and by clock, and one
CDN or service-worker cache hit that serves a member's `full` body to a signed-out
device undoes the whole thing.

`/api/` is already in `PASS_THROUGH_PATHS` in `public/sw.js`, so the site's own
service worker will not cache or replay this. **The app must not add a cache layer
of its own in front of it.** The one form of persistence that *is* sanctioned is
§6, and it is not a cache.

---

## 5. Typed refusals

Every non-`200` carries `{ error, code }` — `error` is a sentence safe to show a
reader, `code` is the machine-readable one. **Branch on `code`, never on `error`.**

| HTTP | `code`                    | when                                                     |
|------|---------------------------|----------------------------------------------------------|
| 400  | `bad_request`             | missing/malformed slug, or a present-but-unparseable body |
| 401  | `signed_out`              | a token was supplied and did not verify                   |
| 404  | `not_found`               | unknown slug, or `published === false` (§3.1)             |
| 405  | `method_not_allowed`      | anything but `POST`                                       |
| 500  | `misconfigured`           | server env incomplete — never the reader's fault          |
| 500  | `preview_failed`          | the body failed the HTML validation gate (§5.5)           |
| 502  | `unavailable`             | the body read failed                                      |
| 503  | `entitlement_unavailable` | the membership read failed (§5.4)                         |

### 5.1 There is no `403`

Deliberate, and load-bearing. Not being entitled is not a refusal here — it is a
`200` with a preview. If you find yourself writing a `403` in this endpoint, the
gate has been modelled wrong.

### 5.2 `401` is only ever a *broken* token

Re-read §1.1. Absent token → `200`, tier `free`. A `401` means "the credential you
sent me is no good" and the only correct client response is to refresh the token
and retry once, then sign the reader out.

### 5.3 `502 unavailable` fails **closed**

If the body read fails, the request fails. It does not fall back to some other
copy of the body, and in particular it never falls back to
`cms_stories/<slug>/content` once §7 has moved it. A read error is
indistinguishable from "no such story", and the safe reading of an unknown state
is to withhold, not to hand over — the same ruling `stream.js` makes at its
purchase read.

### 5.4 `503 entitlement_unavailable` carries the preview anyway

The one genuinely awkward case: the story is fine, but the membership read failed,
so we do not know whether this reader is entitled.

Both obvious answers are wrong. Assume free and a paying member is shown a paywall
they already paid to be rid of. Assume entitled and one flaky RTDB read hands the
archive to everyone.

So the response is `503` **with `preview` and `previewOf` populated and
`degraded: true`**. The reader sees the opening rather than an error page; the
client shows a retry rather than an upgrade prompt. **A client must never render
an upsell on a `degraded` response** — we do not sell a membership to someone who
may already have one, on the strength of a read we know failed.

`degraded` is `false` on every other response, always present, so branching on it
needs no existence check.

### 5.5 `500 preview_failed` never falls back to the body

The validation gate (§4.2 rule 4) found HTML it cannot cut into a provably
well-formed prefix. The request fails.

**The tempting fallbacks are all wrong, and one of them is dangerous.** Emitting a
best-effort cut breaks §4.2's well-formedness guarantee, which the client renders
straight into a prose container with `dangerouslySetInnerHTML` — unbalanced tags
there do not stay inside the story. Emitting a naive character slice cuts
mid-word and mid-tag. And **serving the full body because the preview failed turns
malformed HTML into a paywall bypass**: the worse the markup, the more reliably it
would open the archive, which is precisely backwards.

So the endpoint refuses, logs loudly with the slug, and the story is broken until
someone fixes its HTML. That is the correct amount of pain — it is an editorial
defect with an editorial fix, and it should be visible to us rather than quietly
absorbed. The compose-time gate and the corpus audit exist so this path is never
reached in practice.

A reader who is **entitled** never sees this: entitlement is decided before the
cutter runs, and `access:'full'` does not cut anything. `preview_failed` can only
reach a reader who was going to be shown a preview.

---

## 6. Saved copies persist. Forever. This endpoint has no say in it

**The confiscation ruling extends to gating.**

The precedent is `app/lib/shelf.js` and the popover in
`app/components/SaveForOffline.js`: when a day pass lapses and a reader is left
holding twenty saved stories on a shelf that now holds two, **nothing is
removed**. They are told the truth — "kept from when your pass was live. Nothing
has been removed" — and the stories stay readable.

The same applies here, and it is a *contract term*, not an implementation detail:

- A story body already written to the device's IndexedDB shelf **stays readable
  with no signal and no entitlement check, permanently**, including after it
  falls out of the free window and including after a membership lapses.
- **The app must not call this endpoint to revalidate a saved copy.** Not on open,
  not on a schedule, not on reconnect.
- **This endpoint will never return an expiry, a lease, a TTL or a revocation for
  a saved body**, and no such field will be added. If you are looking for one, it
  is not missing — it is refused.
- Saving is a normal `access:'full'` response written to disk by the client. A
  reader can only save what they could read at the time they saved it, which is
  the whole of the enforcement.

The promise the save button makes is *"Saved to this device. It stays readable
with no signal."* A gate that reaches onto someone's device and takes back
something they were entitled to when they took it is not a gate, it is a
confiscation, and we already ruled against it once.

---

## 7. Transition semantics — old app versions still reading the node

Today `cms_stories` is `.read: true` and every story body is in it, in two fields:
`content` (the HTML) and `extractedText` (the EPUB plain text). Deployed app
versions read that node directly. **They cannot be updated retroactively and some
of them will never be updated at all.**

The bodies move to a new node, `story_bodies/<slug>`, with `.read: false` — read
only by admin-token server code. That move happens in three phases and **the order
is not negotiable.**

### Phase T1 — dual-write. The node keeps its bodies

- `story_bodies/<slug>` is created and populated: `{ content, extractedText }`.
- `cms_stories/<slug>/content` and `/extractedText` **stay exactly as they are**.
- The composer, and every path that writes a body, writes **both** in one atomic
  multi-path update — the same discipline `indexUpdatePaths()` already enforces
  for the index. A body that lands in one node and not the other is the failure
  this phase exists to avoid.
- `/api/story` ships and serves from `story_bodies`.
- **The RTDB node is not gated for anybody.** A new app calling `/api/story` gets
  a correct `access`; an old app reading the node gets the whole body ungated.

That gap is **accepted and time-boxed, not overlooked.** There is no way to gate an
already-deployed client that reads a public node, and pretending otherwise would
mean cutting the node before the new app ships and blanking every story on every
old install.

#### The web reading path in T1 — ONE statement, and it is the whole of it

**T1 says nothing about whether the web story page gates its readers. That is
§7.3's decision, taken once, per surface, deliberately.** T1 moves bodies and ships
an endpoint; it does not change what a reader sees.

> **An earlier version of this section said "Gating is not live for anybody" and
> then, in §7.1, put the preview-only static render in this same phase. Both were
> implemented. They contradict each other, and R11.9 shipped the contradiction: on
> 2026-08-08 a signed-out reader on the web got a truncated body, "The rest of this
> story is in the archive." and a SEE MEMBERSHIP button on 130 stories, for roughly
> 4h50m, during a contest that pays out on 1 September.**
>
> The sentence was never false — it was **scoped to old app installs reading
> `cms_stories` directly** and silently true only of them. The web story page is a
> client too, and the one client T1 also changed to stop reading the node's body.
> A phase-level claim of the form "not live for anybody" must therefore either name
> every surface or not be made. This document now does not make it.

The rule that replaces it, and it holds for every phase:

**NO PHASE TURNS A GATE ON AS A SIDE EFFECT.** A change to what a reader sees is
its own step, named as such, in §7.3 — never a consequence of a step whose stated
purpose was to be invisible to readers.

### Phase T2 — the app ships and takes up

The app session ships the `/api/story` client. Adoption is watched via the
`client`/`clientVersion` telemetry from §1.3. **This repo does not proceed to T3
on a schedule; it proceeds on a number.**

### Phase T3 — the cut. `content` becomes a tombstone, not an absence

When the node's bodies are withdrawn:

- `cms_stories/<slug>/extractedText` is **deleted**.
- `cms_stories/<slug>/content` is **replaced with a tombstone**, never deleted:

```html
<p>This story now opens in the latest version of Story Island. Please update the
app to keep reading.</p>
```

**This is the single most important line in this section.** An old app reads
`content` and renders it. If the field is deleted, that app renders a story page
with a title, a cover, an author — and no words. The reader concludes the app is
broken, or that we lost their story. If the field is a sentence, they read the
sentence and know what to do. We cannot ship code to those installs; the only
thing we can still put in front of those readers is the string in this field, so
it has to be a string worth reading.

- Alongside it, two machine-readable fields so a client that *does* know better
  never mistakes the tombstone for prose:
  - `bodyMoved: true`
  - `bodyEndpoint: "/api/story"`

- **A client that understands `bodyMoved` must ignore `content` entirely.** Not
  render it, not fall back to it, not show it while the fetch is in flight. It is
  a message for clients that cannot read this document, and rendering it on a
  client that can would flash "please update the app" at a reader who is already
  up to date.

- `database.rules.json` is *not* tightened on `cms_stories` in this phase — the
  node stays `.read: true` because everything else on it (title, cover, author,
  date, category) is public and every list surface depends on it. What changes is
  what is *in* it.

### 7.1 The second door, which is in this repo and not in the app

`app/stories/[slug]/page.js` fetches the whole `cms_stories` node at build time
and **inlines each story's prose into its static HTML**. Gating the RTDB node
while `view-source` still hands over the words is theatre of the §4.4 kind.

The fix, **when the web gate is turned on**: the static HTML carries the preview,
never the body. The preview is public by definition, first paint still arrives with
real words and no round-trip, and the full body comes from `/api/story` after
hydration. This is stated in an app-facing document because it is the reason the
app should expect the *web* story page to behave identically to its own — same
endpoint, same `access`, same re-fetch on upgrade.

**This is not a T1 step.** An earlier version of this section put it "in the same
phase as T1", which contradicted T1's own text and is what shipped the 2026-08-08
paywall. It belongs to §7.3, and it is the *second half* of that switch, not a
separate decision:

> **BOTH HALVES OF THE WEB GATE FLIP TOGETHER, OR NEITHER DOES.** The endpoint's
> half is decided per request; the build's half is **baked into static HTML at
> build time**. That asymmetry has two consequences and both are load-bearing:
>
> - **No request-time toggle can reach the build's half.** An environment variable
>   or a dashboard switch cannot un-bake deployed HTML. The switch has to be a
>   value the build itself reads — today `GATING_ENABLED` in
>   `app/lib/storyAccess.js`, which the endpoint and `app/stories/[slug]/page.js`
>   both import. Do not replace it with config that only the Worker can see.
> - **Half-on is worse than either state.** Preview baked in with the endpoint
>   serving full bodies gives every reader a flash of paywall on a site that has
>   none, and gives a reader without JavaScript nothing but the preview, forever.
>   Full bodies baked in with the endpoint gating is the leak §4.4 refuses.

### 7.2 The quiz endpoints move in the same phase

`functions/api/generate-quiz.js` and `functions/api/evaluate-quiz.js` both read
the body today with an **unauthenticated** `fetch()` against
`cms_stories/<slug>.json`, relying on the public read. Both move to
admin-token reads of `story_bodies/<slug>` in phase T1, alongside the endpoint —
not after it. `generate-quiz.js` reads `extractedText` for reader-mode stories and
`content` otherwise, and both fields move together, so both call sites move
together.

Quiz generation is **not** gated by the reader's tier: a quiz is about a story the
reader has, by definition, just read. The move is about closing the public read,
not about adding a second gate.

### 7.3 Turning the reader-visible gate on — its own step, per surface

**This step has never been taken.** As of R11.11 `GATING_ENABLED = false` and no
reader on any surface is gated. That is the deliberate state, not an unfinished one.

Taking it requires, in order:

1. A decision **per surface** — web, iOS, Android — recorded here with its date.
   The surfaces do not have to flip together and there is no reason to assume they
   should; the app's adoption number (§7 T2) governs the app, and nothing about
   web reading depends on it.
2. Both halves of the web switch flipped in one change (§7.1).
3. The §7.4 check run against production, asserting the gate is present **on
   purpose** — the same command that proves it absent proves it present.
4. A stated rollback: the switch is one constant, so the rollback is one edit and
   one deploy. Roughly five minutes, measured on the R11.11 deploy.

### 7.4 The standing verification term — every round that touches the reading path

**Any round that changes the reading path ends with a signed-out fetch of a real
story page on production, asserting the story's closing sentence is present or
absent as intended.** Not a local build, not a unit test, not a code review: the
deployed page, fetched with no credential, the way a reader gets it.

This term exists because the round that shipped the 2026-08-08 paywall *did* verify
its own work — its commit message reads "Verified over all 162 built pages: zero
carry their story's ending" — and filed a working paywall under "closing a door".
Every check it ran passed. None of them asked what a reader sees.

The reading path means, at minimum: `/api/story`, `app/stories/[slug]/page.js`,
`app/stories/[slug]/page-client.js`, `app/components/StoryGate.js`,
`app/lib/storyAccess.js`, `app/lib/previewCut.js`.

Two commands. Pick a story **older than `FREE_WINDOW_DAYS` and not on the
most-recent-5 floor** — a story inside the free window passes whether the gate
works or not, which is the one way to run this check and learn nothing:

```sh
# 1. the endpoint, signed out. `reason` is the tell.
curl -s -X POST https://calvaryscribblings.co.uk/api/story \
  -H 'content-type: application/json' -d '{"slug":"<old-slug>"}' \
  | head -c 400

# 2. the static page, signed out — this is the half a JS-less reader gets,
#    and the half no unit test covers.
curl -s https://calvaryscribblings.co.uk/stories/<old-slug> \
  | grep -c 'The rest of this story is in the archive'
```

Expected with the gate **off**: `"access":"full","reason":"gating_off"`, a
full-length `content`, and `0` from the grep. Expected with it **on**:
`"access":"preview","reason":"archive"`, a short `content`, and `1`.

`reason` is what makes this worth running: `gating_off` cannot appear unless the
switch is actually deployed, so it distinguishes "the gate is off" from "my change
did not deploy" — which a body-length check alone cannot do.

Record the output in the round's commit message. `scripts/incident-quiz-impact.mjs`
is the companion for the other question — whether a gate that *was* live changed
what readers did — and it is read-only.

---

## 8. What the index carries

`cms_stories_index` (see the contract block at the top of `app/lib/storyIndex.js`,
which this section is subordinate to) gains two projected fields:

**ONE new field: `publishedAtMs`** — number, §2.

It is **presentation-only for clients** (§2.1) but **load-bearing for the server**,
which is new and worth stating plainly: the most-recent-5 floor (§3.2) is resolved
by an ordered query on this field. It is the one index field whose absence breaks
entitlement rather than cosmetics, and `"publishedAtMs"` must join `.indexOn` on
`cms_stories_index` in `database.rules.json` or that query is refused outright.

**There is deliberately no `gated` field, and an earlier draft of this section was
wrong to specify one.** It proposed a stored boolean, then had to spend a paragraph
explaining that it would be stale for most of a story's life — the index is
editorially immutable, rewritten only on publish/edit/unpublish/delete, so a story
that crosses the window boundary tomorrow never gets a fresh record.

That staleness was self-inflicted. Once `FREE_WINDOW_MS` lives in
`app/lib/storyAccess.js` (§3.1) a library card can compute the badge from
`publishedAtMs` at render time and it is never stale. A stored copy would have
meant a third writer to keep in step — including the dashboard-managed Worker — to
carry a value that is one subtraction away from a field already present.

The rule that survives is the one that mattered: **a lock icon is a badge, never a
decision.** Compute it for the card if you like. Only `access` from a live
`/api/story` response decides what is rendered.

The index rules from `storyIndex.js` apply unchanged and are worth restating
because this change touches the projection: **anything writing to the index must
write a complete projected record** via `buildIndexRecord()` / `indexUpdatePaths()`,
never a partial deep path, and **the external `calvary-newsletter` Worker's mirror
must gain both fields in the same change** or scheduled-publish will start writing
records that lack them.

---

## 9. The client checklist

For the app session, in one place:

- [ ] `POST /api/story`, `Authorization: Bearer` header, `{ slug }` body.
- [ ] Send `client`, `clientVersion`, `updateId` and `runtime`. They cost nothing
      and they are how we learn when T3 is safe — `updateId` especially, since an
      OTA fleet makes `clientVersion` unable to tell an updated bundle from a
      stale one. §1.3.
- [ ] Render `readTimeMinutes` from the response. **Stop computing it from the
      body you hold** — that understates on a preview and reads "1 min" on a
      tombstone. §4.0b.
- [ ] Route reader-mode on the FLAGS (`readerMode`/`bookReader`). Do not add a
      `category: 'novel'` fallback; the server absorbs that shape. §4.4.
- [ ] Branch on `access` (closed set: `full` | `preview` | `reader`). Tolerate an
      unknown `reason`.
- [ ] **Do not print `freeUntilMs` as "free until …" without checking `reason`.**
      On `recent_floor` and `poetry` it is in the past. §4.5.
- [ ] Poetry is always `full`. Do not build an upsell path that can appear on it.
- [ ] `access:'reader'` → navigate to `readerHref`. Do not try to render a body.
- [ ] On entitlement change (sign-in, pass purchase, upgrade) → **re-call with the
      same slug**. There is no unlock call. §4.3.
- [ ] Never cache or persist `access`. Never cache the response. §4.6.
- [ ] Never compute the window client-side. Render `freeUntilMs`, don't reason
      from it. §2.1.
- [ ] `401` → refresh token, retry once, then sign out. **No token at all is not a
      `401`** and must not be treated as one. §5.2.
- [ ] `degraded: true` → show the preview and a retry. **Never an upsell.** §5.4.
- [ ] Saved bodies: never revalidate, never expire, never remove. §6.
- [ ] After T3: if `bodyMoved` is `true` on a `cms_stories` record, ignore
      `content` completely. §7.
