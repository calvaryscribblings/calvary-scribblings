// §6h — THE CROSS-SURFACE CFI EXCHANGE.
//
// Emits this surface's four positions, and verifies the app's four land where the app meant.
//
// ── THE DIGEST GATE COMES FIRST, ALWAYS ──────────────────────────────────────
// "Same book" means SAME BYTES, and here they are GENERATED rather than received. The app
// sends its generator — make-epub.mjs + zip.mjs — and this spec runs it and matches the
// published digest. Byte-identity is therefore DERIVED, not transferred: a copied binary can
// only be checked against a number somebody sent, a generated one is reproduced from the
// source that defines it, in this environment, on every run.
//
// That is why the fixture is NOT committed here, which reverses the earlier call in
// docs/cfi-exchange-protocol.md. That call was right for a delivered binary — "a fixture you
// have to obtain is a fixture the test skips" — and the generator removes its premise:
// nothing has to be obtained, so nothing skips, and a binary in git is a fixture nobody can
// review. The app side keeps a committed copy only because Metro must bundle one into the
// binary, and asserts it byte-identical to a fresh build for exactly this reason.
//
// The gate rebuilds and compares before anything below emits or seeks a CFI:
//
//   digest MATCHES    → proceed.
//   digest DIFFERS    → FAIL, loudly, with both digests. This would be a finding about the
//                       GENERATOR'S DETERMINISM ACROSS ENVIRONMENTS — a Node version that
//                       orders something differently, a Buffer encoding that moved — and it
//                       is worth knowing before it is worth fixing. Do NOT re-pin to make it
//                       agree: the pin is the app's published value, and a fixture that has
//                       genuinely changed is a change both surfaces adopt together, in one
//                       move, or the exchange means nothing.
//   generator MISSING → SKIP, with the path. Nothing to build from.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { settle } from './helpers.mjs';
import { POSITIONS, EMIT_IN_PAGE, SEEK_IN_PAGE, WINDOW, sameLanding, listDigest, normalise } from './cross-surface/exchange.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PIN = JSON.parse(readFileSync(resolve(HERE, 'cross-surface/fixture-pin.json'), 'utf8'));

const GENERATOR = resolve(ROOT, PIN.generator);
const FIXTURE = resolve(ROOT, PIN.fixture);
const OUR_LIST = resolve(ROOT, 'docs/cfi-web-list.json');
const THEIR_LIST = resolve(ROOT, 'docs/cfi-app-list.json');

// A rehearsal book, so the machinery can be exercised without the real fixture. NEVER a
// substitute for it: it only drives the emit path, and it never writes the exchange list.
const REHEARSAL = process.env.CFI_REHEARSAL_BOOK || null;

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Rebuild from source and match. Returns a skip reason, or throws — never "fine" by accident. */
function gate() {
  if (!existsSync(GENERATOR)) {
    return `§6h generator missing — expected at ${PIN.generator}`;
  }
  return null;
}

let skipReason = gate();
test.skip(!!skipReason && !REHEARSAL, () => skipReason || 'generator missing');

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

// Runs before every test in this file, not only the digest test: no CFI is emitted or sought
// against a book whose bytes have not been re-derived in THIS environment on THIS run.
test.beforeAll(async () => {
  if (REHEARSAL) return;
  const { buildFixture } = await import(pathToFileURL(GENERATOR).href);
  const built = buildFixture();
  if (built.sha256 !== PIN.sha256) {
    throw new Error(
      `FIXTURE DIGEST MISMATCH — the generator did not reproduce the app's book here.\n`
      + `  generator  ${PIN.generator}\n`
      + `  expected   ${PIN.sha256}  (${PIN.bytes} bytes, the app's published value)\n`
      + `  built      ${built.sha256}  (${built.bytes} bytes)\n\n`
      + `  This is a finding about the GENERATOR'S DETERMINISM ACROSS ENVIRONMENTS, not about\n`
      + `  the reader. Report the difference; do NOT re-pin to make it agree. Every CFI below\n`
      + `  would otherwise be about a different book while looking exactly right.`);
  }
});

test('the fixture is the app\'s book, byte for byte, rebuilt from source', async () => {
  test.skip(!!REHEARSAL, 'rehearsal run — the real fixture is what gets pinned');
  expect(existsSync(FIXTURE), `${PIN.fixture} should exist after the build`).toBe(true);
  expect(sha256File(FIXTURE)).toBe(PIN.sha256);
  expect(readFileSync(FIXTURE).length).toBe(PIN.bytes);
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
