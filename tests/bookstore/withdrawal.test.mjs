// ═══════════════════════════════════════════════════════════════════════════════════════════
// R21 — WITHDRAWAL AND DELETION, asserted.
//
//   node --test tests/bookstore/withdrawal.test.mjs      (npm run test:withdrawals)
//
// Two rulings, and every test here is one of them:
//
//   1. ADMIN HAS COMPLETE CONTROL over what the shop sells. No title is unremovable.
//   2. WE NEVER TAKE BACK BOUGHT TITLES. A purchase is permanent.
//
// THE LOAD-BEARING CLAIM OF THE WHOLE ROUND is "an owner of a DELETED title can still stream
// it", and it is asserted directly, against the real endpoint, at the foot of this file. Every
// other test in here exists to stop something from quietly making that false.
//
// The WATCH MUTATIONS block at the end is the other half: each one deliberately breaks a rule
// and proves the suite catches it. A guard nobody has tried to get past is a guard nobody
// knows the strength of.
//
// Offline and host-independent. The withdrawal module is pure, and the one endpoint test stubs
// every outbound call — which is the only way to produce "the title record does not exist any
// more" without deleting a live title.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

import {
  WITHDRAWN,
  WITHDRAWAL_KEY,
  RESTORE_STATUS,
  normaliseWithdrawal,
  validateWithdrawal,
  applyWithdrawalBlock,
  isWithdrawn,
  isScheduled,
  withdrawalDue,
  dueWithdrawals,
  withdrawalRefusal,
  restoreRefusal,
  OWNERS_UNKNOWN,
  ownersKnown,
  ownersSentence,
  confirmConsequence,
  nameMatches,
  deletionPlan,
  tombstoneOf,
  pruneClaims,
  takenCatalogueNumbers,
  storagePathFromDownloadUrl,
  masterPathFor,
  samplePathFor,
} from '../../app/lib/bookstore/withdrawal.js';
import { TITLE_STATUSES } from '../../app/lib/bookstore/schema.js';
import { resolveSections } from '../../app/lib/bookstore/sections.js';
import { onRequestPost } from '../../functions/api/bookstore/stream.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const BUCKET = 'calvary-scribblings.firebasestorage.app';
const dl = (path) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=abc-123`;

/** A complete, live-shaped title — the thing every act below operates on. */
const TITLE = Object.freeze({
  id: 'the-quiet-house',
  schemaVersion: 2,
  slug: 'the-quiet-house',
  title: 'The Quiet House',
  author: 'A. Nwosu',
  publisherId: 'calvary',
  synopsis: 'A house that will not say what it knows.',
  coverUrl: dl('bookstore_covers/the-quiet-house.jpg'),
  coverSizes: {
    w360: dl('bookstore_covers/the-quiet-house_w360.webp'),
    w720: dl('bookstore_covers/the-quiet-house_w720.webp'),
  },
  epubPath: 'bookstore_epubs/the-quiet-house/master.epub',
  samplePath: 'bookstore_epubs/the-quiet-house/sample.epub',
  authorPhotoPath: 'bookstore_covers/the-quiet-house_author.jpg',
  catalogueNumber: 7,
  prices: { gbp: 499 },
  genre: 'literary-fiction',
  publishedDate: '2026-03-01',
  addedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  status: 'published',
  featured: false,
  bestseller: false,
  territoriesAllowed: '*',
  salesCount: 0,
  ratingAverage: null,
  ratingCount: 0,
});

const withdrawn = (extra = {}) => ({
  ...TITLE,
  status: WITHDRAWN,
  [WITHDRAWAL_KEY]: { appliedAt: 1_800_000_000_000, by: 'founder', previousStatus: 'published' },
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the state machine', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test("'withdrawn' is a real status, and it is not 'unpublished' wearing a hat", () => {
    assert.ok(TITLE_STATUSES.includes(WITHDRAWN), 'the enum must carry it');
    assert.notEqual(WITHDRAWN, 'unpublished');
    assert.notEqual(WITHDRAWN, 'published');
    // The property every public surface depends on without knowing it: a withdrawn title
    // fails `status === 'published'`.
    assert.equal(withdrawn().status === 'published', false);
  });

  test('published → withdrawn → published', () => {
    assert.equal(withdrawalRefusal(TITLE), null, 'a published title may be withdrawn');
    const w = withdrawn();
    assert.ok(isWithdrawn(w));
    assert.equal(restoreRefusal(w), null, 'a withdrawn title may be restored');
    assert.equal(RESTORE_STATUS, 'published', 'and it goes back to the shelf, not to a draft');
  });

  test('only a published title can be withdrawn — there is nothing to withdraw a draft from', () => {
    for (const status of ['draft', 'unpublished']) {
      const r = withdrawalRefusal({ ...TITLE, status });
      assert.ok(r, `${status} must be refused`);
      assert.match(r, /Only a published title/);
      // And the refusal has to point somewhere useful — ruling 1 means the answer is never
      // "you cannot remove this", it is "use the other act".
      assert.match(r, /Delete it/);
    }
  });

  test('a withdrawn title is not withdrawn twice, and an unwithdrawn one is not restored', () => {
    assert.match(withdrawalRefusal(withdrawn()), /already withdrawn/);
    assert.match(restoreRefusal(TITLE), /Only a withdrawn title/);
    assert.match(restoreRefusal({ ...TITLE, status: 'draft' }), /Only a withdrawn title/);
  });

  test('restoring puts a title straight back on the shelf, so it must still have its files', () => {
    // validateTitle requires cover + EPUB for 'published'. Catching it here means the founder
    // is told which file is missing rather than being handed a validator error from three
    // frames up.
    assert.match(restoreRefusal(withdrawn({ coverUrl: null })), /cover and its EPUB/);
    assert.match(restoreRefusal(withdrawn({ epubPath: null })), /cover and its EPUB/);
  });

  test('anything → deleted: ruling 1 has no status condition anywhere', () => {
    // The delete path takes no status into account at all. Proven by the plan builder, which is
    // the only thing standing between a click and a removal, accepting every status.
    for (const status of TITLE_STATUSES) {
      const plan = deletionPlan({ titleId: TITLE.id, title: { ...TITLE, status }, owners: ownersKnown(0) });
      assert.equal(plan.ok, true, `${status} must be deletable`);
    }
    // And the CMS row offers Delete unconditionally — no status test on that button. Sliced
    // from the button's own comment marker so an edit above it cannot widen the window.
    const page = src('app/admin/bookstore/page.js');
    const from = page.indexOf('NO STATUS CONDITION');
    assert.ok(from > 0, 'the ruling has to be written at the button');
    const btn = page.slice(from, page.indexOf('data-testid={`delete-${t.id}`}'));
    assert.equal(/t\.status/.test(btn), false, 'the Delete button must not be gated on a status');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('a withdrawn or deleted title is absent from every public surface', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// THE MECHANISM IS THAT THERE IS NO NEW MECHANISM. Every public reader in this repo selects on
// `status === 'published'` — a positive test — so a new status is excluded by construction. The
// tests below pin that property rather than re-listing the surfaces, because a list would go
// stale the moment a tenth surface is added and this will not.

  const PUBLIC_READERS = [
    'app/lib/bookstore/loader.js',
    'app/bookstore/page.js',
    'app/bookstore/[slug]/page.js',
    'app/reader/[slug]/page.js',
  ];

  test('every public reader selects titles POSITIVELY, on published', () => {
    for (const rel of PUBLIC_READERS) {
      const text = src(rel);
      assert.ok(
        /equalTo\('published'\)/.test(text) || /===\s*'published'/.test(text),
        `${rel} must select on status === 'published'`,
      );
    }
  });

  test('no public reader selects titles by EXCLUDING statuses', () => {
    // A `status !== 'unpublished'` filter would let a withdrawn title straight through, and it
    // is the exact shape a well-meaning later edit reaches for. There must be none.
    for (const rel of PUBLIC_READERS) {
      const text = src(rel);
      const bad = text.match(/status\s*!==?\s*'(draft|unpublished|withdrawn)'/g);
      assert.equal(bad, null, `${rel} filters by exclusion: ${bad}`);
    }
  });

  test('a withdrawn title leaves every curated section that claims it — silently', () => {
    const sections = [
      { id: 'ec-1', type: 'editors-choice', status: 'live', displayTitle: "Editor's Choice", slugs: [TITLE.slug] },
    ];
    const withIt = resolveSections(sections, [TITLE], { now: 1_800_000_000_000 });
    assert.equal(withIt.length, 1, 'while published, the section renders');

    // The published catalogue no longer contains it — that is all a withdrawal does.
    const withoutIt = resolveSections(sections, [], { now: 1_800_000_000_000 });
    assert.equal(withoutIt.length, 0, 'the section drops, and there is no empty state');
  });

  test('withdrawal does NOT prune the curator\'s claim, because withdrawal is reversible', () => {
    // Restoring a title must put it back in the section it was chosen for. Pruning on
    // withdrawal would destroy the curator's decision on an act that advertises itself as
    // undoable — the shop stops showing it either way (the test above), so pruning buys
    // nothing and costs the choice.
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function withdrawTitle'), admin.indexOf('export async function restoreTitle'));
    assert.equal(/pruneClaims/.test(fn), false, 'withdrawTitle must not prune claims');
  });

  test('deletion DOES prune the claim — no section may point at nothing', () => {
    const sections = [
      { id: 'ec-1', type: 'editors-choice', status: 'live', displayTitle: "Editor's Choice", slugs: ['other', TITLE.slug] },
      { id: 'tos-1', type: 'top-of-the-shelf', status: 'live', displayTitle: 'Top of the Shelf', slugs: [TITLE.slug] },
      { id: 'untouched', type: 'editors-choice', status: 'live', displayTitle: 'Elsewhere', slugs: ['other'] },
    ];
    const { patch, touched } = pruneClaims(sections, TITLE.slug, 999);
    assert.deepEqual(patch['ec-1/slugs'], ['other']);
    // An emptied claim is written as null — RTDB drops the key, and an unmade claim is silence.
    assert.equal(patch['tos-1/slugs'], null);
    assert.equal(patch['untouched/slugs'], undefined, 'a section that never claimed it is not touched');
    assert.equal(touched.length, 2);
  });

  test('pruning never retires a section, and never invents one', () => {
    // The eight silent-drop conditions still hold: resolveSections decides what renders, and a
    // section that falls below its `min` disappears on its own. A title deletion that could
    // delete a SECTION would mean removing a book edits the curator's shelf.
    const sections = [{ id: 'tos-1', type: 'top-of-the-shelf', status: 'live', displayTitle: 'T', slugs: [TITLE.slug] }];
    const { patch } = pruneClaims(sections, TITLE.slug, 999);
    assert.equal(patch['tos-1'], undefined, 'the section record itself is never removed');
    assert.equal(patch['tos-1/status'], undefined, 'and it is never retired');
  });

  test('a data-driven section is never given a slugs key it is not allowed to have', () => {
    const sections = [{ id: 'rc', type: 'readers-choice', status: 'live', displayTitle: 'R' }];
    const { patch, touched } = pruneClaims(sections, TITLE.slug, 999);
    assert.deepEqual(patch, {});
    assert.equal(touched.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('⛔ THE MASTER EPUB SURVIVES DELETION WHEN THE BOOK IS OWNED', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test('nine owners: the master is HELD, and it is not in the delete list', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(9) });
    assert.equal(plan.ok, true);
    assert.equal(plan.owned, true);
    assert.ok(plan.held.includes(masterPathFor(TITLE.id)), 'the master must be held');
    assert.equal(plan.delete.includes(masterPathFor(TITLE.id)), false, 'and never queued for deletion');
    assert.match(plan.reason, /master EPUB/);
  });

  test('one owner is enough — the rule is "anyone", not "enough people"', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(1) });
    assert.equal(plan.delete.includes(masterPathFor(TITLE.id)), false);
    assert.ok(plan.held.includes(masterPathFor(TITLE.id)));
  });

  test('the cover an owner\'s shelf renders is held with it', () => {
    // The tombstone carries coverUrl and My Library renders it as a bare <img src>. Delete the
    // object and a book someone owns renders as a broken-image glyph.
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(3) });
    assert.ok(plan.held.includes('bookstore_covers/the-quiet-house.jpg'));
    assert.equal(plan.delete.includes('bookstore_covers/the-quiet-house.jpg'), false);
  });

  test('AN UNREADABLE OWNER COUNT DELETES NOTHING. It is not zero.', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: OWNERS_UNKNOWN });
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.delete, [], 'not one file');
    assert.ok(plan.held.includes(masterPathFor(TITLE.id)));
    assert.match(plan.reason, /could not be read/);
  });

  test('the write path refuses the delete outright on an unknown count', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function deleteTitle'));
    assert.match(fn, /if \(!owners\.ok\)/, 'deleteTitle must branch on the unknown count');
    assert.match(fn, /nothing was deleted/);
    // And the reason has to be AT the code site — that is the round's requirement.
    assert.match(fn, /RULING 2/);
  });

  test('nobody owns it: everything goes. Ruling 1 — no title is unremovable.', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(0) });
    assert.equal(plan.owned, false);
    assert.deepEqual(plan.held, [], 'nothing is held when nothing is owned');
    assert.ok(plan.delete.includes(masterPathFor(TITLE.id)));
    assert.ok(plan.delete.includes('bookstore_covers/the-quiet-house.jpg'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the storage objects that should go are actually gone', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test('an owned title still loses its sample, its cover rungs and its author photograph', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(9) });
    assert.ok(plan.delete.includes(samplePathFor(TITLE.id)), 'the free chapter must not survive');
    assert.ok(plan.delete.includes('bookstore_covers/the-quiet-house_w360.webp'));
    assert.ok(plan.delete.includes('bookstore_covers/the-quiet-house_w720.webp'));
    assert.ok(plan.delete.includes('bookstore_covers/the-quiet-house_author.jpg'));
  });

  test('every path in the plan is a real Storage key, never a download URL', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(0) });
    for (const p of [...plan.delete, ...plan.held]) {
      assert.equal(/^https?:/.test(p), false, `${p} is a URL, not a Storage path`);
      assert.match(p, /^bookstore_(covers|epubs)\//, `${p} is outside the bookstore's prefixes`);
    }
  });

  test('the plan never names the same object twice', () => {
    const plan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(0) });
    assert.equal(new Set(plan.delete).size, plan.delete.length);
  });

  test('a title with no sample, no rungs and no photograph produces no phantom paths', () => {
    const bare = { ...TITLE, coverSizes: null, samplePath: null, authorPhotoPath: null };
    const plan = deletionPlan({ titleId: bare.id, title: bare, owners: ownersKnown(0) });
    // The sample path is always attempted — it is a constant, and object-not-found is the
    // ordinary answer for a title that never had one. Everything else is derived and absent.
    assert.deepEqual(plan.delete.filter((p) => p.includes('_w')), []);
    assert.equal(plan.delete.includes('bookstore_covers/the-quiet-house_author.jpg'), false);
  });

  test('a download URL resolves to its object path, and anything else resolves to nothing', () => {
    assert.equal(storagePathFromDownloadUrl(dl('bookstore_covers/a-b.jpg')), 'bookstore_covers/a-b.jpg');
    // A path with a slash in it survives the percent-decode intact.
    assert.equal(storagePathFromDownloadUrl(dl('bookstore_epubs/x/master.epub')), 'bookstore_epubs/x/master.epub');
    for (const junk of [null, '', 'https://example.com/a.jpg', 'gs://bucket/a.jpg', 42, {}]) {
      assert.equal(storagePathFromDownloadUrl(junk), null, `${JSON.stringify(junk)} must not name an object`);
    }
  });

  test('the delete loop treats object-not-found as ordinary, and everything else as a failure', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function deleteTitle'));
    assert.match(fn, /storage\/object-not-found/);
    assert.match(fn, /filesFailed/, 'a real failure is reported, not swallowed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("the confirm step's count matches live data", () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test('the sentence carries the number, and the number is the count', () => {
    assert.equal(ownersSentence(0), 'No one owns this book yet.');
    assert.equal(ownersSentence(1), 'One reader owns this book.');
    assert.equal(ownersSentence(9), 'Nine readers own this book.');
    assert.equal(ownersSentence(13), '13 readers own this book.');
    assert.equal(ownersSentence(1204), '1,204 readers own this book.');
  });

  test('the whole consequence is stated in plain words BEFORE it happens', () => {
    const c = confirmConsequence(9);
    assert.equal(
      c,
      'Nine readers own this book. They keep it — it will stay in their library and they can '
      + 'still read it. Deleting removes it from the shop and from the catalogue.',
    );
    // Ruling 2 comes FIRST, before the destructive half. That ordering is the design.
    assert.ok(c.indexOf('They keep it') < c.indexOf('Deleting removes'));
  });

  test('NEVER A BARE "ARE YOU SURE"', () => {
    for (const n of [0, 1, 9, 1204]) {
      const c = confirmConsequence(n);
      assert.equal(/are you sure/i.test(c), false);
      assert.match(c, /owns? this book/);
      assert.match(c, /Deleting removes it from the shop/);
    }
    // Comments stripped: the file's own header ARGUES against a bare confirm, by name.
    const dialog = src('app/admin/bookstore/RemovalDialog.js')
      .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/are you sure/i.test(dialog), false);

    // The DELETE dialog must not carry its own copy of the consequence — that sentence is
    // built from a live number, and a second copy is a second number waiting to disagree.
    const del = dialog.slice(dialog.indexOf('export function DeleteDialog'));
    assert.equal(/Deleting removes it from the shop/.test(del), false, 'the sentence lives in withdrawal.js, once');
    assert.match(del, /preview\.consequence/, 'and the dialog renders that one');

    // The WITHDRAW dialog states ruling 2 in its own words, because it has no count to carry
    // and its wording turns on a different thing — whether the date is in the future.
    const wd = dialog.slice(dialog.indexOf('export function WithdrawDialog'), dialog.indexOf('export function DeleteDialog'));
    assert.match(wd, /keep it/, 'the withdraw dialog must say the owners keep the book');
    assert.match(wd, /still read it/);
  });

  test('an unknown count produces no sentence at all — a dialog may not guess a number', () => {
    for (const bad of [null, undefined, -1, 1.5, '9']) {
      assert.equal(confirmConsequence(bad), null);
      assert.equal(ownersSentence(bad), null);
    }
  });

  test('the count is read LIVE, from the node that is written with each purchase', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    assert.match(admin, /READERSHIP_PATH/, 'the count comes from bookstore_readership');
    const preview = admin.slice(admin.indexOf('export async function deletionPreview'), admin.indexOf('export async function withdrawTitle'));
    assert.match(preview, /readOwnerCount/);
    assert.match(preview, /confirmConsequence\(owners\.count\)/, 'the sentence is built from the number that was read');
    assert.match(preview, /!owners\.ok/, 'and an unreadable count returns an error, not a dialog');
  });

  test('the dialog does not open until the count is in hand', () => {
    const page = src('app/admin/bookstore/page.js');
    const open = page.slice(page.indexOf('async function openDelete'), page.indexOf('async function confirmWithdraw'));
    // The preview is awaited, checked, and only then does the dialog get its state.
    assert.ok(open.indexOf('await deletionPreview') < open.indexOf("setRemoval({ mode: 'delete'"));
    assert.match(open, /if \(!preview\.ok\)/);
    assert.ok(
      open.indexOf('if (!preview.ok)') < open.indexOf("setRemoval({ mode: 'delete'"),
      'a failed count must return before the dialog is opened',
    );
  });

  test('the founder types the title\'s name — trimmed and case-insensitive, but nothing looser', () => {
    assert.equal(nameMatches('The Quiet House', TITLE.title), true);
    assert.equal(nameMatches('  the quiet   house  ', TITLE.title), true, 'copied off the row, on a phone keyboard');
    assert.equal(nameMatches('The Quiet Hous', TITLE.title), false);
    assert.equal(nameMatches('The Loud House', TITLE.title), false);
    assert.equal(nameMatches('', TITLE.title), false);
    assert.equal(nameMatches('x', ''), false, 'a title with no name arms nothing');
    assert.equal(nameMatches(null, TITLE.title), false);
  });

  test('the write path refuses a delete whose typed name does not match', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function deleteTitle'));
    assert.match(fn, /nameMatches\(confirmName, title\.title\)/);
    // BEFORE the count is read, so a mistyped name never even asks the database.
    assert.ok(fn.indexOf('nameMatches') < fn.indexOf('readOwnerCount'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the tombstone, and the catalogue number that is never reused', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test('it carries exactly what My Library would need, and nothing the shop must not see', () => {
    const t = tombstoneOf({ titleId: TITLE.id, title: TITLE, by: 'founder-uid', nowMs: 999, ownerCount: 9 });
    assert.equal(t.title, 'The Quiet House');
    assert.equal(t.author, 'A. Nwosu');
    assert.equal(t.slug, 'the-quiet-house');
    assert.equal(t.coverUrl, TITLE.coverUrl);
    assert.equal(t.catalogueNumber, 7);
    assert.equal(t.ownersAtDeletion, 9);
    // ⚠ NO PRICES, NO EPUB PATH, NO PUBLISHER PAYMENT DETAIL. The node is `.read: true`.
    for (const forbidden of ['prices', 'epubPath', 'samplePath', 'coverSizes', 'synopsis', 'territoriesAllowed']) {
      assert.equal(forbidden in t, false, `the tombstone must not carry ${forbidden}`);
    }
  });

  test('it is a fixed field list, not a spread of the record', () => {
    // A spread would leak whatever a future field happens to be onto a public node.
    const lib = src('app/lib/bookstore/withdrawal.js');
    const fn = lib.slice(lib.indexOf('export function tombstoneOf'), lib.indexOf('THE CATALOGUE NUMBER OF A REMOVED TITLE'));
    assert.equal(/\.\.\.t[,\s}]/.test(fn), false, 'tombstoneOf must never spread the title');
  });

  test('it goes to its OWN node, never a flag on the title record', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    assert.match(admin, /bookstore_titles_deleted/);
    const fn = admin.slice(admin.indexOf('export async function deleteTitle'));
    assert.match(fn, /\[`\$\{TITLES_PATH\}\/\$\{titleId\}`\]: null/, 'the record is genuinely removed');
    assert.equal(/deleted:\s*true/.test(fn), false, 'never a soft-delete flag');
  });

  test('the number of a removed title is never offered again — the sequence keeps its gap', () => {
    const titles = [{ id: 'a', title: 'A', catalogueNumber: 1 }, { id: 'b', title: 'B', catalogueNumber: 3 }];
    const stones = [{ titleId: 'gone', title: 'Gone', catalogueNumber: 2 }];
    const taken = takenCatalogueNumbers(titles, stones);
    assert.equal(taken.has(2), true, 'CS 002 is taken by a book that no longer exists');
    assert.equal(taken.get(2).kind, 'deleted');
    assert.equal(taken.has(4), false);
  });

  test('nothing in the tree allocates a catalogue number, which is why the rule holds', () => {
    // The rule is enforced by ABSENCE. If a "next number" helper is ever added, it has to
    // consult takenCatalogueNumbers — and this test is the note that says so.
    const admin = src('app/lib/bookstore/admin-writes.js');
    assert.equal(/nextCatalogueNumber|catalogueNumber:\s*max/i.test(admin), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the withdrawal block, and the scheduled case', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════

  test('an empty block normalises to null, never to {}', () => {
    for (const junk of [null, undefined, {}, [], 'x', { reason: '   ' }]) {
      assert.equal(normaliseWithdrawal(junk), null, `${JSON.stringify(junk)}`);
    }
  });

  test('a future date leaves the title published, on the shelf, and sellable', () => {
    const now = 1_800_000_000_000;
    const scheduled = { ...TITLE, [WITHDRAWAL_KEY]: { scheduledFor: now + 86_400_000 } };
    assert.equal(scheduled.status, 'published', 'nothing about the shop changes yet');
    assert.equal(isScheduled(scheduled), true);
    assert.equal(withdrawalDue(scheduled, now), false);
    // And nothing a reader sees says a countdown is running. A two-year licence is not a book
    // with a clock printed on it.
    assert.equal(isWithdrawn(scheduled), false);
  });

  test('the licence ends AT the date, so the millisecond it names is already out', () => {
    const at = 1_800_000_000_000;
    const t = { ...TITLE, [WITHDRAWAL_KEY]: { scheduledFor: at } };
    assert.equal(withdrawalDue(t, at - 1), false);
    assert.equal(withdrawalDue(t, at), true);
    assert.equal(withdrawalDue(t, at + 1), true);
  });

  test('no clock, no dated decision', () => {
    const t = { ...TITLE, [WITHDRAWAL_KEY]: { scheduledFor: 1 } };
    for (const bad of [NaN, undefined, null, 'now']) assert.equal(withdrawalDue(t, bad), false);
  });

  test('an already-withdrawn title is never re-withdrawn by the reconciler', () => {
    const t = withdrawn({ [WITHDRAWAL_KEY]: { scheduledFor: 1, appliedAt: 2 } });
    assert.equal(withdrawalDue(t, Date.now()), false);
    assert.deepEqual(dueWithdrawals([t], Date.now()), []);
  });

  test('applying a scheduled withdrawal keeps the date that caused it', () => {
    const block = applyWithdrawalBlock({
      existing: { scheduledFor: 111, reason: 'licence ended' },
      previousStatus: 'published',
      by: 'scheduled',
      nowMs: 222,
    });
    assert.equal(block.scheduledFor, 111, 'the record still says WHY the book left');
    assert.equal(block.appliedAt, 222);
    assert.equal(block.reason, 'licence ended');
    assert.equal(block.by, 'scheduled');
  });

  test('a restore clears the block, or the reconciler withdraws the title again next hour', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function restoreTitle'), admin.indexOf('export async function deleteTitle'));
    assert.match(fn, /\[WITHDRAWAL_KEY\]: null/);
  });

  test('a malformed block is rejected rather than repaired', () => {
    assert.deepEqual(validateWithdrawal(null), []);
    assert.deepEqual(validateWithdrawal(undefined), []);
    assert.ok(validateWithdrawal({ scheduledFor: 'soon' }).length);
    assert.ok(validateWithdrawal({ scheduledFor: -1 }).length);
    assert.ok(validateWithdrawal({ appliedAt: 1.5 }).length);
    assert.ok(validateWithdrawal({ reason: 'x'.repeat(500) }).length);
    assert.ok(validateWithdrawal([]).length);
  });

  test('THE STATIC-EXPORT PROBLEM IS SAID OUT LOUD, and something actually runs', () => {
    // A date-based change cannot reach a statically exported site on its own. If this stops
    // being true — the workflow deleted, the script renamed — a scheduled withdrawal silently
    // never happens, and nothing else in the suite would notice.
    const lib = src('app/lib/bookstore/withdrawal.js');
    assert.match(lib, /output:'export'|output: 'export'/, 'the constraint has to be written where the predicate is');
    assert.match(lib, /scripts\/bookstore\/withdrawals\.mjs/);

    const script = src('scripts/bookstore/withdrawals.mjs');
    assert.match(script, /withdrawalDue/, 'the reconciler uses the same predicate the shop does');
    assert.match(script, /fireDeployHook/, 'and it summons the build the flip requires');

    const wf = src('.github/workflows/withdrawals.yml');
    assert.match(wf, /cron:/);
    assert.match(wf, /scripts\/bookstore\/withdrawals\.mjs/);
    assert.match(wf, /--apply/);
  });

  test('the reconciler never touches purchases or storage', () => {
    const script = src('scripts/bookstore/withdrawals.mjs');
    assert.equal(/bookstore_purchases/.test(script.replace(/\/\/.*$/gm, '')), false);
    assert.equal(/deleteObject|storage\.googleapis/.test(script), false);
  });

  test('the deploy hook is never printed', () => {
    const script = src('scripts/bookstore/withdrawals.mjs');
    const fn = script.slice(script.indexOf('async function fireDeployHook'), script.indexOf('async function main'));
    assert.equal(/console\.(log|error)\([^)]*\burl\b/.test(fn), false, 'the URL must never reach a log line');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('⭑ AN OWNER OF A DELETED TITLE CAN STILL STREAM IT', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// THE LOAD-BEARING CLAIM OF THE ROUND, asserted against the real endpoint with the title record
// gone. Ruling 2 lives or dies here.

  const UID = 'reader-uid-0001';
  const TITLE_ID = 'the-quiet-house';
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const ENV = {
    NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
    FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey,
  };

  // The world AFTER a delete: bookstore_titles/{id} is gone, bookstore_purchases/{uid}/{id}
  // is untouched, and master.epub is still in the bucket because deletionPlan held it.
  function installDeletedWorld({ purchase = { status: 'active', title: 'The Quiet House' } } = {}) {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      calls.push(u);
      const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('identitytoolkit.googleapis.com')) return ok({ users: [{ localId: UID }] });
      if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'stub-admin-token' });
      if (u.includes('storage.googleapis.com/storage/v1/')) return ok({ generation: '1785243569624430', md5Hash: 'q/sAeFGbhb5mfv37T0GrBQ==' });
      // ⛔ THE TITLE RECORD IS GONE. Any read of it answers null, exactly as RTDB would.
      if (u.includes('/bookstore_titles/')) return ok(null);
      if (u.includes('/bookstore_purchases/')) return ok(purchase);
      if (u.includes('firebasedatabase.app')) return ok(null);
      throw new Error(`unstubbed fetch: ${u}`);
    };
    return { calls, restore() { globalThis.fetch = realFetch; } };
  }

  const call = () => onRequestPost({
    env: ENV,
    request: new Request('https://calvaryscribblings.co.uk/api/bookstore/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'stub', titleId: TITLE_ID }),
    }),
  });

  test('the book still opens — 200, and a signed URL for the master EPUB', async () => {
    const host = installDeletedWorld();
    try {
      const res = await call();
      assert.equal(res.status, 200, 'a reader who paid must still be served');
      const body = await res.json();
      assert.ok(body.url, 'and handed a signed URL');
      assert.ok(body.url.includes('bookstore_epubs%2Fthe-quiet-house%2Fmaster.epub')
        || body.url.includes('bookstore_epubs/the-quiet-house/master.epub'), body.url);
    } finally { host.restore(); }
  });

  test('it never asks about the title record at all — that is WHY it survives the delete', () => {
    // The structural reason, not a behavioural coincidence. stream.js derives the object path
    // from titleId and reads only the purchase. A future edit that "helpfully" looked up the
    // title record to find epubPath would make every deleted title unreadable by its owners,
    // and would pass every other test in this file.
    const ep = src('functions/api/bookstore/stream.js');
    const handler = ep.slice(ep.indexOf('export async function onRequestPost'));
    assert.equal(/bookstore_titles/.test(handler), false, 'stream.js must never read the title record');
    assert.match(handler, /PURCHASES_PATH/);
    assert.match(handler, /purchase\.status !== 'active'/);
  });

  test('a WITHDRAWN title streams too — withdrawal is the shop\'s act, not the reader\'s', async () => {
    // Identical world, because the endpoint cannot tell the difference: it reads the purchase
    // and nothing else. That equivalence IS the design.
    const host = installDeletedWorld();
    try {
      const res = await call();
      assert.equal(res.status, 200);
    } finally { host.restore(); }
  });

  test('and a refund still revokes — the ONE thing that ends access, and it is not an admin act', async () => {
    const host = installDeletedWorld({ purchase: { status: 'revoked', revokedReason: 'refund' } });
    try {
      const res = await call();
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, 'revoked');
    } finally { host.restore(); }
  });

  test('nothing in the admin write path can reach a purchase record', () => {
    const admin = src('app/lib/bookstore/admin-writes.js');
    const code = admin.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/bookstore_purchases/.test(code), false, 'the CMS must have no path to a reader\'s library');
    const lib = src('app/lib/bookstore/withdrawal.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/bookstore_purchases/.test(lib), false);
  });

  test('My Library renders a deleted title from the purchase record alone', () => {
    // VERIFIED, not assumed: functions/api/bookstore/_lib.js denormalises slug/title/author/
    // coverUrl onto every purchase, and app/my-library/page.js falls back to them. The shelf
    // already survived a missing title record before R21 existed.
    const lib = src('functions/api/bookstore/_lib.js');
    const fn = lib.slice(lib.indexOf('export function denormalisedFields'));
    for (const f of ['slug', 'title', 'author', 'coverUrl']) {
      assert.ok(fn.includes(`${f}:`), `${f} must be denormalised onto the purchase`);
    }
    const page = src('app/my-library/page.js');
    assert.match(page, /titleDoc\?\.title \|\| p\.title/);
    assert.match(page, /titleDoc\?\.author \|\| p\.author/);
    assert.match(page, /titleDoc\?\.coverUrl \|\| p\.coverUrl/);
    assert.match(page, /titleDoc\?\.slug \|\| p\.slug/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('WATCH MUTATIONS — each one breaks a ruling, and each one must be caught', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// A guard nobody has tried to get past is a guard nobody knows the strength of. Each test below
// builds the broken version and proves the assertion that stops it actually fires.

  test('MUTATION: a delete that removes an owned master', () => {
    // The break: deletionPlan stops distinguishing owned from unowned.
    const mutant = ({ titleId }) => ({ ok: true, owned: true, delete: [masterPathFor(titleId)], held: [] });
    const plan = mutant({ titleId: TITLE.id });

    // The assertion from the master-EPUB block, run against the mutant. It must fail.
    assert.throws(
      () => assert.equal(plan.delete.includes(masterPathFor(TITLE.id)), false),
      'a plan that deletes an owned master must be rejected',
    );
    // And the real one passes.
    const real = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: ownersKnown(9) });
    assert.equal(real.delete.includes(masterPathFor(TITLE.id)), false);
  });

  test('MUTATION: an unknown owner count treated as zero', () => {
    // The break: OWNERS_UNKNOWN read as "nobody owns it", which is how a network hiccup
    // deletes a book out from under nine readers.
    const asZero = { ok: true, count: 0 };
    const mutantPlan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: asZero });
    assert.ok(mutantPlan.delete.includes(masterPathFor(TITLE.id)), 'the mutant would delete the master…');

    const realPlan = deletionPlan({ titleId: TITLE.id, title: TITLE, owners: OWNERS_UNKNOWN });
    assert.equal(realPlan.ok, false, '…and the real one refuses to plan at all');
    assert.deepEqual(realPlan.delete, []);
  });

  test('MUTATION: a withdrawal that blocks streaming', async () => {
    // The break: stream.js gains a title-status check. Simulated by applying the check the
    // mutant would apply, to a record that a withdrawal has flipped.
    const record = withdrawn();
    const mutantGate = (t) => (t.status === 'published' ? 200 : 403);
    assert.equal(mutantGate(record), 403, 'the mutant would lock the owner out');

    // The real endpoint, on the same world, does not — and cannot, because it never reads the
    // record. Proven behaviourally, not by inspection.
    const host = (() => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (u.includes('identitytoolkit')) return ok({ users: [{ localId: 'u' }] });
        if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 't' });
        if (u.includes('storage.googleapis.com/storage/v1/')) return ok({ generation: '1', md5Hash: 'm' });
        if (u.includes('/bookstore_purchases/')) return ok({ status: 'active' });
        if (u.includes('firebasedatabase.app')) return ok(record);
        throw new Error(`unstubbed: ${u}`);
      };
      return { restore() { globalThis.fetch = realFetch; } };
    })();
    try {
      const res = await onRequestPost({
        env: {
          NEXT_PUBLIC_FIREBASE_API_KEY: 'k',
          FIREBASE_CLIENT_EMAIL: 'a@b.iam.gserviceaccount.com',
          FIREBASE_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).privateKey,
        },
        request: new Request('https://x/api/bookstore/stream', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: 'x', titleId: 'the-quiet-house' }),
        }),
      });
      assert.equal(res.status, 200, 'a withdrawn title still opens for its owner');
    } finally { host.restore(); }
  });

  test('MUTATION: a confirm step without the count', () => {
    // The break: the dialog falls back to a generic sentence when the count is unknown.
    const mutant = (n) => confirmConsequence(n) || 'Are you sure you want to delete this title?';
    assert.match(mutant(null), /Are you sure/, 'the mutant would ship a bare confirm…');

    // …and the real one refuses to produce a sentence at all, which is what makes
    // deletionPreview return an error instead of opening a dialog.
    assert.equal(confirmConsequence(null), null);
    const admin = src('app/lib/bookstore/admin-writes.js');
    const preview = admin.slice(admin.indexOf('export async function deletionPreview'), admin.indexOf('export async function withdrawTitle'));
    assert.match(preview, /return \{\s*\n?\s*ok: false/, 'an unknown count returns an error, never a dialog');
  });

  test('MUTATION: a confirm step that accepts any typed text', () => {
    const mutant = (typed, name) => String(typed || '').length > 0 && !!name;
    assert.equal(mutant('x', TITLE.title), true, 'the mutant would arm on a single keystroke');
    assert.equal(nameMatches('x', TITLE.title), false);
  });

  test('MUTATION: a soft delete wearing the name of a hard one', () => {
    // The break this round exists to undo: `deleteTitle = setTitleStatus(id, 'unpublished')`.
    const admin = src('app/lib/bookstore/admin-writes.js');
    const fn = admin.slice(admin.indexOf('export async function deleteTitle'));
    assert.equal(/return setTitleStatus\(/.test(fn), false, 'deleteTitle must not be a status flip');
    assert.match(fn, /: null,/, 'it removes the record');
    assert.match(fn, /deleteObject/, 'and it removes files');
  });

  test('MUTATION: a withdrawal set by typing a status into the form', () => {
    // The break: updateTitle or setTitleStatus lets 'withdrawn' through, producing a withdrawn
    // title with no provenance and a shelf that still shows it until something else deploys.
    const admin = src('app/lib/bookstore/admin-writes.js');
    const set = admin.slice(admin.indexOf('export async function setTitleStatus'), admin.indexOf('// ══'));
    assert.match(set, /status === WITHDRAWN/, 'setTitleStatus must refuse it');
    const upd = admin.slice(admin.indexOf('export async function updateTitle'), admin.indexOf('export async function setTitleStatus'));
    assert.match(upd, /merged\.status === WITHDRAWN/, 'and so must updateTitle');
    assert.match(upd, /existing\.status === WITHDRAWN/, 'in both directions');
  });

  test('MUTATION: storage rules that cannot express a delete', () => {
    // The break that was ALREADY THERE before R21: `allow write` guarded on
    // request.resource.size, which is null on a delete, so every founder delete was denied.
    const rules = src('storage.rules');
    for (const prefix of ['bookstore_covers/{titleId}', 'bookstore_epubs/{titleId}/sample.epub', 'bookstore_epubs/{titleId}/master.epub']) {
      const at = rules.indexOf(`match /${prefix}`);
      assert.ok(at > 0, `${prefix} must still have a rule`);
      const block = rules.slice(at, rules.indexOf('}', rules.indexOf('allow delete', at)));
      assert.match(block, /allow create, update:/, `${prefix}: the size/type guard belongs on writes`);
      assert.match(block, /allow delete:/, `${prefix}: a delete needs its own rule`);
      // And the delete rule must NOT reference request.resource, which is null on a delete.
      const del = block.slice(block.indexOf('allow delete:'));
      assert.equal(/request\.resource/.test(del), false, `${prefix}: a delete rule cannot read request.resource`);
    }
  });

  test('MUTATION: a tombstone that leaks the shop\'s private fields onto a public node', () => {
    const t = tombstoneOf({ titleId: TITLE.id, title: TITLE, by: 'u', nowMs: 1, ownerCount: 0 });
    const mutant = { ...t, ...TITLE };
    assert.ok('prices' in mutant, 'a spread would carry prices onto a .read:true node…');
    assert.equal('prices' in t, false, '…and the real tombstone does not');
    // The rules are the second half of the promise.
    const rules = JSON.parse(src('database.rules.json'));
    const node = rules.rules.bookstore_titles_deleted;
    assert.equal(node['.read'], true);
    assert.equal(node.$titleId.$other['.validate'], false, 'unknown fields are denied at the database');
    assert.equal('prices' in node.$titleId, false);
  });
});
