# The Calvary account: what this repo promises

> Reviewed 5 Nov 2026. Items marked pending wait on a ruling or a measurement.

Written in RADIO-C0 (5 Nov 2026) from the code at `aca3a176` and Ikenna's ruling of one Calvary
account across the website, Story Island and Calvary Radio, and later Calvary Films and the
Calvary Scribblings paperback shop at books.calvaryscribblings.co.uk. Corrected in RADIO-B1 after
review; the paperback shop's handoff (§6.2) added in SHOP-2 (18 Nov 2026). Nothing here is built yet.

**This repo owns the account.** It's the one Firebase Authentication project the website already
signs readers into (`calvary-scribblings`). Story Island, Radio, and later Films, sign into the
**same** project. The paperback shop never signs anyone in itself: the main site does it for the
shop (§6.2). They never run a second user store, and never copy profiles between
apps. A reader's uid is the same everywhere, so membership, purchases, positions, notifications
and deletion follow them without any syncing.

**Nothing in this file is a key, a secret, a reader's details, a price or anyone's contract
terms, and nothing added to it ever may be.**

---

## 1. What exists today

- **Website sign-in** (`app/components/AuthModal.js`) offers email and password, Google (popup)
  and Apple (popup). A new account completes its handle and date of birth before anything else
  (`docs/APP-HANDOFF-SIGNUP-COMPLETENESS.md`).
- **The verification and welcome emails** go through the `calvary-auth` Worker, whose source
  isn't in this repo.
- **Deletion** is `POST /api/account/delete`, which needs a recent sign-in (`RECENT_LOGIN_S`), plus
  the quarter-hourly scrub (`scripts/account/scrub.mjs`). The reader's own request is the
  authority (CLAUDE.md, "Account deletion"). `/delete-account` is a public page explaining it,
  and it still says "Story Island account".
- **The association files** (`public/app-association/`) claim `/stories/*` for Story Island
  (`287PRDDG5J.uk.co.storyisland.app`). They carry no `webcredentials` entry today.
- **The web's password fields carry no `autocomplete` hints** (AuthModal's email, password and
  confirm fields). Without them, iOS and password managers guess.

---

## 2. One name, one sign-in

- **"Your Calvary account", everywhere.** Every surface that names the account says "your Calvary
  account": the website, Story Island, Radio, emails, store listings and the deletion page. No
  surface says "Story Island account" or "Radio account". The web's sweep is a build round (§7).
  The apps' copy is their own rounds.
- **One sign-in design** for the website, Story Island and Radio: the same providers, in the same
  order, with the same words. **The design itself comes later.** This contract fixes only that
  there is one, and that every surface offers the same three ways in: email and password,
  Google, and Apple.

---

## 3. Password autofill on iPhone

**The website.**

- Add a `webcredentials` entry to `apple-app-site-association.json`, listing each app that may
  share the website's saved passwords:
  ```json
  "webcredentials": { "apps": ["287PRDDG5J.uk.co.storyisland.app", "287PRDDG5J.<Radio's bundle id>"] }
  ```
  Radio's bundle id is needed before this is written (§8). `tests/applinks/association.test.mjs`
  is extended to pin it.
- Add `autocomplete` hints to the website's sign-in fields: `username` on the email field,
  `current-password` on sign-in, `new-password` on sign-up and its confirmation.
- For Android, add the `delegate_permission/common.get_login_creds` relation to `assetlinks.json`,
  for each app's package and signing fingerprint, so Google Password Manager shares the same
  credentials.

**Each app, in its next native build:**

- the **Associated Domains** entitlement `webcredentials:calvaryscribblings.co.uk`, next to the
  existing `applinks:` entry (Story Island) or as a new one (Radio);
- the sign-in fields marked for autofill (`textContentType` / `autoComplete` of `username`,
  `password` and `newPassword`).

iOS reads the association file at install, so **the web file ships first**, then the builds.

---

## 4. "Continue as [name]" between Story Island and Radio

A reader signed into one app should be able to sign into the other with one tap, without typing
a password.

### The two designs

**A. A shared keychain group under team 287PRDDG5J, plus a token exchange.**

