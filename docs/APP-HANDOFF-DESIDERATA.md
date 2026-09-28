# Hand-off to the app repo: Desiderata (W22, 27 Sep 2026) — for round A24

The web shipped Ikenna's rulings 74–81 and 88 of 27 Sept: a bar on the shop's head (wordmark left,
Search and Desiderata right), a readers line with a **+** under every shelf book, the same **+** on
the book's page, and two rooms, `/bookstore/search` and `/bookstore/desiderata`. This is what the
app needs to build the same list against the same data. **The web transcribed nothing from the app
for this** — the look came from the canvas "Book Store rooms" (app → web for look), and the system
below goes web → app.

## The node

```
desiderata/{uid}/{titleId} = { addedAt: <number, ms> }
```

- **Write `addedAt` as a server timestamp** — `{ addedAt: serverTimestamp() }` (JS SDK) /
  `ServerValue.TIMESTAMP` — never the device clock. Undo is the one exception: it writes back the
  entry's ORIGINAL number, which is in the past and therefore allowed.
- **Remove** by deleting `desiderata/{uid}/{titleId}`.
- **Read** with ONE listener on `desiderata/{uid}` for the whole app, so every surface agrees and a
  change on the web shows on the phone.

## The rules (live in `database.rules.json`, deployed W22)

```json
"desiderata": {
  "$uid": {
    ".read":  "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    "$titleId": {
      ".validate": "newData.hasChildren(['addedAt']) && root.child('bookstore_titles').child($titleId).exists()",
      "addedAt": { ".validate": "newData.isNumber() && newData.val() <= now" },
      "$other":  { ".validate": false }
    }
  }
}
```

So: only the reader reads or writes their own list (founders are NOT an exception); an entry holds
`addedAt` and nothing else; `addedAt` can't be in the future; the title must exist in
`bookstore_titles`. A write for a title that has been deleted is refused — show the failure toast
and change the + back.

## "Owned" means holdsBook

`bookstore_purchases/{uid}/{titleId}.status === 'active'` — sales **and** comps alike
(`holdsBook` in `app/lib/bookstore/purchaseSource.js`, the same test `/api/bookstore/stream`
makes). A refunded copy (`status: 'revoked'`) is NOT owned, so the + comes back on it.

- A book the reader holds **never shows a +** (shelf or page) and **never shows in Desiderata**.
- A signed-out tap that turns out, after sign-in, to be on a held book **adds nothing**.

## Filtering and clean-up

Desiderata shows an entry only when its title is on the shelves — the storefront's own read
(`status === 'published'`, publisher not suspended) — and the reader doesn't hold it. Newest first
by `addedAt`.

- **Held book:** not shown, and **loading the room quietly deletes the entry** (one multi-path
  update, no toast).
- **Title not on the shelves** (withdrawn, unpublished, deleted): not shown, but the entry
  **stays** — a withdrawn book can come back, and the reader marked it.
- **Not on sale** (any status but `published`): no + anywhere.

## Deletion

`desiderata` is in `OWNED_NODES` in `functions/api/account/_deletion.js`, so
`POST /api/account/delete` (see `APP-HANDOFF-ACCOUNT-DELETE.md`) removes the whole
`desiderata/{uid}` node. The app does nothing extra. (The deletion screen's words are pinned by
ruling 49 and don't list every kind of data; nothing there changed.)

## The words

From `app/lib/bookstore/readership.js` and `app/lib/bookstore/desiderata.js`. Every line is ruled:
with the canvas on 27 Sept, and the five W22 drafts by ruling 89 on 28 Sept, as written (see
`docs/COPY-RULINGS.md`).

| where | words | status |
|---|---|---|
| shelf line, count 0 | *(nothing — the + alone)* | ruled (88) |
| shelf line, count 1 | `One reader` (uppercased by style) | ruled (88) |
| shelf line, count n ≥ 2 | `{n} readers`, thousands grouped with commas: `1,204 readers` | ruled (88) |
| + aria-label | `Add {title} to Desiderata` / `Take {title} out of Desiderata` | ruled |
| toast after add | `Added to Desiderata. You’ll find it under the ribbon at the top of the shop.` | ruled |
| toast after remove, with **Undo** | `Removed from Desiderata` | ruled (89) |
| toast when a write is refused | `Couldn’t save that change. Try again.` | ruled (89) |
| room title / subline | `Desiderata` / `Books you’ve marked to come back to.` | ruled |
| room count | `1 TITLE` / `N TITLES` | ruled |
| room foot | `When a book comes into your library, it leaves this list.` | ruled |
| room empty | `Nothing marked yet. The + under any book on the shelves adds it here.` | ruled (89) |
| room signed out | `Sign in to see your Desiderata.` + SIGN IN | ruled (89) |
| search hint / no results | `Titles, authors and genres on these shelves.` / `Nothing on these shelves matches “{q}”.` | ruled / ruled (89) |

`readershipShort` sits behind the same platform gate as `readershipFor` (`READERSHIP_REGISTER`),
which is open on web, iOS and Android today.

## The + states

| state | shelf (20px) | page (28px) | room (28px) |
|---|---|---|---|
| no count, not marked | the ring alone, centred | ring (with no readership line: alone, its left edge on the credits' left edge) | — |
| count, not marked | count, then the ring | the line, then the ring | — |
| in Desiderata | count (if any), then the **filled gold disc with a tick** | line (if any), then the disc | the disc, always |
| owned (holdsBook) | the count alone, no + | nothing | never listed |
| not on sale | no + | nothing | never listed |

Ring: 1px `rgba(201,164,76,.55)` border, plus in `#c9a44c` (12-unit viewBox `M6 1.25 V10.75 M1.25 6
H10.75`; 9px at stroke 1.4 on the shelf, 12px at 1.25 on the page). Disc: `#c9a44c`, tick in the
ground colour (`M2.8 6.3 L5 8.4 L9.2 3.8`; 9px at 1.7 / 12px at 1.5). 44pt hit area. The unit draws
**once**, when the counts and the reader's lists are in, fades in with no movement, and never
flips state by itself afterwards.

**Behaviour.** Signed out: the sign-in sheet opens in place; once signed in, the book tapped is
added with no second tap (unless held). Signed in: optimistic — the + changes at once, the write
follows, a refusal changes it back with the failure toast. Undo restores the original `addedAt`.

**Before launch there is no basket** (rulings 79–81): each Desiderata row has its own BUY on the
checkout already proven. Ticking several and paying once comes after a real two-book purchase works
on both rails. The app shows no BUY today, so its rows need none.

## What the web measured (re-measure at the app's own widths)

The web's numbers, for reference — not to copy. On the shelf the ring's top is 10px under the
book's DRAWN bottom edge (the web adds its perspective overhang, 0.39–1.72px), the count's last
letter is 8px from the ring, the count's capitals are centred on the ring (within 0.35px on the web),
and the unit is centred on the title's axis. Where the unit is wider than its column (a web column
under 83px: a 320px phone) the count takes its own line above the ring.
