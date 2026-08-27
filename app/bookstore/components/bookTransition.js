// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE BOOK CARRIES YOU TO ITS PAGE — R22C
//
// ⚠ NO 'use client' DIRECTIVE, DELIBERATELY. This module holds constants, two CSS strings and
// some DOM helpers — no hooks, no JSX, no component. app/layout.js is a SERVER component and
// has to read VIEW_TRANSITION_OPT_IN_CSS and VIEW_TRANSITION_GUARD_JS out of it to put them in
// the static <head>; marking the file client-only would make those two exports client
// references rather than strings, and the head would get a proxy instead of a stylesheet. The
// browser-only functions below are called from client effects and are the caller's business.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Per the approved mock: a book on the shop takes the reader to its detail page with the cover
// PERSISTING across the navigation. It lifts from where it stands, travels, and lands as the
// detail page's own board. The cover must never blink out and back — that is the whole effect.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE MECHANISM, AND THE THING THAT ALMOST STOPPED IT WORKING
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// next.config.mjs sets output:'export'. Every /bookstore/{slug} is a FILE and every link to one
// is a REAL document navigation — the shop uses plain <a href>, not next/link, so nothing
// intercepts it. So this is a CROSS-DOCUMENT VIEW TRANSITION:
//
//   · `@view-transition { navigation: auto }` in a stylesheet on BOTH documents, same origin
//   · the same `view-transition-name` on the outgoing element and the incoming one
//   · the browser snapshots both and morphs one into the other
//
// VERIFIED, NOT ASSUMED, before any of this was built. Chromium 151 (the version Playwright
// 1.62 ships) parses `@view-transition` into a CSSViewTransitionRule, and a scripted click
// through a plain <a> between two static files fires `pageswap` with a live `e.viewTransition`
// on the way out and `pagereveal` with one on the way in. That pair is also what makes this
// ASSERTABLE HEADLESSLY, which almost nothing about an animation is — see
// tests/bookstore/payload.spec.mjs.
//
// ── ⚠ THE TIMING WINDOW, WHICH IS THE WHOLE DIFFICULTY ────────────────────────────────────
//
// The incoming snapshot is taken at the FIRST RENDERING OPPORTUNITY after `pagereveal`. An
// element that appears later is not in it, the names do not pair, and the browser falls back to
// its default root cross-fade — which is precisely the cover blinking out and back.
//
// Measured, on a probe with the same browser, mounting the incoming element four ways:
//
//     during parse       in the snapshot        ✓
//     setTimeout(…, 0)   in the snapshot        ✓
//     requestAnimationFrame   TOO LATE          ✗
//     setTimeout(…, 300)      TOO LATE          ✗
//
// And the detail page fetches its title from Firebase — hundreds of milliseconds, firmly in the
// "too late" column. It renders a SKELETON meanwhile. So a naive cross-document transition on
// this shop would have paired the shelf's cover with a grey rectangle.
//
// ⭑ THE ANSWER IS THAT THE BOARD IS IN THE PRERENDERED HTML. app/bookstore/[slug]/page.js
// already reads the title from Firebase at BUILD time for generateMetadata; R22 has it pass the
// four fields a cover needs to BookDetailClient as `seed`, and the client draws its BoundBook
// from `title ?? seed`. The board is therefore in the parsed document — the "during parse" row
// above — at its final geometry, before a byte of Firebase has arrived. When the live record
// lands it carries the same coverUrl, so the <img> src does not change and nothing repaints.
//
// This is why the effect is real rather than staged. There is no full-screen overlay pretending
// to be a cover; the two documents genuinely each own a board and the browser morphs between
// them.
//
// ── HOW IT DEGRADES, WHICH IS TO NOTHING AT ALL ──────────────────────────────────────────
//
// Cross-document view transitions ship in Chrome/Edge 126+ and Safari 18.2+. Firefox has not
// shipped them. On a browser without support, `@view-transition` is an unknown at-rule and is
// dropped, `view-transition-name` is an unknown property and is dropped, and the <a> performs
// the navigation it was always going to perform. NOTHING here is load-bearing for getting to
// the page: no click handler calls preventDefault, no navigation is performed by script, and if
// every line of this module failed the shop would still work exactly as it did before R22.
// That is the test to apply to any future edit here.
//
// ── WHY THE NAME IS STAMPED AT CLICK TIME AND NOT IN THE STYLESHEET ──────────────────────
//
// `view-transition-name` must be UNIQUE in a document. The shelf draws twenty-odd boards; if
// the rule named them all, the browser would find duplicates and silently skip the transition
// for every one of them. So exactly one element is named, at the moment a link is followed, and
// it is un-named on the way back (see `disarm`) so a bfcache restore does not leave a stale
// name behind on the shelf.

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⛔ THE ONE THING STILL MISSING, AND IT IS NOT IN THIS FILE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// EVERYTHING ABOVE IS BUILT AND VERIFIED. What does not happen yet is the reader seeing it, and
// the reason is worth writing down exactly, because the next person to look will otherwise
// assume the mechanism is broken and rip it out.
//
// MEASURED against the shipped export, gate key set, clicking through to a detail page:
//
//     pageswap    viewTransition = YES   the outgoing board is found, named and snapshotted
//     pagereveal  viewTransition = YES   the arriving document opts in and offers a transition
//                 document.readyState  = 'interactive'   — fully parsed
//                 [data-cs-board] .bb-front = ABSENT     ← this is the whole problem
//
// EVERY BOOKSTORE PAGE RENDERS ITS ENTIRE CONTENTS BEHIND THE LAUNCH GATE. `detailReady =
// unlocked`, and `unlocked` is set in an EFFECT — it cannot be read during render, because
// isStoreUnlocked() reads localStorage and a server cannot know what it will say, so a
// synchronous read would be a hydration mismatch. Effects run after first paint. At
// `pagereveal` the arriving document is therefore fully parsed and EMPTY of the shop, board
// included, and the pair cannot form.
//
// ⭑ FLIPPING GATE_ENABLED TO false IS NOT ENOUGH, AND THAT WAS TESTED RATHER THAN ASSUMED.
// With the gate disabled and a full rebuild, `data-cs-board` still appears nowhere in the
// prerendered body — only inside the guard script's own source text. `unlocked` still starts
// false and is still set in an effect: the gate's CONSTANT is not what holds the render back,
// its STATE SHAPE is. Unwinding that is R9's work — app/lib/bookstore/gate.js already carries
// the delete list for the day the curtain comes down — and the board lands in the prerendered
// HTML as a consequence of it, not of anything here.
//
// UNTIL THEN THE GUARD CANCELS, EVERY TIME, and the shop navigates exactly as it did before
// R22: no dissolve, no half-effect, no cover blinking. That is the correct behaviour for a
// precondition that is not met, and it is the same path a browser with no support takes.
//
// ALREADY DONE FOR THAT DAY: the opt-in is in every document's static <head>, the outgoing half
// is verified working, the arriving board is named by rule, and seedFor() in
// app/bookstore/[slug]/page.js puts the cover into the prerendered HTML the moment the gate
// stops suppressing it. Nothing in R22C has to be remembered or rebuilt.

