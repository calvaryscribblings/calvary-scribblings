// CARRY SAVED PLACES ACROSS A REPAIRED FILE — the mapping, dry run only. Nothing is written.
// (W43: the write mode is carry-over.mjs, which calls mapPositions() below.)
//
//   node scripts/epub-repair/map-positions.mjs --old <original.epub> --new <repair.epub> \
//        [--title <titleId>]   read that title's saved positions + ribbons, read-only, as A, B, …
//        [--sample]            also map a point at every third paragraph of the old book
//
// A CFI is coordinates into one file's bytes, so a stored one means nothing in a replacement.
// This finds, for each stored place, the same text in the new file:
//
//   1. resolve the old CFI with foliate's own epubcfi.js against the old OPF and document
//   2. take the block it starts in (p, heading, li, …) and that block's OCCURRENCE among blocks
//      with identical text across the whole spine — so a line that recurs ("Yes.") maps to its
//      own copy, not the first one
//   3. find the same occurrence in the new spine, keep the character offset, and write the CFI
//      with foliate's fromRange — then resolve it back and require the same text
//   4. if the text cannot be found (a heading line the repair removed, say), LAND at the start of
//      the right new chapter: the one the next mappable block went to. Never the start of the book.
//
// Fractions use foliate's own SectionProgress over uncompressed section sizes, as the reader does.
// The fraction inside a section is text-proportional here; the reader's is page-based, so the
// third decimal is an estimate of the reader's, not a promise of it.
//
// Output is structure only: files, element indices, booleans, fractions. Never a line of text.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readZip, parseEpub } from '../make-sample-epub.mjs';
import { outsideRepo, args, ROOT } from './paths.mjs';
import { cfiShape } from './cfi.mjs';

const VENDOR = join(ROOT, 'public/vendor/foliate-js-main');

