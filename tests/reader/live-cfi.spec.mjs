// THE 09:23 VERDICT — do the ribbons stored on glass actually resolve?
//
// These are the REAL records from readerBookmarks/XaG6bTGqdDXh7VkBTw4y1H2d2s82/
// the-fire-in-the-flint, read on 2026-07-29 with scripts/inspect-ribbons.mjs, resolved
// against the REAL master EPUB. The Fire in the Flint is a published BOOKSTORE title
// (bookstore_epubs/the-fire-in-the-flint/master.epub, CS 003) — so every one of these
// ribbons was dropped on the purchased path, which is the surface the glass report is
// about.
//
// The book is licensed and is not in the repo. Fetch it first:
//   node scripts/fetch-master-epub.mjs the-fire-in-the-flint
// Without it these tests skip rather than fail — the suite must stay runnable by anyone.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { settle, msgs, clearMsgs, post, currentFraction } from './helpers.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/the-fire-in-the-flint.master.epub', import.meta.url));
const BOOK_URL = '/__t/fixtures/the-fire-in-the-flint.master.epub';

// Verbatim from the live database. Two shapes: the 09:23 pair carry a cfi and NOTHING
// else (R7.1's dropRibbon), the 09:52/11:55 records carry cfi + fraction (R7.2's).
const RECORDS = [
  { at: '09:23', id: '-OyhAp_wQoI3NjY7SIr6', cfi: 'epubcfi(/6/12!/4/2[chapter-1],/10/5:342,/12/1:707)', fraction: null },
  { at: '09:23', id: '-OyhArXAbb76C-njy68d', cfi: 'epubcfi(/6/12!/4/2[chapter-1],/18/1:631,/20/1:215)', fraction: null },
  { at: '09:52', id: '-OyhHaAOeyKEDuW-cZJq', cfi: 'epubcfi(/6/12!/4/2[chapter-1]/20,/1:215,/1:951)', fraction: 0.028779725159803416 },
  { at: '09:52', id: '-OyhHcC5_MUj2NnMhVsw', cfi: 'epubcfi(/6/12!/4/2[chapter-1]/28,/2,/3:749)', fraction: 0.03568741193123937 },
  { at: '11:55', id: '-OyhiaATi4hqn7yLIsN0', cfi: 'epubcfi(/6/12!/4/2[chapter-1],/36/1:237,/38/1:241)', fraction: 0.042595098702675326 },
];

test.skip(!existsSync(FIXTURE), 'run: node scripts/fetch-master-epub.mjs the-fire-in-the-flint');

async function openBook(page) {
  const q = new URLSearchParams({
    url: BOOK_URL, bg: '#f2ecd9', fg: '#2b2418', face: 'cormorant',
    size: '100', leading: '1.6', flow: 'paginated',
  }).toString();
  await page.goto(`/__t/reader/harness.html?q=${encodeURIComponent(q)}`);
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), null, { timeout: 40000 });
  await settle(page, 600);
}

test('every live ribbon cfi either moves the reader or is caught as unresolved', async ({ page }) => {
  await openBook(page);

  // Park FAR away — mid-book — so "did not move" cannot be confused with "the target was
  // already under us". Every record here points into chapter 1 (fraction < 0.05), so 0.55
  // is unambiguous. An earlier run parked a few pages in and had to be discarded for
  // exactly that confound.
  const PARK = 0.55;

  const results = [];
  for (const rec of RECORDS) {
    await post(page, { type: 'goToFraction', fraction: PARK });
    await settle(page, 500);
    const before = await currentFraction(page);
    await clearMsgs(page);

    await post(page, { type: 'goTo', cfi: rec.cfi, id: 1 });
    await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'goToAck' && m.id === 1), null, { timeout: 10000 });
    await settle(page, 900);

    const ack = (await msgs(page, 'goToAck')).find((a) => a.id === 1);
    const after = await currentFraction(page);
    const relocates = (await msgs(page, 'relocate')).length;
    const moved = Math.abs((after ?? before) - before) > 1e-9;

    // Now the fallback, for the records that have one.
    let fallbackLanded = null;
    if (rec.fraction != null) {
      await clearMsgs(page);
      await post(page, { type: 'goToFraction', fraction: rec.fraction, id: 2 });
      await settle(page, 900);
      fallbackLanded = await currentFraction(page);
    }

    results.push({ ...rec, ackOk: ack?.ok, relocates, before, after, moved, fallbackLanded });
  }

  console.log('\n=== LIVE RIBBON CFI VERDICT (The Fire in the Flint, master.epub) ===');
  for (const r of results) {
    console.log(
      `  ${r.at} ${r.id}\n`
      + `    cfi        ${r.cfi}\n`
      + `    ack        ok=${r.ackOk}  relocates=${r.relocates}\n`
      + `    position   ${r.before} → ${r.after}   MOVED=${r.moved}\n`
      + `    fraction   ${r.fraction ?? '— (none stored)'}`
      + (r.fallbackLanded != null ? `  → fallback landed ${r.fallbackLanded}` : '  → NO FALLBACK POSSIBLE'),
    );
  }
  console.log('');

  // The verdict this test exists to deliver: a jump either moves the reader, or the host
  // reports that it could not. Silence is the failure.
  const silent = results.filter((r) => !r.moved && r.ackOk !== false);
  expect(silent.map((r) => `${r.at}/${r.id}`), 'these cfis resolved to nothing AND acked ok — silent death')
    .toEqual([]);
});

test('every record with a fraction lands near it', async ({ page }) => {
  await openBook(page);
  const withFraction = RECORDS.filter((r) => r.fraction != null);
  expect(withFraction.length).toBeGreaterThan(0);

  for (const rec of withFraction) {
    await post(page, { type: 'goToFraction', fraction: 0.5 });
    await settle(page, 500);
    await clearMsgs(page);
    await post(page, { type: 'goToFraction', fraction: rec.fraction, id: 7 });
    await settle(page, 900);
    const landed = await currentFraction(page);
    expect(Math.abs(landed - rec.fraction), `${rec.at} fallback must land near ${rec.fraction}`)
      .toBeLessThan(0.02);
  }
});
