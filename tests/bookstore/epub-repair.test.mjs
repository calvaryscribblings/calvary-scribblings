// The EPUB repair tools, proven on invented books built in memory.
//
//   node --test tests/bookstore/epub-repair.test.mjs      (npm run test:purchases)
//
// A repair must change only the bytes that are wrong, so every saved place outside the repair
// still resolves to the same text (docs/epub-replacement.md). These drive scripts/epub-repair/
// with a book that has three chapters folded into one, and one that has a wrong numeral.
// The carry-over test needs Chromium: reader-tests installs it before this suite; the hygiene
// job runs the suite without one, and there that test skips by name.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { readEntries, writeEntries, applyPlan, splitChapter, relabel, sectionBlocks, RepairError } from '../../scripts/epub-repair/lib.mjs';
import { compareEntries } from '../../scripts/epub-repair/verify.mjs';
import { analyseEpub } from '../../scripts/audit-folded-headings.mjs';
import { readZip } from '../../scripts/make-sample-epub.mjs';
import { foldedBook, SPLIT_PLAN, mislabelledBook, RELABEL_PLAN } from '../fixtures/epub-repair-fixtures.mjs';
import { wrappedOnce, guardCfi, REFUSED_CFI } from '../../scripts/epub-repair/cfi.mjs';

const repaired = (bytes, plan) => writeEntries(applyPlan(readEntries(bytes), plan).entries);
const str = (bytes, name) => readZip(bytes).get(name).toString('utf8');

