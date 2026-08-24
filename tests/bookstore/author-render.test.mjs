// R18 — THE AUTHOR BLOCK, as a document.
//
// ── WHY THIS FILE RENDERS RATHER THAN GREPS ───────────────────────────────────────────────
// The round's load-bearing assertion is "no bio and no photo → the SECTION ELEMENT is absent,
// not that its string is empty". A source regex cannot tell those apart, and neither can a
// test that checks textContent: an empty <section> with a gold "THE AUTHOR" label over nothing
// passes a string test perfectly and still leaves a labelled hole on a published page. So the
// component is really rendered and the real markup is really searched.
//
// ── THE HARNESS ───────────────────────────────────────────────────────────────────────────
// node --test cannot parse JSX. AuthorBlock.js is house-style JSX and should stay that way, so
// the file is transformed with the babel React preset Next already ships, written NEXT TO the
// original under a dot-prefixed name — beside it, so its own relative imports resolve exactly
// as they do in the build — imported, and deleted. The temp file is dot-prefixed and removed
// in after(); it is also in .gitignore, because a crashed run must never leave a stray module
// where a fuzzy file-open can find it.
//
// There is no jsdom in this repo and none is needed: renderToStaticMarkup gives the markup the
// static export would carry, which is the thing under test.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('app/bookstore/components/AuthorBlock.js', ROOT);
const TMP = new URL('app/bookstore/components/.author-block.test-build.mjs', ROOT);

let AuthorBlock;
let AUTHOR_BLOCK_CSS;

