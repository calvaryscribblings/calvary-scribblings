// §6h — THE CROSS-SURFACE CFI EXCHANGE.
//
// Emits this surface's four positions, and verifies the app's four land where the app meant.
//
// ── THE DIGEST GATE COMES FIRST, ALWAYS ──────────────────────────────────────
// "Same book" means SAME BYTES, verified here rather than assumed. A fixture that drifts by
// one byte makes every assertion below answer a question about two different books while
// looking exactly like it answered the right one — a green run that means nothing, which is
// worse than a red one. So nothing in this file emits or seeks a CFI until the file on disk
// has been hashed and matched.
//
// Three states, three different behaviours, and the difference between them matters:
//
//   fixture ABSENT, pin null   → SKIP. Nothing has been delivered yet. The suite has to stay
//                                runnable by anyone (the same rule live-cfi.spec.mjs follows
//                                for the licensed masters).
//   fixture PRESENT, pin null  → FAIL. The file arrived and nobody pinned it. This is the
//                                dangerous state: the tests would run, pass, and prove
//                                nothing about which book they ran against.
//   digest MISMATCH            → FAIL, loudly, with both digests. Do not "re-pin to make it
//                                pass": a changed fixture is either a new fixture that both
//                                sides must adopt together, or a corrupted copy.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { settle } from './helpers.mjs';
import { POSITIONS, EMIT_IN_PAGE, SEEK_IN_PAGE, WINDOW, sameLanding, listDigest, normalise } from './cross-surface/exchange.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PIN = JSON.parse(readFileSync(resolve(HERE, 'cross-surface/fixture-pin.json'), 'utf8'));

const FIXTURE = resolve(ROOT, PIN.fixture);
const OUR_LIST = resolve(ROOT, 'docs/cfi-web-list.json');
const THEIR_LIST = resolve(ROOT, 'docs/cfi-app-list.json');

// A rehearsal book, so the machinery can be exercised before the real fixture lands. It is
// NEVER a substitute for it: the exchange itself refuses to run on anything unpinned, and
// this only ever drives the emit path so we know the mechanism works.
const REHEARSAL = process.env.CFI_REHEARSAL_BOOK || null;

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** The gate. Returns the reason to skip, or throws — never returns "fine" by accident. */
function gate() {
  const present = existsSync(FIXTURE);
  if (!present && !PIN.sha256) {
    return `§6h fixture not delivered yet — expected at ${PIN.fixture}, digest not yet pinned.`;
  }
  if (present && !PIN.sha256) {
    throw new Error(
      `THE FIXTURE IS PRESENT AND ITS DIGEST IS NOT PINNED.\n`
      + `  ${PIN.fixture}\n`
      + `  sha256 on disk: ${sha256File(FIXTURE)}\n\n`
      + `  Put that value in tests/reader/cross-surface/fixture-pin.json ONLY if it matches the\n`
      + `  digest the app side published. Pinning whatever happens to be on disk defeats the\n`
      + `  entire point of pinning: it would make any copy self-certifying.`);
  }
  if (!present && PIN.sha256) {
    return `§6h fixture pinned but missing on disk — expected at ${PIN.fixture}.`;
  }
  const actual = sha256File(FIXTURE);
  if (actual !== PIN.sha256) {
    throw new Error(
      `FIXTURE DIGEST MISMATCH — this is not the app's book.\n`
      + `  file      ${PIN.fixture}\n`
      + `  expected  ${PIN.sha256}\n`
      + `  actual    ${actual}\n\n`
      + `  Every CFI below would be about a different book. Do NOT re-pin to make this pass.\n`
      + `  Either the copy is corrupt, or the fixture was revised — and a revised fixture is a\n`
      + `  change both surfaces adopt together, in one move, or the exchange is meaningless.`);
  }
  return null;
}

let skipReason = null;
try { skipReason = gate(); } catch (e) { skipReason = null; test.beforeAll(() => { throw e; }); }
test.skip(!!skipReason && !REHEARSAL, () => skipReason || 'not delivered');

const BOOK_URL = REHEARSAL || PIN.servedAt;

async function open(page) {
  const q = new URLSearchParams({
    url: BOOK_URL, bg: '#f2ecd9', fg: '#2b2418', face: 'cormorant',
    size: '100', leading: '1.6', flow: 'paginated',
  }).toString();
  await page.goto(`/__t/reader/harness.html?q=${encodeURIComponent(q)}`);
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), null, { timeout: 40000 });
  await settle(page, 600);
  return page.frames().find((f) => f.url().includes('/reading-room.html'));
}

