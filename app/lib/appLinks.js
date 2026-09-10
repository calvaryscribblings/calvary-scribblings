// THE APP LINKS. Two flags, two URLs, one line of copy, and the rule about where they may go.
//
// ── THE TWO FLAGS ARE THE WHOLE DISCIPLINE ───────────────────────────────────────────────
//
// iOS 1.5.0 is LIVE in the App Store (verified 10 Sep 2026: the listing returns HTTP 200 and
// prints "Version 1.5.0"). Android versionCode 15 is IN GOOGLE PLAY REVIEW. A page that
// offers both when only one works is worse than a page that offers neither — a dead store
// link on launch week is a bad first impression from the one surface meant to be inviting.
//
// So there are TWO booleans, never one. If exactly one is true the surface offers only that
// one, honestly, and says NOTHING about the other. There is no "coming soon" here: a reader
// who cannot install on their phone today does not need to be told they are second.
//
//   ⭑ TO FLIP ON APPROVAL DAY: set ANDROID_APP_LIVE to true, below. One edit, one file,
//     one word. Nothing else moves — no copy, no layout, no other file.
//
// Same shape as BOOKSTORE_LAUNCHED / MEMBERSHIP_LAUNCHED in app/links/page.js: a build-time
// constant, not an env var and not a remote read. The static export inlines it, which is what
// makes the flag TESTABLE BY ABSENCE — with ANDROID_APP_LIVE false, no Play URL exists
// anywhere in the built output, so the guarantee is a property of the bytes rather than a
// promise about a code path.
//
// ⚠ DO NOT WIRE THESE TO EACH OTHER, AND DO NOT DERIVE THEM FROM THE URL. app/links/page.js
// used to gate its badges on isLive(url) — "is this string shaped like a URL" — which is a
// test of the CONFIG, not of the STORE. Both URLs have been real and well-formed since July,
// so that gate rendered a live Google Play badge for an app Google had not approved. The URL
// being right is not the app being live. That is the defect this file exists to close.

/** iOS 1.5.0 — LIVE in the App Store since the morning of 10 Sep 2026. */
export const IOS_APP_LIVE = true;

/** Android versionCode 15 — IN REVIEW. ⭑ FLIP TO true WHEN GOOGLE PLAY APPROVES. */
export const ANDROID_APP_LIVE = false;

// ── THE URLS ─────────────────────────────────────────────────────────────────────────────
//
// Both verified against the live stores on 10 Sep 2026, not guessed:
//
//   App Store    HTTP 200, <title> "Story Island App - App Store", body prints "Version 1.5.0"
//   Google Play  HTTP 200, itemprop="description" present, description opens "Story Island is
//                a home for stories worth keeping." A nonexistent package on the same fetch
//                returns HTTP 404 with <title>Not Found</title>, so the listing page is real.
//
// ⚠ THE PLAY LISTING RESOLVING DOES NOT MEAN THE APP IS APPROVED. Play serves a listing page
// for an app in review; it looks, over HTTP, exactly like a published one. ANDROID_APP_LIVE
// is therefore flipped on the Play Console approval mail and on nothing else — never on the
// strength of a fetch from this repo.
//
// ⚠⚠ THESE TWO ARE MODULE-PRIVATE, AND THAT IS LOAD-BEARING, NOT TIDINESS.
//
// The round's guarantee is "with ANDROID_APP_LIVE false, no Play URL exists in the built
// tree". THE FIRST IMPLEMENTATION OF THIS FILE FAILED THAT, and the failure is worth keeping
// written down because both halves of it look like good practice:
//
//   1. The decision function took the flags as PARAMETERS, so all four states could be unit
//      tested. A parameter is not a constant, so the minifier cannot fold `android && push(…)`
//      — the Play URL shipped in three chunks with the flag off.
//   2. app/links/page.js imported GOOGLE_PLAY_URL into its config object unconditionally. An
//      exported binding that something imports survives tree-shaking no matter what any flag
//      says.
//
// So: the URLs are `const` in this module and exported to NOBODY. The only way to a URL is
// liveStores(), whose branches are `if (CONST_BOOLEAN)` in the same module — which SWC folds,
// taking the dead branch's string with it. Verified by rebuilding and grepping out/, not by
// reading the bundler's documentation.
//
// ⭑ IF A SURFACE EVER NEEDS A RAW URL, IT NEEDS liveStores() INSTEAD. Exporting either
// constant re-opens the hole silently, and tests/applinks/matrix.mjs is what would catch it.
const IOS_URL = 'https://apps.apple.com/gb/app/story-island/id6769357370';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=uk.co.storyisland.app';

// ── THESE ARE STORE LINKS. THEY ARE NOT DEEP LINKS. ──────────────────────────────────────
//
// NO UNIVERSAL LINKS EXIST ON EITHER PLATFORM. There is no apple-app-site-association file
// and no assetlinks.json, so a calvaryscribblings.co.uk link from an email, a share sheet or
// a social post opens the WEB PAGE even on a device with the app installed, and a store link
// opens the STORE, never the story it was next to.
//
// RISK ACCEPTED FOR LAUNCH. Owner: Ikenna. Review: post-launch.
//
// ⚠ SAY IT AT THE SITE, which is why NO_DEEP_LINK_NOTE exists and is rendered on /app rather
// than living only in this comment. The failure this guards against is someone six months
// from now assuming a store link carries a reader into the app at a book, and building a
// share flow, a campaign or an email on that assumption.
export const NO_DEEP_LINK_NOTE =
  'These open the store, not the story. Story Island has no deep links yet, so a link shared from the site opens the website — even on a phone that already has the app.';