/** The parts of a book the page needs: OPF, spine documents, sizes, nav labels. Plain data. */
export function bookData(bytes) {
  const files = readZip(bytes);
  const epub = parseEpub(files);
  const spine = epub.spine.map((s) => ({
    file: s.item.full, idref: s.idref, linear: s.linear ? 'yes' : 'no',
    size: files.get(s.item.full)?.length ?? 0, html: files.get(s.item.full)?.toString('utf8') ?? '',
  }));
  const labels = {};
  if (epub.navItem) {
    const navDir = epub.navItem.full.slice(0, epub.navItem.full.lastIndexOf('/') + 1);
    for (const m of files.get(epub.navItem.full).toString('utf8').matchAll(/<a\b[^>]*href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const full = new URL(m[1], `file:///${navDir}`).pathname.slice(1);
      if (!(full in labels)) labels[full] = m[2].replace(/<[^>]+>/g, '').trim();
    }
  }
  return { opf: files.get(epub.opfPath).toString('utf8'), spine, labels };
}

// Runs inside the page. Self-contained: it may only use window.CFI and window.SectionProgress.
function pageMapper({ oldBook, newBook, records, sample }) {
  const { parse, toRange, fromRange, toElement, collapse, fake, joinIndir } = window.CFI;
  const P = new DOMParser();
  const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,td,th,dt,dd';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const load = (b) => {
    const docs = b.spine.map((s) => P.parseFromString(s.html, 'application/xhtml+xml'));
    const index = [];          // every leaf block, spine order: { doc, el, key, ord }
    const seen = new Map();
    docs.forEach((d, di) => {
      for (const el of d.body ? d.body.querySelectorAll(BLOCK) : []) {
        if (el.querySelector(BLOCK)) continue;           // leaf blocks only
        const key = `${el.localName}|${norm(el.textContent)}`;
        const ord = seen.get(key) || 0;
        seen.set(key, ord + 1);
        index.push({ di, el, key, ord });
      }
    });
    const byKey = new Map();
    for (const x of index) (byKey.get(x.key) || byKey.set(x.key, []).get(x.key)).push(x);
    const progress = new window.SectionProgress(b.spine.map((s) => ({ linear: s.linear, size: s.size })), 1500, 1600);
    return { ...b, docs, index, byKey, opfDoc: P.parseFromString(b.opf, 'application/xml'), progress };
  };
  const OLD = load(oldBook);
  const NEW = load(newBook);

  // foliate's Resources#resolveCFI, in substance.
  const resolveIn = (B, cfi) => {
    const parts = parse(cfi);
    const top = (parts.parent ?? parts).shift();
    let it = toElement(B.opfDoc, top);
    if (it && it.nodeName !== 'itemref') { top.at(-1).id = null; it = toElement(B.opfDoc, top); }
    const di = B.spine.findIndex((s) => s.idref === it?.getAttribute('idref'));
    if (di < 0) return { di, range: null };
    let range = null;
    try { range = toRange(B.docs[di], parts); } catch { range = null; }
    return { di, range };
  };
  const textFrom = (range) => {
    if (!range) return null;
    const r = range.cloneRange();
    r.collapse(true);
    const end = r.startContainer.ownerDocument.createRange();
    end.setStart(r.startContainer, r.startOffset);
    end.setEndAfter(r.startContainer.ownerDocument.body.lastChild || r.startContainer);
    return norm(end.toString()).slice(0, 80);
  };
  const blockOf = (n) => { let e = n.nodeType === 1 ? n : n.parentElement; while (e && !(e.matches?.(BLOCK) && !e.querySelector(BLOCK))) e = e.parentElement; return e; };
  const sectionChild = (doc, el) => { const sec = doc.querySelector('section') || doc.body; let e = el; while (e && e.parentElement !== sec) e = e.parentElement; return e ? [...sec.children].indexOf(e) : -1; };
  const offsetIn = (el, node, off) => { const r = el.ownerDocument.createRange(); r.setStart(el, 0); r.setEnd(node, off); return r.toString().length; };
  const pointAt = (el, chars) => {
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; let acc = 0; let last = null;
    while ((n = w.nextNode())) { last = n; if (acc + n.data.length >= chars) { const r = el.ownerDocument.createRange(); r.setStart(n, chars - acc); r.collapse(true); return r; } acc += n.data.length; }
    const r = el.ownerDocument.createRange();
    if (last) r.setStart(last, last.data.length); else r.setStart(el, 0);
    r.collapse(true);
    return r;
  };
  // joinIndir unwraps each part and wraps the join ONCE (epubcfi.js `lift`). Never wrap its
  // result again: W45 wrote epubcfi(epubcfi(…)) that way (W47, scripts/epub-repair/cfi.mjs).
  const cfiFor = (di, range) => joinIndir(fake.fromIndex(di), fromRange(range));
  const fractionOf = (B, di, range) => {
    const body = B.docs[di].body;
    const total = norm(body.textContent).length || 1;
    const before = range ? (() => { const r = B.docs[di].createRange(); r.setStart(body, 0); r.setEnd(range.startContainer, range.startOffset); return norm(r.toString()).length; })() : 0;
    return B.progress.getProgress(di, Math.min(1, before / total)).fraction;
  };
  const chapterStart = (di) => {
    const sec = NEW.docs[di].querySelector('section') || NEW.docs[di].body;
    const first = sec.firstElementChild || sec;
    const r = NEW.docs[di].createRange();
    r.setStart(first, 0);
    r.collapse(true);
    return r;
  };
  // The new home of an old leaf block, by text + occurrence; null if it is not unambiguous.
  const homeOf = (x) => {
    const o = OLD.byKey.get(x.key);
    const n = NEW.byKey.get(x.key);
    if (!n || n.length !== o.length) return null;   // a repeated line gained or lost a copy
    return n[x.ord];
  };

  const map = (cfi) => {
    const point = collapse(cfi);                       // a saved place means its START
    const o = resolveIn(OLD, point);
    if (!o.range) return { result: 'unresolved in old file' };
    // KEEP FIRST. If the stored CFI, whole, still resolves in the new file to the same document
    // and the same text at both ends, it is kept byte-for-byte and only needs re-pinning.
    const keep = (() => {
      const ns = resolveIn(NEW, point);
      const oe = resolveIn(OLD, collapse(cfi, true));
      const ne = resolveIn(NEW, collapse(cfi, true));
      if (!ns.range || !ne.range || NEW.spine[ns.di].file !== OLD.spine[o.di].file) return null;
      if (textFrom(ns.range) !== textFrom(o.range) || textFrom(ne.range) !== textFrom(oe.range)) return null;
      return ns;
    })();
    if (keep) {
      return { result: 'kept', oldFile: OLD.spine[o.di].file, oldElement: sectionChild(OLD.docs[o.di], o.range.startContainer),
        newFile: NEW.spine[keep.di].file, newElement: sectionChild(NEW.docs[keep.di], keep.range.startContainer),
        textMatches: true, roundTrip: true, sameCfi: true, newCfi: cfi,
        oldFractionComputed: fractionOf(OLD, o.di, o.range), newFraction: fractionOf(NEW, keep.di, keep.range),
        oldLabel: OLD.labels[OLD.spine[o.di].file] ?? null, newLabel: NEW.labels[NEW.spine[keep.di].file] ?? null };
    }
    const want = textFrom(o.range);
    const el = blockOf(o.range.startContainer);
    const out = { oldFile: OLD.spine[o.di].file, oldElement: sectionChild(OLD.docs[o.di], el || o.range.startContainer), oldFractionComputed: fractionOf(OLD, o.di, o.range) };
    const x = el ? OLD.index.find((i) => i.el === el) : null;
    const home = x ? homeOf(x) : null;
    let di; let range; let result;
    if (home) {
      di = home.di;
      range = pointAt(home.el, offsetIn(el, o.range.startContainer, o.range.startOffset));
      result = 'mapped';
    } else {
      // Land at the start of the chapter the next mappable block went to (then the previous).
      const at = x ? OLD.index.indexOf(x) : OLD.index.findIndex((i) => i.di === o.di);
      let target = null;
      for (let k = at + 1; k < OLD.index.length && !target; k++) target = homeOf(OLD.index[k]);
      for (let k = at - 1; k >= 0 && !target; k--) target = homeOf(OLD.index[k]);
      if (!target) return { ...out, result: 'missed' };
      di = target.di;
      range = chapterStart(di);
      result = 'landed';
    }
    const newCfi = cfiFor(di, range);
    const back = resolveIn(NEW, newCfi);
    const got = textFrom(back.range);
    return {
      ...out, result,
      newFile: NEW.spine[di].file,
      newElement: sectionChild(NEW.docs[di], blockOf(range.startContainer) || range.startContainer),
      textMatches: result === 'mapped' ? got === want : null,
      roundTrip: back.di === di && !!back.range,
      sameCfi: newCfi === point,
      newFraction: fractionOf(NEW, di, range),
      oldLabel: OLD.labels[OLD.spine[o.di].file] ?? null,
      newLabel: NEW.labels[NEW.spine[di].file] ?? null,
      newCfi,
    };
  };

  // Where the stored CFI lands in EACH file, and the fraction it estimates there. An unpinned
  // record has no other evidence of which copy it was taken in (carry-over.mjs, whichFile).
  const probe = (cfi) => {
    const at = (B) => {
      try {
        const r = resolveIn(B, collapse(cfi));
        return r.range ? { resolves: true, file: B.spine[r.di].file, fraction: fractionOf(B, r.di, r.range) } : { resolves: false };
      } catch { return { resolves: false }; }
    };
    return { old: at(OLD), new: at(NEW) };
  };

  const recs = records.map((r) => {
    let m;
    try { m = map(r.cfi); } catch { m = { result: 'unresolved in old file' }; }
    return { key: r.key, kind: r.kind, storedFraction: r.fraction ?? null, storedLabel: r.label ?? null, probe: probe(r.cfi), ...m };
  });

  let sampled = null;
  if (sample) {
    sampled = { points: 0, kept: 0, mapped: 0, mappedTextMismatch: 0, landed: 0, landings: [], missed: 0, unresolved: 0 };
    OLD.docs.forEach((d, di) => {
      const sec = d.querySelector('section');
      if (!sec) return;
      [...sec.querySelectorAll(':scope > p')].forEach((p, j) => {
        if (j % 3) return;
        const tn = [...p.childNodes].find((c) => c.nodeType === 3 && c.data.trim());
        if (!tn) return;
        const r = d.createRange();
        r.setStart(tn, Math.min(5, tn.data.length));
        r.collapse(true);
        const m = map(cfiFor(di, r));
        sampled.points++;
        if (m.result === 'landed') m.why = (() => { const k = OLD.index.find((i) => i.el === p); return !k ? 'not a leaf block' : !NEW.byKey.get(k.key) ? 'text gone' : 'repeated line changed count'; })();
        if (m.result === 'kept') sampled.kept++;
        else if (m.result === 'mapped') { sampled.mapped++; if (!m.textMatches || !m.roundTrip) sampled.mappedTextMismatch++; }
        else if (m.result === 'landed') { sampled.landed++; sampled.landings.push(`${m.oldFile}#${m.oldElement} → start of ${m.newFile} (${m.why})`); }
        else if (m.result === 'missed') sampled.missed++;
        else sampled.unresolved++;
      });
    });
  }
  return { records: recs, sample: sampled };
}

