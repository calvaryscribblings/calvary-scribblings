# Continue Reading: what this repo promises

> Written in CR-2 (28 Nov 2026). Design approved 24 Nov 2026; CR-1's recon and all its suggested
> rulings approved 28 Nov 2026.

The web built Continue Reading in CR-2: a row under the hero on `/public-library` of the pieces a
signed-in reader has started and not finished, each card opening the piece where they stopped.
This file is everything Story Island needs to **write the same records and read the same row**, so
a reader who starts a story on one picks it up on the other. The records and their rules live in
this repo (`app/lib/continueReading/schema.js`, generated into `database.rules.json` by
`scripts/continue-reading/write-rules.mjs`); the app owns its own screens.

**Nothing in this file is a key, a secret, story text or a reader's details, and nothing added to
it ever may be.**

---

## 1. The rulings (28 Nov 2026)

1. Tapping a card opens the piece where the reader stopped: **straight there, no animation**. Only
   from the card: any other visit opens a story at its top, as before.
2. A story counts as **started** once a visit passes the read-count thresholds (**12 seconds** of
   foreground dwell **or 25%** of the way through), whether or not the read was already counted. It
   is **finished** at the existing end-of-story marker.
3. An instalment whose reader's membership has lapsed (`tier_too_low`) gets the **same lock and
   "Members"** as an archived story.
4. An instalment with no cover of its own shows its **series poster**.
5. After a ✕, a **later saved position brings the card back**.
6. The kind line uses the push notifications' form names (`scripts/push/forms.mjs`, the table
   `app/lib/bell.js` already shares). Imported, never copied.
7. No word count. No minutes line other than the card's "minutes left". Unpublished, hidden or
   retired pieces **drop off silently**.
8. A **new node** with a strict shape. The app's `userProgress` is left alone.
9. The row sits **under the hero, below the first screen**.

## 2. The records

```
reading_position/{uid}/stories/{slug}
  = { fraction, updatedAt }
  fraction    a number, 0 ≤ fraction ≤ 1: the reading thread's measure (§3)
  updatedAt   the SERVER's time: write ServerValue.TIMESTAMP; a client number is refused

reading_position/{uid}/hidden/stories/{slug}       = the server's time of the ✕
reading_position/{uid}/hidden/instalments/{id}     = the server's time of the ✕

read/write: that reader only (founders included: a founder cannot read anyone else's)
slug:       app/lib/ids.js's slug (lowercase a–z 0–9 words joined by single hyphens, ≤ 128)
            AND it must exist in cms_stories_index
id:         /^[A-Za-z0-9_-]{1,128}$/ AND it must exist in series_instalments
$other:     false at every level: under the uid, under hidden, inside a record
removal:    always allowed to the owner, even for a story that has since left the index
```

**An instalment's position is NOT here.** It stays where the Series reader already writes it:
`series_reading_progress/{uid}/{id}` (`{ fraction, updatedAt, cfi?, epubVersion? }`) and
`series_finished/{uid}/{id}`. Nothing new is written for instalments except the ✕.

**Deletion.** `reading_position` is in `OWNED_NODES` (`functions/api/account/_deletion.js`):
deleted whole with the account. `tests/account/deletion.test.mjs` holds it there.

## 3. Writing a story's position (the story page)

