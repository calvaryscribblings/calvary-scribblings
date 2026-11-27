# Sign in with Apple on the website: the setup before the switch

APPLE-W1 (24 Nov 2026). "Continue with Apple" was built and tested with the switch **off**.
**Steps 1 to 4 were done by Ikenna (reported 27 Nov 2026)**, and on 27 Nov the live provider read back
with a web Services ID and a code-flow Team ID, Key ID and private key all set. The switch is now
on: `APPLE_WEB_READY = true` in `app/lib/appleSignIn.js`.

## Why it was off

The live `apple.com` provider in Firebase Auth was read on 24 Nov 2026: **enabled, but set up for the
iOS app only.** It has no web Services ID and no code-flow key (Team ID, Key ID, private key). A
website pop-up needs both, so with the button showing, every reader's attempt would fail.

## Steps (Ikenna: Apple Developer account + Firebase console) — 1 to 4 DONE by Ikenna, 27 Nov 2026

1. *Done by Ikenna, 27 Nov 2026.* **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → + → Services IDs.**
   Make one for the website, e.g. `uk.co.calvaryscribblings.web`. Tick **Sign in with Apple** →
   Configure:
   - Primary App ID: the iOS app's App ID (the one already using Sign in with Apple).
   - Domains and subdomains: `calvary-scribblings.firebaseapp.com`
   - Return URL: `https://calvary-scribblings.firebaseapp.com/__/auth/handler`

   (The site's `authDomain` is `calvary-scribblings.firebaseapp.com`, so Apple returns to Firebase's
   handler there, not to calvaryscribblings.co.uk.)
2. *Done by Ikenna, 27 Nov 2026.* **Keys → +**, tick Sign in with Apple, choose the same primary App ID, then download the `.p8`
   file. Download it once and keep it private. An existing Sign in with Apple key can be reused instead.
3. *Done by Ikenna, 27 Nov 2026.* **Firebase console → Authentication → Sign-in method → Apple → edit.** Under the web settings,
   enter the Services ID (step 1), the Apple **Team ID**, the **Key ID** and the `.p8` contents
   (step 2). Save. See the note on the bundle-ID list below.
4. *Done by Ikenna, 27 Nov 2026.* **Private relay email.** Readers who hide their email get a
   `@privaterelay.appleid.com` address. Apple delivers mail to those only from registered senders:
   Apple Developer → Services → **Sign in with Apple for Email Communication**. What is registered:
   - the domain `calvaryscribblings.co.uk`;
   - the domain `send.calvaryscribblings.co.uk`. All our mail goes through Resend, and Resend's
     return path is its `send.` subdomain, so that is the domain Apple's SPF check sees;
   - Firebase's own sender `noreply@calvary-scribblings.firebaseapp.com`, which sends password resets.

   Without these, welcome, verification and reset mail to those readers is dropped.

**The bundle-ID list.** The provider's bundle-ID list is empty, and the iOS app still signs in with
Apple (checked by Ikenna before APPLE-W1 go, 27 Nov 2026), so any later change to the Apple provider
needs that same check.

## Then (the session, outside 19:30–00:00 London)

5. *Done 27 Nov 2026 (APPLE-W1 go): committed inside the release window, to be pushed after 00:00 London.* Set `APPLE_WEB_READY = true` in `app/lib/appleSignIn.js`. Update the switch test in
   `tests/account/apple-signin.test.mjs`, which pinned `false` on purpose so the flip is a deliberate
   two-line change; it now pins `true`.
6. Run `npm run test:account` and `npm run test:apple-signin`, then push.
7. On the live site, Ikenna signs in once with his own Apple ID, both in the header modal and on
   `/account/shop`. Check that the pop-up returns to the same tab and lands on the existing account
   (the same uid the app uses), not a new one. This is the one check the emulator can't make.
