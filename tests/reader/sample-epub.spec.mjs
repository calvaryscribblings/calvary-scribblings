// R8.0 §D — DO THE TRIMMED SAMPLES ACTUALLY OPEN?
//
// scripts/make-sample-epub.mjs rebuilds a package: a new manifest, a new spine, a nav and an
// NCX written from scratch. Every one of those is a chance to produce a file that unzips
// perfectly and will not open — a spine referencing a dropped id, a nav pointing at a file
// that is no longer there, a manifest that forgot the stylesheet. None of that is visible by
// reading the XML; it is visible by giving the file to foliate and watching what happens.
//
// So this spec does not inspect the output. It OPENS it, in the real reading-room host, and
// asks the questions a reader would: does it paginate, does the Contents list match what is
// actually in the book, and does it end where it is supposed to end.
//
// TWO TIERS, deliberately:
//
//   THE SYNTHETIC BOOK — built from tests/fixtures/harness-book.epub, which every run
//   generates. This tier runs everywhere, CI included, and is what guards the splitter
//   itself against regression.
//
//   THE THREE LIVE TITLES — the actual deliverables, built from licensed masters that are
//   gitignored and absent from CI. These skip when the masters are not present, the same
//   contract live-cfi.spec.mjs uses: the suite must stay runnable by anyone.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openReader, settle, roomFrame } from './helpers.mjs';
import { makeSample, readZip, MAX_BYTES, LIVE_TITLES } from '../../scripts/make-sample-epub.mjs';

const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * Build a sample from a master and drop it in tests/fixtures/ so the harness server can
 * reach it. Written at test time, never committed — it is a derived file.
 */
function buildInto(masterFile, outName, opts = {}) {
  const master = readFileSync(masterFile);
  const result = makeSample(master, opts);
  return Promise.resolve(result).then((r) => {
    writeFileSync(fixturePath(outName), r.bytes);
    return r;
  });
}

/** What the reader can actually see, once the book is open. */
async function bookState(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    return {
      // The spine, as foliate resolved it — not as the OPF claims it.
      sections: (view.book?.sections || []).length,
      toc: (view.book?.toc || []).map((t) => ({ label: (t.label || '').trim(), href: t.href || null })),
      pages: view.renderer?.pages ?? null,
      hasContents: (view.renderer?.getContents?.() || []).length,
    };
  });
}

/** Walk to the very end and report the final fraction, to prove the book terminates. */
async function readToEnd(page, maxTurns = 400) {
  return roomFrame(page).evaluate(async (limit) => {
    const view = document.querySelector('foliate-view');
    let last = -1;
    for (let i = 0; i < limit; i++) {
      const f = view.lastLocation?.fraction ?? 0;
      if (f >= 0.999) return { fraction: f, turns: i, ended: true };
      if (f === last) { /* a repeated fraction is fine mid-section; keep going */ }
      last = f;
      try { await view.goRight(); } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 12));
    }
    return { fraction: view.lastLocation?.fraction ?? 0, turns: limit, ended: false };
  }, maxTurns);
}

/**
 * The assertions every sample must satisfy, whatever book it came from.
 * `built` is the makeSample() result; `url` is where the harness server serves it.
 */
async function assertSampleOpens(page, built, url, label) {
  // ── Size, before anything else: a sample nobody can download is not a sample.
  expect(built.bytes.length, `${label}: must be under ${MAX_BYTES / 1024 / 1024} MB`)
    .toBeLessThanOrEqual(MAX_BYTES);

  // ── The archive must be a well-formed EPUB container.
  const files = readZip(built.bytes);
  expect(files.has('mimetype'), `${label}: an EPUB needs a mimetype entry`).toBe(true);
  expect(files.get('mimetype').toString(), `${label}: mimetype content`).toBe('application/epub+zip');
  expect(files.has('META-INF/container.xml'), `${label}: needs a container`).toBe(true);

  // EVERY href the package declares must exist in the archive. This is the assertion that
  // catches a rebuilt manifest referencing something that was left behind — the single most
  // likely way for this script to produce a broken book.
  const opfPath = /full-path="([^"]+)"/.exec(files.get('META-INF/container.xml').toString())[1];
  const opf = files.get(opfPath).toString();
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const declared = [...opf.matchAll(/<item\b[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  for (const href of declared) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    expect(files.has(base + decodeURIComponent(href)), `${label}: manifest declares "${href}" — it must be in the archive`).toBe(true);
  }

  // And every spine idref must name a manifest item: a dangling idref is a book that opens
  // to a blank page at that position.
  const ids = new Set([...opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*>/g)].map((m) => m[1]));
  const idrefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  for (const idref of idrefs) {
    expect(ids.has(idref), `${label}: spine references id "${idref}"`).toBe(true);
  }
  expect(idrefs.length, `${label}: the spine must not be empty`).toBeGreaterThan(0);

  // ── IT OPENS. The real host, the real paginator.
  await openReader(page, { book: url });
  await settle(page, 600);
  const state = await bookState(page);

  expect(state.hasContents, `${label}: the book must have painted a section`).toBeGreaterThan(0);
  expect(state.pages, `${label}: it must paginate`).toBeGreaterThan(2);

  // ── The spine foliate resolved must be exactly the trimmed spine we wrote.
  expect(state.sections, `${label}: foliate's spine must match the trimmed spine`)
    .toBe(built.pick.ordered.length);

  // ── THE CONTENTS MATCH THE TRIMMED SPINE. A nav that still lists chapter 20 is the
  // defect this whole file exists to catch: it looks fine until a reader taps it.
  const keptHrefs = new Set(built.pick.ordered.map((d) => d.item.full.split('/').pop()));
  expect(state.toc.length, `${label}: the Contents must not be empty`).toBeGreaterThan(0);
  expect(state.toc.length, `${label}: the Contents must not list more than the spine holds`)
    .toBeLessThanOrEqual(built.pick.ordered.length);
  for (const entry of state.toc) {
    const file = (entry.href || '').split('/').pop().split('#')[0];
    expect(keptHrefs.has(file), `${label}: Contents entry "${entry.label}" → ${file} must be in the sample`).toBe(true);
  }

  return state;
}