test('the fixture is the app\'s book, byte for byte', async () => {
  test.skip(!!REHEARSAL, 'rehearsal run — the real fixture is what gets pinned');
  expect(PIN.sha256, 'digest must be pinned before any CFI is emitted').toBeTruthy();
  expect(sha256File(FIXTURE)).toBe(PIN.sha256);
});

test('emit our four positions, and confirm each one round-trips on our own surface', async ({ page }) => {
  const frame = await open(page);

  const sections = await frame.evaluate(() => document.querySelector('foliate-view').book.sections.length);
  if (!REHEARSAL) expect(sections, 'the fixture should have four sections').toBe(PIN.expectedSections);

  const records = [];
  for (const p of POSITIONS) {
    const index = Math.min(p.section, sections - 1);
    const emitted = await frame.evaluate(new Function(`return ${EMIT_IN_PAGE}`)(), { index, at: p.at, window: WINDOW });
    expect(emitted.error, `emitting ${p.key}: ${emitted.error || ''}`).toBeFalsy();
    expect(emitted.cfi, `${p.key} produced no CFI`).toBeTruthy();

    // ROUND-TRIP ON OUR OWN SURFACE FIRST. If a CFI we emitted does not resolve back to
    // where we emitted it HERE, it is not worth sending: we would be asking the app to
    // reproduce a position this surface cannot reproduce for itself, and the failure would
    // be reported against them.
    const back = await frame.evaluate(new Function(`return ${SEEK_IN_PAGE}`)(), { cfi: emitted.cfi, window: WINDOW });
    expect(back.error, `seeking our own ${p.key}: ${back.error || ''}`).toBeFalsy();
    const landed = sameLanding(emitted, back);
    expect(landed.ok, `our own ${p.key} did not round-trip: ${landed.why}`).toBe(true);

    records.push({
      key: p.key,
      why: p.why,
      cfi: emitted.cfi,
      sectionIndex: emitted.sectionIndex,
      resolvedText: normalise(emitted.resolvedText).slice(0, WINDOW),
    });
  }

  expect(records.length).toBe(4);

  if (REHEARSAL) {
    console.log('\nREHEARSAL — machinery only, NOT the exchange. Records that would be sent:');
    for (const r of records) console.log(`  ${r.key.padEnd(30)} §${r.sectionIndex}  ${JSON.stringify(r.resolvedText.slice(0, 44))}`);
    return;
  }

  mkdirSync(dirname(OUR_LIST), { recursive: true });
  writeFileSync(OUR_LIST, JSON.stringify({
    _: '§6h — the web surface\'s four positions. The app SEEKS each cfi and reports the '
     + 'sectionIndex and resolvedText it lands on; pass is that they match the values here. '
     + 'Do NOT compare cfi strings — see tests/reader/cross-surface/exchange.mjs.',
    fixture: PIN.fixture,
    fixtureSha256: PIN.sha256,
    window: WINDOW,
    digest: listDigest(records),
    records,
  }, null, 2) + '\n');
  console.log(`wrote docs/cfi-web-list.json — 4 positions, digest ${listDigest(records)}`);
});

test('the app\'s four positions land where the app meant', async ({ page }) => {
  test.skip(!existsSync(THEIR_LIST), 'docs/cfi-app-list.json not delivered yet');
  const theirs = JSON.parse(readFileSync(THEIR_LIST, 'utf8'));

  // Their list must be about OUR book. Two surfaces exchanging positions in different books
  // is the failure this whole gate exists for, and it can arrive from their side too.
  expect(theirs.fixtureSha256, 'their list must name the fixture it was taken against').toBe(PIN.sha256);

  const frame = await open(page);
  const failures = [];
  for (const rec of theirs.records) {
    const got = await frame.evaluate(new Function(`return ${SEEK_IN_PAGE}`)(), { cfi: rec.cfi, window: WINDOW });
    if (got.error) { failures.push(`${rec.key}: ${got.error}`); continue; }
    const landed = sameLanding(rec, { ...got, resolvedText: normalise(got.resolvedText).slice(0, WINDOW) });
    if (!landed.ok) failures.push(`${rec.key}: ${landed.why}`);
  }
  expect(failures, `app→web landings failed:\n  ${failures.join('\n  ')}`).toEqual([]);
});