/** The one name, on both documents. A constant so the two sides cannot drift. */
export const BOOK_VT_NAME = 'cs-book-board';

/** Marks a BoundBook's root so a link can find the board that belongs to its slug. */
export const BOOK_SLUG_ATTR = 'data-bb-slug';

/** The face that travels — the front cover, which is what the reader is looking at. */
export const BOOK_FACE_SELECTOR = '.bb-front';

/**
 * The ARRIVING board's marker, on the detail page's cover slot.
 *
 * The two ends are named differently ON PURPOSE. The shelf has twenty-odd boards and only one
 * of them may carry the name, so it is stamped by script at click time. The detail page has
 * exactly ONE board, so it is named by a stylesheet rule — no script, nothing to be late, and
 * nothing to un-name afterwards. This attribute is what that rule hangs off, and what the
 * pair-or-nothing guard looks for.
 */
export const BOOK_ARRIVAL_ATTR = 'data-cs-board';

export const BOOK_TRANSITION = {
  ruledBy: 'Ikenna',
  on: '2026-08-26',
  approvedAs: 'the mock — the book carries you to its page',
  mechanism: 'cross-document view transitions',
  durationMs: 560,
  easing: 'cubic-bezier(.33,0,.15,1)',
  // The detail page's contents settle a beat at a time behind the arriving board.
  staggerMs: 44,
  staggeredSteps: 6,
  // Verified in Chromium 151 before the round was built; see the header.
  supported: ['Chrome/Edge 126+', 'Safari 18.2+'],
  degradesTo: 'a plain navigation — no handler prevents default, no script navigates',
  // The window the incoming board has to be in. Measured, not read off a spec.
  incomingMustExistBy: 'the first rendering opportunity after pagereveal — parse or a task, never a frame later',
};

