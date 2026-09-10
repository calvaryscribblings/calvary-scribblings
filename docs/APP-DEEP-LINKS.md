# Universal Links and App Links — the specification the app repo builds against

**Round:** APP-DL1, 10 Sep 2026. Recon and web half.
**Ruled by Ikenna on the route table.** The claim set below is a ruling, not a proposal.
**The web files ship FIRST. The binary follows.** iOS fetches the AASA at install and caches it
stickily enough to need a reinstall to clear, so a wrong file cannot be fixed after the fact.

---

## 1. The identifiers

| | value | provenance |
|---|---|---|
| iOS bundle identifier | `uk.co.storyisland.app` | Apple's iTunes Lookup API for `id6769357370` |
| Android package name | `uk.co.storyisland.app` | it *is* the `?id=` in the live Play URL |
| App Store ID | `6769357370` | `app/lib/appLinks.js` |
| Live iOS | 1.5.0, 10 Sep 2026; min iOS 15.1 | iTunes Lookup |
| Live Android | versionCode 15, 11 Sep 2026 | `app/lib/appLinks.js` |

**Two values are not derivable from this repo and ship as placeholders** — see §6.

- **`<TEAM_ID>`** — Apple Developer → **Membership details** → Team ID. Ten alphanumerics.
  ⚠ Not the App Store artist id (`1896652339`), which is ten *digits* and a different number.
- **`<PLAY_APP_SIGNING_SHA256>`** — Play Console → app → **Test and release → Setup → App
  integrity → App signing** → **"App signing key certificate" → SHA-256 certificate
  fingerprint**. 32 uppercase hex pairs, colon-separated, exactly as the Console prints them.
  ⚠ **Not the "Upload key certificate" on the same page.** Google re-signs every upload with the
  app signing key, and that is what lands on the device. Using the upload key is the commonest
  App Links failure there is.

---

## 2. The claim set — TIER 1 ONLY

> Ikenna: *"A narrow claim that works beats a broad one that dead-ends."*

| claimed | app route | evidence |
|---|---|---|
| `/stories/*` | the story screen | `STORY-SERVING-CONTRACT.md` §9; `app/lib/storyIndex.js:5` (`storyHref`) |

**That is the whole claim.** It carries the newsletter — `/stories/${slug}` is the *only* URL
shape emitted by `emails/` and `workers-external/` — and almost the whole influencer push.

**Everything else on the site is unclaimed by omission**, which is the strongest form: there is
no broad pattern that an exclusion has to carve back out. The one `exclude` entry in the file is
the record of a ruling, not a mechanism (§4).

### Two hard acceptance criteria, before the binary ships

1. **A cold, signed-out, deep-linked open must render the story.** Not a splash, not a sign-in
   wall. The web gives a signed-out reader the whole body today — verified live 10 Sep 2026:
   `POST /api/story {"slug":"a-daub-of-blue"}` → `access:"full", reason:"gating_off"`. If the app
   walls a signed-out reader, the claim is **strictly worse than the browser** and must be pulled.
2. **If the destination cannot be rendered, hand back to the browser.** Open the URL externally
   rather than showing an app-shaped dead end.

### ⚠ One standing condition

`GATING_ENABLED = false` today, so nothing is gated. **If the gate is ever switched on, this
claim must be re-examined on iOS specifically:** contract §4.5 records that the iOS preview card
is non-transactional under 3.1.1 — *no purchase path at all*. A deep-linked iOS reader on a gated
story would hit a preview with no way forward, where the web offers membership. Turning the gate
on and leaving this claim standing is the same class of incident as R11.9.

---

## 3. The tier-2 ask list — questions for the app repo, not claims

Widening is cheap on iOS (a web deploy) and costs a binary on Android (§5). Each row needs a
yes/no before it is claimed:

