// R18 — THE AUTHOR BLOCK, as data. The bounds, the byline, and the one decision the page makes.
//
// This file pins app/lib/bookstore/author.js. Its companion, author-render.test.mjs, renders
// the component and asserts what is and is not in the document; the rules half is pinned in
// tests/rules/database.test.mjs, which reads AUTHOR_CAPS out of this same module so the
// validator and the .validate rule cannot drift.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHOR_CAPS,
  AUTHOR_FIELDS,
  authorBlockOf,
  authorPhotoPathFor,
  isAuthorPhotoPath,
  normaliseAuthorFields,
  publicPhotoUrl,
  validateAuthorFields,
  MAX_AUTHOR_PHOTO_BYTES,
} from '../../app/lib/bookstore/author.js';

const chars = (n) => 'a'.repeat(n);
/** The write path always normalises first, so the validator only ever sees '' as null. */
const check = (fields) => validateAuthorFields(normaliseAuthorFields({ ...fields }));

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · the bounds', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('authorBio: 0 is absence, 800 saves, 801 is refused', () => {
    // 0 — an empty textarea is not an error, it is the field not being used. normalise turns
    // it into null, which RTDB drops, which is how ABSENCE stays expressible for a field whose
    // .validate can never run on a null write.
    const zero = normaliseAuthorFields({ authorBio: chars(0) });
    assert.equal(zero.authorBio, null, 'an empty bio must become null, not stay an empty string');
    assert.deepEqual(validateAuthorFields(zero), [], 'no bio is a valid title');

    assert.deepEqual(check({ authorBio: chars(800) }), [], '800 characters is inside the cap');

    const over = check({ authorBio: chars(801) });
    assert.equal(over.length, 1, '801 characters must be refused');
    assert.match(over[0], /authorBio must be 800 characters or fewer/);
  });

  test('authorName: 0 is absence, 120 saves, 121 is refused', () => {
    const zero = normaliseAuthorFields({ authorName: chars(0) });
    assert.equal(zero.authorName, null);
    assert.deepEqual(validateAuthorFields(zero), []);

    assert.deepEqual(check({ authorName: chars(120) }), []);

    const over = check({ authorName: chars(121) });
    assert.equal(over.length, 1);
    assert.match(over[0], /authorName must be 120 characters or fewer/);
  });

  test('authorPhotoAlt: 0 is absence, 160 saves, 161 is refused', () => {
    assert.equal(normaliseAuthorFields({ authorPhotoAlt: '' }).authorPhotoAlt, null);
    assert.deepEqual(check({ authorPhotoAlt: chars(160) }), []);
    assert.equal(check({ authorPhotoAlt: chars(161) }).length, 1);
  });

  test('all four fields are optional — a title carrying none of them is valid', () => {
    assert.deepEqual(validateAuthorFields({}), []);
    assert.deepEqual(validateAuthorFields(normaliseAuthorFields({})), []);
    for (const k of AUTHOR_FIELDS) {
      assert.deepEqual(validateAuthorFields({ [k]: null }), [], `${k}: null must be valid`);
    }
  });

  test('a non-string is named rather than silently coerced', () => {
    assert.equal(check({ authorBio: 42 }).length, 1);
    assert.equal(check({ authorName: { first: 'Jane' } }).length, 1);
    assert.equal(check({ authorPhotoPath: ['x'] }).length, 1);
  });

  test('whitespace is trimmed, and whitespace alone is absence', () => {
    assert.equal(normaliseAuthorFields({ authorBio: '  A life.  ' }).authorBio, 'A life.');
    assert.equal(normaliseAuthorFields({ authorName: '   ' }).authorName, null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · THE BYLINE AND THE NAME ARE DIFFERENT CLAIMS', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The anthology case, which is the reason the two fields exist separately. `author` is the
// byline — whose name sits under the title — and on an anthology it deliberately reads
// "Calvary Scribblings" so that no single contributor takes the attention. `authorName` is a
// person, for the block under the synopsis.
//
// A future tidy that "reconciles" them would overwrite an editorial decision with a guess.

  const ANTHOLOGY = {
    author: 'Calvary Scribblings',           // the byline
    authorName: 'Ada Nwachukwu',             // the person in the author block
    authorBio: 'Ada writes from Enugu.',
  };

  test('a byline of "Calvary Scribblings" and a different authorName both save, uncorrected', () => {
    const doc = normaliseAuthorFields({ ...ANTHOLOGY });
    assert.deepEqual(validateAuthorFields(doc), [], 'a disagreeing pair must not be an error');

    // NEITHER FIELD IS TOUCHED. Not synced, not derived, not warned about.
    assert.equal(doc.author, 'Calvary Scribblings', 'the byline must survive normalisation unchanged');
    assert.equal(doc.authorName, 'Ada Nwachukwu', 'the author name must survive normalisation unchanged');
    assert.notEqual(doc.author, doc.authorName, 'the two must be allowed to differ');
  });

  test('the block prints the person, never the byline', () => {
    const block = authorBlockOf(ANTHOLOGY);
    assert.equal(block.name, 'Ada Nwachukwu');
    assert.notEqual(block.name, ANTHOLOGY.author);
  });

  test('a byline with no authorName does NOT become one', () => {
    // The gate is bio-or-photo. A title with only a byline has no author block at all, and
    // must not borrow `author` to manufacture one.
    assert.equal(authorBlockOf({ author: 'Calvary Scribblings' }), null);
    // And with a bio but no name, the block renders the bio and NO name line.
    const b = authorBlockOf({ author: 'Calvary Scribblings', authorBio: 'Eight writers.' });
    assert.equal(b.name, null, 'the byline must never fill in for a missing authorName');
    assert.equal(b.bio, 'Eight writers.');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · the photograph’s path', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('it is a FLAT sibling of the cover, because the storage match is single-segment', () => {
    assert.equal(authorPhotoPathFor('the-quiet-house', 'jpg'), 'bookstore_covers/the-quiet-house_author.jpg');
    // storage.rules: `match /bookstore_covers/{titleId}` captures ONE segment. A nested path
    // would match no rule at all and be denied on read and on write.
    assert.ok(!authorPhotoPathFor('x', 'jpg').slice('bookstore_covers/'.length).includes('/'),
      'the photo key must not contain a second path segment');
  });

  test('the underscore suffix cannot collide with a real title’s cover', () => {
    // SLUG_RE is /^[a-z0-9]+(-[a-z0-9]+)*$/ — hyphens yes, underscores never. So a title
    // legitimately slugged `jane-author` gets `bookstore_covers/jane-author.jpg` for its
    // cover, which is a different key from `jane`'s photograph.
    assert.notEqual(authorPhotoPathFor('jane', 'jpg'), 'bookstore_covers/jane-author.jpg');
    assert.equal(authorPhotoPathFor('jane', 'jpg'), 'bookstore_covers/jane_author.jpg');
  });

  test('extensions are normalised, junk is not smuggled into the key', () => {
    assert.equal(authorPhotoPathFor('a', 'JPEG'), 'bookstore_covers/a_author.jpeg');
    assert.equal(authorPhotoPathFor('a', '../evil'), 'bookstore_covers/a_author.evil');
    assert.equal(authorPhotoPathFor('a', ''), 'bookstore_covers/a_author.bin');
  });

  test('isAuthorPhotoPath accepts only a flat key under the public-read prefix', () => {
    assert.ok(isAuthorPhotoPath('bookstore_covers/a_author.jpg'));
    assert.ok(!isAuthorPhotoPath('bookstore_covers/a/author.jpg'), 'nested is not storable');
    assert.ok(!isAuthorPhotoPath('bookstore_epubs/a_author.jpg'), 'the private prefix is not storable');
    assert.ok(!isAuthorPhotoPath('/bookstore_covers/a_author.jpg'));
    assert.ok(!isAuthorPhotoPath('bookstore_covers/'), 'the prefix alone is not a file');
    assert.ok(!isAuthorPhotoPath(''));
    assert.ok(!isAuthorPhotoPath('bookstore_covers/' + 'a'.repeat(AUTHOR_CAPS.authorPhotoPath)),
      'over the length cap is not storable');
  });

  test('a path becomes a public URL with no token — which is only true because the prefix is public-read', () => {
    const url = publicPhotoUrl('bookstore_covers/a_author.jpg');
    assert.match(url, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/calvary-scribblings\.firebasestorage\.app\/o\//);
    assert.match(url, /bookstore_covers%2Fa_author\.jpg\?alt=media$/);
    assert.ok(!/token/.test(url), 'no access token — storage.rules allows the anonymous read');
    assert.equal(publicPhotoUrl('bookstore_epubs/a_author.jpg'), null);
  });

  test('the client cap is 3 MB, tighter than the cover rule’s 5', () => {
    assert.equal(MAX_AUTHOR_PHOTO_BYTES, 3 * 1024 * 1024);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R18 · NO FALLBACK — the one decision the page makes', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const PHOTO = 'bookstore_covers/t_author.jpg';

  test('no bio and no photo → null. Not an empty block.', () => {
    assert.equal(authorBlockOf({}), null);
    assert.equal(authorBlockOf({ authorBio: null, authorPhotoPath: null }), null);
    assert.equal(authorBlockOf(null), null);
  });

  test('a NAME alone is not a block', () => {
    // It would print a section heading over one line the byline already said three inches up.
    assert.equal(authorBlockOf({ authorName: 'Ada Nwachukwu' }), null);
    assert.equal(authorBlockOf({ authorName: 'Ada', authorPhotoAlt: 'Ada, smiling' }), null,
      'alt text without a photograph is not a block either');
  });

  test('bio-only is a block, with no photograph', () => {
    const b = authorBlockOf({ authorName: 'Ada', authorBio: 'Ada writes from Enugu.' });
    assert.equal(b.bio, 'Ada writes from Enugu.');
    assert.equal(b.photoUrl, null);
    assert.equal(b.alt, null, 'no photograph means no alt text to carry');
  });

  test('photo-only is a block, with no bio', () => {
    const b = authorBlockOf({ authorName: 'Ada', authorPhotoPath: PHOTO });
    assert.ok(b.photoUrl);
    assert.equal(b.bio, null);
    assert.equal(b.name, 'Ada');
  });

  test('a photograph with neither name nor bio is still a block', () => {
    const b = authorBlockOf({ authorPhotoPath: PHOTO });
    assert.ok(b.photoUrl);
    assert.equal(b.name, null);
    assert.equal(b.bio, null);
    assert.equal(b.alt, 'Photograph of the author', 'an image always reaches a screen reader named');
  });

  test('a malformed photo path is treated as no photograph, not as a broken image', () => {
    assert.equal(authorBlockOf({ authorPhotoPath: 'bookstore_covers/a/nested.jpg' }), null);
    assert.equal(authorBlockOf({ authorPhotoPath: 'https://example.com/x.jpg' }), null);
  });

  test('alt falls back to the name, then to a plain description', () => {
    assert.equal(authorBlockOf({ authorName: 'Ada', authorPhotoPath: PHOTO }).alt, 'Photograph of Ada');
    assert.equal(authorBlockOf({ authorName: 'Ada', authorPhotoPath: PHOTO, authorPhotoAlt: 'Ada at her desk' }).alt,
      'Ada at her desk');
  });
});
