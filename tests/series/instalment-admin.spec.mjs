// R31 — THE TIER IS EDITABLE, AND AN INSTALMENT IS DELETABLE. DRIVEN AS AN EDITOR DRIVES THEM.
//
// Sibling of sponsor-logo.spec.mjs, and here for the same reason that file exists: the two
// controls this round adds are exactly the shape of the bug that suite was written for. The
// sponsor uploader was correctly wired — real handler, right key, atomic write — and DEAD,
// because it gated on the saved value rather than the one the editor could see. Every unit
// test on the platform stayed green. Nothing short of driving the real control caught it.
//
// So both new controls are driven through the browser, against the real client, the real
// rules and the real emulated bucket:
//
//   · The tier select must actually change what a reader is granted — asserted through
//     grantForInstalment(), the same function functions/api/series/stream.js decides with,
//     rather than by reading the row back and trusting that the row means something.
//   · The delete must empty every node AND the bucket, and it must burn the ordinal.
//
// ── WHY THE ARTEFACT ASSERTIONS ARE THE POINT ───────────────────────────────────────────
//
// storage.rules shipped `series_epubs/**` and `series_covers/**` with a COMBINED `allow write`
// guarded on request.resource.size and request.resource.contentType. On a delete
// request.resource is null, so every delete evaluated those against null and was DENIED — for
// the founders too. R21 hit this on the bookstore and split the rules; the Series prefixes were
// added afterwards and did not inherit the split. A delete written against those rules would
// have removed the records and silently orphaned every file, and the ONLY test that could see
// it is one that asks the bucket afterwards. tests/ci/series-deletion.test.mjs asserts the rule
// text; this asserts the behaviour.
//
// Emulators, never production — see the harness header. A delete suite pointed at production
// would remove a live instalment and its master EPUB on every CI run.

import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  adminApp, closeApp, seedFixture, seedReleased, adminToken,
  rowRef, detailRef, tombstoneRef, seriesRef, putObject, objectExists, listPrefix,
  SERIES_ID, INSTALMENT_ID, RELEASED_ID,
} from './harness.mjs';
import { grantForInstalment, policyGrantForInstalment } from '../../app/lib/series/access.js';

// A real 1x1 PNG and a minimal EPUB-shaped blob. Real bytes and real content types, because
// storage.rules enforces both on the way in.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const EPUB = Buffer.from('PKfixture-epub-bytes');

let app;
test.beforeAll(async () => { app = adminApp('r31-harness'); });
test.afterAll(async () => { if (app) await closeApp(app); });
test.beforeEach(async () => {
  await seedFixture(app);
  await seedReleased(app);
});

async function openAdmin(page) {
  const token = await adminToken(app);
  await page.goto('/admin/series');
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 30000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  await expect(page.getByText('Not authorised')).toHaveCount(0);
  await expect(page.getByText('Harness Series')).toBeVisible({ timeout: 30000 });
}

/**
 * One instalment's row, by the id the row carries as data-instalment.
 *
 * NOT by the id text the note line prints. That text lives on a nested <div>, so an ancestor
 * lookup from it resolves to whichever div comes last — the note itself, which holds no
 * buttons. With two instalments on screen every control in this file has to name its row
 * exactly, so the row names itself.
 */
const rowFor = (page, id) => page.locator(`[data-instalment="${id}"]`);

/**
 * Open an instalment's Edit panel. IDEMPOTENT, and that is load-bearing.
 *
 * The screen's button TOGGLES — it reads 'Edit' when closed and 'Close' when open. A helper
 * that clicked unconditionally would shut a panel that a previous step had already opened, and
 * the test would then wait fifteen seconds for a control it had just dismissed. Two tests here
 * open the same row twice on purpose (save, then reopen to change the value back), so the
 * helper has to ask rather than assume.
 */
async function openEditor(page, id) {
  const row = rowFor(page, id);
  const tier = row.getByText('Who may read this instalment');
  if (await tier.count() === 0) {
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
  }
  await expect(tier).toBeVisible();
  return row;
}

/** The tier select inside one row's editor. Scoped — the create form has one too. */
const tierSelect = (row) => row.locator('select').first();

