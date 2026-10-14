// W46 §7 — READERS' NOTES IN THE SERIES ADMIN, driven through the instalment screen.
//
//   npm run test:series-notes-admin    (Firebase emulators + `next dev`; hermetic)
//
// Emulators only, never production. /api/series/notes is stubbed with page.route: the stub plays
// the endpoint's part through the admin SDK (draft-questions writes the draft node, publish-
// questions writes series_questions + series_questions_public, review clears the item), and it
// records what the draft node held at the moment each call arrived — which is how the flush is
// proved: the endpoint must see the last keystrokes already saved.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp, seedFixture, adminToken, SERIES_ID, INSTALMENT_ID } from '../../series/harness.mjs';
import { NOTES_COPY, publishableQuestions } from '../../../app/lib/series/notes.js';

const INST = INSTALMENT_ID;
let app;
test.beforeAll(async () => { app = adminApp('w46-admin-notes'); });
test.afterAll(async () => { if (app) await closeApp(app); });
test.beforeEach(async () => {
  await seedFixture(app);
  const updates = {};
  for (const p of ['series_question_drafts', 'series_questions', 'series_questions_public', 'series_notes', 'series_notes_held', 'series_note_reports']) updates[p] = null;
  await db().ref().update(updates);
});

const db = () => getDatabase(app);
const draftNode = async () => (await db().ref(`series_question_drafts/${INST}`).get()).val();

async function open(page) {
  const token = await adminToken(app);
  await page.goto(`/admin/series?s=${SERIES_ID}&i=${INST}`);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 60000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  await expect(page.getByText('Not authorised')).toHaveCount(0);
  await expect(section(page)).toBeVisible({ timeout: 60000 });
  await expect(sit(page)).toBeEnabled();
}
const section = (page) => page.locator('#sa-notes');
const sit = (page) => page.getByLabel(NOTES_COPY.adminSit);
const sideQ = (page) => section(page).getByLabel('The question');
const opt = (page, L) => section(page).getByLabel(`Side ${L}`, { exact: true });
const line = (page) => section(page).getByLabel(NOTES_COPY.adminLine, { exact: true });
const check = (page) => page.locator('aside.sa-panel [data-testid="notes-check"]');
const publishBtn = (page) => section(page).getByRole('button', { name: NOTES_COPY.publishQuestions });
const draftBtn = (page) => section(page).getByRole('button', { name: NOTES_COPY.draftFromText });

/** The endpoint, stubbed. */
async function stubNotes(page, { draft = null } = {}) {
  const calls = [];
  await page.route('**/api/series/notes', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const auth = route.request().headers().authorization || '';
    const seen = await draftNode();
    calls.push({ body, seen, bearer: auth.startsWith('Bearer ') });
    let out = { ok: true };
    if (body.action === 'draft-questions') {
      await db().ref(`series_question_drafts/${body.inst}`).update({ ...draft, updatedAt: Date.now(), draftedAt: Date.now(), model: 'stub-model' });
      out = { ok: true, draft };
    } else if (body.action === 'publish-questions') {
      const p = publishableQuestions(seen);
      if (p.error) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'not_ready', error: p.error }) }); return; }
      await db().ref().update({ [`series_questions/${body.inst}`]: p.questions, [`series_questions_public/${body.inst}`]: p.public });
      out = { ok: true, questions: p.questions };
    } else if (body.action === 'review') {
      await db().ref().update({ [`series_notes_held/${body.inst}/${body.noteId}`]: null, [`series_note_reports/${body.inst}/${body.noteId}`]: null });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  return calls;
}

async function fillAll(page) {
  await sit(page).fill('What did the quiet in the house feel like?');
  await sideQ(page).fill('Who was right to leave?');
  await opt(page, 'A').fill('Ama');
  await opt(page, 'B').fill('Kofi');
  await line(page).fill('Which line would you keep?');
}

