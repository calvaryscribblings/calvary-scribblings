# R11 — MEMBERSHIP ROUND 8 SCOPE (THE UI ROUND)

**Date:** 2026-08-07 · **From:** the membership workstream, at the close of Round 7
**Verified against:** `ed02d6ef` (R11.6a). Every line number below was re-read at that commit.
**Memberships open:** 2026-09-30.

Self-contained. You should not have to open `audit/R9.*` or reconstruct anything from the
commit log to act on this.

Round 8 is the last round in the eight-round programme **as originally scoped**. It is not the
last round before launch — see §6, which is a launch-blocker that has no round yet.

---

## §0 — WHERE THE PROGRAMME STANDS

Seven of eight rounds are shipped and pushed. Rounds 1–4 needed no app change; Round 5 was the
first that did.

| # | Round | Commit(s) | State |
|---|-------|-----------|-------|
| 1 | Rules — `users/$uid` stops being one grant | `320a522e` | ✅ |
| 1.5 | `isAuthor` founder-only | `0dbcb719` | ✅ |
| 2 | Writer + `effectiveTier` | `8436186c`, `d72eb21d` | ✅ |
| 3 | Stripe rail + portal | `940e9c54`, `ae5baeb6` | ✅ |
| 4 | Paystack Plans | `b34cdc19`, `1283d418`, `abf881d5` | ✅ |
| 5 | Day + week passes | `2c957c15` | ✅ |
| 6 | `useMembership()`; currency.js moves up a level | `84fc84df` | ✅ |
| 7 | `capFor(kind, tier)` | `8a230174`, `ed02d6ef` | ✅ |
| 8 | **UI** | — | **this document** |

`npm run test:membership` — **163 pass, 0 fail** at `ed02d6ef`.
`npm run lint:ratchet` — baseline **142 errors / 110 warnings**, locked at `ed02d6ef`.

---

## §1 — THE CLAIM IN THE PREVIOUS NOTES THAT IS NO LONGER TRUE

**"BLOCKED ON PROVIDER KEYS" IS STALE. Nothing in Round 8 is blocked on a credential.**

The handover notes and the project memory both said the founding Prices and Plans had not been
created, that `PRICE_BOOK` ids were "all null", and that `/api/membership/checkout` answered
409 `not_configured`. That was true when written and was closed by `ae5baeb6` and `1283d418`.
Re-verified at `ed02d6ef`:

- `functions/api/membership/prices.js:61-72` — all **eight** founding **test** Price ids are
  present (gold/platinum × monthly/annual × gbp/usd).
- `functions/api/membership/prices.js:77` — the portal configuration exists in test:
  `bpc_1U1QJE0BtuEAyw2tQGwmXOle`.
- `functions/api/membership/paystack-plans.js:53-61` — all **four** founding **test** Plan
  codes are present.
- `isConfigured('test')` returns **true**. `isConfigured('live')` returns **false**.

