// BEHAVIOURAL RULES ASSERTIONS — storage.rules, against the emulator.
//
// storage.rules is smaller than the database rules and almost entirely correct:
// every write names a uid or the two founder UIDs. R9.0 LB-6 found the one
// exception — film_submissions had no auth term at all — and this suite exists
// so that exception cannot reappear, and so the two rules that genuinely matter
// for money (the master EPUB fence) are asserted rather than assumed.

import { test, before, after, describe } from 'node:test';
import { makeEnv, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A } from './helpers.mjs';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let env, owner, stranger, anon, founder;

before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).storage();
  stranger = env.authenticatedContext(STRANGER).storage();
  founder = env.authenticatedContext(FOUNDER_A).storage();
  anon = env.unauthenticatedContext().storage();
});
after(async () => { await env?.cleanup(); });

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);      // %PDF-
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const EPUB = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const put = (st, path, bytes, contentType) =>
  uploadBytes(ref(st, path), bytes, { contentType });

describe('LB-6 · film_submissions — the unauthenticated upload hole', () => {
  test('an unauthenticated caller cannot upload (this was the hole)', async () => {
    await assertFails(put(anon, 'film_submissions/anything/x.pdf', PDF, 'application/pdf'));
  });

  test('LEGITIMATE: a signed-in reader can still submit a PDF', async () => {
    await assertSucceeds(put(owner, 'film_submissions/s1/script.pdf', PDF, 'application/pdf'));
  });

  test('non-PDF content is still refused', async () => {
    await assertFails(put(owner, 'film_submissions/s1/x.png', PNG, 'image/png'));
  });

  test('only founders may read submissions', async () => {
    await assertSucceeds(put(owner, 'film_submissions/s2/script.pdf', PDF, 'application/pdf'));
    await assertFails(getBytes(ref(anon, 'film_submissions/s2/script.pdf')));
    await assertFails(getBytes(ref(stranger, 'film_submissions/s2/script.pdf')));
    await assertSucceeds(getBytes(ref(founder, 'film_submissions/s2/script.pdf')));
  });
});

describe('the master EPUB fence — the only path to paid bytes', () => {
  test('master.epub is unreadable by everyone, signed in or not', async () => {
    // storage.rules keeps `allow read: if false`. The ONLY route to these bytes
    // is a V4 signed URL minted by functions/api/bookstore/stream.js AFTER it has
    // checked the purchase. A signed URL is a Cloud-Storage-level grant evaluated
    // before Firebase's rule layer, so the two coexist by design.
    await assertFails(getBytes(ref(anon, 'bookstore_epubs/a-title/master.epub')));
    await assertFails(getBytes(ref(owner, 'bookstore_epubs/a-title/master.epub')));
    await assertFails(getBytes(ref(founder, 'bookstore_epubs/a-title/master.epub')));
  });

  test('nobody but a founder may upload a master EPUB', async () => {
    await assertFails(put(anon, 'bookstore_epubs/t/master.epub', EPUB, 'application/epub+zip'));
    await assertFails(put(owner, 'bookstore_epubs/t/master.epub', EPUB, 'application/epub+zip'));
  });

  test('LEGITIMATE: a founder can upload a master EPUB', async () => {
    await assertSucceeds(put(founder, 'bookstore_epubs/t/master.epub', EPUB, 'application/epub+zip'));
  });

  test('the free sample stays world-readable', async () => {
    await assertSucceeds(put(founder, 'bookstore_epubs/t/sample.epub', EPUB, 'application/epub+zip'));
    await assertSucceeds(getBytes(ref(anon, 'bookstore_epubs/t/sample.epub')));
  });
});

describe('per-user assets', () => {
  test('LEGITIMATE: a reader writes their own avatar and header', async () => {
    await assertSucceeds(put(owner, `avatars/${OWNER}`, PNG, 'image/png'));
    await assertSucceeds(put(owner, `headers/${OWNER}`, PNG, 'image/png'));
  });

  test("a reader cannot write another reader's avatar", async () => {
    await assertFails(put(stranger, `avatars/${OWNER}`, PNG, 'image/png'));
  });

  test('open_pages images are owner-scoped and image-only', async () => {
    await assertSucceeds(put(owner, `open_pages/${OWNER}/a.png`, PNG, 'image/png'));
    await assertFails(put(stranger, `open_pages/${OWNER}/a.png`, PNG, 'image/png'));
    await assertFails(put(owner, `open_pages/${OWNER}/a.pdf`, PDF, 'application/pdf'));
  });
});

