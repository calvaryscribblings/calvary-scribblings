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
- **Follow, don't hide, at scale 1.** The guard translates the bar by the visual viewport's
  `offsetTop`, either sign (CSS `translate`, which composes with the story bar's slide and is never
  transitioned). It won't lag the way W16 feared:
  - healthy, `offsetTop` is 0 and nothing is applied, so momentum scrolling is untouched;
  - the iOS 26 fault is a **static** offset, so following it is one write;
  - the only moving offset at scale 1 is the keyboard's pan while typing, where a frame's trail beats
    a bar 240pt down or gone.

  Zoomed, the offset moves with every pan; there the bar is still hidden.
- **It re-reads on every event that can move a viewport**: window scroll and resize, the visual
  viewport's resize and scroll, and now `pageshow`, `focusin`, `focusout`, `orientationchange`,
  `visibilitychange` and `popstate`. After each (and on mount) it re-reads at 60, 180, 400, 800 and
  1500ms, because iOS settles late. It re-reads `window.visualViewport` each time, never a cached
  object.

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

## 5. The founder readout: `?debug=bar`, now a recorder

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

- **The tab bar during the door's lift.** It is still inside the transformed wrapper for about a
  second (#1). It's not the site bar, so it's out of this round. The fix is the Book Store's:
  `ArrivalVeil rise="page"` with the rise on the Library's own content box.
- **The drawer** (`.cs-drawer`, fixed at `top: 68px`) isn't translated. While it is open the guard
  holds the bar as it is.
- **Only his phone can confirm** which of #4, #5 or #6 it was: the frozen readout will say.