So Round 8 can be built and exercised end to end in test mode today, against real Stripe
Checkout and real Paystack pages. **Do not re-run the setup scripts** — they are idempotent by
lookup key, but a founding plan can never be deleted (`NEVER DELETE A FOUNDING PLAN`; a
deletion would send every founding member's renewals to manual review at once).

**What IS still open is LIVE mode**, and it is deliberate rather than forgotten — see §5.

---

## §2 — WHAT ROUND 8 MUST BUILD

Four surfaces. Nothing in the list requires a new endpoint, a new rule, or a schema change.

### 8.1 · A pricing / membership page

There is **no `/membership`, `/pricing`, `/upgrade` or `/plans` route**, and — verified by grep
at `ed02d6ef` — **nothing anywhere in `app/` links to one**. So there is no dangling href to
repair and no URL already committed to in copy. The route name is a free choice.

It must render, for the reader's selected currency:

- Gold and Platinum, monthly and annual, at the **settled hand-set figures**.
- The passes that exist in that currency, from `passesFor(currency)`.
- The founding-member price lock, which is the strongest thing there is to say before 30 Sept.

### 8.2 · A membership section on `/settings`

`app/settings/page.js` is the account surface — 312 lines, three sections: *Account details*
(:197), *Session* (:235), *Danger zone* (:243). There is **no `app/account/page.js`**; the
`app/account/` directory holds only `deleted/`. A membership section belongs here, above the
danger zone, showing the current tier and the manage/cancel entry point.

### 8.3 · The upgrade path out of the shelf surfaces

R11.6 left both shelf surfaces telling the truth about the cap and offering the reader nowhere
to go. The over-cap and shelf-full copy already exists and is careful — do not rewrite it, add
to it:

- `app/components/SaveForOffline.js:147` — the `'full'` popover.
- `app/my-library/page.js:898-906` — the four-way slot line.
- `app/my-library/page.js:943-949` — the empty-state honesty line.

### 8.4 · The states that are not the happy path

Each of these is a real answer from a built endpoint, not a hypothetical:

| Code | Meaning for the reader |
|---|---|
| `not_configured` (409) | *"Memberships open on 30 September."* — this is the LIVE-mode answer, and it is honest, not an error. Render it as a state. |
| `not_priced` (409) | That tier/interval is not sold in this currency. |
| `wrong_rail` (400) | Naira is paid through Paystack. Should be unreachable if the UI routes on `railFor(currency)`. |
| `no_email` (400) | A naira reader with no email on the account. |
| `signed_out` (401) | Token expired mid-flow. |
| `no_customer` | Portal only. **`pending: true` means mid-webhook — try again in a moment; `pending: false` means no membership at all.** Two different sentences. |

---

## §3 — WHAT ALREADY EXISTS. REUSE IT; DO NOT REBUILD IT

This is the part most likely to be re-implemented by accident.

**Entitlement** — `app/lib/MembershipContext.js`
- `useMembership()` (:169) → `{ tier, subscriptionTier, pass, source, status, founding,
  currentPeriodEnd, loading, signedIn }`
- `useTier()` (:174) — for surfaces that want nothing else.
- `source` is `'subscription' | 'pass' | 'none'`, and it exists **so copy can be honest**:
  "your Gold membership" and "your day pass" are not the same sentence, and a Platinum member
  holding a Gold pass is a Platinum member.
- Called outside the provider it returns the signed-out shape rather than null, so a component
  in isolation degrades to `'free'` instead of throwing.

**Pure helpers** — `app/lib/membership.js`
`TIERS` (:40) · `normaliseTier` (:108, TOTAL, never guesses upward) · `maxTier` (:127) ·
`tierAtLeast(tier, floor)` (:131) · `activePass` (:147) · `effectiveTier` (:169) ·
`describeMembership` (:180).

**Pass pricing** — `app/lib/membershipPasses.js`
`passesFor(currency)` (:106) is the one question a pricing page asks. The week pass being
naira-only is **not a condition anywhere** — it falls out of `AMOUNTS.week` (:69) having only
an `ngn` entry. Add a gbp week price one day and the page offers it with no code change.
`railFor(currency)` (:96) decides which endpoint to POST to.

**Currency** — `app/lib/currency.js` (moved up out of `bookstore/` by R11.5, `84fc84df`)
`useCurrency()` (:359) · `formatPrice` (:162) · `CURRENCY_LABELS` (:74) · `setCurrency` (:279).

**Caps** — `app/lib/shelf.js`
`capFor(kind, tier)` (:116) · `isUnlimitedCap(cap)` (:129) · `CAPS` (:98).

---

## §4 — THE FIVE RULES ROUND 8 MUST NOT BREAK

**1. `users/{uid}/membership` IS A SCALAR STRING. Do not "improve" it.**
`'free' | 'gold' | 'platinum'`. The Story Island app reads it with **strict equality** and
`.tier` appears nowhere in it. Writing an object there silently downgrades every paying member.
The rich billing record is the sibling at top-level `memberships/{uid}`. Round 8 is UI and
should not be writing either — but if it ever does, both go in ONE atomic multi-path update.

**2. The `loading` beat is a lie waiting to happen.**
`loading` is true for one beat after a signed-in mount and `tier` is the `'free'` default
during it. A surface that prints a number or refuses an action **must wait**. Both shelf
surfaces do (`SaveForOffline.js:132` makes the button inert; `my-library/page.js:898, 943`
withhold the number). A pricing page that flashes "Your plan: Free" at a Platinum member for
one frame is the same bug wearing better clothes.

**3. Unlimited is `Infinity`, and a renderer cannot draw it.**
Call `isUnlimitedCap(cap)` and print a count, never a denominator.
`Array.from({ length: Infinity })` throws.

**4. Over-cap saves persist, and the copy must not imply otherwise.**
A lapsed-pass reader can hold twenty stories against a cap of two. Nothing evicts, prunes or
sweeps. The settled copy is *"your plan holds 2, and you have 20 — kept from when your pass was
live. Nothing has been removed"* — **never** "remove one to make room", which is false twice
over. The full ruling and its reasoning are written above `CAPS` in `app/lib/shelf.js:69-97`,
where a later round will actually read them.

**5. The provider REPORTS entitlement; it does not enforce it.**
No cap lookup, no paywalling in `MembershipContext.js`. That property is why R11.6 changed the
caps without touching this file, and Round 8 will add more consumers that only want to print a
tier name than any round so far. Keep gates in the surfaces.

Also standing: **nothing is paywalled at launch.** The tiers are perk-shaped, not
access-shaped. The pricing page is selling shelf slots and support, not unlocking stories.

---

## §5 — THE TWO THINGS THAT ARE GENUINELY NOT DONE

**A. Live-mode ids do not exist.** `PRICE_BOOK.founding.live` (`prices.js:67-70`),
`PORTAL_CONFIGURATION.founding.live` (:77) and `PLAN_BOOK.founding.live`
(`paystack-plans.js:59`) are all null.

This is close to a feature. Because live is unconfigured, `isConfigured('live')` is false and
every live checkout returns 409 *"Memberships open on 30 September."* — **the launch date
enforces itself by the absence of live prices, with no date check anywhere in the codebase.**
Creating live prices IS opening the store. Do it deliberately, and know that the
`--i-mean-live` guard on `scripts/create-founding-prices.mjs` is the only thing standing
between a test run and a live one.

**B. There is no Paystack portal, so naira members have no self-serve cancel.**
Stripe members get `functions/api/membership/portal.js`. Naira members get nothing equivalent —
Paystack has no portal at all. The path was scoped and not built: `/subscription/disable` needs
the subscription code **and** an `email_token`, fetched on demand via `GET /subscription/:code`
rather than stored (`memberships/{uid}` is owner-readable and that token is a capability), then
let the `subscription.disable` webhook do the downgrade rather than writing optimistically.

**This is a Round 8 decision, not a Round 8 given.** A settings page that shows "Manage
membership" to a card member and nothing to a naira member is a visible two-tier experience.
Options: build the disable path in Round 8; or ship an honest contact-us route for naira
cancellations and schedule the build. **Someone has to choose. It should not be chosen by
whoever happens to write the settings section.**

---

## §6 — THE LAUNCH-BLOCKER WITH NO ROUND

**The `writeMembership` race. Agreed 2026-08-07. Still not scheduled. Must land before
30 September.**

`writeMembership()` writes `memberships/{uid}: detail` **wholesale** — a path→object value
replaces the whole node. Both rails currently preserve `existing.pass` by reading it first, so
a pass survives a subscription event. But **a pass landing between that read and that write is
lost**: the reader paid for it, the webhook acknowledged it, and it is gone.

The fix is known and small: move to per-field / deep-path writes, the same shape the pass
writer already uses.

It is not part of Round 8 and should not be quietly absorbed into it. It needs its own round.

---

## §7 — RECOMMENDED ORDER FOR ROUND 8

1. **Settle §5B first.** It changes what the settings section contains.
2. `/settings` membership section — smallest surface, exercises `useMembership()` and the
   portal's three answers (`url`, `no_customer` + `pending`, `no_customer` + no record).
3. The pricing page — the largest, and the only one needing currency routing across two rails.
4. The shelf upgrade paths — last, because they link to the pricing page.
5. Then the `writeMembership` race (§6), as its own round, before 30 September.