/** Map records (and optionally a sample) from one EPUB to another. Opens and closes Chromium. */
export async function mapPositions({ oldBytes, newBytes, records = [], sample = false }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const cfi = await readFile(join(VENDOR, 'epubcfi.js'), 'utf8');
    const prog = await readFile(join(VENDOR, 'progress.js'), 'utf8');
    await page.addScriptTag({ type: 'module', content: `${cfi.replace(/^export /gm, '')}\nwindow.CFI = { parse, toRange, fromRange, toElement, collapse, fake, joinIndir };` });
    await page.addScriptTag({ type: 'module', content: `${prog.replace(/^export /gm, '')}\nwindow.SectionProgress = SectionProgress;` });
    await page.waitForFunction(() => window.CFI && window.SectionProgress);
    return await page.evaluate(pageMapper, { oldBook: bookData(oldBytes), newBook: bookData(newBytes), records, sample });
  } finally {
    await browser.close();
  }
}

/** A title's saved positions and ribbons, read-only, labelled A, B, … — never by account. */
export async function liveRecords(titleId) {
  const { mintToken } = await import('../rules-pull.mjs');
  const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
  const token = await mintToken();
  const get = async (p) => (await fetch(`${DB}/${p}.json?access_token=${token}`)).json();
  const out = [];
  for (const r of Object.values((await get('bookstore_reading_progress')) || {})) {
    const v = r?.[titleId];
    if (v?.cfi) out.push({ kind: 'position', cfi: v.cfi, fraction: v.fraction ?? null, pin: v.epubVersion ?? null });
  }
  const pos = out.length;
  for (const bySlug of Object.values((await get('readerBookmarks')) || {})) {
    for (const v of Object.values(bySlug?.[titleId] || {})) if (v?.cfi) out.push({ kind: 'ribbon', cfi: v.cfi, fraction: v.fraction ?? null, label: v.label ?? null });
  }
  const sortBy = (a, b) => (a.cfi < b.cfi ? -1 : a.cfi > b.cfi ? 1 : 0);
  const sorted = [...out.slice(0, pos).sort(sortBy), ...out.slice(pos).sort(sortBy)];
  return sorted.map((r, i) => ({ ...r, key: String.fromCharCode(65 + i) }));
}

