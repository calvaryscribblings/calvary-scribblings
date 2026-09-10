// R48 — THE APP LINKS, and the four flag states nothing else can reach.
//
// ⚠ WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY CANNOT PROVE.
//
// IOS_APP_LIVE and ANDROID_APP_LIVE are build-time constants. That is the point of them — it
// is what makes "no Play URL exists in the tree" a property of the shipped bytes rather than a
// promise about a code path. But a constant is exactly the thing a test cannot vary, and a
// guard that can only ever observe the ONE state the repo happens to be in is the class of
// could-not-fail test this project keeps finding: R45's marker was assembled at runtime and
// fourteen source tests missed it; a round before that shipped a guard that matched its own
// docblock and nothing else.
//
// The first version of this file DID walk all four states, by making the flags parameters of
// the decision function. It passed, and the build it was blessing shipped the Google Play URL
// in three JS chunks with Android sitting in review — because a parameter is not a constant
// and a minifier cannot fold one, so the dead branch and its URL survived. The unit test was
// green and the bytes were wrong: the exact could-not-fail shape it was written to avoid.
//
// So the work is split, and BOTH halves are needed:
//
//   · HERE: everything that does not depend on the flags — platform detection, the copy, the
//     URLs, the single-source rule — plus an exhaustive check of the state this build IS in.
//   · tests/applinks/matrix.mjs: rewrites the two constants, runs a REAL `next build` for each
//     of the four states, and greps out/. That is the only place the flag matrix is
//     observable at all, because the whole design depends on the bundler folding it away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  liveStores, storesFor, platformOf, anyAppLive,
  IOS_APP_LIVE, ANDROID_APP_LIVE,
  APP_PITCH, APP_PITCH_SHORT, NO_DEEP_LINK_NOTE,
} from '../../app/lib/appLinks.js';

const APP_STORE_URL = 'https://apps.apple.com/gb/app/story-island/id6769357370';
const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=uk.co.storyisland.app';
const hrefs = (rows) => rows.map((r) => r.href);

// ── THE FLAG STATES ARE NOT TESTED HERE, AND THE REASON IS THE POINT ────────────────────
//
// liveStores() reads two module constants by design: `if (CONSTANT)` is the only shape the
// minifier can fold, and folding is what deletes an unlive store's URL from the bundle. A
// first version took the flags as PARAMETERS so this file could walk all four states — and
// that version shipped the Google Play URL in three JS chunks with Android in review, because
// a parameter cannot be folded. The unit test would have passed. The bytes were wrong.
//
// So the four states are proved where they are actually observable: tests/applinks/matrix.mjs
// rewrites the constants, runs a REAL `next build` for each state, and greps out/. That is
// slower and it is the only version of this test that could ever have failed correctly.
//
// What is testable here is everything that does NOT depend on the flags, plus an exhaustive
// check of the state this build is actually in.

test('THIS BUILD offers exactly what its flags say, to every platform', () => {
  const live = liveStores();
  assert.equal(anyAppLive(), IOS_APP_LIVE || ANDROID_APP_LIVE);
  assert.equal(live.length, [IOS_APP_LIVE, ANDROID_APP_LIVE].filter(Boolean).length,
    'liveStores() disagrees with the flags');

  // Whatever the state, no platform is ever offered a store whose flag is down.
  for (const p of ['ios', 'android', 'desktop', 'something-else', undefined]) {
    for (const s of storesFor(p)) {
      if (s.platform === 'ios') assert.ok(IOS_APP_LIVE, `App Store offered to ${p} with IOS_APP_LIVE false`);
      if (s.platform === 'android') assert.ok(ANDROID_APP_LIVE, `Play offered to ${p} with ANDROID_APP_LIVE false`);
    }
  }

  if (!anyAppLive()) {
    // The both-false state: nothing, for everyone.
    for (const p of ['ios', 'android', 'desktop']) assert.deepEqual(storesFor(p), []);
    return;
  }

  // ⭑ A PHONE WHOSE OWN STORE IS DOWN IS OFFERED THE LIVE ONE, NOT AN EMPTY SECTION. A
  // heading and a pitch above blank space reads as broken; the row names the store it links
  // to and never claims the reader can install from it.
  for (const p of ['ios', 'android']) {
    assert.ok(storesFor(p).length >= 1, `${p} was offered nothing while a store is live`);
  }
  // A desktop cannot know what is in the reader's pocket, so it is offered every live store.
  assert.deepEqual(hrefs(storesFor('desktop')), hrefs(live));
});

