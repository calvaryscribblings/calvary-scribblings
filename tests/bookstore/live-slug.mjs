// R20 — ASK THE SHOP WHICH BOOK IT IS SHOWING, RATHER THAN NAMING ONE.
//
// WHY THIS EXISTS. Both the pair harness (R19.8) and the payload harness (R20) need a detail
// page to drive, and both named `basil`. Mid-way through R20 a curator set that title to
// `status: unpublished` in the CMS — an entirely ordinary thing to do to a shop — and every
// case that opened /bookstore/basil began rendering the site's 404 and failing on a selector.
// Nothing was wrong with the code under test.
//
// A live catalogue is a deliberate decision on this platform, argued at length at the head of
// currency.spec.mjs and territory.spec.mjs: the suites assert invariants over whatever is
// really on the shelf. But "whatever is really on the shelf" and "a slug typed into a test
// file" are different things, and the second silently stops being the first.
//
// So the slug is read from a link the storefront itself renders. `.rail-answer` and
// `.btn-details` are anchors to /bookstore/{slug} built from the live catalogue, so anything
// they point at is by construction a title the shop is showing right now.
//
// IF THERE IS NO SUCH LINK the helper throws rather than returning a guess. A detail suite that
// quietly skipped because it could not find a book would be a suite that stopped running the
// day it was most needed.

/**
 * The slug of a title the storefront is currently offering a detail page for.
 * Call after the shelf has rendered.
 */
export async function liveDetailSlug(page) {
  const href = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/bookstore/"]')]
      .map((a) => a.getAttribute('href'))
      // /bookstore itself, and any query or hash form, are not detail pages.
      .filter((h) => /^\/bookstore\/[a-z0-9][a-z0-9-]*$/.test(h));
    return links[0] || null;
  });
  if (!href) {
    throw new Error(
      'The storefront rendered no link to a detail page, so this suite has no book to drive. '
      + 'Either the catalogue has nothing published, or the shelf did not finish loading.');
  }
  return href.replace('/bookstore/', '');
}
