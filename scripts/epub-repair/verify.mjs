// PROVE A REPAIR IS CLEAN — the gate a candidate must pass before it is one.
//
//   node scripts/epub-repair/verify.mjs --original <a.epub> --repair <b.epub> --plan <plan.json> \
//        [--epubcheck <epubcheck.jar>]
//
// Exits non-zero on any failure. Prints structure only (entry names, counts, heading labels):
// never a line of the book. All paths must be outside the repo.
//
//   1. every entry the plan may not change is byte-identical, uncompressed; entry order kept
//      with new files straight after the split file; the OPF / nav / NCX differ ONLY by the
//      lines the plan adds (and dcterms:modified, and a renumbered id sequence)
//   2. split: the blocks of the kept file plus the new files, minus their new h1 + opener, are
//      byte-for-byte the original's blocks minus the heading lines. Relabel: undoing the edits
//      restores each edited file exactly
//   3. EPUBCheck (if given) and build-epub's --check report the same on both files
//   4. the folded-headings audit, on the repair
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEntries, sectionBlocks, allowedChanges } from './lib.mjs';
import { outsideRepo, args } from './paths.mjs';
import { verify as buildCheck } from '../build-epub.mjs';
import { analyseEpub } from '../audit-folded-headings.mjs';
import { parseEpub } from '../make-sample-epub.mjs';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Check 1 and 2. Pure. Returns { problems, facts }. */
export function compareEntries(origEntries, repEntries, plan) {
  const problems = [];
  const facts = {};
  const { changed, added } = allowedChanges(origEntries, plan);
  const may = new Set([...changed, ...added]);
  const O = new Map(origEntries.map((e) => [e.name, e.data]));
  const R = new Map(repEntries.map((e) => [e.name, e.data]));

  // Order: the original's, with the added files straight after the split file.
  const expected = [];
  for (const e of origEntries) { expected.push(e.name); if (plan.op === 'split' && e.name === plan.file) expected.push(...added); }
  const got = repEntries.map((e) => e.name);
  if (expected.join('\n') !== got.join('\n')) problems.push('entry order or set differs from the original plus the planned additions');
  if (got[0] !== 'mimetype') problems.push('mimetype is not the first entry');

  let identical = 0;
  for (const [name, data] of O) {
    if (may.has(name)) continue;
    if (!R.has(name)) { problems.push(`${name} is missing`); continue; }
    if (Buffer.compare(data, R.get(name)) === 0) identical++;
    else problems.push(`${name} differs and the plan does not allow it`);
  }
  facts.untouched = { identical, of: [...O.keys()].filter((n) => !may.has(n)).length };
  facts.changed = changed.filter((n) => O.has(n) && Buffer.compare(O.get(n), R.get(n) || Buffer.alloc(0)) !== 0);
  facts.added = added;

  const s = (m, n) => m.get(n)?.toString('utf8') ?? '';
  const epub = parseEpub(O);
  const newIds = plan.op === 'split' ? plan.new.map((n) => n.id) : [];
  const unModified = (x) => x.replace(/(<meta\b[^>]*property="dcterms:modified"[^>]*>)[^<]*(<\/meta>)/, '$1#$2');

  // OPF: drop the lines that name a new id; restore modified; must equal the original.
  const opfR = s(R, epub.opfPath).split('\n').filter((l) => !newIds.some((id) => new RegExp(`\\b(?:id|idref)="${escRe(id)}"`).test(l))).join('\n');
  if (unModified(opfR) !== unModified(s(O, epub.opfPath))) problems.push('OPF differs beyond the planned items, itemrefs and dcterms:modified');
  const mod = /property="dcterms:modified"[^>]*>([^<]*)</.exec(s(R, epub.opfPath));
  if (!mod || mod[1] !== plan.modified) problems.push('dcterms:modified is not the plan\'s value');

  if (plan.op === 'split') {
    // nav + NCX: drop the entries that point at new files; normalise numbered ids; equal.
    const newBase = plan.new.map((n) => n.file.split('/').pop());
    const strip = (x, re) => x.replace(re, (blk) => (newBase.some((b) => blk.includes(`${b}"`)) ? '' : blk));
    const ids = (x) => x.replace(/\bid="([A-Za-z_-]*?)\d+"/g, 'id="$1#"');
    for (const [item, re] of [[epub.navItem, /<li\b[^>]*>\s*<a\b[^>]*>[\s\S]*?<\/a>\s*<\/li>/g],
      [epub.ncxItem, /[ \t]*<navPoint\b[^>]*>(?:(?!<navPoint\b)[\s\S])*?<\/navPoint>\n?/g]]) {
      if (!item) continue;
      if (ids(strip(s(R, item.full), re)) !== ids(s(O, item.full))) problems.push(`${item.href} differs beyond the planned entries and id sequence`);
      const seq = [...s(R, item.full).matchAll(/\bid="([A-Za-z_-]*?)(\d+)"/g)];
      const byPrefix = {};
      for (const m of seq) (byPrefix[m[1]] ||= []).push(Number(m[2]));
      for (const [p, ns] of Object.entries(byPrefix)) if (ns.some((n, i) => i && n !== ns[i - 1] + 1)) problems.push(`${item.href}: ids "${p}N" are not in sequence`);
      const order = newBase.map((b) => s(R, item.full).indexOf(`${b}"`));
      if (order.some((x, i) => x < 0 || (i && x < order[i - 1]))) problems.push(`${item.href}: new entries missing or out of order`);
    }

    // Check 2: the blocks, byte for byte.
    const od = s(O, plan.file);
    const os_ = sectionBlocks(od);
    const heads = new Set(plan.new.map((n) => n.heading));
    const want = os_.blocks.filter((b) => !heads.has(b.text)).map((b) => od.slice(b.start, b.end));
    const kd = s(R, plan.file);
    const ks = sectionBlocks(kd);
    const gotBlocks = ks.blocks.map((b) => kd.slice(b.start, b.end));
    facts.newChapters = [];
    for (const n of plan.new) {
      const d = s(R, n.file);
      const ns = sectionBlocks(d);
      gotBlocks.push(...ns.blocks.slice(2).map((b) => d.slice(b.start, b.end)));
      facts.newChapters.push({ file: n.file, blocks: ns.blocks.length - 2 });
      const closing = od.slice(os_.blocks[os_.blocks.length - 1].end);
      if (!d.endsWith(closing)) problems.push(`${n.file} does not end with the original's closing bytes`);
      if (d.slice(0, ns.open.start) !== od.slice(0, os_.open.start).replace(`<title>${plan.file.split('/').pop()}</title>`, `<title>${n.file.split('/').pop()}</title>`)) problems.push(`${n.file}: head differs from the split file's beyond <title>`);
    }
    facts.blocks = { original: os_.blocks.length, headings: os_.blocks.length - want.length, compared: want.length };
    if (want.length !== gotBlocks.length || want.some((b, i) => b !== gotBlocks[i])) {
      const at = want.findIndex((b, i) => b !== gotBlocks[i]);
      problems.push(`blocks differ (want ${want.length}, got ${gotBlocks.length}, first difference at block ${at})`);
    }
    const closing = od.slice(os_.blocks[os_.blocks.length - 1].end);
    const cutEnd = os_.blocks[os_.blocks.findIndex((b) => heads.has(b.text)) - 1].end;
    if (kd !== od.slice(0, cutEnd) + closing) problems.push(`${plan.file} is not the original's prefix plus its closing bytes`);
    // The bytes themselves, not just the decoded strings.
    if (Buffer.compare(Buffer.from(kd, 'utf8').subarray(0, Buffer.byteLength(od.slice(0, cutEnd))), O.get(plan.file).subarray(0, Buffer.byteLength(od.slice(0, cutEnd)))) !== 0) problems.push(`${plan.file}: kept prefix is not byte-identical`);
  } else {
    for (const f of new Set(plan.edits.map((e) => e.file))) {
      let back = s(R, f);
      for (const e of plan.edits.filter((x) => x.file === f).reverse()) back = back.split(e.replace).join(e.find);
      if (Buffer.compare(Buffer.from(back, 'utf8'), O.get(f)) !== 0) problems.push(`${f}: undoing the edits does not restore the original`);
    }
  }
  return { problems, facts };
}