// ⚠ THESE TWO ARE GUARDED ON THE FLAG STATE SO THEY STATE A FACT RATHER THAN A WISH: each
// runs only while the repo is in the state it describes, and matrix.mjs covers the rest by
// rebuilding. Both are kept even though only one can run today — the asymmetric state returns
// the next time a version ships to one store before the other.
test('iOS only — no Google Play URL is produced for ANY platform', () => {
  if (!(IOS_APP_LIVE && !ANDROID_APP_LIVE)) return;
  const seen = [];
  for (const p of ['ios', 'android', 'desktop', 'something-else', undefined]) seen.push(...hrefs(storesFor(p)));
  assert.ok(seen.length > 0, 'iOS is live and nothing was offered — the test proves nothing');
  for (const h of seen) {
    assert.ok(!/play\.google\.com/.test(h), `a Play URL was produced with ANDROID_APP_LIVE false: ${h}`);
  }
  assert.deepEqual([...new Set(seen)], [APP_STORE_URL]);
  assert.deepEqual(hrefs(storesFor('android')), [APP_STORE_URL]);
});

test('TODAY: both live — each phone gets its own store, the desktop gets both', () => {
  if (!(IOS_APP_LIVE && ANDROID_APP_LIVE)) return;
  // ⭑ THE NARROWING IS THE WHOLE POINT OF THIS STATE, and it is the state in which it can
  // finally be wrong. With one store live there is nothing to narrow and every platform gets
  // the same answer; with both live, an iPhone reader being shown a Google Play link is a
  // real, reachable defect.
  assert.deepEqual(hrefs(storesFor('ios')), [APP_STORE_URL]);
  assert.deepEqual(hrefs(storesFor('android')), [GOOGLE_PLAY_URL]);
  assert.deepEqual(hrefs(storesFor('desktop')), [APP_STORE_URL, GOOGLE_PLAY_URL]);
  // Anything unrecognised is treated as a desktop and offered both — never guessed at.
  assert.deepEqual(hrefs(storesFor('something-else')), [APP_STORE_URL, GOOGLE_PLAY_URL]);
});

test('the platform is DETECTED, and iPadOS 13+ does not slip through as a desktop', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  assert.equal(platformOf(IPHONE), 'ios');
  assert.equal(platformOf(ANDROID), 'android');
  assert.equal(platformOf(MAC, 1), 'desktop');
  assert.equal(platformOf(WINDOWS, 0), 'desktop');

  // ⚠ THE ONE THAT LIES. iPadOS 13+ sends the Macintosh UA above, byte for byte. The only
  // thing separating an iPad from a MacBook is the touch screen — no Mac reports more than
  // one touch point, every iPad reports five.
  assert.equal(platformOf(MAC, 5), 'ios', 'an iPad was read as a desktop — it sends a Mac UA');

  // Nothing unrecognised is guessed at.
  assert.equal(platformOf('', 0), 'desktop');
  assert.equal(platformOf(undefined), 'desktop');
  assert.equal(platformOf(null), 'desktop');
});

test('the URLs are the VERIFIED ones, not a placeholder and not a guess', async () => {
  // Verified live on 10 Sep 2026 — see the header of app/lib/appLinks.js for the fetches.
  // ⚠ THE EXPECTED VALUES ARE TYPED OUT AT THE TOP OF THIS FILE, NOT IMPORTED. The module
  // keeps them private (that is what lets the dead one be folded away), so the assertion has
  // to carry its own copy — which is also what makes it a real check rather than `x === x`.
  for (const s of liveStores()) {
    assert.ok(s.href.startsWith('https://'), `${s.href} is not https`);
    assert.ok(!/TODO|example|placeholder|xxx|<|>/i.test(s.href), `${s.href} looks like a placeholder`);
    if (s.platform === 'ios') assert.equal(s.href, APP_STORE_URL);
    if (s.platform === 'android') assert.equal(s.href, GOOGLE_PLAY_URL);
  }
  // Both literals must still be present in the SOURCE, whatever the flags — a flag being down
  // must not be a licence to lose the URL. The Apple ID and the Android package are the
  // load-bearing halves; a typo in either is a link to somebody else's app.
  const mod = await readFile(new URL('../../app/lib/appLinks.js', import.meta.url), 'utf8');
  assert.ok(mod.includes(APP_STORE_URL), 'the App Store URL is not in appLinks.js');
  assert.ok(mod.includes(GOOGLE_PLAY_URL), 'the Google Play URL is not in appLinks.js');
  // And neither may be exported — an exported binding survives tree-shaking whatever the flag.
  assert.ok(!/export\s+const\s+(IOS_URL|ANDROID_URL|APP_STORE_URL|GOOGLE_PLAY_URL)/.test(mod),
    'a store URL is exported — importing it anywhere re-ships the link the flag is hiding');
});

