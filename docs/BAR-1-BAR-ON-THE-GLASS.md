# BAR-1 — the site bar, on the glass at last

28 Nov 2026, 03:33. Ikenna, iPhone, Safari, live, signed in, `/public-library`: the site bar
(`.cs-nav`) drawn with its top about 240pt below the top of the screen, over Just Added's covers,
content above and below it. The bottom tab bar sat where it belonged. The page was **not zoomed**.
Mid-walk: a Continue Reading card into a story, back to Home, the ✕, reading on. The same bar on the
same page on 30 Sep (444px down, W31); the story bar on 26 Sep (W16).

**Verdict: the cause is narrowed, not proven on the device.** No engine this codespace can run has
iOS's viewport. The fix below makes the bar hold the top of the screen for every mechanism that fits
the picture, and the founder readout now freezes the readings the next time anything moves it.

## 1. What the picture rules in, and out

A fixed bar at `top: 0` lives at the top of the **layout** viewport. The tab bar, at `bottom: 0`,
lives at its bottom. Both are children of the same page `<div>`, so they share every ancestor.

- A **containing-block ancestor** moves both: the nav to the top of that ancestor, the tab bar to
  its bottom (off screen, on a page this tall). Ikenna's tab bar was in place.
- A **zoom** moves both, and he wasn't zoomed.
- What draws the top bar 240pt down **and** leaves the tab bar at the bottom is a layout viewport whose
  top is 240pt below the glass while its bottom is the glass's bottom: a visual viewport with a
  **negative `offsetTop`** at scale 1, and/or one whose height has not come back to `innerHeight`.

W16's guard read a negative `offsetTop` as the top rubber-band and **painted the bar**. That is
consistent with what he saw (painted, not hidden). And it is a known fault: iOS 26 has an open
regression, after the keyboard closes or an interactive swipe-back, in which the visual viewport
stays offset from the layout viewport, unzoomed, and its height stays short of `innerHeight`, with
no viewport event to say so (Apple Developer Forums thread 800125; WebKit bug 300523; Apple thread
797097 names the swipe-back).

## 2. Every way, tested on /public-library

`tests/storybar/bar-1.spec.mjs`: WebKit, iPhone 13 profile, the emulators. Every frame and every
window and viewport event is sampled. The visual viewport is replayed, as W16 did.

