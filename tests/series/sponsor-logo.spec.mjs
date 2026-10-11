// THE SPONSOR LOGO, ON THE W38 EDITOR. The claims the R12.4 suite made, held on the new screen:
//   · with no sponsor name, the logo control says so and cannot open a file chooser;
//   · typing a name enables it, with no save in between;
//   · a real upload completes, and the name and the logo land in ONE write;
//   · the writer refuses a logo with no name, not only the UI.
//
//   npm run test:sponsor      (Firebase emulators + `next dev`; hermetic — see ./harness.mjs)
//
// The fixture instalment is a DRAFT, so its sponsor name saves as it is typed (ruling 140, "drafts
// save as you type"). The one-write claim is therefore about the upload: once the name has
// settled, choosing the logo produces exactly one write, and that write carries both.
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminApp, closeApp, seedFixture, adminToken, detailRef, SERIES_ID, INSTALMENT_ID } from './harness.mjs';

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

async function openEditor(page) {
  const token = await adminToken(app);
  await page.goto(`/admin/series?s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 30000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  await expect(page.getByText('Not authorised')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Harness Instalment' })).toBeVisible({ timeout: 60000 });
}

const sponsorCard = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: /^Sponsor/ }) });
const nameField = (page) => page.getByLabel('Name', { exact: true });
const logoButton = (page) => sponsorCard(page).getByRole('button', { name: /Choose logo|Replace logo/ });
const logoInput = (page) => sponsorCard(page).locator('input[type=file]');

test('with no sponsor name, the logo control says so and opens nothing', async ({ page }) => {
  await openEditor(page);
  await expect(sponsorCard(page).getByText('Type the sponsor’s name first. A logo needs a name.')).toBeVisible();
  await expect(logoButton(page)).toBeDisabled();
  await expect(logoInput(page)).toBeDisabled();
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await logoButton(page).click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  expect(chooser).toBe(false);
});

test('typing a name enables it — no save in between', async ({ page }) => {
  await openEditor(page);
  await nameField(page).fill(SPONSOR);
  await expect(logoButton(page)).toBeEnabled();
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  await logoButton(page).click();
  expect(await chooserPromise).toBeTruthy();
  await nameField(page).fill('   ');
  await expect(logoButton(page)).toBeDisabled();
});

test('a real upload completes, and the name and the logo land in ONE write', async ({ page }) => {
  await openEditor(page);
  const ref = detailRef(app);
  await nameField(page).fill(SPONSOR);
  // The draft saves the name as it is typed; wait for that to settle first.
  await expect.poll(async () => (await ref.get()).val().sponsorName, { timeout: 20000 }).toBe(SPONSOR);
  await page.waitForTimeout(800);

  const seen = [];
  const listener = ref.on('value', (snap) => seen.push(snap.val()));
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  const baseline = seen[0];

  await logoInput(page).setInputFiles(LOGO);
  await expect(sponsorCard(page).getByRole('button', { name: 'Replace logo' })).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  ref.off('value', listener);

  const writes = seen.slice(1);
  expect(writes, `expected exactly one write, saw ${writes.length}`).toHaveLength(1);
  const [written] = writes;
  expect(written.sponsorName).toBe(SPONSOR);
  expect(decodeURIComponent(written.sponsorLogoUrl)).toContain(`series_covers/${INSTALMENT_ID}/sponsor/`);
  expect(written.title).toBe('Harness Instalment');
  expect(written.updatedAt).toBeGreaterThan(baseline.updatedAt);
});

test('the logo is refused without a name at the writer too, not just in the UI', async () => {
  const { validateInstalmentDetail } = await import('../../app/lib/series/schema.js');
  const record = await detailRef(app).get().then((s) => s.val());
  const r = validateInstalmentDetail({ ...record, sponsorLogoUrl: 'https://example.test/logo.png', sponsorName: null });
  expect(r.valid).toBe(false);
  expect(r.errors.join(' ')).toContain('sponsorLogoUrl requires sponsorName');
});
