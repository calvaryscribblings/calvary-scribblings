// ─────────────────────────────────────────────────────────────────────────────
// R7.3 §B — THE FOREVER-SPINNER, closed at the host.
//
// foliate's loader is fetch(url) → res.blob() (view.js:70-75). A status code fails loudly;
// a request that never answers, or one whose body stops arriving halfway, does not fail at
// all. There is no timeout in foliate and there was none here, so "Opening book…" simply
// span for as long as the reader was willing to look at it — nothing on the glass, nothing
// in the console, and nothing for the register above to report.
//
// The host now fetches the file itself and fences it two ways (headers, then stall) while
// deliberately NOT capping the download as a whole. Each branch below is one of those ways.
// The fences are shortened with ?fencems= so CI does not spend a minute waiting for silence.
//
// The reader-facing half of this — the styled failure state with a route out — is asserted
// across the React boundary in app.spec.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { msgs } from './helpers.mjs';

const FENCE_MS = 900;

/** Open the harness against a URL that is meant to fail, and return the error message. */
async function openFailing(page, url, { fence = true } = {}) {
  const q = new URLSearchParams({
    bg: '#f2ecd9', fg: '#2b2418', face: 'cormorant', size: '100', leading: '1.6', flow: 'paginated',
  });
  if (url !== null) q.set('url', url);
  if (fence) q.set('fencems', String(FENCE_MS));
  await page.goto(`/__t/reader/harness.html?q=${encodeURIComponent(q.toString())}`);
  await page.waitForFunction(
    () => window.__msgs.some((m) => m.type === 'error'), null, { timeout: 15000 },
  );
  const [err] = await msgs(page, 'error');
  return err;
}

/** What the reader sees inside the frame while no register has supplied a failure state. */
async function hostGlass(page) {
  const frame = page.frames().find((f) => f.url().includes('/reading-room.html'));
  return frame.evaluate(() => ({
    spinnerHidden: document.getElementById('loading').classList.contains('hidden'),
    errorShown: document.getElementById('error').classList.contains('show'),
    text: document.getElementById('error-text').textContent.trim(),
  }));
}

test('a book that never answers fails at the headers fence, it does not spin', async ({ page }) => {
  // THE ORIGINAL DEFECT, exactly: a server that accepts the connection and says nothing.
  // Before R7.3 this test could not be written — there was no outcome to wait for.
  const started = Date.now();
  const err = await openFailing(page, '/__fail/hang');
  const elapsed = Date.now() - started;

  console.log(`\n=== headers fence ===\n${JSON.stringify(err)}\nreported after ${elapsed} ms (fence ${FENCE_MS} ms)\n`);
  expect(err.reason, 'silence must be reported as no-answer').toBe('no-answer');
  // It must fail because the fence fired, not because something else went wrong first.
  expect(elapsed, 'the fence must be what ends the wait').toBeGreaterThanOrEqual(FENCE_MS - 100);
  expect(elapsed, 'and it must not wait appreciably longer than the fence').toBeLessThan(FENCE_MS + 6000);

  const glass = await hostGlass(page);
  expect(glass.spinnerHidden, 'the spinner must stop').toBe(true);
  expect(glass.errorShown, 'and the host must say something in its place').toBe(true);
  expect(glass.text, 'in the Reading Room’s voice, not a browser error').toBe('This book would not open.');
});

test('a body that stops arriving fails at the stall fence', async ({ page }) => {
  // Headers came, two bytes came, then the connection went quiet — the train-tunnel case.
  const err = await openFailing(page, '/__fail/stall');
  console.log(`\n=== stall fence ===\n${JSON.stringify(err)}\n`);
  expect(err.reason).toBe('stalled');
  expect((await hostGlass(page)).errorShown).toBe(true);
});

test('a 404 is reported as an http failure, with the status in the message', async ({ page }) => {
  const err = await openFailing(page, '/__t/fixtures/no-such-book.epub');
  console.log(`\n=== 404 ===\n${JSON.stringify(err)}\n`);
  expect(err.reason).toBe('http');
  expect(err.message, 'the status belongs in the log line').toContain('404');
});

test('a zero-length response is reported rather than opened', async ({ page }) => {
  const err = await openFailing(page, '/__fail/empty');
  console.log(`\n=== empty ===\n${JSON.stringify(err)}\n`);
  expect(err.reason).toBe('empty');
});

test('a file that arrives but is not a book is a different failure from one that never arrives', async ({ page }) => {
  // The distinction matters: "the file did not come" and "the file came and is not readable"
  // are different sentences to a reader, and different problems to whoever gets the log.
  const err = await openFailing(page, '/__t/reader/harness.html');
  console.log(`\n=== not a book ===\n${JSON.stringify(err)}\n`);
  expect(err.reason).toBe('unreadable');
});

test('no url at all is reported, not left blank', async ({ page }) => {
  const err = await openFailing(page, null, { fence: false });
  expect(err.reason).toBe('no-target');
  expect((await hostGlass(page)).errorShown).toBe(true);
});

test('the fence does not interfere with a book that loads', async ({ page }) => {
  // The guard on the guard: the whole fence is bytes-in-flight bookkeeping around a fetch,
  // and if it broke normal loading it would break everything. A short fence with a real
  // book must still open, because every chunk re-arms the stall clock.
  const q = new URLSearchParams({
    url: '/__t/fixtures/harness-book.epub', fencems: String(FENCE_MS),
    bg: '#f2ecd9', fg: '#2b2418', face: 'cormorant', size: '100', leading: '1.6', flow: 'paginated',
  }).toString();
  await page.goto(`/__t/reader/harness.html?q=${encodeURIComponent(q)}`);
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), null, { timeout: 20000 });
  const errors = await msgs(page, 'error');
  expect(errors.length, 'a good book must produce no error').toBe(0);
  const glass = await hostGlass(page);
  expect(glass.spinnerHidden).toBe(true);
  expect(glass.errorShown).toBe(false);
});
