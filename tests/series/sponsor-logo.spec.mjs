// THE SPONSOR LOGO UPLOAD, DRIVEN AS AN EDITOR DRIVES IT.
//
// This suite exists because of a bug that every unit test on the platform was blind to. The
// control was correctly wired — a real handler, the right storage key, an atomic write — and
// it was DEAD, because it shipped `disabled={!detail.sponsorName}`: gated on the SAVED sponsor
// name rather than the one the editor was looking at themselves type. Every live instalment
// had an empty sponsorName, so the button was disabled on all of them, and a <label> wrapping
// a disabled input is inert — no file picker opens, not even on a forced click. It was
// reported from the outside as "the upload button isn't working", which is precisely what it
// was.
//
// Nothing short of driving the real control could have caught that. The handler, the key
// derivation and the validator were all correct in isolation and are all covered by
// tests/ci/series-access.test.mjs, which stayed green throughout.
//
// ── WHY THE EMULATORS, AND NOT PRODUCTION OR A STUB ─────────────────────────────────────
//
// The claim under test is that a real upload completes and lands both fields in ONE write.
// Against production this suite would put a fabricated sponsor credit on a released
// instalment's public page every time CI ran. Against a stubbed transport it would prove only
// that a stub resolves. So the app's own client is pointed at the Firebase emulators — see the
// fenced switch at the bottom of app/lib/firebase.js — and the write, the upload, the rules
// and the validator are all the real ones.

import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  adminApp, closeApp, seedFixture, adminToken, detailRef, INSTALMENT_ID,
} from './harness.mjs';

// A real 1x1 PNG. Real bytes, real contentType — storage.rules requires `image/*` and a size
// under 5 MB, and both are being enforced by the emulator here.
const LOGO = join(tmpdir(), 'harness-sponsor-logo.png');
writeFileSync(LOGO, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

const SPONSOR = 'Ada Type Foundry';

let app;
test.beforeAll(async () => { app = adminApp(); });
test.afterAll(async () => { if (app) await closeApp(app); });
test.beforeEach(async () => { await seedFixture(app); });

/** Sign the browser in as a founder and open the Series admin, with the editor expanded. */
async function openEditor(page) {
  const token = await adminToken(app);
  await page.goto('/admin/series');
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 30000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);

  // The screen refuses non-admins outright, so seeing the fixture at all is the proof the
  // session took. Asserted rather than assumed — a suite that silently ran signed-out would
  // find no controls and report it as a UI regression.
  await expect(page.getByText('Not authorised')).toHaveCount(0);
  await expect(page.getByText('Harness Series')).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  // The sponsor-name field, by its placeholder — the panel's headings ("Sponsor name",
  // "Sponsor name (optional)") appear on both the editor and the create form, and a text
  // match on them is ambiguous by construction.
  await expect(nameField(page)).toBeVisible();
}

const sponsorLabel = (page) => page.locator('label').filter({ hasText: /Upload sponsor logo|Add a sponsor name first/ });
const sponsorInput = (page) => sponsorLabel(page).locator('input[type=file]');
const nameField = (page) => page.locator('input[placeholder="Leave empty for no sponsor credit."]').first();

test('with no sponsor name, the button says so instead of sitting there dead', async ({ page }) => {
  await openEditor(page);

  // THE REGRESSION GUARD ON THE COPY. A dimmed button with no explanation is what shipped,
  // and what got reported. The disabled state has to say what to do about itself.
  await expect(sponsorLabel(page)).toHaveText(/Add a sponsor name first/);
  await expect(sponsorInput(page)).toBeDisabled();

  // And it really is inert — this is the observable symptom, not an inference from the
  // attribute. A forced click bypasses every actionability check and still opens nothing.
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await sponsorLabel(page).click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  expect(chooser).toBe(false);
});