describe('admin-only prefixes reject ordinary readers', () => {
  for (const path of ['covers/x.png', 'authors/x.png', 'voices/v/x.png',
    'newsletter/i/x.png', 'bookstore_covers/t', 'story_authors/x.png']) {
    test(`${path} refuses a signed-in stranger`, async () => {
      await assertFails(put(stranger, path, PNG, 'image/png'));
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// R21 — THE DELETE RULES, AND THE HOLE THEY CLOSE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every bookstore rule used to be a single `allow write` guarded on
// `request.resource.size` and `request.resource.contentType`. On a DELETE,
// `request.resource` is NULL — so those guards evaluated against null and the
// delete was refused, for the founders too. Nothing noticed, because until R21
// nothing in the product ever deleted a bookstore object: `deleteTitle` was
// `setTitleStatus(id, 'unpublished')`.
//
// The rules now split `create, update` (which put bytes in the bucket, and keep
// the size and type guards) from `delete` (which needs only the identity).
//
// ⚠ THE MASTER EPUB'S RULE DOES NOT ENCODE R21'S RULING, AND MUST NOT PRETEND TO.
// "The master is not deleted if anyone owns the book" needs a purchase count, and
// a Storage rule cannot read RTDB. The guard is deletionPlan() in
// app/lib/bookstore/withdrawal.js, asserted in tests/bookstore/withdrawal.test.mjs.
// A rule that LOOKED like it enforced the ruling would be worse than this one,
// because it would move a reader's confidence onto a line that cannot hold it.
describe('R21 · deleting bookstore objects', () => {
  test('a founder can delete a cover — this was denied before the split', async () => {
    await assertSucceeds(put(founder, 'bookstore_covers/r21-a', PNG, 'image/png'));
    await assertSucceeds(deleteObject(ref(founder, 'bookstore_covers/r21-a')));
  });

  test('a founder can delete a cover derivative (flat sibling key)', async () => {
    await assertSucceeds(put(founder, 'bookstore_covers/r21-b_w360.webp', PNG, 'image/png'));
    await assertSucceeds(deleteObject(ref(founder, 'bookstore_covers/r21-b_w360.webp')));
  });

  test('a founder can delete a sample EPUB', async () => {
    await assertSucceeds(put(founder, 'bookstore_epubs/r21-c/sample.epub', EPUB, 'application/epub+zip'));
    await assertSucceeds(deleteObject(ref(founder, 'bookstore_epubs/r21-c/sample.epub')));
  });

  test('a founder can delete a master EPUB — the RULE allows it; the CODE is what refuses', async () => {
    await assertSucceeds(put(founder, 'bookstore_epubs/r21-d/master.epub', EPUB, 'application/epub+zip'));
    await assertSucceeds(deleteObject(ref(founder, 'bookstore_epubs/r21-d/master.epub')));
  });

  test('nobody else can delete anything under the bookstore prefixes', async () => {
    await assertSucceeds(put(founder, 'bookstore_covers/r21-e', PNG, 'image/png'));
    await assertSucceeds(put(founder, 'bookstore_epubs/r21-e/sample.epub', EPUB, 'application/epub+zip'));
    await assertSucceeds(put(founder, 'bookstore_epubs/r21-e/master.epub', EPUB, 'application/epub+zip'));
    for (const st of [anon, owner, stranger]) {
      await assertFails(deleteObject(ref(st, 'bookstore_covers/r21-e')));
      await assertFails(deleteObject(ref(st, 'bookstore_epubs/r21-e/sample.epub')));
      await assertFails(deleteObject(ref(st, 'bookstore_epubs/r21-e/master.epub')));
    }
  });

  test('THE SPLIT DID NOT LOOSEN THE UPLOAD GUARDS', async () => {
    // The whole risk of turning one `allow write` into two rules is that the size
    // and content-type conditions get left on the wrong half.
    await assertFails(put(founder, 'bookstore_covers/r21-f', EPUB, 'application/epub+zip'));
    await assertFails(put(founder, 'bookstore_epubs/r21-f/master.epub', PNG, 'image/png'));
    await assertFails(put(founder, 'bookstore_epubs/r21-f/sample.epub', PNG, 'image/png'));
    await assertFails(put(stranger, 'bookstore_covers/r21-f', PNG, 'image/png'));
    await assertFails(put(anon, 'bookstore_epubs/r21-f/sample.epub', EPUB, 'application/epub+zip'));
  });

  test('and master.epub is still unreadable by everyone', async () => {
    await assertSucceeds(put(founder, 'bookstore_epubs/r21-g/master.epub', EPUB, 'application/epub+zip'));
    await assertFails(getBytes(ref(anon, 'bookstore_epubs/r21-g/master.epub')));
    await assertFails(getBytes(ref(owner, 'bookstore_epubs/r21-g/master.epub')));
    await assertFails(getBytes(ref(founder, 'bookstore_epubs/r21-g/master.epub')));
  });
});