/**
 * Wait for a write to report, and ASSERT IT REPORTED IN BOTH PLACES.
 *
 * Every message from a row lands twice by design — once on the page-level line at the top and
 * once at the row that was clicked. That is R31's fix for the refusal nobody could see, so the
 * duplication is the claim rather than an inconvenience, and a `.first()` here would quietly
 * stop testing it. Two elements, one of them inside this row.
 */
async function reportedBoth(page, row, re) {
  await expect(row.getByText(re)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(re)).toHaveCount(2);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// A. THE TIER IS EDITABLE, AND THE EDIT REACHES A READER
// ═══════════════════════════════════════════════════════════════════════════════════════

test('the tier control is present on an existing instalment and seeded from the record', async ({ page }) => {
  await openAdmin(page);
  const row = await openEditor(page, RELEASED_ID);

  const select = tierSelect(row);
  // Seeded from the row, not defaulted. seedReleased writes freeForGold:false.
  await expect(select).toHaveValue('no');

  // Inert until the selection differs — the create form's tri-state discipline, kept in the
  // one form it can be kept in here. See the component header.
  await expect(page.getByRole('button', { name: 'Tier unchanged' })).toBeDisabled();
});

test('⚠ CHANGING THE TIER TAKES EFFECT FOR A READER — asserted through the grant, not the row', async ({ page }) => {
  const before = (await rowRef(app, RELEASED_ID).get()).val();
  assert.equal(before.freeForGold, false);

  // The claim under test is about a READER, so it is asserted with the function that decides
  // for readers. A Gold member is refused this instalment before the edit...
  const goldBefore = policyGrantForInstalment(before, { subscriptionTier: 'gold', signedIn: true });
  assert.equal(goldBefore.access, 'locked');
  assert.equal(goldBefore.reason, 'needs_platinum');

  await openAdmin(page);
  const row = await openEditor(page, RELEASED_ID);
  await tierSelect(row).selectOption('yes');
  await expect(page.getByRole('button', { name: 'Save tier' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save tier' }).click();
  await reportedBoth(page, row, /is now free for Gold/);

  // ...and granted it after. Read back from the database the browser actually wrote to.
  const after = (await rowRef(app, RELEASED_ID).get()).val();
  assert.equal(after.freeForGold, true, 'the tier did not reach the record');
  const goldAfter = policyGrantForInstalment(after, { subscriptionTier: 'gold', signedIn: true });
  assert.equal(goldAfter.access, 'granted');
  assert.equal(goldAfter.reason, 'gold_taste');

  // MUTATION TWIN. If the write had been a no-op, `before` and `after` would agree — so the
  // same assertion against the untouched record must FAIL. Without this the test would pass
  // against a screen whose button did nothing, provided the fixture had started at true.
  assert.notEqual(before.freeForGold, after.freeForGold, 'MUTATION TWIN: the record did not change, so the grant assertions prove nothing');
});

test('⚠ THE £1 DAY PASS STILL DOES NOT QUALIFY, WHICHEVER WAY THE NEW CONTROL IS SET', async ({ page }) => {
  await openAdmin(page);
  const row = await openEditor(page, RELEASED_ID);
  await tierSelect(row).selectOption('yes');
  await page.getByRole('button', { name: 'Save tier' }).click();
  await reportedBoth(page, row, /is now free for Gold/);

  const record = (await rowRef(app, RELEASED_ID).get()).val();
  assert.equal(record.freeForGold, true, 'the fixture never became a Gold instalment, so nothing below is being tested');

  // A free subscriber holding a live day pass: effectiveTier() folds PASS_TIER='gold' into the
  // same string a real Gold membership produces. The gate compares the SUBSCRIPTION, so this is
  // refused — and refused with the honest reason rather than the generic one.
  const passHolder = policyGrantForInstalment(record, {
    subscriptionTier: 'free', effectiveTier: 'gold', signedIn: true,
  });
  assert.equal(passHolder.access, 'locked', 'a day pass opened a freeForGold instalment — the exclusion is gone');
  assert.equal(passHolder.reason, 'pass_excluded');

  // The real Gold member IS granted the same row, which is what stops the assertion above
  // passing for the wrong reason (a gate that refused everybody).
  assert.equal(policyGrantForInstalment(record, { subscriptionTier: 'gold', signedIn: true }).access, 'granted');

  // And the control says so where an editor reads it — inside THIS row's panel, not merely
  // somewhere on the page. The create form carries the same sentence, which is exactly why the
  // assertion is scoped: a page-wide match would pass on the create form's copy alone and
  // prove nothing about the control this round added.
  await expect(row.locator('strong').filter({ hasText: /Day and week passes never qualify/ })).toBeVisible();
});

test('the panel warns before it narrows a live instalment, and not before a draft', async ({ page }) => {
  await openAdmin(page);

  // The RELEASED one: going Platinum-only takes it from Gold members, and the panel says so.
  const row = await openEditor(page, RELEASED_ID);
  await tierSelect(row).selectOption('yes');
  await page.getByRole('button', { name: 'Save tier' }).click();
  await reportedBoth(page, row, /is now free for Gold/);
  // The panel remounts on save (key={detail.updatedAt}) with the stored value re-seeded, so
  // the select is back at 'yes' and going to 'no' is a genuine narrowing.
  const reopened = await openEditor(page, RELEASED_ID);
  await tierSelect(reopened).selectOption('no');
  await expect(page.getByText(/takes it away from/)).toBeVisible();

  // The DRAFT, unreleased one: nobody can read it at any tier, so there is nothing to take
  // away and no warning. A warning here would be noise, and noise is how the real one gets
  // dismissed.
  await page.reload();
  await openAdmin(page);
  const draft = await openEditor(page, INSTALMENT_ID);
  await tierSelect(draft).selectOption('yes');
  await expect(page.getByText(/takes it away from/)).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// B. DELETION
// ═══════════════════════════════════════════════════════════════════════════════════════

test('⚠ A DELETED INSTALMENT IS GONE FROM EVERY NODE, AND ITS ARTEFACTS WITH IT', async ({ page }) => {
  const epubPath = `series_epubs/${RELEASED_ID}/master.epub`;
  const coverPath = `series_covers/${RELEASED_ID}/cover/1700000000000-cover.png`;
  const sponsorPath = `series_covers/${RELEASED_ID}/sponsor/1700000000001-logo.png`;
  await putObject(app, epubPath, EPUB, 'application/epub+zip');
  await putObject(app, coverPath, PNG, 'image/png');
  await putObject(app, sponsorPath, PNG, 'image/png');

  // The fixture is real before the delete — otherwise "it is gone afterwards" is a claim about
  // nothing, which is the exact species of vacuous test this round is counting.
  assert.ok(await objectExists(app, epubPath), 'the EPUB fixture did not land');
  assert.ok(await objectExists(app, coverPath), 'the cover fixture did not land');
  assert.ok(await objectExists(app, sponsorPath), 'the sponsor fixture did not land');
  assert.ok((await rowRef(app, RELEASED_ID).get()).exists());
  assert.ok((await detailRef(app).parent.child(RELEASED_ID).get()).exists());

  await openAdmin(page);
  const row = rowFor(page, RELEASED_ID);
  await row.getByRole('button', { name: 'Delete' }).click();

  // The confirmation is TYPED, and the button is inert until it matches. A confirm() would be
  // one keystroke from a habit; this is the one control on the screen that destroys bytes with
  // nothing to restore them from.
  const deleteBtn = page.getByRole('button', { name: `Delete instalment 2` });
  await expect(deleteBtn).toBeDisabled();
  await page.getByPlaceholder('2').fill('2');
  await expect(deleteBtn).toBeEnabled();
  await deleteBtn.click();
  await expect(page.getByText(/Instalment 2 deleted/)).toBeVisible({ timeout: 30000 });

  // Every node.
  assert.equal((await rowRef(app, RELEASED_ID).get()).exists(), false, 'the public row survived');
  assert.equal((await detailRef(app).parent.child(RELEASED_ID).get()).exists(), false, 'the detail record survived');

  // Every artefact. ⚠ THIS IS THE ASSERTION THE RULES SPLIT EXISTS FOR — with a combined
  // `allow write` these three stay true and nothing else in the suite notices.
  assert.equal(await objectExists(app, epubPath), false, 'the master EPUB was orphaned in Storage');
  assert.deepEqual(await listPrefix(app, `series_covers/${RELEASED_ID}/`), [],
    'cover or sponsor artefacts were orphaned in Storage');

  // The OTHER instalment is untouched — a delete that took a sibling with it would satisfy
  // every assertion above.
  assert.ok((await rowRef(app, INSTALMENT_ID).get()).exists(), 'the delete removed a sibling');
});

test('⚠ THE ORDINAL GAP SURVIVES DELETION — the number is retired, not reissued', async ({ page }) => {
  await openAdmin(page);
  const row = rowFor(page, RELEASED_ID);
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByPlaceholder('2').fill('2');
  await page.getByRole('button', { name: 'Delete instalment 2' }).click();
  await expect(page.getByText(/Instalment 2 deleted/)).toBeVisible({ timeout: 30000 });

  // The tombstone: the id is burned and the ordinal it held is recorded.
  const stone = (await tombstoneRef(app, RELEASED_ID).get()).val();
  assert.ok(stone, 'no tombstone — the id can be reissued and a reader position re-pointed');
  assert.equal(stone.ordinal, 2);
  assert.equal(stone.seriesId, SERIES_ID);
  assert.ok(Number.isFinite(stone.deletedAt) && stone.deletedAt > 0);

  // Instalment 1 was NOT renumbered into the hole.
  assert.equal((await rowRef(app, INSTALMENT_ID).get()).val().ordinal, 1, 'a surviving instalment was renumbered');

  // The screen proposes 3, not 2 — the deleted instalment was the highest, which is the case
  // max(live)+1 gets wrong.
  await expect(page.getByText(/Add instalment — harness-series-i3/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/ordinal 2 deleted — permanently retired/i)).toBeVisible();

  // And typing 2 back in is refused BY THE WRITER, not merely discouraged by the form.
  const ordinalInput = page.locator('input[type="number"]').last();
  await ordinalInput.fill('2');
  await expect(page.getByText(/Ordinal 2 was deleted and is retired/)).toBeVisible();
  // ⚠ NOTHING ELSE IS FILLED IN, AND THAT IS THE ASSERTION. A retired ordinal is not a fault a
  // better-filled form can fix, so createInstalment() answers it BEFORE the content validators
  // — an editor who typed 2 learns the number is impossible now, not after nine more fields.
  // If that order is ever reversed this fails on 'title is required' instead, which is exactly
  // the experience the ordering exists to prevent.
  // .last(): the New Series card carries the same label. The Add-instalment form is the one
  // inside the series card, at the bottom.
  await page.getByRole('button', { name: 'Create (as draft)' }).last().click();
  // The WRITER's exact phrase, not the loose one. The form's own standing note reads "Those
  // numbers are gone for good and cannot be reused" whenever a retired ordinal exists, so a
  // match on /cannot be reused/ alone would be satisfied by the screen's advice rather than by
  // the refusal — and the count assertion below could then never hold.
  await expect(page.getByText(/its number cannot be reused/)).toBeVisible({ timeout: 15000 });
  assert.equal((await rowRef(app, RELEASED_ID).get()).exists(), false, 'the burned id was reissued');

  // MUTATION TWIN — the SAME empty form at a FREE ordinal must be refused for a different
  // reason. Without this, "cannot be reused" could be passing on a create path that refuses
  // everything, and the burn would be proving nothing.
  await ordinalInput.fill('3');
  await page.getByRole('button', { name: 'Create (as draft)' }).last().click();
  // The row validator is the first thing past the identity checks, so an empty form at a FREE
  // ordinal is refused on releaseAtMs — a different refusal, which is the whole point. What
  // matters is that it is NOT the burn.
  await expect(page.getByText(/releaseAtMs must be a positive integer/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/its number cannot be reused/)).toHaveCount(0);
});

test('the count is recomputed by deriving it — there is no stored instalmentCount to drift', async ({ page }) => {
  const seriesBefore = (await seriesRef(app).get()).val();
  assert.equal(Object.prototype.hasOwnProperty.call(seriesBefore, 'instalmentCount'), false,
    'a stored counter appeared on the parent — see the schema header on why it was rejected');

  await openAdmin(page);
  // Two instalments, one of them released.
  await expect(page.getByText(/1 of 2 instalments released/)).toBeVisible({ timeout: 15000 });

  const row = rowFor(page, RELEASED_ID);
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByPlaceholder('2').fill('2');
  await page.getByRole('button', { name: 'Delete instalment 2' }).click();
  await expect(page.getByText(/Instalment 2 deleted/)).toBeVisible({ timeout: 30000 });

  // Recomputed, because it was never stored: removing the row IS the recount. A decremented
  // counter would now read 1 released of 1 whether or not the row had actually gone.
  await expect(page.getByText(/0 of 1 instalments released/)).toBeVisible({ timeout: 15000 });
  const seriesAfter = (await seriesRef(app).get()).val();
  assert.equal(Object.prototype.hasOwnProperty.call(seriesAfter, 'instalmentCount'), false);
  assert.ok(seriesAfter.updatedAt > seriesBefore.updatedAt,
    "the parent's updatedAt was not bumped — a delete leaves the series record looking untouched");
});

test('a reader who could open the instalment cannot after it is deleted', async ({ page }) => {
  const live = (await rowRef(app, RELEASED_ID).get()).val();
  // Before: granted. With SERIES_TIER_GATE_ENABLED false this is 'tier_gate_off' for everyone,
  // which is the state the site is actually in — asserted through the same function the
  // endpoint calls rather than a re-derivation of it.
  assert.equal(grantForInstalment(live, { subscriptionTier: 'free', signedIn: false }).access, 'granted');

  await openAdmin(page);
  const row = rowFor(page, RELEASED_ID);
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByPlaceholder('2').fill('2');
  await page.getByRole('button', { name: 'Delete instalment 2' }).click();
  await expect(page.getByText(/Instalment 2 deleted/)).toBeVisible({ timeout: 30000 });

  // After: there is no row, and a missing row is not released, so nobody is granted anything —
  // including a Platinum member. The release gate answers first and answers for everyone.
  const gone = (await rowRef(app, RELEASED_ID).get()).val();
  assert.equal(gone, null);
  const grant = grantForInstalment(gone, { subscriptionTier: 'platinum', signedIn: true });
  assert.equal(grant.access, 'locked');
  assert.equal(grant.code, 'not_released');
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// C. THE REFUSAL THAT WAS INVISIBLE
// ═══════════════════════════════════════════════════════════════════════════════════════

test('⚠ A REFUSED STATUS CHANGE REPORTS AT THE ROW, NOT ONLY AT THE TOP OF THE PAGE', async ({ page }) => {
  // This is beta-princess-i3's actual story. Publishing needs an epubPath; the draft fixture
  // has none, so the write is refused. It reported only at the page-level line, far above the
  // button, and the editor concluded the instalment had published. The database said draft.
  await openAdmin(page);
  const row = rowFor(page, INSTALMENT_ID);
  await row.getByRole('button', { name: 'published', exact: true }).click();

  // ⚠ THE WHOLE POINT: TWICE. Once at the top, once at the row the editor's hand was on. Two
  // elements is the assertion — one would mean the row-level report is gone and the refusal is
  // invisible again to anyone scrolled past the top of the page.
  await expect(page.getByText(/Could not set published/)).toHaveCount(2, { timeout: 15000 });
  await expect(row.getByText(/Could not set published/)).toBeVisible();
  await expect(row.getByText(/epubPath is required/)).toBeVisible();

  // And the refusal was real: the record is still a draft.
  assert.equal((await rowRef(app, INSTALMENT_ID).get()).val().status, 'draft');

  // MUTATION TWIN — the same click on an instalment that CAN publish must succeed and must not
  // print the error, or the assertions above would pass against a screen that refused
  // everything.
  const ok = rowFor(page, RELEASED_ID);
  await ok.getByRole('button', { name: 'unpublished', exact: true }).click();
  await reportedBoth(page, ok, /Instalment 2 is now unpublished/);
  assert.equal((await rowRef(app, RELEASED_ID).get()).val().status, 'unpublished');
});
