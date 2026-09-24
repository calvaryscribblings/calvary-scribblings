# The one paste Ikenna owes the live Worker — `publishedAtMs`

> **DONE, 24 Sep 2026 (W3 step 0).** The Worker was deployed from the mirror with wrangler, byte-identical
> (version `a2646c98`). Nothing below is owed any more; it is kept as the record of why.

**Worker:** `calvary-newsletter` — the Cloudflare Worker that runs the scheduled-publish cron.
**Where:** Cloudflare dashboard → Workers & Pages → `calvary-newsletter` → Edit code.
**Repo mirror (already correct, for reference):** `workers-external/calvary-newsletter.worker.js`

---

## Why this one, and why the reconciler does not make it optional

The reconciler (`.github/workflows/index-reconcile.yml`) repairs a drifted index record within
about fifteen minutes. For `opening` that is fine — a search result briefly missing a line.

**For `publishedAtMs` it is fifteen minutes of wrong entitlement, every time a story publishes,
once `GATING_ENABLED` is switched back on.**

And the failure runs backwards from what anyone expects. A record with **no** `publishedAtMs` is
**invisible** to `orderBy="publishedAtMs"` — Firebase does not return nodes missing the ordered
key in the tail of a `limitToLast` query. The free floor is *"the five newest gateable stories
are always free"*, so a newly published story with no `publishedAtMs` cannot take a slot:

- **the newest story is gated** — the one that should most certainly be free
- **an older story keeps a free slot** it should have just lost

Silently. Nothing errors; the query succeeds and returns five slugs. They are the wrong five.

So this gets closed **at source**. The reconciler is the net, not the fix.

---

## Step 1 — add this function, if it is not already there

Paste it above `buildIndexRecordMirror`:

```js
// publishedAtMsMirror — mirrors app/lib/storyAccess.js:publishedAtMsFor.
//
//   ⚠ THIS ONE IS NOT COSMETIC. Every other field in the projection decides how a card
//   LOOKS. This one decides whether a reader can READ the story: the story-serving endpoint
//   resolves the most-recent-5 free floor with an ordered query on
//   cms_stories_index.publishedAtMs, so a scheduled publish that omits it writes a record the
//   floor cannot see. See STORY-SERVING-CONTRACT.md §3.2, §8.
//
//   Epoch MILLISECONDS, UTC, a NUMBER — never an ISO string, which would compare against a
//   clock as a string and never expire. publishAt wins over the display date because it is the
//   real publication moment written by code rather than typed by a person; a dayless
//   "Jan 2026" takes the 1st, the earliest day it can mean; anything unreadable is null and is
//   NOT guessed at.
//
//   Date.UTC, never new Date(str) — the latter parses in the runtime's LOCAL zone, and this
//   Worker's zone is whatever Cloudflare picked.
function publishedAtMsMirror(story) {
  const s = story || {};
  if (typeof s.publishAt === "string" && s.publishAt) {
    const t = Date.parse(s.publishAt);
    if (Number.isFinite(t)) return t;
  }
  const str = String(s.date || "").trim();
  if (!str) return null;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = (w) => MONTHS.indexOf(String(w || "").toLowerCase().slice(0, 3));
  let m = /^([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s+(\d{4})$/.exec(str);
  if (m) {
    const i = mi(m[1]); const d = Number(m[2]);
    return i >= 0 && d >= 1 && d <= 31 ? Date.UTC(Number(m[3]), i, d) : null;
  }
  m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(str);
  if (m) { const i = mi(m[1]); return i >= 0 ? Date.UTC(Number(m[2]), i, 1) : null; }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
```

## Step 2 — add the one line to the projection

Inside `buildIndexRecordMirror`, in the `const rec = { … }` literal, immediately after
`readTime:`:

```js
    publishedAtMs: publishedAtMsMirror(s),
```

That is the whole change. **One function and one line.**

---

## Step 3 — how to know it worked

The next scheduled publish writes a **21-key** record instead of 19. To check without waiting:

```
node scripts/audit-stories-index.mjs
```

Its `SCHEDULED-PUBLISH INTEGRITY` section names any due, live scheduled story with an
incomplete record. It should stay at:

```
  ✓ every due, live scheduled story has a complete index record
```

---

## What you do **not** need to paste — and this is the point of the reconciler

**`opening` never goes into the Worker.** Carrying it would mean hand-copying `parseBlocks()`
from `app/lib/htmlBlocks.js` and `walkToProse()` from `app/lib/prosePredicate.js` — about two
hundred lines across two modules — into a file edited in a web dashboard. The opening line and
the drop cap **must** pick the same paragraph, and two hand-copies of one predicate is precisely
how they stop agreeing. The reconciler fills it in instead.

**Nor does any future field.** The reconciler re-projects the whole record through the real
`buildIndexRecord`, so anything added to the projection lands on scheduled publishes with no
dashboard edit at all.

`publishedAtMs` is the exception only because its fifteen-minute window is an entitlement
window rather than a cosmetic one.
