# W18 — no zoom on a tapped field, the slow shelf (ruling 42), the Android test push

27 Sep 2026.

## 1. No focus zoom

iOS Safari zooms the page when a focused field's text is under 16px, and the zoom outlasts the
keyboard. That zoom is what put the story bar mid-screen (W16).

**The fix, at the source.** The site has 217 field sites in 39 files. So instead of fixing each
one, `app/globals.css` has one rule for touch screens (`(hover: none) and (pointer: coarse)`):
every text input, textarea, select and editable field renders at **16px**.
- It uses `!important`, because most fields set their size inline.
- Fields that are deliberately larger carry `data-field-large` and keep their own size: search
  (20px), and the Open Pages title (46.4px) and body (19.5px) on both the new and edit pages.
- A mouse-and-keyboard screen is unchanged.
- Pinch zoom is kept: there's no `maximum-scale` and no `user-scalable=no` anywhere.
  `tests/ci/w18-fields.test.mjs` pins all of this, and fails if either rule is reverted.
- The Square's messages button now has `aria-label="Messages"`, so the census (and a screen
  reader) can find it.

**Census.** `tests/typography/field-census.mjs` covers every surface a reader can reach at
390×844 with a touch screen. That's signed out, and signed in as the W17 test reader behind the
firewall (no records changed). It opens the boxes that only appear on a tap: Reply, sign-in,
create account, forgot password, Edit profile, the Square's messages, and delete account.

| Field | Where | Before (live) | After |
|---|---|---|---|
| Newsletter email | /public-library | **12.8** | 16 |
| Date of birth | Create account | **13.12** | 16 |
| Reply box | the Square | **14.08** | 16 |
| Name, handle | Edit profile | **14.4** | 16 |
| Email, password | Sign in | 14.72 | 16 |
| Name, handle | Create account | 14.72 | 16 |
| Username confirm | Delete account | 14.72 | 16 |
| Composer | the Square | 15.2 | 16 |
| Bio | Edit profile | 15.2 | 16 |
| DM search, message box, report note, story-attach search | the Square | 14.08 (source) | 16 |
| Poll question and options (moderators) | the Square | 14.4 (source) | 16 |
| Newsletter email | end of a story | 16 | 16 |
| Response, reply | story page | 16 | 16 |
| Comment, reply | Open Pages | 16 | 16 |
| Search | /search | 20 | 20 (large) |
| Title, body | Open Pages new / edit | 46.4 / 19.5 | kept (large) |

That's **12 of 20 fields under 16px before, and 0 after** (on the local build; the live re-run is
below). /admin is founders-only, so no live test reaches it; its fields are covered by the same
rule.

**Look changes worth noticing.** These are phone only; a desktop is unchanged.
- The newsletter box on /public-library: text goes from 12.8px to 16px, and the box grows from
  42px to 47px.
- The date of birth on Create account: 13.1px to 16px, and 47px to 51px.
- The Square's reply box and the DM boxes: 14px to 16px.
- Edit profile's name and handle: 14.4px to 16px.
- Everything else moves by 1–1.3px.

Nothing overflows or truncates. The biggest change is the newsletter box; it reads larger but
keeps its place beside Subscribe.

## 2. Ruling 42: the slow shelf

Ikenna, 27 Sep: on a slow but live connection, My Library shows the saved copy after 3 seconds
again, as before W16, and refreshes once the network answers.

**`public/sw.js`.** The race is back. A cached shelf document is shown after 3s, and its RSC
payload after 2.5s, but only when a copy is in hand. When the late response arrives, the cache
is refreshed (as before W16) and every open window gets `CS_SHELL_REFRESHED`.

**`app/components/Providers.js`.** On that message the page runs W16's build check, which now
covers `/my-library` too. If `/build.json` names a newer build and the reader is near the top,
the page reloads onto it. Anywhere lower, it doesn't. `useOffline` clears the banner on the same
message.

**Proof (`tests/offline/slow-shelf.mjs`, Chromium, the real worker, local build).** The shelf
document was held for 9s. The saved copy painted at **3.2s**, and the page was told when the
network answered. With the same build live there was no reload; with a newer build live and the
reader at the top, the page reloaded.
- `CS_OFFLINE` goes out before the page it serves exists, so a slow load raises no offline
  banner. That was equally true before W16.

## 3. The Android test push: skipped

Ikenna's uid holds **one device: iOS** (app 1.7.0, token refreshed 27 Sep 00:22 UTC), and no
Android token. So nothing was sent. The only Android token in `push_tokens` belongs to a reader
account, not a founder; the test tool never targets a reader.

## Suites

`test:ci` 1200/1200 (W18 4/4; W16's service-worker tests now pin ruling 42), plus `test:launch`,
`test:square`, `test:openpages`, `test:account` and `test:build`. Lint is held and the build
passes.