/**
 * The CSS both documents carry. One export so the shelf and the detail page cannot disagree
 * about the name, the duration or the curve.
 *
 * `::view-transition-group` is the pair's own pseudo-element; styling it is how the morph gets
 * this shop's timing instead of the browser's default 250ms ease.
 *
 * ⚠ THE OLD AND NEW IMAGES ARE NOT CROSS-FADED. `animation:none` on both halves leaves the
 * group's morph as the only motion, so the cover does not ghost through a second copy of
 * itself on the way — which on a book cover reads as a printing fault rather than as movement.
 */
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE OPT-IN MUST BE IN THE PARSED <head>, AND FINDING THAT OUT COST THE ROUND ITS FIRST
//    WORKING VERSION.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `@view-transition{navigation:auto}` is read by the UA at two moments it does not control: on
// the OUTGOING document when the navigation starts, and on the INCOMING document at
// `pagereveal`. Put it in a <style> that React renders and the second read finds nothing.
//
// MEASURED against the real export, gate key set, clicking the Window's "Full details":
//
//     pageswap    viewTransition = YES     (the shop is hydrated; the rule is there)
//     pagereveal  viewTransition = no      (the detail page had not rendered its <style> yet)
//
// The shop's pages render EVERYTHING behind the launch gate — `detailReady = unlocked`, set in
// an effect — so on the arriving document the whole page, stylesheet included, appears after
// first paint. The transition was being declined by the destination on every single
// navigation, silently, and it looked exactly like "view transitions do not work in a Next
// static export". They do. The rule was in the wrong place.
//
// So the at-rule lives in app/layout.js's static <head>, in the prerendered HTML of every page
// in the site, where no gate and no hydration can be late for it. THIS export carries only the
// pair's styling, which is read when the transition is already under way and is therefore
// allowed to arrive with the page.
export const BOOK_TRANSITION_CSS = `
  /* THE ARRIVING BOARD, named by rule rather than by script — see BOOK_ARRIVAL_ATTR. There is
     exactly one on this page, so a stylesheet can say so and nothing has to remember to. */
  [${BOOK_ARRIVAL_ATTR}] ${BOOK_FACE_SELECTOR}{view-transition-name:${BOOK_VT_NAME}}
  ::view-transition-group(${BOOK_VT_NAME}){animation-duration:${BOOK_TRANSITION.durationMs}ms;animation-timing-function:${BOOK_TRANSITION.easing}}
  ::view-transition-old(${BOOK_VT_NAME}),::view-transition-new(${BOOK_VT_NAME}){animation:none;mix-blend-mode:normal}
  /* THE SHELF RECEDES BEHIND IT. The root pair is the rest of the page: it fades and settles
     back a little while the board travels over the top of it. z-index keeps the board above
     the page it is leaving and the page it is arriving at. */
  ::view-transition-group(root){animation-duration:${BOOK_TRANSITION.durationMs}ms;animation-timing-function:${BOOK_TRANSITION.easing}}
  ::view-transition-old(root){animation:cs-shelf-recede ${BOOK_TRANSITION.durationMs}ms ${BOOK_TRANSITION.easing} both}
  ::view-transition-new(root){animation:cs-page-settle ${BOOK_TRANSITION.durationMs}ms ${BOOK_TRANSITION.easing} both}
  @keyframes cs-shelf-recede{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.985)}}
  @keyframes cs-page-settle{from{opacity:0;transform:scale(1.008)}to{opacity:1;transform:scale(1)}}
  /* THE CONTENTS SETTLE A BEAT AT A TIME. Six steps of 44ms behind the arriving board, which is
     what makes the page assemble rather than appear. Transform and opacity only. */
  @keyframes cs-settle-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  html:active-view-transition .cs-settle{animation:cs-settle-in ${BOOK_TRANSITION.durationMs}ms ${BOOK_TRANSITION.easing} both}
  ${Array.from({ length: BOOK_TRANSITION.staggeredSteps }, (_, i) =>
    `html:active-view-transition .cs-settle-${i + 1}{animation-delay:${(i + 1) * BOOK_TRANSITION.staggerMs}ms}`).join('\n  ')}
  /* The motion IS the feature, so a reader who asked for less of it gets the navigation and
     nothing else. skipTransition() in arm() is the other half — the CSS alone cannot stop a
     cross-document transition that the UA has already begun. */
  @media(prefers-reduced-motion:reduce){
    ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none !important}
    html:active-view-transition .cs-settle{animation:none !important}
  }
`;

/**
 * The two lines that must be in the parsed <head> of every document. See the block above.
 *
 * `navigation: auto` opts the whole site in; the guard script below is what keeps that from
 * meaning "cross-fade everything".
 */
export const VIEW_TRANSITION_OPT_IN_CSS = '@view-transition{navigation:auto}';