function epubcheck(jar, bytes, tmp, name) {
  const file = join(tmp, `${name}.epub`);
  const json = join(tmp, `${name}.json`);
  writeFileSync(file, bytes);
  try { execFileSync('java', ['-jar', jar, file, '--json', json], { stdio: 'ignore' }); } catch { /* non-zero on findings; the JSON says what */ }
  const out = JSON.parse(readFileSync(json, 'utf8'));
  return out.messages.map((m) => `${m.severity} ${m.ID}`).sort();
}

async function main() {
  const a = args(process.argv.slice(2), ['original', 'repair', 'plan', 'epubcheck']);
  const ob = await readFile(outsideRepo(a.original, '--original'));
  const rb = await readFile(outsideRepo(a.repair, '--repair'));
  const plan = JSON.parse(await readFile(outsideRepo(a.plan, '--plan'), 'utf8'));
  const report = {};
  const problems = [];

  const c = compareEntries(readEntries(ob), readEntries(rb), plan);
  problems.push(...c.problems);
  report.entries = c.facts;

  // 3. build-epub's check, then EPUBCheck. Problem TEXT can quote the book, so only the heads
  //    of the problems are printed; equality is decided on the whole string.
  const bo = buildCheck(ob).problems;
  const br = buildCheck(rb).problems;
  report.buildCheck = { original: bo.length, repair: br.length, same: JSON.stringify(bo) === JSON.stringify(br), heads: br.map((p) => p.split(/[:\n—]/)[0].slice(0, 70)) };
  if (!report.buildCheck.same) problems.push('build-epub --check differs between original and repair');
  if (a.epubcheck) {
    const tmp = await mkdtemp(join(tmpdir(), 'epub-verify-'));
    try {
      const eo = epubcheck(outsideRepo(a.epubcheck, '--epubcheck'), ob, tmp, 'original');
      const er = epubcheck(a.epubcheck, rb, tmp, 'repair');
      const fresh = er.filter((m) => { const i = eo.indexOf(m); if (i >= 0) { eo.splice(i, 1); return false; } return true; });
      report.epubcheck = { repairMessages: er.length, newMessages: fresh };
      if (fresh.length) problems.push(`EPUBCheck: ${fresh.length} new message(s) on the repair`);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  } else report.epubcheck = 'not run (no --epubcheck)';

  // 4. The audit.
  const au = analyseEpub(rb);
  report.audit = {
    flags: au.flags.length, numbered: au.numbered, median: au.median,
    chapters: au.chapters.length, oversized: au.oversized.map((o) => `${o.label} ${o.ratio}×`),
  };
  if (plan.op === 'split') {
    report.audit.newChapters = plan.new.map((n) => {
      const ch = au.chapters.find((x) => x.file === n.file);
      return { file: n.file, label: ch?.label, words: ch?.words, xMedian: ch ? +(ch.words / au.median).toFixed(2) : null };
    });
    const kept = au.chapters.find((x) => x.file === plan.file);
    report.audit.keptChapter = { file: plan.file, label: kept?.label, words: kept?.words, xMedian: kept ? +(kept.words / au.median).toFixed(2) : null };
  }
  if (au.flags.length) problems.push(`the audit flags ${au.flags.length} paragraph(s) on the repair`);
  if (au.numbered.gaps.length || au.numbered.repeats.length) problems.push('the audit finds a gap or repeat in the numbering');

  console.log(JSON.stringify(report, null, 1));
  if (problems.length) { console.log(`\nNOT CLEAN — ${problems.length} problem(s):`); for (const p of problems) console.log(`  ✗ ${p}`); process.exit(1); }
  console.log('\nCLEAN — every check passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`verify failed to run: ${e.message}`); process.exit(2); });
}