test('THE FIX: typing a name enables it — no save in between', async ({ page }) => {
  await openEditor(page);
  await expect(sponsorInput(page)).toBeDisabled();

  // The exact sequence that failed before: type, then reach for the button. Nothing is saved
  // between the two, and nothing should have to be.
  await nameField(page).fill(SPONSOR);

  await expect(sponsorLabel(page)).toHaveText(/Upload sponsor logo/);
  await expect(sponsorInput(page)).toBeEnabled();

  // The picker opens now, which is the thing an editor was reporting as broken.
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  await sponsorLabel(page).click();
  expect(await chooserPromise).toBeTruthy();

  // Whitespace is not a name. The trim is what the write uses, so it is what the gate uses.
  await nameField(page).fill('   ');
  await expect(sponsorInput(page)).toBeDisabled();
  await expect(sponsorLabel(page)).toHaveText(/Add a sponsor name first/);
});

test('a real upload completes, and BOTH fields land in ONE write', async ({ page }) => {
  await openEditor(page);

  // ── THE WRITE LEDGER ──────────────────────────────────────────────────────────────────
  // Every value the detail record takes, recorded as it takes it. `on('value')` fires once
  // immediately with the current state, so that first entry is the baseline and everything
  // after it is a write that actually happened. This is what makes "in ONE write" an
  // assertion rather than a description: two writes would leave an intermediate state in
  // this array with one field set and the other still null — which is exactly the state the
  // validator refuses and the old code would have produced.
  const seen = [];
  const ref = detailRef(app);
  const listener = ref.on('value', (snap) => seen.push(snap.val()));

  // ABSENT, not empty-string. Note the `?? null`: RTDB DROPS null values on write, so a
  // record seeded with `sponsorName: null` comes back with no such key at all. The same
  // behaviour is why tests/rules/database.test.mjs warns that "Firebase strips the client's
  // `imageUrl: null`, so zero live messages carry the key" — absent and null are one state
  // here, and the validator treats them as one (`v !== null && v !== undefined`).
  const baseline = await ref.get().then((s) => s.val());
  expect(baseline.sponsorName ?? null).toBe(null);
  expect(baseline.sponsorLogoUrl ?? null).toBe(null);

  await nameField(page).fill(SPONSOR);
  await sponsorInput(page).setInputFiles(LOGO);

  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 30000 });

  // Give the listener a beat to deliver anything still in flight, so "exactly one" cannot
  // pass by arriving late.
  await page.waitForTimeout(1500);
  ref.off('value', listener);

  const writes = seen.slice(1);
  expect(writes, `expected exactly one write, saw ${writes.length}`).toHaveLength(1);

  const [written] = writes;
  expect(written.sponsorName).toBe(SPONSOR);
  expect(written.sponsorLogoUrl).toEqual(expect.stringContaining('http'));
  // The URL points at the SPONSOR key, not the cover's — the failure mode where a logo
  // quietly overwrites the instalment's artwork.
  expect(decodeURIComponent(written.sponsorLogoUrl)).toContain(`series_covers/${INSTALMENT_ID}/sponsor/`);
  // Untouched by this write. It writes two fields, not the whole form.
  expect(written.coverUrl ?? null).toBe(null);
  expect(written.title).toBe('Harness Instalment');

  // One updateInstalment call stamps one updatedAt, and both fields carry it. Two calls could
  // not have produced this record without an intermediate state in the ledger above.
  expect(written.updatedAt).toBeGreaterThan(baseline.updatedAt);
});

test('the logo is refused without a name at the writer too, not just in the UI', async ({ page }) => {
  // The UI gate is a courtesy; validateInstalmentDetail is the rule. If the button's condition
  // were ever loosened, this is what would still stand between a logo and a blank credit line.
  await openEditor(page);
  const { validateInstalmentDetail } = await import('../../app/lib/series/schema.js');
  const record = await detailRef(app).get().then((s) => s.val());
  const bad = { ...record, sponsorLogoUrl: 'https://example.test/logo.png', sponsorName: null };
  const r = validateInstalmentDetail(bad);
  expect(r.valid).toBe(false);
  expect(r.errors.join(' ')).toContain('sponsorLogoUrl requires sponsorName');
});
