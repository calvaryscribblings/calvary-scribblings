# The Series — what it is, and the four things it carries

Built 16 August 2026. This document is the contract; the code is the implementation. Where
they disagree, one of them is a bug and this file says which.

## The shape

A **series** is a parent record. An **instalment** is a child. The word is *instalment* —
British single-L — everywhere: field names, log lines, card badges, row labels, refusal copy.
Nothing in this codebase says "episode". The membership copy deck said it once, in its October
entry, and was corrected in the same round that shipped the schema.

Every instalment is **its own separate, complete EPUB file** — not a chapter inside one growing
book. That is what lets the existing Reading Room open one with no changes: a complete EPUB is
exactly what it already opens. It is also why the position pin is per-instalment (see §4).

```
series/{seriesId}                       public   slug, title, synopsis, coverUrl (poster), status
series_instalments/{instalmentId}       public   seriesId, ordinal, releaseAtMs, freeForGold, status
series_instalments_detail/{id}          GATED    title, synopsis, author/authorUid/authorHandle,
                                                 coverUrl, epubPath
series_reading_progress/{uid}/{id}      owner    fraction, updatedAt, cfi?, epubVersion?
series_epubs/{id}/master.epub           read:false
```

`instalmentId` is `<seriesSlug>-i<ordinal>` and is flat rather than nested, because the release
rule looks the row up from the detail node's own path and cannot reach a seriesId buried in the
key.

**There is no `instalmentCount`.** The count a reader needs is "released so far", which changes
at a moment nothing writes to the database, so no stored integer can express it. It is derived
by `releasedCount()` on every read. The bookstore's `titlesCount` was examined as a model and
rejected: it increments on create and never decrements, because `deleteTitle()` is a soft
status change.

## The two gates, in order

**1. Has it released?** `releaseAtMs` vs `now`. Answered for everyone — Free, Gold, Platinum,
signed out, admin. **2. May you read it?** Subscription tier.

The order is load-bearing and is enforced in three places (`grantForInstalment()`, the
endpoint, the client). A Platinum member asking for next month's instalment is told *"not
yet"*, never *"not for you"*. It also closes a leak: if tier ran first, the pair of answers a
prober could collect would map the unreleased schedule.

Release is enforced **twice, on the same clock**:

- `database.rules.json` denies `series_instalments_detail/{id}` until
  `root.child('series_instalments').child($id).child('releaseAtMs').val() <= now`. This is the
  RTDB server clock. Nothing has to run at midnight and nothing can forget to.
- `functions/api/series/stream.js` re-checks before signing anything.

This is why `releaseAtMs` is **epoch milliseconds** and named for it. A rules expression can
compare a number to `now`; it cannot parse a date string. This codebase has shipped the
string-vs-clock mistake twice — `activePass().expiresAt` and `publishedAtMsFor()` both carry the
scar in their comments — and both times the failure was silent.

Neither `cms_stories` nor `bookstore_titles` could host this. Both are `.read: true`: an
unpublished story record is fully readable by anyone with curl (182 keys on the node against
168 in the index — fourteen unpublished records are public right now), and the bookstore
protects only `master.epub`, not the metadata around it.

## The £1 day pass is excluded, deliberately and by construction

`app/lib/membershipPasses.js` sets `PASS_TIER = 'gold'`. `effectiveTier()` folds an active pass
into **the same string** a real Gold membership produces — correct for every other gate on the
platform, and wrong for this one.

A gate written the obvious way — `tierAtLeast(effectiveTier(...), 'gold')` — would hand every
`freeForGold` instalment of **every series** to anyone holding a £1 day pass, for twenty-four
hours, and nothing in the code would look wrong.

So the Series compares against the **subscription** tier: `normaliseTier(users/{uid}/membership)`
on the server, `membership.subscriptionTier` on the client. `effectiveTier` is passed alongside
for exactly one purpose — wording the refusal, so a pass-holder who would otherwise have
qualified reads *"Day and week passes do not include the Series"* rather than a generic line.