/**
 * ⭑ PAIR OR NOTHING. The guard, as a classic inline script for the static <head>.
 *
 * A cross-document transition runs whether or not the names pair. When they do not, the reader
 * gets the browser's default ROOT cross-fade — the whole page dissolving into the whole next
 * page — and the cover blinks out and back inside it. That is worse than no effect at all, and
 * it is the exact thing the mock rules out.
 *
 * This runs during parse on the arriving document, before `pagereveal`, and cancels the
 * transition unless the board it is supposed to land on is actually there. So the shop either
 * carries the book across or it navigates plainly. It never dissolves.
 *
 * ⚠ IT IS ALSO WHY THIS FEATURE IS HONEST ABOUT THE LAUNCH GATE. See THE ONE THING STILL
 * MISSING at the head of this file: today this guard cancels on every navigation, and the shop
 * behaves exactly as it did before R22.
 */
export const VIEW_TRANSITION_GUARD_JS = `
(function(){
  if(!window.matchMedia)return;
  addEventListener('pagereveal',function(e){
    if(!e.viewTransition)return;
    var reduced=false;
    try{reduced=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(x){}
    var paired=!!document.querySelector('[${BOOK_ARRIVAL_ATTR}] ${BOOK_FACE_SELECTOR}');
    if(reduced||!paired)e.viewTransition.skipTransition();
  });
})();`;

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

/** Every element currently claiming the name, so a second arm cannot create a duplicate. */
function clearNames(root = document) {
  for (const el of root.querySelectorAll(`[style*="${BOOK_VT_NAME}"]`)) {
    el.style.viewTransitionName = '';
  }
}

/**
 * Name the board for `slug` so it is the element that travels.
 *
 * NEVER THROWS AND NEVER PREVENTS A NAVIGATION. Every failure path — no board on screen, a
 * browser with no support, a reader who wants less motion — leaves the link to do exactly what
 * it did before this module existed. Returns true only when a board was actually armed, which
 * is what the harness checks.
 */
export function armBookTransition(slug) {
  try {
    if (!slug) return false;
    if (!CSS?.supports?.('view-transition-name', 'x')) return false;
    if (prefersReducedMotion()) return false;

    clearNames();
    const host = document.querySelector(`[${BOOK_SLUG_ATTR}="${CSS.escape(slug)}"]`);
    if (!host) return false;
    const face = host.querySelector(BOOK_FACE_SELECTOR);
    if (!face) return false;

    // ⚠ A FLIPPED BOOK HAS NO FRONT TO PHOTOGRAPH. The shop's grammar is that a book turns over
    // on tap (R17.3) and the Quick Look is reached from the back face — so by the time the
    // reader presses "Full details" the board is showing its reverse and `backface-visibility`
    // has made the front invisible. Snapshotting it would capture nothing and the pair would
    // silently fall back to a cross-fade. So arming turns the book back first: the modal
    // closes, the cover returns, and THEN it carries the reader. That is also the better
    // reading of the gesture.
    host.dispatchEvent(new CustomEvent('cs-book-unflip', { bubbles: false }));

    face.style.viewTransitionName = BOOK_VT_NAME;
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the name off again.
 *
 * Called on `pageswap` — the name has served its purpose the moment the outgoing snapshot is
 * taken — and on `pageshow` for a bfcache restore, where the shelf comes back with whatever the
 * DOM held when the reader left it. A board still carrying the name would collide with the next
 * one armed and kill the transition, which is the sort of bug that only appears on the second
 * journey.
 */
export function disarmBookTransition() {
  try { clearNames(); } catch { /* nothing to undo */ }
}

/**
 * Wire the shop's side up once, from a client component's effect.
 *
 * Delegated from the document rather than bound per link: the shelf re-renders on every genre
 * tab, every currency change and every section resolve, and a handler per <a> would be dozens
 * of listeners churning on each of those. One listener, and it reads the href.
 *
 * CAPTURE PHASE, so the name is on the element before anything downstream can navigate.
 */
export function installBookTransitions() {
  const onClick = (e) => {
    // Modified clicks open a new tab; there is no navigation in this document to transition.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.('a[href]');
    if (!a || a.target === '_blank') return;
    const m = /^\/bookstore\/([a-z0-9][a-z0-9-]*)\/?$/.exec(a.getAttribute('href') || '');
    if (!m) return;
    armBookTransition(m[1]);
  };

  const onSwap = (e) => {
    // A reader who asked for less motion gets the navigation with none of it. The CSS above
    // also zeroes the animations, and both are needed: the media query cannot stop a
    // transition the UA has already started on the outgoing document.
    if (prefersReducedMotion()) e.viewTransition?.skipTransition?.();
    disarmBookTransition();
  };

  document.addEventListener('click', onClick, true);
  window.addEventListener('pageswap', onSwap);
  window.addEventListener('pageshow', disarmBookTransition);
  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('pageswap', onSwap);
    window.removeEventListener('pageshow', disarmBookTransition);
  };
}