// ═════════════════════════════════════════════════════════════════════════════════════════
test('each slot saves as a draft after the debounce, the endpoint’s fields survive, and the checklist counts', async ({ page }) => {
  // A draft the endpoint made earlier: its own fields must survive the editor's saves.
  await db().ref(`series_question_drafts/${INST}`).set({ sit: '', side: { text: '' }, line: '', updatedAt: 1, draftedAt: 111, model: 'm-1' });
  await stubNotes(page);
  await open(page);
  await expect(check(page)).toContainText(NOTES_COPY.checklist(0));
  await expect(section(page).getByTestId('rn-state')).toHaveText('Not yet live');

  await sit(page).fill('What stayed with you?');
  await expect.poll(async () => (await draftNode())?.sit, { timeout: 10000 }).toBe('What stayed with you?');
  await expect(check(page)).toContainText(NOTES_COPY.checklist(1));

  await sideQ(page).fill('Who was right?');
  await opt(page, 'A').fill('Ama');
  await expect(check(page)).toContainText(NOTES_COPY.checklist(1));
  await opt(page, 'B').fill('Kofi');
  await expect.poll(async () => (await draftNode())?.side, { timeout: 10000 }).toEqual({ text: 'Who was right?', options: { a: 'Ama', b: 'Kofi' } });
  await expect(check(page)).toContainText(NOTES_COPY.checklist(2));

  await line(page).fill('Which line?');
  await expect.poll(async () => (await draftNode())?.line, { timeout: 10000 }).toBe('Which line?');
  await expect(check(page)).toContainText(NOTES_COPY.checklist(3));
  await expect(section(page).getByTestId('rn-ready')).toHaveText(NOTES_COPY.checklist(3));

  const d = await draftNode();
  expect(d.draftedAt).toBe(111);
  expect(d.model).toBe('m-1');
  expect(d.updatedAt).toBeGreaterThan(1);

  // A reload shows what was saved.
  await open(page);
  await expect(sit(page)).toHaveValue('What stayed with you?');
  await expect(opt(page, 'B')).toHaveValue('Kofi');
});

test('sides: add and remove keep a..d contiguous and hold to 2–4', async ({ page }) => {
  await stubNotes(page);
  await open(page);
  const add = section(page).getByRole('button', { name: 'Add a side' });
  await expect(section(page).getByRole('button', { name: 'Remove side A' })).toBeDisabled();
  await expect(section(page).getByRole('button', { name: 'Remove side B' })).toBeDisabled();
  await add.click();
  await add.click();
  await expect(add).toBeDisabled();
  await expect(opt(page, 'D')).toBeVisible();
  for (const L of ['A', 'B', 'C', 'D']) await opt(page, L).fill(`Side ${L.toLowerCase()} text`);
  await expect.poll(async () => (await draftNode())?.side?.options, { timeout: 10000 })
    .toEqual({ a: 'Side a text', b: 'Side b text', c: 'Side c text', d: 'Side d text' });

  await section(page).getByRole('button', { name: 'Remove side B' }).click();
  await expect(opt(page, 'D')).toHaveCount(0);
  await expect(opt(page, 'B')).toHaveValue('Side c text');
  await expect(add).toBeEnabled();
  await expect.poll(async () => (await draftNode())?.side?.options, { timeout: 10000 })
    .toEqual({ a: 'Side a text', b: 'Side c text', c: 'Side d text' });

  await section(page).getByRole('button', { name: 'Remove side A' }).click();
  await expect(opt(page, 'C')).toHaveCount(0);
  await expect(section(page).getByRole('button', { name: 'Remove side A' })).toBeDisabled();
  await expect.poll(async () => (await draftNode())?.side?.options, { timeout: 10000 })
    .toEqual({ a: 'Side c text', b: 'Side d text' });
});

test('the counter shows near the limit', async ({ page }) => {
  await stubNotes(page);
  await open(page);
  await opt(page, 'A').fill('x'.repeat(10));
  await expect(section(page).getByText('10 / 60')).toHaveCount(0);
  await opt(page, 'A').fill('x'.repeat(55));
  await expect(section(page).getByText('55 / 60')).toBeVisible();
});

test('Publish refuses below 3 of 3, flushes the pending keystrokes first, then shows Published and Unpublished changes', async ({ page }) => {
  const calls = await stubNotes(page);
  await open(page);
  await expect(publishBtn(page)).toBeDisabled();
  await sit(page).fill('What stayed?');
  await sideQ(page).fill('Who was right?');
  await opt(page, 'A').fill('Ama');
  await opt(page, 'B').fill('Kofi');
  await expect(publishBtn(page)).toBeDisabled();
  await expect(check(page)).toContainText(NOTES_COPY.checklist(2));

  await line(page).fill('Which line would you keep');
  await expect(check(page)).toContainText(NOTES_COPY.checklist(3));
  await expect.poll(async () => (await draftNode())?.line, { timeout: 10000 }).toBe('Which line would you keep');
  // The last keystroke and Publish in ONE task, so the 600ms debounce cannot have fired: only a
  // flush can put the '?' in the node before the endpoint reads it. (A Playwright click here
  // spends ~2s on actionability checks, long enough for the debounce, and proved nothing: a
  // build with the flush removed passed it.)
  await page.evaluate(() => {
    const ta = document.getElementById('rn-line');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'Which line would you keep?');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('#sa-notes button')].find((b) => b.textContent === 'Publish questions');
    btn.click();
  });
  await expect(section(page).getByTestId('rn-state')).toHaveText('Published', { timeout: 15000 });

  const pub = calls.filter((c) => c.body.action === 'publish-questions');
  expect(pub).toHaveLength(1);
  expect(pub[0].body).toEqual({ action: 'publish-questions', inst: INST });
  expect(pub[0].bearer).toBe(true);
  expect(pub[0].seen.line, 'the endpoint saw the last keystroke already saved').toBe('Which line would you keep?');
  expect((await db().ref(`series_questions_public/${INST}`).get()).val().sit).toBe('What stayed?');
  await expect(check(page)).toContainText('Published');
  await expect(publishBtn(page)).toBeDisabled();

  await sit(page).fill('What stayed with you?');
  await expect(section(page).getByTestId('rn-state')).toHaveText('Unpublished changes');
  await expect(check(page)).toContainText('Unpublished changes');
  await expect(publishBtn(page)).toBeEnabled();
});

