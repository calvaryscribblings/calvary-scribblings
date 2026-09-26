# W16 — the story bar, measured on the glass

26 Sep 2026. Ikenna, 13:29, iPhone Safari on the live site, "The Number Thirteen": the
"Calvary Scribblings · SHORT STORY" bar sat about 40% of the way down the screen, over the story,
with text above and below it. W9 had reported this fixed.

## 1. The cheap causes, in order

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Is W9's fix what the live site serves? | **Yes.** | The live page's chunk `0jwv79q243o63.js` carries W9's `nextBar` (top zone 80, threshold 32, the `lastH` toolbar rule) and the fixed-top-0 CSS. `/build.json` said `51dec01c5f11`, built 12:08 UTC (13:08 London), 21 minutes before the walk. Every build since W9 (25 Sep, about 16:00 UTC) carries the fix. |
| 2 | Is his phone getting a stale copy? | **Not of the story page.** | `/stories/*` documents are network-first and never cached. `/_next/static/*` is content-hashed, so a stale copy is unreachable. `/sw.js` is `no-cache`. **One stale path did exist**, on `/my-library`: a cached shelf document raced the network against a 3s timeout (2.5s for its RSC payload) and won on a slow connection. That path is **fixed** (below). A second exposure is a tab iOS keeps in memory across a deploy. That is not a served copy, but it is old code, so it is **handled** too (below). |
| 3 | Has anything given the bar's ancestors a containing-block property? | **No.** | Checked at runtime on live, on every sampled frame. Signed out: momentum, both bounces, toolbar, rotation. Founder session: end to end, with the founder pill up. The only ancestors were `div.story-fade-in` (an opacity animation, which by spec is not a containing block), `body` and `html`. None of them carried a transform, filter, backdrop-filter, perspective, contain, will-change, container-type or content-visibility. W13's reaction transforms are all on descendants of the reaction button. The founder pill is a sibling. No scroll lock touches the story page. |
| 4 | Does anything move the page itself? | **No.** | No `body { position: fixed }` lock on the story page. The only scroll locks in the repo are `overflow: hidden` in QuizGuidelinesModal and the bookstore QuickLook. The scroller is the document, and `window.scrollY` tracks it. |

**So it was none of the four. The cause was the thing W9's proof measured wrongly.** W9 asserted
`getBoundingClientRect().top === 0`, which is a *layout-viewport* coordinate. A fixed bar lives at
the top of the layout viewport. On iOS that is the top of the screen only while the *visual*
viewport sits at `offsetTop 0, scale 1`. The two come apart in three ways: a pinch, a double-tap
zoom, and Safari's own zoom onto a focused field, which stays after the keyboard closes. The keyboard
panning the page does it too. Then the visual viewport moves inside the layout viewport, and the
bar is still "at top 0" but drawn wherever the layout top falls on the glass: 40% down, with text
above and below. W9's harness could not see this, because its number was right and its question
was wrong.

This is the one cause consistent with every measurement here. **Only his phone can confirm it**,
with the readout (section 3).

## 2. The fix

- **The bar is shown only while the viewports agree** (`viewportsAgree` in `app/lib/storyBar.js`).
  They disagree when `visualViewport.scale > 1.01` or `offsetTop > 2px`. A negative `offsetTop` is
  the top rubber-band, which the bar already rides out. While they disagree, the bar is **hidden**.
  It is never chased with an offset, because that would be a scroll-derived position, which W9
  ruled out, and on iOS it lags a momentum scroll. When they agree again, the bar comes back only
  by the ordinary rules: in the top zone, or after a 32px scroll up. `StoryBar` now listens to
  `visualViewport`'s `resize` and `scroll` as well as the window's. This applies to the Series bars
  too, which otherwise never hide.
- **The bar's only ancestors are `<body>` and `<html>`.** It moved out of the story's fade-in
  wrapper, which runs an animation, and it fades on its own element instead.
- **The service worker never hands an online reader an old build.** The timeout race is gone, so
  the cache answers only when the network *fails*. The cost, accepted: on a connection that hangs
  rather than fails, `/my-library` waits as long as the browser would, exactly as with no worker.
- **A tab that outlived a deploy** (iOS keeps them for days; bfcache restores them whole) checks
  `/build.json` when it comes back. That means a bfcache restore, or the tab becoming visible after
  30s away. If a newer build is live and the reader is in the top zone, the page reloads.
  Mid-story it is left alone: the next navigation is a fresh document anyway. Reading routes only
  (`/stories/*`, `/series/*`), never a page that might hold an unsent form.

## 3. The founder readout: `?debug=bar`

Add `?debug=bar` to any story or Series address while signed in as a founder. A panel near the
bottom of the screen shows, live:

```
build    51dec01c5f11  (live)      ← this page's build, and whether /build.json agrees
live     51dec01c5f11
scrollY  1400.0   innerH 844
vv       top 0.0  h 844.0  scale 1.00
bar      top -41.0  on screen -41.0  hidden
views    agree                     ← APART means the bar is meant to be hidden
ancestor none                      ← else: the first ancestor and its property
```

