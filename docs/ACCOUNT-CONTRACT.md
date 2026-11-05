# The Calvary account: what this repo promises

> Reviewed 5 Nov 2026. Items marked pending wait on a ruling or a measurement.

Written in RADIO-C0 (5 Nov 2026) from the code at `aca3a176` and Ikenna's ruling of one Calvary
account across the website, Story Island and Calvary Radio, and later Calvary Films and Calvary
Prints. Corrected in RADIO-B1 after review. Nothing here is built yet.

**This repo owns the account.** It's the one Firebase Authentication project the website already
signs readers into (`calvary-scribblings`). Story Island, Radio, and later Films and Prints, sign
into the **same** project. They never run a second user store, and never copy profiles between
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
- **The apps you've used:** Story Island and Radio, later Films and Prints. Each app records
  itself at sign-in in `account_apps/{uid}/{app} = { firstAt, lastAt }` (owner-only, server
  time, added to `OWNED_NODES`). The page lists them so the reader knows what deleting the
  account reaches.
- **Delete your Calvary account:** the existing endpoint and its modal, with the copy from
  `app/lib/accountDeletion.js`, rewritten to name every app.

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

## 6. Calvary Films and Calvary Prints

When either needs sign-in, it uses the same account under this contract: the same Firebase
project, the same three ways in, "your Calvary account", the handshake (§4), a line in
`webcredentials` (§3), a row in "The apps you've used" (§5), the deletion page (§5), and, as an
app that creates accounts, an in-app "Delete your Calvary account" on the same endpoint. No new
user store.

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