| # | Mechanism | Result | Evidence |
|---|---|---|---|
| 1 | **A containing-block ancestor, at any moment** | **Reproduced, and fixed.** Not tonight's cause (it would move the tab bar too), but a real one. | During the door's lift (`ArrivalVeil`, `rise="wrapper"`), `div.cs-arrive-rise.is-lifting` carries `transform: matrix(1,0,0,1,0,13.9)` and is an ancestor of the site bar *and* the tab bar for about a second. The probe caught it on every lift frame on the old code; with the bar in its body host, none. |
| 2 | CSS from any page touching `.cs-nav` or `nav` | Ruled out. | No selector outside `Navbar.js` reaches the site bar (`nav.cs-tabbar` in LaunchGate is the tab bar's z-index only). |
| 3 | `html`/`body` scroll locks or overflow | Ruled out on Home. | The only body locks are QuizGuidelinesModal and the Book Store's QuickLook; neither is on Home. The story and Book Store pages' `body { overflow-x: hidden }` are inline styles on full-navigation pages. |
| 4 | Events the guard didn't hear: `pageshow`, `focusout`, `orientationchange`, `visibilitychange`, `popstate` | **Reproduced, and fixed.** | Back from a story with the viewport stuck 240 off and only `pageshow` to say so: the old guard painted the bar **at 240 on the glass, never corrected** (exactly Ikenna's picture). With the keyboard replayed and left stuck: hidden for 8.5s and never back. Both now answered. |
| 5 | A negative `offsetTop` at scale 1 | **Reproduced, and fixed.** | The old rule called it "agree". It is the one replayed fault that draws the picture with the tab bar in place. |
| 6 | A visual viewport left short of `innerHeight`, `offsetTop` 0 | **Not detectable** from the API. | If the glass is offset while the API says 0, no script can place the bar. The readout freezes on it (`SHORT VIEW`), with no field focused. |
| 7 | Zoom (pinch, double-tap, Safari's focus zoom) | Ruled out tonight. | He wasn't zoomed. No field on a touch screen is under 16px since W18 (§4). Still hidden while zoomed. |
| 8 | First load, the hero carousel, the Continue Reading and Series rows mounting, the drawer, the sign-in box, client-side navigation and `popstate`, rotation | Clean. | On the glass and no containing block on every frame of each. |
| 9 | A bfcache restore | Replayed as a fresh load. | WebKit here comes back as a load (`back(load)`); the restore path is the same `pageshow` handler. |
| 10 | A stale build | Ruled out. | `dafb47f1` was live from 03:09 UTC; the walk was at 03:33. |
| 11 | A view transition's snapshot | Ruled out. | `BOOK_TRANSITION_SHIPPED` is `false`; the layout emits no view-transition CSS. |

## 3. The fix: the bar holds the top of the screen

- **No ancestor but `<body>` and `<html>`.** After hydration the bar and its drawer render through a
  portal into one host, `<body>`'s **first** child, `display: contents`: it draws no box, so it can
  never be a containing block, and being first keeps every stacking tie as it was. Server render and
  hydration are inline, so first paint is unchanged.
- **Follow, don't hide, at scale 1, but only a SETTLED offset (BAR-1 go).** The guard translates the
  bar by the visual viewport's `offsetTop`, either sign (CSS `translate`, which composes with the
  story bar's slide and is never transitioned). It does so only when all three hold:
  - no field has focus;
  - the offset hasn't changed for **150ms** (`FOLLOW_SETTLE_MS`, a chosen number);
  - the page isn't overscrolled.

  The 150ms are counted only while the bar may follow. An offset seen during a bounce or with a field
  focused never counts towards settling: when a rubber band ends, the scroll comes back a moment before
  the offset does, and the WebKit suite caught that moment following an offset that had "held" for
  800ms, all of it overscrolled. Timer re-reads read at once rather than waiting a frame each.

  Otherwise W16's behaviour stands: a positive offset hides the bar, and a negative one leaves it where
  the layout viewport puts it. So code never moves a bar while the offset is moving, which is the lag
  W16 avoided. The fault being corrected is static, so following it is one write. Zoomed, the bar is
  hidden. One rule for every bar the guard drives: the site bar, the story bar (with its scroll-hide)
  and the verify banner.
- **It re-reads on every event that can move a viewport**: window scroll and resize, the visual
  viewport's resize and scroll, and now `pageshow`, `focusin`, `focusout`, `orientationchange`,
  `visibilitychange` and `popstate`. After each (and on mount) it re-reads at 60, 180, 400, 800 and
  1500ms, because iOS settles late. It re-reads `window.visualViewport` each time, never a cached
  object.

- **The open drawer moves with the bar (BAR-1 go).** While it is open the guard holds the bar as it
  is, and the drawer takes the bar's translate as it opens. A guard that re-attaches to a bar already
  following an offset counts it as settled. Without that, closing the drawer dropped the bar back off
  the glass for 150ms; the WebKit suite caught it.
- **The arrival lift moves both bars nowhere (BAR-1 go).** The Library's `ArrivalVeil` is
  `rise="page"`, as the Book Store's has been since W32. The rise lands on the page's content box
  (`data-library-content`), and the site bar, the tab bar and the Square button sit outside it.

## 3a. Stacking (BAR-1 go)

The bar used to be in the page's own tree. Its root `<div>` forms no stacking context, so the bar
competed in the root stacking context at `z-index: 1000` in its DOM position. Now it competes in the
same context at the same z, as `<body>`'s first child. Its order against anything else can change
in only two ways: an element at exactly 1000 that came before it in the DOM, or a moment when an
ancestor formed its own stacking context (the arrival wrapper's transform). The census of every
fixed overlay reachable on the 25 site-bar pages, four import levels deep plus the global overlays
(`Providers`):

| Overlay | z-index | On dafb47f1 | Now | Proof |
|---|---|---|---|---|
| Arrival veil | 10000 | above | above, holding and lifting | browser, every frame of the arrival |
| Save toast region | 10000 | above | above | browser |
| Cookie banner | 9999 | above | above | browser |
| Book Store launch gate | 9000/9100 | above | above | z (Book Store only) |
| Age check (DobCheck) | 2001 | above | above | z, same mount as the profile step |
| Profile completion step | 2001 | above | above | browser |
| Sign-in box (AuthModal) | 2000 | above | above | browser |
| Open Pages composer sheets | 1100–1300 | above | above | z (/open-pages/new only) |
| Book Store QuickLook | 1200 | above | above | z (Book Store only) |
| Bell panel | 1100 (inside the bar) | above | above | browser (desktop; a phone opens /notifications) |
| Composer rail | 1050 | above | above | z (/open-pages/new only) |
| **Leaderboard badge ladder** | **1000, tie** | above (later in the DOM) | above | browser |
| **Open Pages reading progress** | **1000, tie** | above (later in the DOM) | above | browser, plus DOM order |
| Founder readout | max | above | above | browser |
| Verify-email banner | 998 | below by design, **above mid-arrival** | below | z: it sits at top 68px, under the bar, so it never meets it |
| Square button (tablet) | 900 | below; above mid-arrival | below | z, bottom-right, never meets the bar |

The only change is mid-arrival. On dafb47f1 the bar sat inside the transformed wrapper for the lift
(about a second), so anything positioned outside it painted over it, including the verify banner and
the Square button. Neither one overlaps the bar, so nothing a reader can see changes.

## 4. Fields under 16px

None on a touch screen. W18's rule in `app/globals.css` sets every text field to 16px under
`(hover: none) and (pointer: coarse)`. The six opt-outs (`data-field-large`) measure 22px (the
Book Store search), 1.25rem (the search page), 2.9rem and 1.22rem (the new Open Pages piece's title
and body), and 1.85rem and 1.18rem (the edit page's title and body). All are 16px or more. Fields Safari could still zoom onto are ones this CSS can't reach,
such as a payment provider's iframe.

**Proposal, not built:** if a field ever must be under 16px, set `maximum-scale=1` in the viewport
meta **on iOS only** (sniffed client-side). iOS then never auto-zooms onto a focused field and still
lets the reader pinch, because iOS ignores `maximum-scale` for user zoom. It changes no field's look.
It must never ship to Android, where it disables pinch zoom. `tests/ci/w18-fields.test.mjs` would need
to allow it in that one form.

## 5. The founder readout: a recorder on every visit (BAR-1 go)

For founders it records on every visit, with no flag. Nothing is drawn until a record freezes; then
the frozen panel appears, and a **tap clears it**. A cleared condition must go away once before it
can freeze again. A condition must hold for **600ms** (`TRIGGER_HOLD_MS`, chosen) before it freezes,
so a bounce or a keyboard closing is not a record; a containing block freezes at once.
`?debug=bar` shows the live panel; `?debug=bar-off` turns recording and panel off for the session.
Founders only, checked before its code loads. The ancestor walk runs every 250ms, not every frame.

### As first built (BAR-1)

- **Sticky for the session.** Once seen, it stays on across client-side navigation and full page
  loads in that tab, until `?debug=bar-off`. Founders only, checked before its code loads.
- It keeps the last 4 seconds of readings and the last few window and viewport events.
- It **freezes** into sessionStorage, still on screen on later pages, when:
  - `OFF-GLASS`: the painted bar's top is below the top of the glass;
  - `FOLLOWING`: the guard is translating the bar;
  - `SHORT VIEW`: the viewport is short of `innerHeight` at scale 1 with no field focused;
  - `ANCESTOR`: a containing block appears.

  `?debug=bar-reset` clears a frozen record.

One screenshot of a frozen panel names the trigger, the event before it, and the numbers.

## Still open

- **Only his phone can confirm** which of #4, #5 or #6 it was: the frozen record will say.
- The `maximum-scale` proposal (§4) stays unbuilt, by ruling.

## Proof (BAR-1 go)

`npm run test:bar-1`: WebKit, iPhone 13, the emulators, 17 tests, all passing on the branch. Run
against 771ee531 (before the settle rule), the step-1 tests fail. Run against dafb47f1, the stacking
tests give the "on dafb47f1" column above. `tests/ci/bar-1.test.mjs` holds the rule's pure half. Its
twelve settle tests were written first and watched failing on 771ee531.