| path | the question |
|---|---|
| `/reader/*` | Does the app render reader-mode **natively**, or does its `readerHref` handler open the URL externally? ⚠ **If externally, claiming this is a link loop:** app → opens `/reader/x` → universal link → app. |
| `/square`, `/square/p` (`?id=`) | Does the Square screen accept a single-post id? The web's copy-link button emits exactly `/square/p?id=<id>` (`app/square/page.js:305`). |
| `/public-library` | Is Home a shelf a cold deep link can land on? |
| `/search` | Does Search accept a query, or only a typed one? |
| `/user` (`?handle=`) **and `/u/*`** | ⚠ Both, or neither. `/u/:handle` is a server 301 and iOS matches the AASA against the **tapped** URL, so `/u/ada` must be claimed explicitly or it goes to the browser. |
| `/voices`, `/voices/*` | These are *roster slugs*, not handles, and they move (`arthor-eze → arthur-eze`). Does the app key on slug or on uid? |

---

## 4. Never claimed, with a reason each

| path(s) | reason |
|---|---|
| `/` | ⚠ The App Store listing's own `sellerUrl` **is** the bare domain. Claiming `/` sends a store visitor into the app they are looking at. |
| `/bookstore`, `/bookstore/*` | **Ruling — §5.** |
| `/membership` | Purchase path; 3.1.1. The web is where a membership is bought. |
| `/rewards` | Points/tier surface tied to membership; no app surface evidenced. |
| `/admin` + 17 `/admin/*` | Founder console. No app equivalent; opens the app and dead-ends. |
| `/my-library`, `/my-library/read` | The app's bar carries **no** My Library tab (`app/components/TabBar.js:156`), and the web shelf is explicitly the *reference* for one not yet built (`app/my-library/page.js:81`). Auth-gated besides. |
| `/profile`, `/settings`, `/account/deleted` | Auth-gated; the app has its own Settings; a signed-out deep link lands at a wall. |
| `/delete-account` | ⚠ Must stay web. Both stores require a publicly reachable deletion page, and it has to work for someone who has **already deleted the app**. |
| `/app`, `/links` | ⚠ These are the pages that *offer* the app. If the app claims them, a reader tapping "get the app" gets the app instead of the page. |
| `/open-pages` + 4 sub-routes | No app surface evidenced. Composer is web-only, edits server-side-only, drafts private. |
| `/series` + 3 sub-routes | `app/lib/series/format.js:108` — *"Nothing in the app renders an instalment's reading time … THE SERIES HAS NO SUCH COUNTERPART."* |
| `/book-reader` | Legacy reader host page. |
| `/leaderboard` + 2, `/reading-program` | No app surface evidenced; the terms page must read in a browser. |
| `/quizzes` | The app calls the quiz endpoints; no evidence of a quizzes index screen. |
| `/flash`, `/inspiring`, `/news`, `/poetry`, `/short` | Web category pages, children of the web's Home. |
| `/about`, `/contact`, `/privacy`, `/terms`, `/ai-policy`, `/age-verified` | ⚠ Both stores link the privacy URL directly. A privacy policy that opens an app is a review problem. |
| `/api/*` | Pages Functions, not pages. |
| `/.well-known/*`, `/_next/*`, `/sw.js`, `/manifest.webmanifest`, `/gateway-wall/*` | Assets. |

---

## 5. The Book Store, and why Android does not differ

The paragraph below is written **verbatim into the AASA's exclusion comment** — the reason lives
at the site, not only in a report. The Android half must carry it in the app manifest.

> App Store guideline 3.1.1 — the iPhone app shows no prices and no buy button. Three influencers
> publish on the 28th telling readers to buy on the website. A deep link that pulls those readers
> into an app where they cannot buy costs the sale and contradicts the brief. This stays on the
> web deliberately.

**Both platforms behave identically. Two reasons, and the second is the stronger:**

1. A link that behaves differently by phone is a support problem nobody can reproduce.
2. ⭑ **"Android can buy" is a legal assumption, not a technical one.** Play Billing makes an
   embedded web checkout its own policy question, and there is no evidence in this repo that the
   Android build has a purchase path at all — the storefront is one ratified design shared with
   iOS, and no real checkout has ever been run on any surface. You would be trading a certain web
   sale for an unverified app sale.