async function main() {
  const a = args(process.argv.slice(2), ['old', 'new', 'title', 'sample']);
  const oldBytes = await readFile(outsideRepo(a.old, '--old'));
  const newBytes = await readFile(outsideRepo(a.new, '--new'));
  const records = a.title ? await liveRecords(a.title) : [];
  const res = await mapPositions({ oldBytes, newBytes, records, sample: !!a.sample });
  const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '—');
  for (const r of res.records) {
    // The stored label is the reader's; compare it, never print it beyond a heading label.
    const labelChange = r.kind === 'ribbon' ? (r.storedLabel ?? r.oldLabel) !== r.newLabel : null;
    console.log(`${r.key} ${r.kind}: ${r.result} · ${r.oldFile}#${r.oldElement} → ${r.newFile}#${r.newElement} · text ${r.textMatches === null ? 'n/a' : r.textMatches ? 'matches' : 'DIFFERS'} · round trip ${r.roundTrip ? 'ok' : 'FAILED'} · cfi ${r.sameCfi ? 'unchanged' : 'rewritten'}${r.newCfi ? `, ${cfiShape(r.newCfi)}` : ''} · fraction stored ${f3(r.storedFraction)} / old ${f3(r.oldFractionComputed)} → new ${f3(r.newFraction)}${labelChange === null ? '' : ` · label ${labelChange ? `changes ("${r.storedLabel ?? r.oldLabel}" → "${r.newLabel}")` : 'unchanged'}`}`);
  }
  if (res.sample) console.log(`sample: ${JSON.stringify(res.sample)}`);
  console.log('dry run: nothing was written.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`map failed: ${e.message}`); process.exit(2); });
}