// ── THE PITCH IS OFFLINE READING, AND IT IS ONE LINE ─────────────────────────────────────
//
// "Get the app" is a shrug: it names the object and gives no reason. The app's genuine
// advantage over this website is that THE WHOLE LIBRARY TRAVELS — it is true, it is the real
// differentiator, and it is the thing a reader would actually want. So the line says that and
// stops.
//
// Two alternates were written and are recorded rather than deleted, because the choice is
// Ikenna's and a rejected line is worth more than a blank page:
//   · "Every story, on your phone, with no signal at all."
//   · "Download once. Read anywhere — a flight, the Underground, a dead zone."
// The one below was preferred for naming the LIBRARY rather than a story, which is what makes
// the offer feel like the shelf coming with you rather than one download.
export const APP_PITCH = 'Take the library with you. Story Island keeps every story on your phone — on a flight, on the Underground, with no signal at all.';

/** The short form, for a footer row where a sentence would not fit. Same promise, fewer words. */
export const APP_PITCH_SHORT = 'Read with no signal';

// ── WHAT ACTUALLY RENDERS ────────────────────────────────────────────────────────────────

/**
 * The stores THIS build offers, in order. The ONLY way to a store URL anywhere on the site.
 *
 * ⚠ THE TWO BRANCHES MUST STAY `if (CONSTANT)` AND MUST NOT BECOME PARAMETERS. That shape is
 * what lets the minifier delete the dead branch and its URL — see the note on IOS_URL above
 * for the version of this function that took flags as arguments and shipped the Play link
 * with Android in review.
 *
 * The cost of that shape is that this function has exactly ONE observable behaviour per build,
 * so it cannot carry a four-state unit test. tests/applinks/matrix.mjs pays that cost properly:
 * it rewrites the two constants, runs a real `next build` for each of the four states, and
 * greps out/ — which tests the wiring AND the folding, neither of which a unit test could see.
 *
 * Returns [] when both flags are false, and every consumer treats [] as "render nothing at
 * all" rather than "render an empty section".
 */
export function liveStores() {
  const out = [];
  if (IOS_APP_LIVE) out.push({ key: 'ios', label: 'App Store', href: IOS_URL, platform: 'ios' });
  if (ANDROID_APP_LIVE) out.push({ key: 'android', label: 'Google Play', href: ANDROID_URL, platform: 'android' });
  return out;
}

/** True when this build offers at least one store. Nothing app-related renders when false. */
export function anyAppLive() {
  return IOS_APP_LIVE || ANDROID_APP_LIVE;
}

/**
 * Which platform a user agent is holding.
 *
 * ⚠ DETECT, DO NOT ASK. A reader on an iPhone should not be made to identify their own device
 * in order to be given the right link; the page knows.
 *
 * ⚠ iPadOS 13+ LIES. It reports a desktop Macintosh UA by default, so the Mac branch checks
 * for a touch screen: a Macintosh with maxTouchPoints > 1 is an iPad, and no real Mac reports
 * more than one. Without this an iPad reader is sent to a desktop view of a page whose whole
 * subject is the app they could install right now.
 *
 * Returns 'ios' | 'android' | 'desktop'. Anything unrecognised is 'desktop', which is the safe
 * direction: desktop is offered EVERY live store rather than a guessed one.
 */
export function platformOf(ua, maxTouchPoints = 0) {
  const s = String(ua || '');
  if (/android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  // iPadOS 13+ masquerading as a Mac.
  if (/Macintosh/i.test(s) && Number(maxTouchPoints) > 1) return 'ios';
  return 'desktop';
}

/**
 * The stores to show a given platform.
 *
 *   an iPhone   → the App Store alone
 *   an Android  → Google Play alone
 *   a desktop   → EVERY live store
 *
 * ⭑ WHY DESKTOP GETS BOTH RATHER THAN NEITHER. A desktop reader cannot install anything from
 * the machine they are on, so the link is not a call to action there — it is an ANSWER to
 * "which phone can I read this on". Hiding both leaves the pitch stated and unanswerable.
 * Showing both is also the only honest desktop answer, since the page has no idea what is in
 * their pocket.
 *
 * ⚠ A PHONE WHOSE PLATFORM HAS NO LIVE STORE GETS THE LIVE ONE ANYWAY, not an empty space.
 * With Android in review, an Android reader is shown the App Store link — because the
 * alternative is a section that renders its heading and its pitch above nothing, which reads
 * as broken rather than as honest. The row never claims the reader can install it; it names
 * the store it links to, and "App Store" tells an Android reader everything they need.
 */
export function storesFor(platform) {
  const live = liveStores();
  if (live.length === 0) return [];
  if (platform === 'desktop') return live;
  const mine = live.filter((s) => s.platform === platform);
  return mine.length ? mine : live;
}