before(async () => {
  const { code } = transformSync(readFileSync(SRC, 'utf8'), {
    presets: [[require.resolve('next/dist/compiled/babel/preset-react'), { runtime: 'automatic' }]],
    configFile: false,
    babelrc: false,
    filename: fileURLToPath(SRC),
  });
  // The repo writes extensionless relative imports (Next resolves them; node ESM does not).
  // Add the extension in the BUILD ONLY — the source keeps the house style its neighbours use.
  const resolved = code.replace(/(from\s+'\.\.?\/[^']*?)(')/g, (m, path, q) => (/\.[a-z]+$/.test(path) ? m : `${path}.js${q}`));
  writeFileSync(TMP, resolved);
  const mod = await import(`${TMP.href}?t=${process.pid}`);
  AuthorBlock = mod.default;
  AUTHOR_BLOCK_CSS = mod.AUTHOR_BLOCK_CSS;
});

after(() => { rmSync(TMP, { force: true }); });

const render = (title) => renderToStaticMarkup(AuthorBlock({ title }));
const has = (html, testid) => new RegExp(`data-testid="${testid}"`).test(html);

const PHOTO = 'bookstore_covers/the-quiet-house_author.jpg';
const BIO = 'Ada Nwachukwu writes from Enugu. The Quiet House is her second novel.';

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · NO FALLBACK — the absence is an absence', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('no bio and no photo: the SECTION ELEMENT is not in the document', () => {
    const html = render({ title: 'An Anthology', author: 'Calvary Scribblings' });

    // The strongest form of the assertion: the component contributes NOTHING at all.
    assert.equal(html, '', 'the author block must render no markup whatsoever');

    // And said again as element queries, because "" is easy to break into "<section></section>"
    // by a later refactor that keeps the tests green on a text assertion.
    assert.ok(!has(html, 'author-block'), 'no <section data-testid="author-block">');
    assert.ok(!/<section/.test(html), 'no section element of any kind');
    assert.ok(!/<div/.test(html), 'no wrapper div left standing');
  });

  test('THE GOLD LABEL DOES NOT RENDER WHEN THE SECTION DOES NOT', () => {
    const html = render({ title: 'An Anthology' });
    assert.ok(!has(html, 'author-label'), 'no label element');
    assert.ok(!/The author/i.test(html), 'the words must not appear anywhere');
    assert.ok(!/bd-author-label/.test(html), 'not even the class name');
  });

  test('a name alone renders nothing — a heading over one line is not a block', () => {
    assert.equal(render({ authorName: 'Ada Nwachukwu' }), '');
    assert.equal(render({ authorName: 'Ada', authorPhotoAlt: 'Ada, smiling' }), '');
  });

  test('a malformed photo path renders nothing, not a broken image', () => {
    assert.equal(render({ authorPhotoPath: 'bookstore_covers/nested/photo.jpg' }), '');
    assert.equal(render({ authorPhotoPath: 'https://example.com/photo.jpg' }), '');
  });

  test('no placeholder copy is rendered in ANY state', () => {
    // Every combination that produces no block, plus the two that produce a half one: none of
    // them may put an apology on the page where the author would have been.
    const states = [
      {}, { authorName: 'Ada' }, { authorPhotoAlt: 'x' },
      { authorBio: BIO }, { authorPhotoPath: PHOTO },
    ];
    for (const t of states) {
      const html = render(t);
      for (const phrase of [/no bio/i, /not available/i, /coming soon/i, /placeholder/i, /unknown author/i, /&mdash;\s*<\/p>/]) {
        assert.ok(!phrase.test(html), `${phrase} rendered for ${JSON.stringify(t)}`);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · each half renders sensibly alone', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('BIO ONLY — text, no image, no reserved column', () => {
    const html = render({ authorName: 'Ada Nwachukwu', authorBio: BIO });
    assert.ok(has(html, 'author-block'));
    assert.ok(has(html, 'author-label'));
    assert.ok(has(html, 'author-bio'));
    assert.ok(has(html, 'author-name'));
    assert.ok(!has(html, 'author-photo'), 'no photograph element');
    assert.ok(!/<img/.test(html), 'no image tag at all — not an empty one, not a placeholder src');
    assert.ok(html.includes(BIO));
  });

  test('PHOTO ONLY — an image, no empty paragraph where the bio would be', () => {
    const html = render({ authorName: 'Ada Nwachukwu', authorPhotoPath: PHOTO });
    assert.ok(has(html, 'author-block'));
    assert.ok(has(html, 'author-photo'));
    assert.ok(has(html, 'author-name'));
    assert.ok(!has(html, 'author-bio'), 'no bio paragraph');
    assert.ok(!/<p class="bd-author-bio"/.test(html));
  });

  test('PHOTO ALONE — no name, no bio, and the image is still named for a screen reader', () => {
    const html = render({ authorPhotoPath: PHOTO });
    assert.ok(has(html, 'author-photo'));
    assert.ok(!has(html, 'author-name'));
    assert.ok(!has(html, 'author-bio'));
    assert.ok(!/bd-author-text/.test(html), 'the text column is not rendered empty');
    assert.match(html, /alt="Photograph of the author"/);
  });

  test('BOTH — photograph, name and bio, in that order', () => {
    const html = render({ authorName: 'Ada Nwachukwu', authorBio: BIO, authorPhotoPath: PHOTO });
    const iPhoto = html.indexOf('author-photo');
    const iName = html.indexOf('author-name');
    const iBio = html.indexOf('author-bio');
    assert.ok(iPhoto > -1 && iName > iPhoto && iBio > iName, 'photograph, then name, then bio');
  });

  test('the photograph is fetched from the public-read prefix with no token', () => {
    const html = render({ authorPhotoPath: PHOTO, authorBio: BIO });
    assert.match(html, /src="https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/calvary-scribblings\.firebasestorage\.app\/o\/bookstore_covers%2F/);
    assert.ok(!/token=/.test(html));
  });

  test('a supplied alt overrides the derived one', () => {
    const html = render({ authorName: 'Ada', authorPhotoPath: PHOTO, authorPhotoAlt: 'Ada at her desk in Enugu' });
    assert.match(html, /alt="Ada at her desk in Enugu"/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · the gold label speaks the page’s own grammar', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The detail page's label face, verbatim from the "From the book" head further down the same
// page: Cinzel .58rem, .28em tracking, uppercased by CSS, #c9a44c. Pinned against the DETAIL
// PAGE'S OWN SOURCE rather than against a copy of the numbers, so a change to the house label
// has to be a deliberate change to both.

  const DETAIL = readFileSync(new URL('app/bookstore/[slug]/page-detail.js', ROOT), 'utf8');

  test('THE AUTHOR is set exactly as FROM THE BOOK is', () => {
    const houseLabel = /fontFamily: "'Cinzel',serif", fontSize: '\.58rem', letterSpacing: '\.28em', textTransform: 'uppercase', color: '#c9a44c'/;
    assert.ok(houseLabel.test(DETAIL), 'the page no longer has the label face this block copies');

    const rule = /\.bd-author-label\{([^}]*)\}/.exec(AUTHOR_BLOCK_CSS);
    assert.ok(rule, '.bd-author-label has no rule');
    assert.match(rule[1], /font-family:'Cinzel',serif/);
    assert.match(rule[1], /font-size:\.58rem/);
    assert.match(rule[1], /letter-spacing:\.28em/);
    assert.match(rule[1], /text-transform:uppercase/);
    assert.match(rule[1], /color:#c9a44c/);
  });

  test('the label is written in sentence case and uppercased by CSS, like every other head', () => {
    const html = render({ authorBio: BIO });
    assert.match(html, />The author</, 'the text is authored in sentence case');
  });

  test('the bio is Cormorant at the synopsis’s body size', () => {
    const rule = /\.bd-author-bio\{([^}]*)\}/.exec(AUTHOR_BLOCK_CSS);
    assert.ok(rule);
    assert.match(rule[1], /font-family:'Cormorant Garamond'/);
    // .bd-synopsis is 1.02rem in page-detail.js — the body size of this page.
    const syn = /\.bd-synopsis\{([^}]*)\}/.exec(DETAIL);
    assert.ok(syn, 'the page no longer has a .bd-synopsis rule to match');
    assert.match(syn[1], /font-size:1\.02rem/, 'the page body size moved; move the bio with it');
    assert.match(rule[1], /font-size:1\.02rem/);
  });

  test('the bio does NOT take the synopsis’s drop cap — that is the synopsis’s signature', () => {
    assert.ok(!/\.bd-author-bio::first-letter/.test(AUTHOR_BLOCK_CSS));
  });

  test('the photograph is a plate, not an avatar', () => {
    const rule = /\.bd-author-plate\{([^}]*)\}/.exec(AUTHOR_BLOCK_CSS);
    assert.ok(rule);
    assert.match(rule[1], /aspect-ratio:4\/5/, 'a jacket-flap portrait, not a square');
    assert.ok(!/border-radius:50%/.test(rule[1]), 'a circle is the vernacular of a profile page');
    assert.match(rule[1], /object-fit:cover/, 'a supplied photo of any ratio must not be squashed');
    assert.match(rule[1], /border:1px solid rgba\(201,164,76,/, 'the house hairline');
    assert.match(rule[1], /filter:/, 'the tone that seats a raw upload in a near-black page');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · where it stands on the page', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const DETAIL = readFileSync(new URL('app/bookstore/[slug]/page-detail.js', ROOT), 'utf8');

  test('AFTER the synopsis and BEFORE the editor’s note', () => {
    const iSyn = DETAIL.indexOf('className="bd-synopsis"');
    const iAuthor = DETAIL.indexOf('<AuthorBlock title={title} />');
    const iNote = DETAIL.indexOf('className="bd-shelfcard"');
    assert.ok(iSyn > -1 && iAuthor > -1 && iNote > -1, 'all three beats must be on the page');
    assert.ok(iAuthor > iSyn, 'the author block must follow the synopsis');
    assert.ok(iAuthor < iNote, 'the author block must precede the editor’s note');
  });

  test('the editor’s note is still the last beat before the button', () => {
    const iNote = DETAIL.indexOf('className="bd-shelfcard"');
    const iButton = DETAIL.indexOf('<BuyButton');
    assert.ok(iNote < iButton, 'the note comes before the CTA');
    // Nothing new may be wedged between them.
    assert.ok(!/AuthorBlock/.test(DETAIL.slice(iNote, iButton)), 'nothing stands between the note and the button');
  });

  test('the page does NOT second-guess the component with its own condition', () => {
    // A `title.authorBio && <AuthorBlock ...>` here would be a second copy of the no-fallback
    // rule, and the two would drift the first time the gate changed.
    assert.match(DETAIL, /\n\s*<AuthorBlock title=\{title\} \/>/, 'the render must be unconditional');
    assert.ok(!/authorBio\s*&&\s*<AuthorBlock/.test(DETAIL));
    assert.ok(!/authorPhotoPath\s*&&\s*<AuthorBlock/.test(DETAIL));
  });
});
