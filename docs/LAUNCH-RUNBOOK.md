# Launch runbook — what happens by itself, and what needs a deploy

**The date lives in exactly one place: `app/lib/launch.js`, `export const LAUNCH`.**
Move it there and everything below follows. `npm run test:launch` fails if anyone types a
launch date anywhere else; `npm run test:doors` proves the coupling across a fortnight built
from whatever that constant says.

---

## 1. What opens by itself, with no deploy

These read the clock **in the reader's browser**, so they change at **London midnight** on the
launch date, on whatever bytes are already on the CDN.

| | what changes |
|---|---|
| **The Book Store curtain** | `isStoreUnlocked()` → the shop opens to everyone. **This is the one that matters.** |
| The gateway countdown | "Opens in 3 days" → the note disappears and the space closes |
| The My Library countdown | same |
| The My Library "opens" note and switch pill | both go |
| The gateway's Book Store modal line | "opens its doors on …" disappears |
| The gateway's crawlable paragraph | "The Book Store opens 30 September." → "The Book Store is open." |

**Before R50 none of this was true of the curtain.** `GATE_ENABLED` was a hand-flipped boolean:
the countdown would reach zero, the page would say the shop had opened, and the shop would stay
shut until somebody remembered to edit a file. That was the launch-day risk, and it is gone.

---

## 2. ⚠ What is BAKED and needs a deploy on the morning

`next.config.mjs` sets `output: 'export'`. **A `metadata` export and any module-scope constant in
a server component are evaluated at BUILD TIME and frozen into the HTML.** A page built on the
29th carries the 29th's sentence until something rebuilds — no clock will save it.

| site | what it says while stale | who sees it |
|---|---|---|
| `app/page.js` — OG + meta description ×2 | "The Book Store opens 30 September." | search results, link unfurls |
| `app/bookstore/layout.js` — meta description | same | search results |
| `app/links/page.js` — `BOOKSTORE_LABEL` | "Book Store · opens 30 Sept" | anyone tapping the Instagram bio |
| `app/components/Gateway.js` — crawlable `<p>` | the pre-launch sentence **in the served HTML** | a crawler that does not run JS |
| `app/bookstore/[slug]/page-detail.js` | "Available September 2026" | a title page |

> The gateway paragraph is the subtle one: Gateway is a client component, so **a reader** sees
> the correct sentence immediately. Only the **crawled** copy is stale.

### ⭑ So: **deploy on the morning of launch.**

Any rebuild does it — there is nothing to edit. Trigger a Cloudflare Pages deploy after London
midnight and every baked sentence re-derives. Until then the site is correct for readers and
stale for crawlers and for the link-in-bio label.

If the deploy is missed, nothing breaks: the shop is open, the reader-facing pages are right,
and the stale copy is a description rather than a door.

---

## 3. The four booleans — which are calendar, which are configuration

**Two are "has the calendar reached the day". Both now derive from `doorsOpen()`:**

- ~~`GATE_ENABLED`~~ → `isCurtainUp()` in `app/lib/bookstore/gate.js`
- ~~`BOOKSTORE_LAUNCHED`~~ → `BOOKSTORE_LABEL` in `app/links/page.js`

**Two are "is a thing configured". Both stay hand-flipped, deliberately:**

- **`MEMBERSHIPS_ON_SALE`** (`app/lib/membershipPrices.js`) — asks whether the **live Stripe and
  Paystack price ids exist**. ⚠ **Must never become a clock.** It is asserted against
  `isConfigured('live')` by `tests/membership/on-sale.test.mjs`, and that interlock exists
  because a single boolean is only safe when it *cannot silently drift, because the build
  stops*. A date-driven flag would sell subscriptions on a day the prices do not exist —
  buttons that answer 409. **Flip it in the same commit that pastes the live price books.**
- **`MEMBERSHIP_LAUNCHED`** (`app/links/page.js`) — reads like a calendar flag and is not one.
  It chooses between "opens 30 September. Read the tiers" and "**open the archive**", and the
  second is a lie unless memberships are purchasable. Flip it beside `MEMBERSHIPS_ON_SALE`.

---

## 4. Launch morning, in order

1. **Nothing at midnight.** The doors open themselves. Check `/bookstore` shows the shop.
2. **Trigger a deploy** (§2). Any rebuild.
3. **When the live price books are pasted:** flip `MEMBERSHIPS_ON_SALE` *and*
   `MEMBERSHIP_LAUNCHED` in the same commit, then `npm run test:membership`.
4. **R9 clean-up, any time after** — no longer urgent, because there is no switch to throw. The
   delete list is at the foot of `app/lib/bookstore/gate.js`.

## 5. If the date moves

Edit `LAUNCH` in `app/lib/launch.js`. Then `npm run test:launch && npm run test:doors`.

⚠ **If `test:launch` reddens under `tests/` or `scripts/`, check for a coincidental collision
first.** Since R50 the guard walks the harness, which is full of dates that have nothing to do
with launch — a rules fixture and a Book-of-the-Month label are both known to collide on
certain dates. **Move the fixture, never exempt the file:** an allowlist is a hatch the next
collision widens.
