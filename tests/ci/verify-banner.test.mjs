// R9.4 — THE VERIFICATION BANNER'S EXCLUSION LIST, PINNED TO ROUTES THAT ACTUALLY EXIST.
//
//   node --test tests/ci/verify-banner.test.mjs      (npm run test:ci)
//
// app/components/VerifyEmailBanner.js mounts globally, so the reading surfaces are kept
// clear by a pathname DENYLIST — against this codebase's usual opt-in-per-page convention,
// for the reason set out in app/lib/immersiveRoutes.js. TabBar's header names the risk that
// convention exists to avoid: "a pathname denylist that could rot". This suite is the
// alternative to that rot.
//
// TWO FAILURE MODES, and a test for each:
//
//   1. THE LIST POINTS AT NOTHING. A reader route is renamed or moved, the regex keeps
//      matching a path no page serves, and the banner quietly starts appearing over the
//      reader. Caught by asserting each pattern's route directory is still on disk.
//
//   2. A NEW READING SURFACE APPEARS. Someone adds another reader and the list has never
//      heard of it. Caught by sweeping app/ for route directories whose name looks like a
//      reader and requiring each to be covered.
//
// Offline and instant: it reads the filesystem and a module of regexes. No browser, no
// network, no Firebase.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { IMMERSIVE_ROUTES, isImmersive } from '../../app/lib/immersiveRoutes.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP = join(ROOT, 'app');

// pattern source → the route directory it is meant to protect. The gateway is app/page.js
// itself, which is why it is a file rather than a directory.
const PATTERN_ROUTES = [
  ['/^\\/reader(\\/|$)/', 'app/reader'],
  ['/^\\/book-reader(\\/|$)/', 'app/book-reader'],
  ['/^\\/series\\/read(\\/|$)/', 'app/series/read'],
  ['/^\\/my-library\\/read(\\/|$)/', 'app/my-library/read'],
  ['/^\\/$/', 'app/page.js'],
];

// Route directories that LOOK like a reading surface by name. Anything matching this sweep
// must be either immersive or listed as a deliberate exception below.
const READERISH = /read/i;

// Named exceptions: directories whose name trips the sweep but which are not reading
// surfaces. Empty today — every /read/i route in the app is a reader. Add here WITH a reason
// rather than loosening the sweep.
const NOT_IMMERSIVE_BY_DESIGN = new Set([]);

function routeDirs(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'components' || entry === 'lib') continue;
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    acc.push(full);
    routeDirs(full, acc);
  }
  return acc;
}

// app/my-library/read → /my-library/read. Route groups and dynamic segments are dropped:
// a [slug] directory is served under its parent's path.
function urlPathFor(dirAbs) {
  const rel = relative(APP, dirAbs).split('/').filter((s) => !s.startsWith('[') && !s.startsWith('('));
  return '/' + rel.join('/');
}

describe('the verification banner stays off the reading surfaces', () => {
  test('every exclusion pattern still points at a route that exists', () => {
    for (const [pattern, routePath] of PATTERN_ROUTES) {
      assert.ok(
        existsSync(join(ROOT, routePath)),
        `${pattern} in app/lib/immersiveRoutes.js protects ${routePath}, which no longer exists — `
        + 'the route moved and the pattern is now dead. Update both together.',
      );
    }
  });

  test('the list has one pattern per protected route and no strays', () => {
    assert.equal(IMMERSIVE_ROUTES.length, PATTERN_ROUTES.length,
      'a pattern was added or removed in app/lib/immersiveRoutes.js without updating this suite — '
      + 'add it to PATTERN_ROUTES with the route directory it protects');
  });

  test('every reader-shaped route in app/ is covered', () => {
    const uncovered = routeDirs(APP)
      .filter((d) => existsSync(join(d, 'page.js')))
      .map(urlPathFor)
      .filter((p) => READERISH.test(p))
      .filter((p) => !isImmersive(p) && !NOT_IMMERSIVE_BY_DESIGN.has(p));

    assert.deepEqual(uncovered, [],
      `Reading surface(s) the banner would appear over: ${uncovered.join(', ')}.\n`
      + '      Add a pattern to IMMERSIVE_ROUTES in app/lib/immersiveRoutes.js, or — if this is\n'
      + '      not actually a reading surface — name it in NOT_IMMERSIVE_BY_DESIGN with a reason.');
  });

  test('the three readers and the gateway match', () => {
    for (const p of ['/reader/basil', '/reader/basil/', '/book-reader', '/my-library/read', '/']) {
      assert.ok(isImmersive(p), `${p} should be immersive`);
    }
  });

  test('ordinary pages do not match', () => {
    for (const p of [
      '/public-library', '/stories/chaff', '/profile', '/settings', '/my-library',
      '/bookstore', '/bookstore/basil', '/search', '/square', '/leaderboard',
    ]) {
      assert.ok(!isImmersive(p), `${p} should NOT be immersive — the banner belongs here`);
    }
  });

  test('/my-library itself keeps the banner; only its reader is excluded', () => {
    // The shelf is a list of books, not a book. Getting this wrong would hide the prompt
    // from the surface a signed-in reader is most likely to be on.
    assert.equal(isImmersive('/my-library'), false);
    assert.equal(isImmersive('/my-library/read'), true);
  });

  test('an empty or missing pathname is not treated as the gateway', () => {
    // usePathname() can be null on the very first client render. Returning true there would
    // blank the banner for a frame on every page; returning false is the safe default.
    assert.equal(isImmersive(null), false);
    assert.equal(isImmersive(''), false);
  });
});
