// Which surfaces are "immersive" — built to be read in, and therefore off-limits to
// interruptions like the verification banner.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────
// It lives apart from app/components/VerifyEmailBanner.js so it can be imported by a plain
// node test. The banner pulls in React, next/navigation and AuthContext (and through it
// firebase/auth), none of which a route-matching assertion should have to boot.
//
// ── WHY A DENYLIST AT ALL ────────────────────────────────────────────────────────────────
// The codebase's convention is opt-in-per-page: the root layout renders no chrome, and
// TabBar's header makes the case that exclusion BY CONSTRUCTION beats "a pathname denylist
// that could rot". That argument is right, and it does not fit here — the banner is wanted
// on essentially every page, so opting thirty pages in to express three exclusions would put
// the rot somewhere worse (thirty call sites that can each forget). The denylist stays, and
// tests/ci/verify-banner.test.mjs pins it against the reader routes that actually exist, so
// rotting is a test failure rather than a banner over somebody's book.
export const IMMERSIVE_ROUTES = [
  /^\/reader(\/|$)/,           // ReadingRoom + the EPUB readers
  /^\/book-reader(\/|$)/,
  /^\/my-library\/read(\/|$)/, // the offline shelf reader
  /^\/$/,                      // the gateway — a door, not a page
];

// Trailing slashes are normalised first: next/navigation reports "/reader/basil" but the
// static export is served with and without the slash depending on how the link was written.
export function isImmersive(pathname) {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  return IMMERSIVE_ROUTES.some((re) => re.test(p));
}