- Both apps carry the keychain-sharing entitlement for one access group.
- The signed-in app writes its current ID token (and the reader's display name) to the group
  whenever the token refreshes.
- The other app reads it, shows "Continue as [name]", and on a tap posts the ID token to
  `POST /api/account/continue`. That endpoint returns a custom token, and the app signs in with
  it.
- **iPhone only.** Android has no shared keychain between apps. Its nearest equivalent
  (`AccountManager` or a shared-user-id) requires matching signatures and an authenticator
  service, and isn't something Expo builds give you.
- A live credential sits in a shared store every app in the group can read, including any future
  app added to the group.

**B. An app-to-app handshake, on both platforms.**

1. Radio checks that Story Island is installed. On iOS that needs `LSApplicationQueriesSchemes`;
   on Android a `<queries>` entry.
2. Radio makes a one-time verifier and opens Story Island at
   `https://calvaryscribblings.co.uk/account/continue?app=radio&challenge=<SHA-256 of the verifier>`,
   a universal or app link claimed by Story Island only.
3. Story Island shows **"Continue as [name] in Calvary Radio?"** from its own session. On a tap, it
   posts its ID token and the challenge to `POST /api/account/handoff`. The server stores a
   one-time code bound to the uid and the challenge (`account_handoffs/{code}`, server-written,
   60 seconds, single use).
4. Story Island opens Radio's return link with the code.
5. Radio posts the code and the verifier to `POST /api/account/redeem`. The server checks the
   verifier against the challenge, deletes the code, and returns a custom token. Radio signs in
   with it.

No token ever leaves the app that holds it. Only a code that's useless without Radio's verifier
does. It works the same way on iPhone and Android, the reader sees which app is asking, and it
runs the other way round by swapping the two names.

### Recommendation: B, the handshake

It's one design for both platforms. It never places a credential where another app can read it,
and the consent is visible to the reader. A costs a cross-platform gap on day one and leaves a
live token in a shared store. B costs one extra tap and two Function requests. If a smoother
iPhone path is wanted later, the keychain can carry **only the display name** to label the button
("Continue as [name]") before the handshake. It never carries a token.

### Rules for whatever mints a custom token

`/api/account/redeem` (and `/api/account/continue`, if A is ever chosen):

- **Freshness.** The ID token presented at handoff must have been issued (`iat`) within the last
  **5 minutes**, with 30 seconds of clock skew, the constants `deletion` already uses. An older
  token is refused with `stale_token`, and the app refreshes and retries once.
- **Rate limit,** through `functions/api/_ratelimit.js`, failing closed: per uid, 5 a minute and
  20 a day. Per IP, 30 a minute.
- **Never logs a token, a code or a verifier.** Log lines carry a result code and nothing else.
  `tests/ci/w12-log-privacy.test.mjs`'s discipline applies.
- **Signing.** The custom token is a JWT signed with the service account's key inside the
  Function, which costs no subrequest. That makes the Functions' `FIREBASE_PRIVATE_KEY` a new
  kind of consumer: a leaked key could now sign anyone in. `security/KEY-ROTATION.md`'s consumer
  map gains this line in the same round.
- **Ruling 269's key round must leave the key able to sign custom tokens.** Firebase checks a
  custom token's signature against the public keys of the service account named as its issuer.
  So whatever 269 cuts from the site's key, it must remain an **active key of a service account
  in this project**, and the Functions must still hold it. If that round moves the Functions to a
  key-less signer instead, the account it signs as needs permission to sign
  (`iam.serviceAccounts.signBlob`). Either way, `/api/account/redeem` is on 269's checklist, and
  `node scripts/security/verify-admin-key.mjs` gains a custom-token check.
- **Claims.** The custom token carries no custom claims, so it never elevates anyone. Founders
  sign in as themselves and are founders by uid, as everywhere.
- **Disabled accounts.** A uid with a `deletions/{uid}` record, or an auth record that's
  disabled, is refused.

---

## 5. One account page on the website

`/account`, a signed-in page. It has four sections:

- **Profile:** name, handle, photo. The editing that `/settings` and `/profile` already do moves
  or links here.
- **Membership:** tier, renewal or end date, and the way to manage it. The words are those of
  `/membership`, which is reached from here.
- **The apps you've used:** Story Island and Radio, later Films. Each app records
  itself at sign-in in `account_apps/{uid}/{app} = { firstAt, lastAt }` (owner-only, server
  time, added to `OWNED_NODES`). The page lists them so the reader knows what deleting the
  account reaches.
- **Delete your Calvary account:** the existing endpoint and its modal, with the copy from
  `app/lib/accountDeletion.js`, rewritten to name every app.

- **Paperback orders:** the reader's orders from the paperback shop at
  books.calvaryscribblings.co.uk, from `print_orders/{uid}` (§6.2 (c)).

It also serves as **the deletion link Google Play requires for both apps**.

- Signed out, `/account` explains what deletion removes and offers sign-in, so it works for
  someone who has already uninstalled the app.
- `/delete-account` stays as a public page pointing to it, so any link to it already in use keeps
  working.
- Neither path is ever claimed by an app (`docs/APP-DEEP-LINKS.md` §4 already says so for
  `/delete-account`; `/account` is added).

### Deleting from inside the app

**Apple requires an app that creates accounts to let people start deletion inside the app**
(App Store Review Guideline 5.1.1(v)); a link out to a website alone doesn't meet it. So:

- **Radio gets an in-app "Delete your Calvary account"** in its Settings. It calls
  **`POST /api/account/delete`**, the same endpoint Story Island uses
  (`docs/APP-HANDOFF-ACCOUNT-DELETE.md`), with the same step order and the same words.
- It **sits alongside the link to `/account`**, not instead of it. The link is still what Google
  Play's listing points to.
- The endpoint needs a **recent sign-in** (`RECENT_LOGIN_S`, 5 minutes), so Radio re-asks for
  sign-in first when the session is older.
- It **loops on `202 { more: true }`** until the endpoint says it's done (LIMITS-1), exactly as
  Story Island must.
- The confirmation names every app the account reaches, because deleting the account from Radio
  deletes it for Story Island and the website too.

---

## 6. Calvary Films, and the paperback shop

### 6.1 Calvary Films

When it needs sign-in, it uses the same account under this contract: the same Firebase project,
the same three ways in, "your Calvary account", the handshake (§4), a line in `webcredentials`
(§3), a row in "The apps you've used" (§5), the deletion page (§5), and, as an app that creates
accounts, an in-app "Delete your Calvary account" on the same endpoint. No new user store.

### 6.2 The Calvary Scribblings paperback shop (books.calvaryscribblings.co.uk)

**Ruling (Ikenna, SHOP-2, 18 Nov 2026): option B, the handoff from the main site.** SHOP-1 laid out
four ways for the shop to know a reader (A: the Firebase SDK on books.\*; B: a handoff from the main
site; C: a shared session cookie on `.calvaryscribblings.co.uk`; D: guest checkout matched by email
later). B was chosen.

The shop is its own Worker (`calvaryprints`), with its own database and storage. **It never runs a
user store, never holds a Firebase credential, never signs a reader in, and never learns a uid.**
The main site does the signing-in and keeps the record. Because sign-in happens on
calvaryscribblings.co.uk, books.\* does **not** need to be a Firebase authorized domain.

**Rulings (Ikenna, 20 Nov 2026).** **403:** the handoff runs **after payment**, from the shop's
confirmation page, which carries both account buttons (sign in, create an account). There is no
sign-in at checkout. **404:** deleting a Calvary account removes `print_orders/{uid}`, and the deletion
copy says that the shop keeps its own record of paid orders and points the reader to the shop for it.

**Built so far:** SHOP-B1 (20 Nov 2026), the two nodes, their rules, the `orderNo` id kind, deletion and
the scrub. SHOP-B2 (24 Nov 2026, committed, not pushed), the handoff page `/account/shop` and
`POST /api/account/shop-code`, which writes `shop_handoff_codes`. Nothing writes `print_orders` until B3,
and no code is redeemable until then either.

#### (a) The handoff page: sign in, then back to the shop with a code

- **Where:** a page on the main site, `/account/shop` (never claimed by an app; added to
  `docs/APP-DEEP-LINKS.md` §4's list when built). The shop links to it with two parameters:
  `return` (where to send the reader back) and `state` (the shop's own opaque value, echoed back
  untouched so the shop can match the return to its session; ≤ 128 URL-safe characters, refused
  otherwise).
- **Sign in or sign up:** the page uses the site's own AuthModal (the same three ways in, §2). A new
  account completes its handle and date of birth first, as everywhere. Signed in already, the page
  asks only to confirm: "Keep this order in your Calvary account?" (copy to be ruled).
- **The return address is allow-listed, exactly.** The allow-list is a constant in the repo: the
  origin `https://books.calvaryscribblings.co.uk` and named paths on it. `return` must equal one
  entry character for character. No prefix match, no pattern, no other host, no "same site": an
  address not on the list is refused with a page that says so, and nobody is redirected (no open
  redirect).
  **Set in SHOP-B2 (the shop had named none):** exactly one entry,
  `https://books.calvaryscribblings.co.uk/account/return` (`SHOP_RETURN_URL` in `app/lib/shopHandoff.js`).
  The shop percent-encodes it in our query (or not); our page decodes the query once and compares.
  The page never navigates to the `return` it was given: both addresses it can go to are built from
  the constant. The Function refuses any other `return` too, so no code is minted for a refused link.
- **The state, as built (SHOP-B2):** 1 to 128 characters from RFC 3986's unreserved set
  (`A–Z a–z 0–9 - . _ ~`), present exactly once. These need no percent-encoding, so the state goes back
  as the very characters the shop sent. Anything else is refused, never cleaned.
- **Two ways back (SHOP-B2).** "Keep it": `…/account/return?code=<43 chars>&state=<state>`. "Not now":
  `…/account/return?state=<state>`, with **no code**. The shop tells them apart by `code` alone. In
  both cases it first checks `state` against the reader's own session, and **refuses any return
  whose state doesn't match** (for B3's hand-off note). The page replaces itself in history, so Back
  never mints a second code.
- **A failure never comes back to the shop (SHOP-B2 go, for B3's hand-off note).** A return carries
  `code` and `state` ("Keep it") or `state` alone ("Not now"), and nothing else: never an error, never
  a reason. When the page can't mint a code (refused, limited, signed out, failed, or no answer within
  20 seconds) it says so on the page and keeps "Not now" there, so the reader can always go back with
  the state and no code. A link the page refuses (bad `return` or `state`) goes nowhere at all.
- **The code:** on confirm, the page calls a Function with the reader's ID token. The Function mints
  a code (32 random bytes, base64url), stores **only its SHA-256** at a server-only node
  (`shop_handoff_codes/{sha256}` = `{ uid, exp }`, `.read`/`.write` false for every client), and the
  page sends the reader to `return?code=…&state=…`. **The key is the SHA-256 as 64 lowercase hex
  characters** (`SHOP_CODE_KEY` in `functions/api/account/_deletion.js`); deletion and the sweep build a
  path only from a key of that shape. `exp` is ms since epoch, the last instant the code is good for
  (a code is expired once `exp <= now`).
- **One-time and short-lived:** a code is good for **one** redemption and for **5 minutes** from
  minting. Redeeming deletes it in the same conditional write that reads it (ETag), so two
  redemptions at once file at most one order. An expired or used code is refused. **Expired codes are
  swept by the account scrub** (`planCodeSweep` / `runCodeSweep` in `scripts/account/`, every 15 minutes
  on `.github/workflows/account-scrub.yml`), along with any malformed entry, so a dead code holds a uid
  for at most about 20 minutes. The sweep only bounds that; refusing an expired code is the redeemer's
  job, whether or not the sweep has reached it.
- **When (ruling 403):** the handoff runs **after the order is paid**, from the shop's confirmation
  page, which shows both account buttons. There is no sign-in at checkout, so the code only has to
  live from sign-in to the shop's next server call.
- **Rate-limited** per uid and per IP through the existing limiter; the page and the Function log
  counts only, never a code, a uid or an order number.
  **As built (SHOP-B2):** 5 a minute and 30 a day per uid, 10 a minute and 100 a day per address
  (`CF-Connecting-IP`; none is refused), 2,000 a day overall (`SHOP_CODE_CAPS`, each tunable by env,
  none removable). The limiter's refusal line names the bucket by kind (`logAs: 'uid' | 'ip'`). The
  code's key is SHA-256 over its 43 ASCII characters, as the shop will present them; the write is
  conditional on the key being absent (`if-match: null_etag`).
- **Words (SHOP-B2). Ruled by Ikenna, 24 Nov 2026: every string in `SHOP_COPY` stands as written.**
  All in `SHOP_COPY` (`app/lib/shopHandoff.js`), the page prints nothing else. Signed in: "Keep this
  order with your others?", "Keep it" / "Not now", and under it "Your Calvary account keeps the order
  number, date, titles and what you paid. Nothing else comes with it." Signed out: the same question
  above the sign-in. Refused link: "This link can’t take you back to the shop."
- **A new account completes its handle and date of birth first.** `/account` is exempt from the
  completion step; `/account/shop` is carved back in (`COMPLETION_REQUIRED` in
  `app/lib/profileCompletion.js`), and the buttons wait until the identity exists.

#### (b) Filing the order: one server-to-server call

- **The call:** `POST /api/shop/print-order`, from the shop's Worker only, with
  `Authorization: Bearer <secret>`. The secret is shared between Pages (`SHOP_ORDERS_SECRET`) and
  the shop's Worker, compared in constant time, and added to `security/KEY-ROTATION.md` as a
  two-holder value when built. Without it, or with a wrong one: 401 and nothing read.
- **The body:** `{ code, order }`, where `order` is:
  - `orderNo`: the shop's order number, **`CS-` and six of A–Z and 0–9** (the shop's own example:
    `CS-7KQ2MX`). The kind `orderNo` in `app/lib/ids.js` (SHOP-B1) refuses anything else with a 400
    and never cleans it: no upper-casing, no trimming. ⚠ **An assumption for the shop to confirm:**
    no live order number has been seen from this repo. If the real format differs, the kind changes
    before B3 files a single order. (An earlier draft of this section said `CS-` and digits.)
  - `date`: when it was paid (ms since epoch);
  - `titles`: 1 to 50 of `{ title, copies }` (title a string ≤ 200 characters, copies an integer
    1 to 99);
  - `amount`: `{ minor, currency }` (an integer in the currency's minor unit, and `GBP` or `NGN`).
  Nothing else: no address, no name, no email, no payment reference.
- **What it does:** redeems the code (above) to a uid, and writes
  `print_orders/{uid}/{orderNo}` = the order plus `filedAt`. It answers `200 { filed: true }` and
  **never returns or echoes the uid**. Filing the same `orderNo` again for the same reader (a retry)
  writes nothing new and answers 200; an `orderNo` already filed under another reader is refused
  (409) and nothing is written.
- **The node:** `print_orders/$uid/$orderNo`, `.read: auth.uid === $uid` (its owner; founders
  read it through the Admin SDK in /admin when needed), `.write: false` for every client, founders
  included. Only the Function writes it. In `database.rules.json` since SHOP-B1 (deploy pending), with
  `tests/rules/shop-b1.test.mjs` for every actor (owner, another reader, signed out, both founders),
  list reads of both parent nodes included.

#### (b2) The server's writes: NO RULE BINDS THEM, so the code is the only check

**This binds SHOP-B2 and SHOP-B3. Read it before writing either Function.**

- **The credential.** Both Functions write with the Firebase **service account's OAuth access token**:
  `mintAccessToken(FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, SCOPES)` from
  `functions/api/bookstore/_lib.js`, sent as `Authorization: Bearer` to the database's REST API.
  This is the same credential `/api/story`, the bookstore webhooks and the account-deletion endpoint
  already use.
- **No rule binds it.** A service-account token is an admin credential. The Realtime Database skips
  **every** rule for it: `.read`, `.write` **and `.validate`**. `.write: false` on both nodes stops
  clients and nothing else. A `.validate` on either node would never run for these writes, so
  **none is written, and nothing may count on one**.
- **So B3's code enforces the order's shape**, before anything is written: `orderNo` through
  `assertId('orderNo', …)` (a bad one is a 400, never cleaned); `date` a finite number; `titles` an
  array of 1 to 50 `{ title, copies }`, title a string of at most 200 characters, copies an integer
  1 to 99; `amount` `{ minor, currency }`, minor a non-negative integer, currency exactly `GBP` or
  `NGN`. **Every other field is dropped by building the record from the named fields**, never by
  spreading the body. The written record is exactly those fields plus `filedAt`. Tests must send a
  body with extra fields (an address, an email, a `uid`) and prove none reaches the database.
- **And B3's code enforces one-time use.** Redeem with a conditional write: GET
  `shop_handoff_codes/{sha256}.json` with `X-Firebase-ETag: true`, check `exp > now`, then DELETE it
  with `if-match: <etag>`. Only a 200 on that DELETE redeems; a 412 means someone else redeemed it
  first, and the call answers as for a used code. The order is written only after a successful
  redemption. The key is built only from a hash of the presented code (64 lowercase hex), never from
  the body.
- **And B2's code enforces the code's shape:** it writes exactly `{ uid, exp }`, uid the verified
  token's, exp now + 5 minutes, at a key it computed, and nothing else.

#### (c) Where the reader sees them

- A "Paperback orders" section of `/account` (§5): order number, date, titles and copies, amount.
  Until ACCOUNT-B2 builds `/account`, a signed-in page `/account/orders` holds the same list and
  moves into `/account` when it exists.
- No link out to the shop's own order pages is promised here (the shop may change them).

#### (d) Deletion

- **Built in SHOP-B1.** `print_orders` is in `OWNED_NODES` in `functions/api/account/_deletion.js`
  (ruling 404), so deleting the account removes `print_orders/{uid}` with the rest, in the `owned`
  step, in the usual step order.
- Any unredeemed `shop_handoff_codes` for the uid are deleted in the same `owned` update, found by the
  `uid` inside each entry (the owned step reads the whole node, which stays small: codes live 5
  minutes and are swept every 15). The step costs 15 subrequests now, not 14.
- **The scrub is the backstop for the one race this has.** A code minted just before the deletion
  and redeemed by the shop just after the `owned` step files an order the endpoint never saw. The
  scrub's next pass removes `print_orders/{uid}` and any code carrying the uid
  (`scripts/account/scrub-plan.mjs`). Proven on the emulator (`tests/account/deletion.emulator.test.mjs`).
- **The shop's own copy of the order** (in its database) is the shop's: its retention and deletion
  are set out by the shop, not by this repo. Because the shop never learns the uid, our deletion
  cannot reach it, and the deletion copy (`app/lib/accountDeletion.js`) must not claim it does.
  **Ruling 404:** the copy says the order history in the Calvary account is removed, that **the shop
  keeps its own record of paid orders**, and points the reader to the shop for it. The words are
  written with B4's copy and ruled before order history goes live. SHOP-B1 does not change the
  deletion copy, because nothing can file an order yet.

#### (e) /privacy, before order history goes live

`/privacy` must say what the account holds for paperback orders (order number, date, titles,
copies, amount; no address or payment details), where it comes from (the shop, when the reader
chose to keep the order in their account), and that deleting the account removes it. **That copy
ships before or with the round that turns order history on**, never after. The copy is Ikenna's to
rule.

#### Estimate: four rounds

1. **SHOP-B1, the nodes.** `print_orders` and `shop_handoff_codes` rules, the `orderNo` id kind,
   `OWNED_NODES` and the scrub, the expired-code sweep, emulator tests. **Built 20 Nov 2026 (committed,
   not pushed); rules deploy still to come.** Nothing reachable yet.
2. **SHOP-B2, the handoff page.** `/account/shop`, the code-minting Function, the exact allow-list,
   the limiter, the copy (to be ruled), tests (allow-list refusals, one-time, expiry). **Built 24 Nov
   2026 (committed, not pushed).** One-time use and expiry are enforced at redemption, so their tests
   are B3's; B2 proves the record (`{ uid, exp }`, exp = mint + 5 min) they rest on.
3. **SHOP-B3, the filing call.** `POST /api/shop/print-order`, `SHOP_ORDERS_SECRET` on both
   holders, `KEY-ROTATION.md`, idempotence and the 409, tests. A hand-off note for the shop.
4. **SHOP-B4, the reader's view.** "Paperback orders" (or `/account/orders`), the `/privacy` and
   deletion copy (ruled first), then turned on.

B1 and B2 can share a round if the copy is ruled in advance. B4 waits on (e)'s copy.

---

## 7. Build rounds, in order

1. **ACCOUNT-B1: the words and the fields.**
   - "Your Calvary account" across the web, including `/delete-account` and the deletion modal.
   - AuthModal's `autocomplete` hints.
   - A CI check that no web copy says "Story Island account".
2. **ACCOUNT-B2: the account page.** `/account` (§5), `account_apps` with its rules and
   `OWNED_NODES` entry, and the signed-out deletion explanation.
3. **ACCOUNT-B3: webcredentials.** The association file's `webcredentials` and assetlinks'
   `get_login_creds`. It needs Radio's identifiers. **It ships before** the two apps' builds.
4. **ACCOUNT-B4: the handshake.**
   - `/api/account/handoff` and `/api/account/redeem`, with the rules in §4.
   - `account_handoffs` (server-only).
   - The `/account/continue` claim for Story Island.
   - The key-rotation consumer map.
   - A hand-off note for both apps.

5. **SHOP-B1 to SHOP-B4: the paperback shop's handoff and order history** (§6.2, four rounds).
   Independent of ACCOUNT-B1 to B4, except that SHOP-B4's "Paperback orders" moves into `/account` once
   ACCOUNT-B2 exists.

---

## 8. What each app's next native build must carry

**Story Island:**

- Associated Domains: add `webcredentials:calvaryscribblings.co.uk`.
- Autofill hints on its sign-in fields.
- The handshake's Story Island side: handle `/account/continue`, show the confirmation, call
  `/api/account/handoff`, open Radio's return link. Add `/account/continue` to its claimed paths
  (iOS: in the association file, from the web side; Android: an intent filter).
- `LSApplicationQueriesSchemes` / `<queries>` for Radio, if it offers the reverse direction.
- The words "your Calvary account".
- Native rendering of `/series/instalment/*` before that path is claimed
  (`docs/RADIO-CONTRACT.md` §9).

**Radio:**

- Sign-in against the **same** Firebase project, with email and password, Google and Apple.
- Associated Domains: `applinks:` for its return link and
  `webcredentials:calvaryscribblings.co.uk`.
- Autofill hints on its sign-in fields.
- The handshake's Radio side: the verifier, opening Story Island, the return link, and
  `/api/account/redeem`.
- `LSApplicationQueriesSchemes` / `<queries>` for Story Island.
- The words "your Calvary account".
- An in-app "Delete your Calvary account" that calls `POST /api/account/delete` (§5, "Deleting
  from inside the app"), alongside a link to `/account`, in Settings. `/account` is also its Play
  listing's deletion link.

## 9. What only Ikenna can set up

1. **Radio's identifiers.** Its iOS bundle id and Android package name. These are chosen once and
   can't be changed after release. Also Radio's **App Store app id**, and its Play **app signing**
   SHA-256 (the "App signing key certificate", not the upload key: see
   `docs/APP-DEEP-LINKS.md` §1).
2. **Radio under team 287PRDDG5J.** Webcredentials and Sign in with Apple only match up within one
   team. Apple gives the same reader a different identifier, and a different relay email, under a
   different team. So Radio must be published under the same Apple team as Story Island, or one
   reader becomes two accounts.
3. **Register Radio's iOS and Android apps in the Firebase project `calvary-scribblings`**, not a
   new project.
4. **Google sign-in.** Create Radio's OAuth client ids in that project. For Android, add Radio's
   signing fingerprints to its Firebase app.
5. **Apple sign-in.** Enable the capability on Radio's App ID. Any Services ID or key it needs is
   added to the Firebase Apple provider, never pasted into a chat.
6. **Google Play.** Set both apps' account-deletion URL to `https://calvaryscribblings.co.uk/account`
   once ACCOUNT-B2 is live. Until then, whatever deletion link Story Island's listing carries today stays as it is.