// ── TIER 1: the synthetic book. Runs everywhere, CI included. ────────────────
test('a sample built from the harness fixture opens, paginates and ends', async ({ page }) => {
  const built = await buildInto(fixturePath('harness-book.epub'), 'harness-sample.epub', { slug: 'harness' });
  const state = await assertSampleOpens(page, built, '/__t/fixtures/harness-sample.epub', 'harness sample');

  console.log(`\n=== harness sample ===\n${built.bytes.length} bytes, ${built.pick.ordered.length} spine docs, `
    + `${built.pick.chapterCount} chapters, ${built.pick.pct.toFixed(1)}%\n`
    + `TOC: ${JSON.stringify(state.toc.map((t) => t.label))}\n`);

  // IT ENDS WHERE IT ENDS. A trimmed book must reach fraction 1 by turning pages — that is
  // what lets the register fire `ended` and show the sample's buy panel. A spine that still
  // pointed at missing documents would stall short of it.
  const end = await readToEnd(page);
  console.log(`=== end of sample ===\n${JSON.stringify(end)}\n`);
  expect(end.ended, 'the sample must reach its end by ordinary page turns').toBe(true);
});

test('the splitter drops the chapters it did not keep — a sample is short in BYTES', async ({ page }) => {
  // The point of rebuilding rather than re-spining: the archive must not still contain the
  // rest of the book. Asserted directly, because "it looks trimmed in a reader" is exactly
  // the failure mode a lazy implementation passes.
  const master = readFileSync(fixturePath('harness-book.epub'));
  const built = await makeSample(master, { slug: 'harness' });
  const files = readZip(built.bytes);
  const masterFiles = readZip(master);

  const keptNames = new Set(built.pick.ordered.map((d) => d.item.full));
  const droppedDocs = [...masterFiles.keys()]
    .filter((n) => /\.xhtml$/i.test(n) && !keptNames.has(n) && !/nav\.xhtml$/.test(n));

  expect(droppedDocs.length, 'the fixture must have chapters left over to drop').toBeGreaterThan(0);
  for (const name of droppedDocs) {
    expect(files.has(name), `"${name}" was not kept, so it must not be in the archive`).toBe(false);
  }
  expect(built.bytes.length, 'and the sample must be smaller than the master').toBeLessThan(master.length);
  console.log(`\n=== bytes ===\nmaster ${master.length} → sample ${built.bytes.length}; dropped ${droppedDocs.length} documents\n`);
});

// ── TIER 2: the three live titles. Skips without the licensed masters. ───────
for (const slug of LIVE_TITLES) {
  const master = fixturePath(`${slug}.master.epub`);

  test(`${slug}: the shipped sample opens cleanly in the Reading Room`, async ({ page }) => {
    test.skip(!existsSync(master), `run: node scripts/fetch-master-epub.mjs ${slug}`);

    const built = await buildInto(master, `${slug}.sample.epub`, { slug });
    const state = await assertSampleOpens(page, built, `/__t/fixtures/${slug}.sample.epub`, slug);

    console.log(`\n=== ${slug} ===\n`
      + `${built.bytes.length} bytes | ${built.pick.ordered.length} spine docs `
      + `(${built.pick.frontCount} front + ${built.pick.chapterCount} chapters) | `
      + `${built.pick.sampleWords} of ${built.pick.totalWords} words = ${built.pick.pct.toFixed(1)}%\n`
      + `TOC: ${JSON.stringify(state.toc.map((t) => t.label))}\n`);

    const end = await readToEnd(page, 1200);
    console.log(`end: ${JSON.stringify(end)}\n`);
    expect(end.ended, `${slug}: the sample must reach its end by ordinary page turns`).toBe(true);
  });
}
