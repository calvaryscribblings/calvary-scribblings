# Sign in with Apple on the website: the setup before the switch

APPLE-W1 (24 Nov 2026). "Continue with Apple" is built and tested, but it is **off in production**:
`APPLE_WEB_READY = false` in `app/lib/appleSignIn.js`. The 16 Apple-only accounts can't use the
website until these steps are done and the switch is flipped.

## Why it is off

The live `apple.com` provider in Firebase Auth was read on 24 Nov 2026: **enabled, but set up for the
iOS app only.** It has no web Services ID and no code-flow key (Team ID, Key ID, private key). A
website pop-up needs both, so with the button showing, every reader's attempt would fail.

## Steps (Ikenna: Apple Developer account + Firebase console)

1. **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → + → Services IDs.**
   Make one for the website, e.g. `uk.co.calvaryscribblings.web`. Tick **Sign in with Apple** →
   Configure:
   - Primary App ID: the iOS app's App ID (the one already using Sign in with Apple).
   - Domains and subdomains: `calvary-scribblings.firebaseapp.com`
   - Return URL: `https://calvary-scribblings.firebaseapp.com/__/auth/handler`

   (The site's `authDomain` is `calvary-scribblings.firebaseapp.com`, so Apple returns to Firebase's
   handler there, not to calvaryscribblings.co.uk.)
2. **Keys → +**, tick Sign in with Apple, choose the same primary App ID, then download the `.p8`
   file. Download it once and keep it private. An existing Sign in with Apple key can be reused instead.
3. **Firebase console → Authentication → Sign-in method → Apple → edit.** Under the web settings,
   enter the Services ID (step 1), the Apple **Team ID**, the **Key ID** and the `.p8` contents
   (step 2). Save. The iOS app is unaffected because its bundle-ID sign-in stays as it is.
4. **Private relay email (recommended).** Readers who hide their email get a
   `@privaterelay.appleid.com` address. Apple delivers mail to those only from registered senders:
   Apple Developer → Services → **Sign in with Apple for Email Communication** → add
   `calvaryscribblings.co.uk` and `noreply@calvaryscribblings.co.uk` (and pass its SPF check). Without
   this, welcome and verification mail to those readers is dropped. The iOS app's Apple sign-ups
   already have this problem.

## Then (the session, outside 19:30–00:00 London)

5. Set `APPLE_WEB_READY = true` in `app/lib/appleSignIn.js`. Update the switch test in
   `tests/account/apple-signin.test.mjs`, which pins `false` on purpose so the flip is a deliberate
   two-line change.
6. Run `npm run test:account` and `npm run test:apple-signin`, then push.
7. On the live site, Ikenna signs in once with his own Apple ID, both in the header modal and on
   `/account/shop`. Check that the pop-up returns to the same tab and lands on the existing account
   (the same uid the app uses), not a new one. This is the one check the emulator can't make.