describe('split · the folded book', () => {
  const orig = foldedBook();
  const plan = SPLIT_PLAN();
  const rep = repaired(orig, plan);

  test('the original really is folded: the audit flags all three lines', () => {
    assert.deepEqual(analyseEpub(orig).flags.map((f) => f.text), ['CHAPTER FOUR', 'CHAPTER FIVE', 'EPILOGUE']);
  });

  test('the repair reads Prologue, One–Five, Epilogue, with nothing flagged', () => {
    const a = analyseEpub(rep);
    assert.equal(a.flags.length, 0);
    assert.deepEqual(a.numbered, { first: 1, last: 5, gaps: [], repeats: [] });
    assert.deepEqual(a.chapters.map((c) => c.label), ['Prologue', 'One', 'Two', 'Three', 'Four', 'Five', 'Epilogue']);
  });

  test('verify finds it clean: untouched entries byte-identical, blocks equal, contents in order', () => {
    const c = compareEntries(readEntries(orig), readEntries(rep), plan);
    assert.deepEqual(c.problems, []);
    assert.equal(c.facts.untouched.identical, c.facts.untouched.of);
    assert.deepEqual(c.facts.blocks, { original: 30, headings: 3, compared: 27 });
  });

  test('the kept file is the original\'s prefix plus its closing bytes, exactly', () => {
    const o = str(orig, plan.file);
    const s = sectionBlocks(o);
    const firstHead = s.blocks.findIndex((b) => b.text === 'CHAPTER FOUR');
    assert.equal(str(rep, plan.file), o.slice(0, s.blocks[firstHead - 1].end) + o.slice(s.blocks.at(-1).end));
  });

  test('new files copy the pattern: title by file name, section id, h1 + opener with the label swapped', () => {
    const d = str(rep, 'EPUB/text/ch006.xhtml');
    assert.match(d, /<title>ch006\.xhtml<\/title>/);
    assert.match(d, /<section id="four" class="level1">\n<h1>Four<\/h1>\n<div class="opener">\n<p class="only">\nFour\n<\/p>/);
    const e = str(rep, 'EPUB/text/ch008.xhtml');
    assert.match(e, /<section id="epilogue" class="level1">\n<h1>Epilogue<\/h1>/);
    assert.ok(!/Prologue|CHAPTER|EPILOGUE/.test(e), 'no pattern label and no heading line carried over');
  });

  test('OPF: items and itemrefs straight after the split file, modified updated, nothing else', () => {
    const o = str(rep, 'EPUB/content.opf');
    assert.ok(o.indexOf('idref="ch004_xhtml"') < o.indexOf('idref="ch006_xhtml"'));
    assert.ok(o.indexOf('idref="ch008_xhtml"') < o.indexOf('idref="ch005_xhtml"'));
    assert.match(o, /dcterms:modified">2026-10-14T12:00:00Z</);
  });

  test('nav and NCX: entries after Three, labelled like neighbours, ids renumbered in sequence', () => {
    const nav = str(rep, 'EPUB/nav.xhtml');
    const labels = [...nav.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['Prologue', 'One', 'Two', 'Three', 'Four', 'Five', 'Epilogue', 'Colophon']);
    assert.deepEqual([...nav.matchAll(/id="toc-li-(\d+)"/g)].map((m) => +m[1]), [1, 2, 3, 4, 5, 6, 7, 8]);
    const ncx = str(rep, 'EPUB/toc.ncx');
    assert.deepEqual([...ncx.matchAll(/id="navPoint-(\d+)"/g)].map((m) => +m[1]), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('entry order: the original\'s, new files straight after the split file, mimetype first', () => {
    assert.deepEqual(readEntries(rep).map((e) => e.name.replace('EPUB/', '')), [
      'mimetype', 'content.opf', 'nav.xhtml', 'toc.ncx', 'text/ch001.xhtml', 'text/ch002.xhtml', 'text/ch003.xhtml',
      'text/ch004.xhtml', 'text/ch006.xhtml', 'text/ch007.xhtml', 'text/ch008.xhtml', 'text/ch005.xhtml', 'styles/s.css', 'META-INF/container.xml']);
  });
});

describe('split · refusals (a candidate is never produced from these)', () => {
  const bad = (bytes, plan, re) => assert.throws(() => splitChapter(readEntries(bytes), plan), (e) => e instanceof RepairError && re.test(e.message));
  test('a heading with markup on it', () => bad(foldedBook({ headingMarkup: (t) => `<p><strong>${t}</strong></p>` }), SPLIT_PLAN(), /not a bare <p>/));
  test('a heading the file does not have', () => { const p = SPLIT_PLAN(); p.new[0].heading = 'CHAPTER NINE'; bad(foldedBook(), p, /found 0 times/); });
  test('headings out of order', () => { const p = SPLIT_PLAN(); [p.new[0], p.new[1]] = [p.new[1], p.new[0]]; bad(foldedBook(), p, /order/); });
  test('a new file name that exists', () => { const p = SPLIT_PLAN(); p.new[0].file = 'EPUB/text/ch005.xhtml'; bad(foldedBook(), p, /collides/); });
  test('a section id already in the book', () => { const p = SPLIT_PLAN(); p.new[0].sectionId = 'two'; bad(foldedBook(), p, /collides/); });
  test('patterns that disagree', () => { const p = SPLIT_PLAN(); p.chapterPatterns.push({ file: 'EPUB/text/ch005.xhtml', label: 'Colophon' }); bad(foldedBook(), p, /pattern/); });
  test('a malformed modified stamp', () => { const p = SPLIT_PLAN(); p.modified = '14 Oct'; bad(foldedBook(), p, /modified/); });
});

describe('verify · it catches what a bad repair would do', () => {
  const orig = foldedBook();
  const plan = SPLIT_PLAN();
  const good = applyPlan(readEntries(orig), plan).entries;
  const tamper = (fn) => compareEntries(readEntries(orig), fn(good.map((e) => ({ ...e }))), plan).problems;
  test('an untouched file changing', () => assert.ok(tamper((es) => { es.find((e) => e.name.endsWith('ch002.xhtml')).data = Buffer.from('x'); return es; }).some((p) => /ch002.*not allow/.test(p))));
  test('a moved block altered by one character', () => assert.ok(tamper((es) => { const e = es.find((x) => x.name.endsWith('ch007.xhtml')); e.data = Buffer.from(e.data.toString().replace('ferryman', 'ferrymen')); return es; }).some((p) => /blocks differ/.test(p))));
  test('a stray OPF change', () => assert.ok(tamper((es) => { const e = es.find((x) => x.name.endsWith('content.opf')); e.data = Buffer.from(e.data.toString().replace('en-GB', 'en-US')); return es; }).some((p) => /OPF differs/.test(p))));
  test('new files out of order', () => assert.ok(tamper((es) => { const i = es.findIndex((x) => x.name.endsWith('ch006.xhtml')); [es[i], es[i + 1]] = [es[i + 1], es[i]]; return es; }).some((p) => /order/.test(p))));
});

describe('relabel · the wrong numeral', () => {
  const orig = mislabelledBook();
  const plan = RELABEL_PLAN();
  test('before: the audit sees II twice', () => assert.deepEqual(analyseEpub(orig).numbered.repeats, [2]));
  test('after: I–IV, no gap or repeat; verify clean', () => {
    const rep = repaired(orig, plan);
    assert.deepEqual(analyseEpub(rep).numbered, { first: 1, last: 4, gaps: [], repeats: [] });
    assert.deepEqual(compareEntries(readEntries(orig), readEntries(rep), plan).problems, []);
  });
  test('an edit whose bytes are not there is refused (an em space is not a space)', () => {
    const p = RELABEL_PLAN(); p.edits[1].find = '<p>II Low Water</p>';
    assert.throws(() => relabel(readEntries(orig), p), /found 0/);
  });
  test('an edit that would hit two places is refused', () => {
    // The contents page carries "II" twice: The Quay (right) and Low Water (wrong).
    const p = RELABEL_PLAN(); p.edits[1].find = '<p>II\u2003'; p.edits[1].replace = '<p>III\u2003';
    assert.throws(() => relabel(readEntries(orig), p), /expected 1/);
  });
});

// ── The carry-over, with foliate's own CFI code in Chromium ─────────────────────────────────
let chromiumPath = null;
try { chromiumPath = (await import('playwright')).chromium.executablePath(); } catch { chromiumPath = null; }
const noBrowser = !chromiumPath || !existsSync(chromiumPath);

describe('carry-over · mapping saved places into the split file', { skip: noBrowser && 'Chromium is not installed in this job (reader-tests installs it and runs this)' }, () => {
  test('kept outside the cut, mapped inside it by text + occurrence, landed on a removed heading', async () => {
    const { mapPositions } = await import('../../scripts/epub-repair/map-positions.mjs');
    const orig = foldedBook();
    const rep = repaired(orig, SPLIT_PLAN());
    // Section children of ch004 (spine index 3): 0 h1, 1 opener, 2–7 body, 8 FOUR, 9–13, 14 FIVE,
    // 15–21, 22 EPILOGUE, 23–24, 25 Yes, 26–27, 28 Yes, 29.
    const at = (spine, child, off = '/1:3') => `epubcfi(/6/${(spine + 1) * 2}!/4/2/${(child + 1) * 2}${off})`;
    const records = [
      { key: 'A', kind: 'position', cfi: at(2, 3) },                  // Two, body: an untouched file
      { key: 'B', kind: 'position', cfi: at(3, 4) },                  // Three, before the cut
      { key: 'C', kind: 'ribbon', cfi: at(3, 10) },                   // folded Four's second paragraph
      { key: 'D', kind: 'ribbon', cfi: at(3, 28, '/1:1') },           // the SECOND "Yes." in the epilogue
      { key: 'E', kind: 'position', cfi: at(3, 8, '/1:2') },          // the "CHAPTER FOUR" line itself
    ];
    const { records: r, sample } = await mapPositions({ oldBytes: orig, newBytes: rep, records, sample: true });
    const by = Object.fromEntries(r.map((x) => [x.key, x]));
    assert.equal(by.A.result, 'kept'); assert.equal(by.A.sameCfi, true);
    assert.equal(by.B.result, 'kept');
    assert.equal(by.C.result, 'mapped'); assert.equal(by.C.newFile, 'EPUB/text/ch006.xhtml'); assert.equal(by.C.newElement, 3); assert.equal(by.C.textMatches, true);
    assert.equal(by.D.result, 'mapped'); assert.equal(by.D.newFile, 'EPUB/text/ch008.xhtml'); assert.equal(by.D.newElement, 7, 'the second "Yes.", not the first');
    assert.equal(by.E.result, 'landed'); assert.equal(by.E.newFile, 'EPUB/text/ch006.xhtml'); assert.equal(by.E.newElement, 0, 'the start of Four, not of the book');
    // W47: a mapped and a landed record each carry a cfi wrapped exactly once.
    for (const k of ['C', 'D', 'E']) {
      assert.ok(wrappedOnce(by[k].newCfi), `${k} (${by[k].result}): ${by[k].newCfi}`);
      assert.match(by[k].newCfi, /^epubcfi\(\/6\/\d+!\/4\/2/, `${k}: one wrapper, then the spine step`);
    }
    assert.equal(sample.missed, 0); assert.equal(sample.mappedTextMismatch, 0);
  });
});

describe('carry-over · a cfi is wrapped exactly once (W47)', () => {
  const ok = 'epubcfi(/6/84!/4/2[thirty-two]/132/1:221)';
  const doubled = `epubcfi(${ok})`;

  test('the rule', () => {
    assert.equal(wrappedOnce(ok), true);
    assert.equal(wrappedOnce('epubcfi(/6/12!/4/2[prologue],/2,/14/1:143)'), true, 'a range cfi');
    assert.equal(wrappedOnce('epubcfi(/6/4!/4/2[a^(b^)]/2/1:0)'), true, 'escaped parentheses in an id');
    for (const bad of [doubled, `epubcfi(epubcfi(${ok}))`, '/6/84!/4/2/132/1:221', 'epubcfi()', 'epubcfi(/6/84', '', null, undefined, 7]) {
      assert.equal(wrappedOnce(bad), false, String(bad));
    }
  });

  test('the guard refuses a write whose cfi is doubled, and passes everything else through', () => {
    const write = (cfi) => ({ action: 'write', why: 'mapped', from: 'pinned old', next: { cfi, fraction: 0.5, epubVersion: 'NEW' } });
    const refused = guardCfi(write(doubled));
    assert.equal(refused.action, 'refuse');
    assert.equal(refused.why, REFUSED_CFI);
    assert.equal(refused.planned, 'mapped');
    const fine = write(ok);
    assert.equal(guardCfi(fine), fine);
    const leave = { action: 'leave', why: 'pinned new' };
    assert.equal(guardCfi(leave), leave, 'a record left alone is never refused, whatever it holds');
  });
});