- **Signed in only.** Nothing when signed out, nothing on a proof, and nothing while the page shows
  the archive **preview** (its fraction is not a place in the story, and its end is not the
  story's end).
- **The fraction is the reading thread's own measure**, clamped 0..1: 0 when the article's top
  meets the viewport's top, 1 when the article's bottom meets the viewport's bottom
  (`threadFraction` in `app/lib/continueReading/model.js`). Story Island should measure the same
  thing over its own story view: how far through the scrollable range of the story body.
- **The first write** happens once the visit passes the thresholds (12 s foreground or 25%).
- **After that**, only when the fraction has moved **0.02 or more** AND **15 seconds** have passed
  since the last write.
- **Plus one best-effort write** when the view is hidden or closed (any change at all).
- **At the end-of-story marker, remove the record.** Not kept at 100%. Nothing more is written in
  that visit. "At the marker" means reached **or passed**: one fast fling can carry the marker from
  below the screen to above it between two frames, and a visibility observer never sees it at all
  (the web found this in CR-2's own test). The web checks the marker's position on every scroll as
  well as observing it.
- **A refused write fails quietly.** The reader sees nothing.

## 4. Resuming

- A card opens a story at `/stories/{slug}#continue-reading`. A **hash**, never a query string, so
  caching and canonicals are untouched. The page removes it from the address at once.
- Once the reader is known and the body has settled (the gated body has answered, fonts are in,
  layout has run), the page reads its own record once and jumps to the saved place **instantly**.
- An instalment's open card goes to `/series/read/{id}`; the Series reader already resumes from
  `series_reading_progress`.

## 5. The row: what to read and how to merge

1. Read `reading_position/{uid}`, `series_reading_progress/{uid}` and `series_finished/{uid}`.
2. **Merge**: every story position and every instalment progress record.
   - Drop a **finished** instalment (`series_finished/{uid}/{id}` exists).
   - Drop a **hidden** entry: hidden at **or after** its position's `updatedAt`. A position saved
     after the ✕ brings the card back. (An instalment's `updatedAt` is the Series reader's own,
     client-clocked; the comparison is the same.)
3. Sort by `updatedAt`, **newest first**.
4. **Resolve**, keeping the first **10** that survive:
   - A story is a card only while it is in `cms_stories_index` (live, not hidden, not retired).
     Its title, writer, cover, category, subcategory and `readTime` come from the index.
   - An instalment needs at most three reads: `series_instalments/{id}`,
     `series_instalments_detail/{id}` (refused before release: treat as absent) and
     `series/{seriesId}`. It is a card only when the row and the series are `published` and its
     access (§6) is open or locked. Anything else drops silently.

## 6. Access

- **Story**: `grantFor(story, { tier: effectiveTier })` (`app/lib/storyAccess.js`). `full` → open
  (the minutes). `preview` → **locked**: the lock and "Members", and the card still links to
  `/stories/{slug}` (without the hash).
- **Instalment**: `grantForInstalment(row, { subscriptionTier, effectiveTier, signedIn: true })`
  (`app/lib/series/access.js`). `granted` → open. `tier_too_low` (and its pass twin,
  `pass_excluded`) → **locked**, linking to `/series/instalment/{id}`. Anything else
  (`not_released`) → no card.
- The web draws nothing until the membership has settled, so a card never flashes a lock it
  doesn't have.

## 7. The card, as drawn

| part | value |
|---|---|
| card | 300 × 146, radius 12, background `rgba(107,47,173,0.08)`, border 1px `rgba(107,47,173,0.28)`, shadow `0 4px 20px rgba(107,47,173,0.15)` |
| cover | 96 × 144 (2:3), flush to the card's left edge. Story: the index cover. Instalment: its own `coverUrl`, else the series poster |
| text block | padded 14 top and bottom, 16 at the sides |
| kind line | Cinzel 8px, letter-spacing 0.2em, uppercase, `#c9a84c`, 6px below it. Story: the form name (`formFor(category, subcategory)`). Instalment: "The Series · Instalment {ordinal}", and the **series name is the title** |
| title | Cormorant Garamond 600, 17px, line-height 1.15, `#f5f0e8`, two lines at most |
| writer | 10.4px, 0.08em, uppercase, `rgba(245,240,232,0.7)`, 4px below the title |
| minutes | Cormorant italic 12.5px, `rgba(245,240,232,0.55)`, 3px below the writer: "N minutes left", "1 minute left". Story: index `readTime` × (1 − fraction). Instalment: `readingMinutes(wordCount)` × (1 − fraction). Rounded up, at least 1 |
| locked | in place of the minutes: a gold lock (9 × 10) and "Members" in Cinzel 7.5px, 0.16em, uppercase, `#c9a84c`, 5px gap, 5px below the writer |
| progress | My Library's bar (`app/components/ReadingBar.js`), pinned to the card's foot so every bar in the row sits level: a 12px row, 7px gap, the percentage **floored** (`barFor`) |
| hover | border `rgba(107,47,173,0.6)`; a 28px round ✕ 8px from the card's outer edge, top and right, counting the 1px border (border 1px `rgba(245,240,232,0.25)`, background `rgba(10,10,10,0.7)`, a 10px cross at stroke 1.3, `#f5f0e8`) |
| ✕ | a real button beside the card's link, labelled "Remove {title} from Continue Reading"; shown on keyboard focus; **always shown on touch screens**. It writes the hidden entry with the server's time |
| row | Just Added's header, side margins, 14px gap and horizontal scroll. Kicker "Where you left off", title "Continue Reading". No skeleton, no reserved space: nothing at all until there is a card |

## 8. What the app needs to do

1. Write `reading_position/{uid}/stories/{slug}` from its story view by §3, with
   `ServerValue.TIMESTAMP`, and remove it at its own end-of-story moment.
2. Read and merge by §5, and draw §6–§7 in its own components.
3. Write the ✕ to `reading_position/{uid}/hidden/{stories|instalments}/{id}` with
   `ServerValue.TIMESTAMP`.
4. Leave `userProgress` alone; nothing here reads or replaces it.
5. Rules are live only once the go round deploys them. A write before then is refused; fail
   quietly, as the web does.