test('THE PITCH IS OFFLINE READING — not "get the app"', () => {
  // The round's ruling, asserted as a property of the copy rather than as an exact string, so
  // Ikenna can reword it without breaking a test — but not into a shrug.
  assert.ok(/signal|offline|no data|plane|flight|Underground/i.test(APP_PITCH),
    `the pitch does not mention the offline promise: "${APP_PITCH}"`);
  assert.ok(!/^get the app/i.test(APP_PITCH.trim()), 'the pitch opens on a shrug');
  assert.ok(/signal|offline/i.test(APP_PITCH_SHORT),
    `the short pitch does not carry the promise: "${APP_PITCH_SHORT}"`);
  assert.ok(APP_PITCH.length > 40, 'the pitch is too short to be saying anything');
});

test('the deep-link caveat exists as COPY, not only as a comment', () => {
  assert.ok(NO_DEEP_LINK_NOTE.length > 60);
  assert.match(NO_DEEP_LINK_NOTE, /deep link/i);
  // The specific thing a future round must not assume: that a link carries a reader into the
  // app. The note has to say the opposite in words a reader can read.
  assert.ok(/opens the website|opens the store/i.test(NO_DEEP_LINK_NOTE));
});

test('the flags today are BOTH live — and this test says so out loud', () => {
  // ⚠ THIS ASSERTION IS EXPECTED TO FAIL WHENEVER A STORE FLAG MOVES, AND THAT IS ITS JOB.
  // It did exactly that on 11 Sep 2026: written on the 10th with ANDROID_APP_LIVE pinned
  // false, it failed on the morning Google Play approved the build, which is how the second
  // half of the flip — this line — got made in the same commit as the first. A flag flipped
  // without this leaves a green suite lying about the state of the platform.
  //
  // ⭑ IT STAYS SHARP NOW THAT BOTH ARE TRUE. The next move is downward — a pulled build, a
  // rejected update, a store taken back for a version — and it will fail then too.
  assert.equal(IOS_APP_LIVE, true, 'iOS 1.5.0 is live in the App Store since 10 Sep 2026');
  assert.equal(ANDROID_APP_LIVE, true, 'Android versionCode 15 is live in Google Play since 11 Sep 2026');
});

test('NO SURFACE DECLARES A STORE URL OF ITS OWN — appLinks.js is the only source', async () => {
  // ⚠ THE SOURCE-GREP HALF, AND ITS ONE REAL TRAP: this file and app/lib/appLinks.js both
  // contain the URLs — one in assertions, one in code and docblock. A naive repo-wide grep
  // matches its own documentation and passes for the wrong reason. Both are excluded BY NAME,
  // and everything else on the platform must be clean.
  const FILES = [
    'app/components/AppInvite.js',
    'app/components/Footer.js',
    'app/app/page.js',
    'app/links/page.js',
    'app/stories/[slug]/page-client.js',
  ];
  for (const f of FILES) {
    const src = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.ok(!/apps\.apple\.com/.test(src), `${f} hardcodes an App Store URL — import it`);
    assert.ok(!/play\.google\.com/.test(src), `${f} hardcodes a Google Play URL — import it`);
  }
  // Non-vacuous: the files were actually read and do reference the module.
  const invite = await readFile(new URL('../../app/components/AppInvite.js', import.meta.url), 'utf8');
  assert.match(invite, /from '\.\.\/lib\/appLinks'/);
});