`effectiveTier()`'s own docstring says to revisit its device-clock caveat "the day a tier gates
something that costs us money to serve". This is that day, and the answer is that the Series
never reads a pass at all.

## The four carried items

### 1. Account deletion — closed, and here is why

R11.23 confirmed the Story Island app's client-side `bookstore_purchases/{uid} = null` is
**denied** by the rules in all three spellings, so the app cannot wipe it. The question was
whether the Series inherits that.

**It does not, and the reason is a design choice worth keeping.** The Series stores **no
per-reader entitlement state**. There is no "unlocked instalments" node, no grant record, no
purchase row — entitlement is *derived* from the membership on every request and never
materialised. So there is nothing new for account deletion to fail to wipe.

The one per-reader node it does create, `series_reading_progress/{uid}`, is
`.write: "auth != null && auth.uid == $uid"` at the `$uid` level — the same rule as
`bookstore_reading_progress`, which the app already wipes successfully. A node-level null write
is permitted (`.validate` does not run on a null), so `set(series_reading_progress/{uid}, null)`
works from the client today.

**If a future round adds any admin-written per-reader Series node, this paragraph stops being
true** and that round owes an admin-token wipe path, not a client attempt in a try/catch.

### 2. `GATING_ENABLED` does not cover this surface

Stated in `app/lib/storyAccess.js` beside the constant itself, because that is where the
contradiction would otherwise sit. The switch's contract reads "FALSE = NO STORY IS EVER GATED,
FOR ANYONE"; the Series is a gated thing to which that sentence does not apply.

The two switches would mean opposite things. `GATING_ENABLED` exists to **undo an accident** —
R11.9 paywalled 130 archive stories nobody had decided to paywall, and false restores a state
the site had always been in. There is no such state for the Series: it has never been ungated,
and "turn it off" would give away a Platinum benefit irrecoverably, because the bytes leave the
bucket. The mechanics differ too: `GATING_ENABLED` must be a compile-time constant because one
half of what it governs is the static build; the Series gate has no static half at all.

If the Series ever needs a kill switch it gets its own, with its own written reason.

### 3. A lapsed member reads to the end of the TTL. Accepted.

The signed URL lives 300 seconds and entitlement is checked once, when it is minted. A member
whose subscription lapses ten seconds later can still fetch for the remaining 290. The
alternative is a proxy re-checking per byte range, which would put a Worker in the path of
every page turn of every book on the site to close a five-minute window. Nothing durable is
handed over.

### 4. Downgrades fail open. Also accepted, also not a bug.

`functions/api/membership/_membership.js` reuses `classifyRevocation()`: when a cancellation
cannot be matched to the stored subscription, **nothing is written** and a human is told — "the
cheaper error". The consequence here is that a *failed* downgrade over-grants the Series rather
than under-granting it. That is the platform's posture, inherited on purpose. The first person
to notice a lapsed member still reading should file it as this trade-off, not as a hole.

## Cross-repo: offline entitlement re-check — NOT this repo's call

**On the web there is nothing to decide.** `app/lib/shelf.js` sets
`CAPS.book = { free: 0, gold: 0, platinum: 0 }` and states why: *"THERE IS NO WEB BOOK SHELF TO
CAP… nothing durable lands in the browser."* An instalment is streaming-only on the web, so the
"never evict" ruling never engages.

**In the Story Island app it does.** The app downloads the EPUB to disk and caches it keyed by
`version` (the Cloud Storage generation). A member who lapses keeps that file. Whether the app
re-checks entitlement when opening an already-cached instalment is **the app's decision**, and
this repo can neither make nor enforce it.

Filed alongside the existing **Foliate pin-parity** thread as a standing cross-repo item. Note
for whoever picks it up: `shelf.js:70-97` already rules that saves made under a *£1 day pass*
persist after it expires — so the platform's precedent for *revocable entitlement expires,
content stays* exists and points one way. That is a precedent, not a decision, and the app
holds the pen.