### ⚠ The asymmetry that will cause drift

**On iOS the path list lives in the web file. On Android it lives in the app manifest** —
`assetlinks.json` proves ownership only and carries no paths. So an iOS path change is a web
deploy and an Android path change is a **new binary**. Two places, two cadences. The claim set is
written down once, here; the manifest is a copy that must match.

The Android manifest half, for the same claim:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https"
        android:host="calvaryscribblings.co.uk"
        android:pathPrefix="/stories/" />
</intent-filter>
```

In Expo config terms this is `expo.android.intentFilters` with `autoVerify: true`; iOS is
`expo.ios.associatedDomains: ["applinks:calvaryscribblings.co.uk"]`. **No new dependency** —
both are pure configuration, and routing uses `expo-linking` / Expo Router's `linking` config,
which ship with Expo. ⚠ Confirm `expo-linking` is already in the app's `package.json` before
treating that as free.

---

## 6. How the files are served — the rewrite, and why not `public/.well-known/`

```
public/app-association/apple-app-site-association.json   ← the bytes
public/app-association/assetlinks.json

# emitted by scripts/generate-redirects.mjs into public/_redirects:
/.well-known/apple-app-site-association   /app-association/apple-app-site-association.json   200
/.well-known/assetlinks.json              /app-association/assetlinks.json                   200
```

- **200 is a rewrite, not a redirect.** The URL and status are unchanged, so neither Apple's CDN
  nor Google's verifier sees a 3xx. Both refuse a redirect, and Apple caches the refusal.
- **Whether Cloudflare Pages uploads a dot-directory is unresolved and must not be bet on.**
  Next 16.2.1 *would* copy it (`next/dist/export/index.js:523` passes `recursiveCopy` exactly one
  filter, "exclude paths used by pages"; no dotfile exclusion exists in `recursive-copy.js`), but
  Pages is the second half of the journey and multiple reports say it treats dot-prefixed
  directories as hidden. Cloudflare's own Known Issues page says nothing either way.
- ⭑ **The rewrite is immune to the question.** R24.1: a rule beats a matching static asset. If
  Pages *does* upload the dot-directory, the rule still wins and the bytes are the same bytes.
- The `.json` extension on the target is what makes Pages type the response `application/json`
  without anyone guessing how it types an extensionless file.
- ⚠ **Both rules are static** (no `*`, no `:placeholder` in the source), so R24's dynamic latch is
  untouched: 357 static of 2,000, one dynamic, still last.
- ⚠ **Into `STATIC_LEGACY_REDIRECTS` via the generator, never into `public/_redirects` by hand** —
  the file is regenerated on every build. The emitter now carries an optional third element
  (the status); a two-element entry still means 301.
- ⚠ **No second copy under `public/.well-known/`.** Asserted by
  `tests/applinks/association.test.mjs`. Two sets of bytes that can drift, one of which nobody
  serves, is worse than the question it would answer.

### The placeholder gate

Both files ship with literal placeholders. `tests/applinks/association.test.mjs` asserts that
state **out loud** (`TEAM_ID_PENDING`, `FINGERPRINT_PENDING`), so the day the real values land
the assertion flips in the same commit — and the well-formedness checks behind it start doing the
work. Run `npm run test:association`; it also runs in `rules-and-hygiene.yml`.

**Nothing is submitted to either store while those two flags are `true`.**

---

## 7. The order of operations

1. ✅ **Probe deploy — DONE AND PASSED, 10 Sep 2026** (`461408c7`). Measured, not assumed:

   ```
   /.well-known/apple-app-site-association   HTTP/2 200 · application/json · 0 redirects
   /.well-known/assetlinks.json              HTTP/2 200 · application/json · 0 redirects
   app-site-association.cdn-apple.com/a/v1/calvaryscribblings.co.uk
                                             HTTP/1.1 200 · application/json
                                             Cache-Control: max-age=21600, public
   ```

   The content type is right **with no `_headers` rule** — the `.json` extension on the rewrite
   target does it, so nothing needs adding. Apple can reach and parse the file, and the
   exclusion comment round-trips intact. The dot-directory question never had to be answered.

   ⚠ **Apple's CDN TTL is six hours, and that probe primed it with the PLACEHOLDER file.** No
   device can be affected — nothing carries the entitlement yet — but see step 3.

   R24 tail check against production, because the file grew by four rules: the file's **final**
   rule (`/u/:handle` → `/user?handle=ikenna`) answers, which proves every rule above it was
   parsed. Fallback unchanged: `/stories/a-daub-of-blue`, `/bookstore` and `/` all 200.
2. **Ikenna fetches** the Team ID and the Play App Signing SHA-256.
3. **Land the real values**, flip both `_PENDING` flags in the same commit, deploy, re-verify the
   origin **and Apple's CDN**. ⚠ **The CDN holds the placeholder version from step 1 for up to
   six hours** (`max-age=21600`, measured). The binary must not be submitted until a fetch of
   that CDN URL shows the real Team ID — not until the origin does, which is sooner and is not
   the thing a device reads.
4. **Then** the binary: runtime pinned first, then the version bump, then the two config blocks —
   in one commit.
5. Cut, submit, and re-run `node scripts/adoption-report.mjs` the day after it lands
   (see [`OWED-APP-ENDPOINT-SILENCE.md`](OWED-APP-ENDPOINT-SILENCE.md) — the instrument that
   should show this working may itself be dead).

### Verification commands

```
curl -sI https://calvaryscribblings.co.uk/.well-known/apple-app-site-association
curl -sI https://calvaryscribblings.co.uk/.well-known/assetlinks.json
curl -s  https://app-site-association.cdn-apple.com/a/v1/calvaryscribblings.co.uk
adb shell pm get-app-links uk.co.storyisland.app        # Android, after install
```

For TestFlight and dev builds, `applinks:calvaryscribblings.co.uk?mode=developer` bypasses
Apple's CDN and fetches the origin directly. **It must not ship.**

---

## 8. Proposed version and build numbers

| | from | to | confidence |
|---|---|---|---|
| `expo.version` | 1.5.0 | **1.6.0** | firm — a new capability, not a patch |
| `android.versionCode` | 15 | **16** | firm |
| `ios.buildNumber` | 30 | **31** | ⚠ confirm in `app.json`; 30 is inferred from the build-30 sweep |

⚠ **Pin the runtime first, then bump the version, in one commit.** Associated domains and intent
filters are *native* config: the binary changes, so an OTA bundle built for it must never reach a
1.5.0 install. Set `runtimeVersion` to an explicit string rather than relying on a
`{"policy": "appVersion"}` to fork it as a side effect — a policy that derives the runtime from
the version is the same shape as R48's `isLive(url)`: a property of the config standing in for
the property you actually need.

### Riding this cut

- `c86cc1c` — the banner fix, ruled not worth its own cut. ⚠ Not an object in this repo; confirm
  it is on the app's main before cutting.
- The reading-position pin's **app half**, and the copy-provenance question
  (`docs/reading-position-pin.md:4`, `:117`).
- Foliate parity — blocked on the app's per-file list and `notVendored` (`FOLIATE.lock`).
- Fore-edge / `BoundBook` geometry: the app transcribed it **from this repo** and R17/R34 have
  moved since.
- The reverse port of R13 (curation sections), R14 (readership counts), R15 (placement).
- R44 subcategory taxonomy; R39's no-emoji rule.
- `STORY-SERVING-CONTRACT.md` §9's client checklist — ⚠ and see
  [`OWED-APP-ENDPOINT-SILENCE.md`](OWED-APP-ENDPOINT-SILENCE.md) first, because there is no
  evidence any of it has shipped.