test('Draft three fills empty slots straight away from the node the endpoint wrote', async ({ page }) => {
  const draft = { sit: 'What did the quiet feel like?', side: { text: 'Leave or stay?', options: { a: 'Leave', b: 'Stay', c: 'Wait' } }, line: 'Which line stays?' };
  const calls = await stubNotes(page, { draft });
  await open(page);
  await draftBtn(page).click();
  await expect(sit(page)).toHaveValue(draft.sit);
  await expect(opt(page, 'C')).toHaveValue('Wait');
  await expect(line(page)).toHaveValue(draft.line);
  await expect(check(page)).toContainText(NOTES_COPY.checklist(3));
  expect(calls.map((c) => c.body)).toEqual([{ action: 'draft-questions', inst: INST }]);
  // Nothing was published by drafting.
  expect((await db().ref(`series_questions/${INST}`).get()).exists()).toBe(false);
});

test('Draft three saves what was typed, then asks before replacing it', async ({ page }) => {
  const draft = { sit: 'Drafted sit', side: { text: 'Drafted side', options: { a: 'One', b: 'Two' } }, line: 'Drafted line' };
  const calls = await stubNotes(page, { draft });
  await open(page);
  // Type and press in ONE task (see the Publish test): the save can only come from the flush.
  await page.evaluate(() => {
    const ta = document.getElementById('rn-sit');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'My own words');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#sa-notes button')].find((b) => b.textContent === 'Draft three from the text').click();
  });
  const confirm = section(page).getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  expect(calls, 'nothing sent before the editor answers').toHaveLength(0);
  expect((await draftNode()).sit, 'typed text flushed before asking').toBe('My own words');

  await confirm.getByRole('button', { name: 'Keep mine' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(sit(page)).toHaveValue('My own words');
  expect(calls).toHaveLength(0);

  await draftBtn(page).click();
  await section(page).getByRole('alertdialog').getByRole('button', { name: 'Replace them' }).click();
  await expect(sit(page)).toHaveValue('Drafted sit');
  await expect(line(page)).toHaveValue('Drafted line');
  expect(calls).toHaveLength(1);
  expect(calls[0].seen.sit).toBe('My own words');
});

test('the review list shows held and reported notes and sends the right decisions', async ({ page }) => {
  const now = Date.now();
  await db().ref().update({
    [`series_notes_held/${INST}/held1`]: { uid: 'u-held', kind: 'sit', text: 'A held note text', reason: 'spam', author: { name: 'Held Author' }, createdAt: now - 1000 },
    [`series_notes/${INST}/live1`]: { uid: 'u-live', kind: 'line', text: 'A reported live note', author: { name: 'Live Author' }, createdAt: now - 5000 },
    [`series_note_reports/${INST}/live1/r1`]: { at: now - 100, reason: 'Unkind' },
    [`series_note_reports/${INST}/live1/r2`]: { at: now - 200 },
  });
  const calls = await stubNotes(page);
  await open(page);
  const review = section(page).getByTestId('rn-review');
  const held = review.locator('[data-note="held1"]');
  const reported = review.locator('[data-note="live1"]');
  await expect(held).toContainText('A held note text');
  await expect(held).toContainText('Held · Spam');
  await expect(held).toContainText('Held Author');
  await expect(held).toContainText('Sit with this');
  await expect(held.getByRole('button')).toHaveText(['Approve', 'Remove']);
  await expect(reported).toContainText('A reported live note');
  await expect(reported).toContainText('Reported 2 times');
  await expect(reported).toContainText('Unkind');
  await expect(reported).toContainText('Live Author');
  await expect(reported.getByRole('button')).toHaveText(['Remove', 'Dismiss']);

  await held.getByRole('button', { name: 'Approve' }).click();
  await expect(held).toHaveCount(0);
  await reported.getByRole('button', { name: 'Dismiss' }).click();
  await expect(reported).toHaveCount(0);
  await expect(review).toContainText('Nothing held or reported.');
  expect(calls.map((c) => c.body)).toEqual([
    { action: 'review', inst: INST, noteId: 'held1', decision: 'approve' },
    { action: 'review', inst: INST, noteId: 'live1', decision: 'dismiss' },
  ]);
});