It follows the visual viewport, so it stays readable when the page is zoomed. It writes nothing.
For anyone else the flag does nothing, and the readout's code is never even loaded. If the bar
strays again, one screenshot tells us which case it is:
- `views APART` with the bar shown: a regression in this fix.
- `ancestor …`: a containing block.
- `STALE`: old code.
- All three clean, but `bar top` not matching where the bar is on the glass: a WebKit
  compositing fault. That would be a new kind of bug, and the screenshot would prove it.

## 4. The build ID on the page

`Build 51dec01c5f11` sits under the story's closing footer and in the site footer, as the app's
Profile footer shows its version. The colours are 4.80:1 on cream and 5.84:1 on the footer's
`#111`. It is the same 12 characters as `/build.json` and the service worker, and it is baked in
by `next.config.mjs`.

## Proof

- **`tests/storybar/w16-probe.mjs`** (WebKit, iPhone 390×844 and iPad 820×1180). It measures the
  bar *on screen*, `(rect.top − vv.offsetTop) × scale`, and checks every ancestor on every frame
  with the same `containingBlockAncestor` the readout runs. It covers W9's scenarios plus rotation,
  and a replayed zoom and keyboard (the visual viewport stood in, the way W9 replayed the bounce).
  A canary puts a transform on `<body>` and requires the check to catch it.
  - **before, live** (`51dec01c`): every W9 scenario passes, and no ancestor is hit on any frame.
    **Viewports apart: the bar stays shown on 81 of 90 frames**, drawn 300–520px down the glass.
    That is Ikenna's picture. Canary caught. (With the probe's final settings, 1× density and
    event sampling, the same run gave 79 of 91.)
  - **after, local build:** **24 of 24 runs pass.** That covers the story page and a Series
    instalment, at iPhone and iPad sizes, across all 6 scenarios. On every sampled frame, the shown
    bar at rest is at 0px on the glass and no ancestor is hit. **Viewports apart: 0 of 90 frames
    shown.** Canary caught 4 of 4.
  - **after, live** (`09af89155d10`, deployed 26 Sep ~22:35 UTC): **24 of 24 runs pass**, with
    the same figures as the local build. Viewports apart: 0 of 90 frames shown, on every surface
    and size. Canary caught 4 of 4.
  - The toolbar scenario samples thinly (3–56 frames). Software GL starves `requestAnimationFrame`
    during a viewport resize, so the probe also samples on `resize`/`scroll` events.
- **`tests/storybar/readout-shot.mjs`** (founder session, write firewall). The readout appears
  for a founder with `?debug=bar`, and shows all seven lines and `ancestor none`. It does not
  appear for a founder without the flag, or for a signed-out reader with it. The build stamp is on
  the page. Founder session end to end, with the pill up: no containing-block ancestor. **Writes
  dropped: 0; Ikenna's records re-read afterwards: unchanged.** The screenshot is kept locally,
  because the repo is public.
- **Live, founder readout** (`readout-shot.mjs` against `09af89155d10`): the same 13 checks pass.
  The readout reads `build 09af89155d10 (live)`, and the stamp reads `Build 09af89155d10`. 0
  writes dropped. Records unchanged.
- **Live, a stale tab** (Chromium, a newer `/build.json` faked, then a bfcache-style `pageshow`): in
  the top zone it reloads. Mid-story (y 3000) it does not. On the same build it does not.
- **`tests/ci/w16-bar.test.mjs`**: 39 of 39. Each of 8 reverts was watched failing: no viewport
  guard, `offsetTop` ignored, `will-change` unchecked, the bar back inside the wrapper,
  `will-change: transform` on `html`, the SW timeout race restored, a static readout import, and
  the readout not founder-gated. The suite includes the static guard that fails if `html`,
  `body`, `*` or `:root` gains a containing-block property in the global or bar-page CSS, or if the
  Series shells do.
- `npm run test:ci`: 1168 of 1168, W16's 39 included. Lint held at the baseline.

## The harness finding: this codespace's WebKit

Playwright's WebKit (2336) **crashes on every live story page here**, and has since at least this
round. There are two triggers, both in the machine's Mesa stack, neither in the site:
- On the default GPU path (llvmpipe), *any* `box-shadow: inset` kills the web process. The bar's
  W9 hairline is one.
- On the CPU Skia path, any `backdrop-filter` scrolling into view does.

`GALLIUM_DRIVER=softpipe` renders both. `tests/storybar/webkit.mjs` launches every storybar
harness that way. It is slower, and that is the only cost.

## What only his phone can confirm

1. That the cause was the viewports coming apart. The readout's `views` line says so the next time
   it happens, or the bar simply stays hidden when he's zoomed.
2. Momentum, the real toolbar, and the real bounce on iOS 26's Liquid Glass Safari. These are
   replayed here, not reproduced.
3. That a resumed tab in the top zone reloads onto the new build.
