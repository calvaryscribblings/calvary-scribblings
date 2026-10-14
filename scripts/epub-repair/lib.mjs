// REPAIR AN EPUB IN PLACE — split one chapter file, or relabel, without rebuilding the book.
//
// Rebuilding a book from source re-serialises every document, which moves every saved place a
// reader has in it. Repairing it touches only the bytes that are wrong, so every saved place
// outside the repair still resolves to the same text. That is the whole reason this exists:
// see docs/epub-replacement.md.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
// A parser LOCATES boundaries; nothing kept or moved is re-serialised. Every byte of output is
// either a slice of the original or a slice of a pattern the book itself already uses, with a
// label swapped. Strings here are UTF-8 decoded from the original and re-encoded on the way out;
// for valid UTF-8 that round trip is exact, and verify.mjs checks it rather than trusting it.
//
// ── THE PLAN ─────────────────────────────────────────────────────────────────
// Everything book-specific (which file, which heading lines, the new labels and ids) comes from
// a plan file. Plans name real books and quote their headings, so they live OUTSIDE the repo,
// beside the EPUBs they describe. Shapes:
//
//   { "op": "split", "file": "EPUB/text/chNNN.xhtml", "modified": "2026-01-01T00:00:00Z",
//     "chapterPatterns": [{ "file": "...", "label": "..." }, …],   // ≥1 numbered chapter whose
//                                                                    // h1 + opener new files copy
//     "new": [{ "heading": "<exact heading line text>", "file": "...", "id": "<manifest id>",
//               "sectionId": "...", "label": "...",
//               "pattern": { "file": "...", "label": "..." } }, …] }   // optional per-file override
//
//   { "op": "relabel", "modified": "…",
//     "edits": [{ "file": "...", "find": "<exact bytes>", "replace": "<exact bytes>", "count": 1 }] }
//
// The heading lines must be bare paragraphs (<p>TEXT</p>) that are direct children of the
// chapter's <section>; anything else is refused, because a heading with markup on it is a
// judgement call this tool does not make.

import { posix } from 'node:path';
import { readZip, parseEpub } from '../make-sample-epub.mjs';
import { zip } from '../build-epub.mjs';

export class RepairError extends Error {}
const fail = (msg) => { throw new RepairError(msg); };

// ─────────────────────────────────────────────────────────────────────────────
// Entries
// ─────────────────────────────────────────────────────────────────────────────

/** An EPUB as an ordered list of { name, data } — the container's own order. */
export function readEntries(buf) {
  return [...readZip(buf)].map(([name, data]) => ({ name, data }));
}

/** Repack through build-epub's writer: mimetype first and stored, everything else deflated. */
export function writeEntries(entries) {
  if (entries[0]?.name !== 'mimetype') fail('the first entry must be mimetype');
  return zip(entries);
}

const text = (entries, name) => {
  const e = entries.find((x) => x.name === name);
  if (!e) fail(`no entry "${name}"`);
  return e.data.toString('utf8');
};

const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const replaceOnce = (hay, find, repl, what) => {
  const n = count(hay, find);
  if (n !== 1) fail(`${what}: expected exactly one ${JSON.stringify(find)}, found ${n}`);
  return hay.replace(find, () => repl);
};
const norm = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────────────────────────────────────
// The section and its blocks
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z][\w:.-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?(\/?)>/g;

/**
 * The first <section> inside <body>, and its top-level children ("blocks"), as offsets into
 * the document string. Refuses a section with loose text between its children, since a split
 * cannot put such text on either side without a decision.
 *
 *   { open: {start, end, tag}, close: {start, end}, blocks: [{start, end, tag, openTag, text}] }
 */
export function sectionBlocks(doc) {
  const bodyAt = doc.search(/<body\b/i);
  if (bodyAt < 0) fail('no <body>');
  const re = new RegExp(TOKEN.source, 'g');
  re.lastIndex = bodyAt;
  let open = null;
  let m;
  while ((m = re.exec(doc))) {
    if (m[0][1] !== '/' && m[1]?.toLowerCase() === 'section') { open = { start: m.index, end: m.index + m[0].length, tag: m[0] }; break; }
  }
  if (!open) fail('no <section> in <body>');

  const blocks = [];
  let depth = 0;
  let cur = null;
  let gapStart = open.end;
  while ((m = re.exec(doc))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<![CDATA[')) {
      if (depth === 0) fail(`a comment or CDATA sits directly in the section at offset ${m.index}`);
      continue;
    }
    const closing = m[0][1] === '/';
    const selfClosing = m[2] === '/';
    if (depth === 0) {
      const gap = doc.slice(gapStart, m.index);
      if (gap.trim()) fail(`loose text between the section's children at offset ${gapStart}`);
      if (closing) {
        if (m[1].toLowerCase() !== 'section') fail(`unbalanced </${m[1]}> at offset ${m.index}`);
        return { open, close: { start: m.index, end: m.index + m[0].length }, blocks };
      }
      cur = { start: m.index, tag: m[1].toLowerCase(), openTag: m[0] };
      if (selfClosing) { cur.end = m.index + m[0].length; blocks.push(cur); cur = null; gapStart = m.index + m[0].length; continue; }
      depth = 1;
      continue;
    }
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (depth === 0) {
      cur.end = m.index + m[0].length;
      cur.text = norm(doc.slice(cur.start, cur.end));
      blocks.push(cur);
      gapStart = cur.end;
      cur = null;
    }
  }
  return fail('the section never closes');
}

const isBareP = (doc, b) => b.tag === 'p' && /^<p\s*>$/i.test(b.openTag) && !/<(?!\/p>)[^>]+>/.test(doc.slice(b.start + b.openTag.length, b.end - 4));

/**
 * The lead a chapter file opens with: from the end of its <section> tag to its first body
 * block — the h1, the opener, and the whitespace between them, as the book itself wrote them.
 * Returns the lead with the pattern's label replaced by `label`, and the pattern's checks.
 */
export function chapterLead(doc, patternLabel) {
  const s = sectionBlocks(doc);
  const [h1, opener] = s.blocks;
  if (h1?.tag !== 'h1') fail('pattern chapter: the first block is not an <h1>');
  if (opener?.tag !== 'div' || !/\bclass\s*=\s*"[^"]*\bopener\b/.test(opener.openTag)) fail('pattern chapter: the second block is not div.opener');
  if (!s.blocks[2]) fail('pattern chapter: nothing after the opener');
  const lead = doc.slice(s.open.end, s.blocks[2].start);
  const n = count(lead, patternLabel);
  if (n < 1) fail(`pattern chapter: its label ${JSON.stringify(patternLabel)} is not in its h1 or opener`);
  // Any other spelling of the label left behind (lower-case in an id or class, say) would be a
  // pattern-specific value nobody swapped. Refuse rather than guess.
  const residue = lead.split(patternLabel).join('').toLowerCase().includes(patternLabel.toLowerCase());
  if (residue) fail(`pattern chapter: ${JSON.stringify(patternLabel)} appears in another form in the lead; swap it in the plan`);
  return { lead, occurrences: n, template: (label) => lead.split(patternLabel).join(label) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT
// ─────────────────────────────────────────────────────────────────────────────

const lineOf = (s, idx) => {
  const a = s.lastIndexOf('\n', idx) + 1;
  const b = s.indexOf('\n', idx);
  return [a, b < 0 ? s.length : b + 1];
};
const relHref = (fromFile, toFile) => posix.relative(posix.dirname(fromFile), toFile);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Insert a cloned line after the line holding `anchor`, once per new value. */
function cloneLineAfter(s, anchor, clones, what) {
  const at = s.indexOf(anchor);
  if (at < 0 || s.indexOf(anchor, at + 1) >= 0) fail(`${what}: expected exactly one ${JSON.stringify(anchor)}`);
  const [a, b] = lineOf(s, at);
  const line = s.slice(a, b);
  if (!line.endsWith('\n')) fail(`${what}: the anchor line has no newline`);
  return s.slice(0, b) + clones.map((f) => f(line)).join('') + s.slice(b);
}

/**
 * Renumber ids of the form `${prefix}${n}` to run 1-up in document order from the first one's
 * number, IF the original already ran that way. Returns { s, renumbered }.
 */
function renumberSequence(s, prefix) {
  const re = new RegExp(`\\bid="${escRe(prefix)}(\\d+)"`, 'g');
  const found = [...s.matchAll(re)];
  if (!found.length) return { s, renumbered: 0 };
  let next = Number(found[0][1]);
  let renumbered = 0;
  const out = s.replace(re, (m, d) => { const id = `id="${prefix}${next++}"`; if (id !== m) renumbered++; return id; });
  return { s: out, renumbered };
}
const isSequential = (s, prefix) => {
  const ns = [...s.matchAll(new RegExp(`\\bid="${escRe(prefix)}(\\d+)"`, 'g'))].map((m) => Number(m[1]));
  return ns.length > 0 && ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
};

/**
 * Split one chapter file at its folded heading lines. Pure: entries in, entries + a record of
 * every decision out. Throws RepairError on anything it cannot do cleanly.
 */
export function splitChapter(entries, plan) {
  const log = [];
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const epub = parseEpub(files);
  const opfPath = epub.opfPath;
  const doc = text(entries, plan.file);
  const s = sectionBlocks(doc);

  // The heading blocks, each matched exactly once, in order, bare.
  const cuts = plan.new.map((n) => {
    const hits = s.blocks.map((b, i) => (b.text === n.heading ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) fail(`heading ${JSON.stringify(n.heading)}: found ${hits.length} times in ${plan.file}`);
    if (!isBareP(doc, s.blocks[hits[0]])) fail(`heading ${JSON.stringify(n.heading)} is not a bare <p>; not splitting on it`);
    return hits[0];
  });
  cuts.forEach((c, i) => { if (i && c <= cuts[i - 1]) fail('heading lines are not in the order the plan gives'); });
  cuts.forEach((c, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1] : s.blocks.length;
    if (end - c < 2) fail(`heading ${JSON.stringify(plan.new[i].heading)} has nothing under it`);
  });
  if (cuts[0] < 1) fail('the first heading line is the section\'s first block; nothing would stay');

  // Collisions: names, manifest ids, section ids.
  const names = new Set(entries.map((e) => e.name));
  const ids = new Set([...epub.manifest.keys()]);
  const sectionIds = new Set();
  for (const e of entries) if (/\.x?html$/i.test(e.name)) for (const m of e.data.toString('utf8').matchAll(/\sid="([^"]+)"/g)) sectionIds.add(m[1]);
  for (const n of plan.new) {
    if (names.has(n.file)) fail(`new file ${n.file} collides with an existing entry`);
    if (ids.has(n.id)) fail(`manifest id ${n.id} collides`);
    if (sectionIds.has(n.sectionId)) fail(`section id ${n.sectionId} collides with an id already in the book`);
  }
  if (new Set(plan.new.map((n) => n.file)).size !== plan.new.length) fail('two new files share a name');

  // The pattern the new chapter files copy: every listed numbered chapter must give the SAME
  // lead once its label is swapped out, or there is no single pattern to copy.
  const PH = '\u0000LABEL\u0000';
  const leads = plan.chapterPatterns.map((p) => chapterLead(text(entries, p.file), p.label));
  const shapes = new Set(leads.map((l) => l.template(PH)));
  if (shapes.size !== 1) fail('the pattern chapters do not share one h1 + opener shape');
  log.push(`pattern: ${plan.chapterPatterns.map((p) => p.file).join(', ')} share one h1 + opener shape (label appears ${leads[0].occurrences}×)`);

  // The title element: the book sets each chapter's <title> to its own file name. Check that
  // on the patterns rather than assume it, then do the same.
  const titleOf = (d) => (/<title>([^<]*)<\/title>/.exec(d) || [])[1];
  const titleScheme = [plan.file, ...plan.chapterPatterns.map((p) => p.file)]
    .every((f) => titleOf(text(entries, f)) === posix.basename(f));
  if (!titleScheme) fail('chapter files do not title themselves by file name; set the title scheme by hand');
  log.push('title: each chapter file titles itself with its own file name');

  const head = doc.slice(0, s.open.start);
  const sectionIdOf = (tag) => (/\bid="([^"]+)"/.exec(tag) || [])[1];
  const oldSectionId = sectionIdOf(s.open.tag);
  if (!oldSectionId) fail('the split file\'s section has no id');
  const closing = doc.slice(s.blocks[s.blocks.length - 1].end);

  // The new split file: every byte up to the end of the block before the first heading, then
  // the original's closing bytes.
  const kept = doc.slice(0, s.blocks[cuts[0] - 1].end) + closing;
  const out = new Map([[plan.file, kept]]);

  const added = plan.new.map((n, i) => {
    const from = cuts[i] + 1;
    const to = (i + 1 < cuts.length ? cuts[i + 1] : s.blocks.length) - 1;
    const moved = doc.slice(s.blocks[from].start, s.blocks[to].end);
    const lead = n.pattern
      ? chapterLead(text(entries, n.pattern.file), n.pattern.label).template(n.label)
      : leads[0].template(n.label);
    const html = head.replace(`<title>${posix.basename(plan.file)}</title>`, `<title>${posix.basename(n.file)}</title>`)
      + s.open.tag.replace(`id="${oldSectionId}"`, `id="${n.sectionId}"`)
      + lead + moved + closing;
    out.set(n.file, html);
    return { ...n, blocks: to - from + 1 };
  });

  // OPF: manifest items and itemrefs cloned from the split file's own lines.
  let opf = text(entries, opfPath);
  const splitItem = [...epub.manifest.values()].find((it) => it.full === plan.file);
  if (!splitItem) fail(`${plan.file} is not in the manifest`);
  const opfDir = posix.dirname(opfPath);
  const hrefFromOpf = (f) => posix.relative(opfDir === '.' ? '' : opfDir, f);
  opf = cloneLineAfter(opf, `href="${splitItem.href}"`, plan.new.map((n) => (line) => line
    .replace(`id="${splitItem.id}"`, `id="${n.id}"`).replace(`href="${splitItem.href}"`, `href="${hrefFromOpf(n.file)}"`)), 'manifest');
  const itemref = new RegExp(`<itemref\\b[^>]*\\bidref="${escRe(splitItem.id)}"[^>]*>`).exec(opf);
  if (!itemref) fail('the split file has no itemref');
  opf = cloneLineAfter(opf, itemref[0], plan.new.map((n) => (line) => line.replace(`idref="${splitItem.id}"`, `idref="${n.id}"`)), 'spine');
  opf = setModified(opf, plan.modified);
  out.set(opfPath, opf);

  // Contents: nav.xhtml, and toc.ncx when the book has one.
  if (epub.navItem) out.set(epub.navItem.full, addNavEntries(text(entries, epub.navItem.full), epub.navItem.full, plan, log));
  if (epub.ncxItem && files.has(epub.ncxItem.full)) out.set(epub.ncxItem.full, addNcxEntries(text(entries, epub.ncxItem.full), epub.ncxItem.full, plan, log));

  // Entries: original order, new files straight after the split file.
  const result = [];
  for (const e of entries) {
    result.push(out.has(e.name) ? { name: e.name, data: Buffer.from(out.get(e.name), 'utf8') } : e);
    if (e.name === plan.file) for (const n of plan.new) result.push({ name: n.file, data: Buffer.from(out.get(n.file), 'utf8') });
  }
  return { entries: result, added, changed: [...out.keys()], log };
}

function setModified(opf, modified) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(modified || '')) fail('plan.modified must be CCYY-MM-DDThh:mm:ssZ');
  const re = /(<meta\b[^>]*property="dcterms:modified"[^>]*>)([^<]*)(<\/meta>)/;
  if (!re.test(opf)) fail('the OPF has no dcterms:modified');
  return opf.replace(re, (m, a, _v, c) => `${a}${modified}${c}`);
}

function addNavEntries(nav, navFile, plan, log) {
  const href = relHref(navFile, plan.file);
  const li = new RegExp(`<li\\b[^>]*>\\s*<a\\b[^>]*href="${escRe(href)}"[^>]*>[\\s\\S]*?<\\/a>\\s*<\\/li>`).exec(nav);
  if (!li) fail(`nav: no entry for ${href}`);
  if (/<ol\b/.test(li[0])) fail('nav: the entry has children; not inserting beside a nested entry');
  const label = (/<a\b[^>]*>([\s\S]*?)<\/a>/.exec(li[0]) || [])[1];
  const idm = /\bid="([^"]*?)(\d+)"/.exec(li[0]);
  const prefix = idm ? idm[1] : null;
  if (prefix && !isSequential(nav, prefix)) fail(`nav: ids "${prefix}N" do not run in sequence; set them by hand`);
  const clones = plan.new.map((n, i) => li[0]
    .replace(`href="${href}"`, `href="${relHref(navFile, n.file)}"`)
    .replace(`>${label}</a>`, `>${n.label}</a>`)
    .replace(idm ? idm[0] : '\u0000', idm ? `id="${prefix}${idm[2]}-new-${i}"` : ''));
  let out = nav.slice(0, li.index + li[0].length) + clones.join('') + nav.slice(li.index + li[0].length);
  if (prefix) {
    const r = renumberSequence(out.replace(new RegExp(`id="${escRe(prefix)}\\d+-new-\\d+"`, 'g'), `id="${prefix}0"`), prefix);
    out = r.s;
    log.push(`nav: ${plan.new.length} entries after ${href}; ids "${prefix}N" renumbered to stay in sequence (${r.renumbered} changed)`);
  }
  return out;
}

function addNcxEntries(ncx, ncxFile, plan, log) {
  const src = relHref(ncxFile, plan.file);
  const re = new RegExp(`[ \\t]*<navPoint\\b[^>]*>(?:(?!<navPoint\\b)[\\s\\S])*?<content\\b[^>]*src="${escRe(src)}"[^>]*/>\\s*</navPoint>\\n?`);
  const np = re.exec(ncx);
  if (!np) fail(`ncx: no flat navPoint for ${src}`);
  const label = (/<text>([\s\S]*?)<\/text>/.exec(np[0]) || [])[1];
  const idm = /\bid="([^"]*?)(\d+)"/.exec(np[0]);
  const prefix = idm ? idm[1] : null;
  if (prefix && !isSequential(ncx, prefix)) fail(`ncx: ids "${prefix}N" do not run in sequence`);
  const clones = plan.new.map((n, i) => np[0]
    .replace(`src="${src}"`, `src="${relHref(ncxFile, n.file)}"`)
    .replace(`<text>${label}</text>`, `<text>${n.label}</text>`)
    .replace(idm ? idm[0] : '\u0000', idm ? `id="${prefix}${idm[2]}-new-${i}"` : ''));
  let out = ncx.slice(0, np.index + np[0].length) + clones.join('') + ncx.slice(np.index + np[0].length);
  if (prefix) out = renumberSequence(out.replace(new RegExp(`id="${escRe(prefix)}\\d+-new-\\d+"`, 'g'), `id="${prefix}0"`), prefix).s;
  // playOrder only if the NCX uses it: it must stay 1..n in document order.
  if (/\bplayOrder="/.test(out)) {
    let k = 1;
    out = out.replace(/\bplayOrder="\d+"/g, () => `playOrder="${k++}"`);
    log.push('ncx: playOrder renumbered 1..n');
  } else log.push('ncx: no playOrder attributes; none added');
  log.push(`ncx: ${plan.new.length} navPoints after ${src}${prefix ? `; ids "${prefix}N" renumbered` : ''}`);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// RELABEL
// ─────────────────────────────────────────────────────────────────────────────

export function relabel(entries, plan) {
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const { opfPath } = parseEpub(files);
  const out = new Map();
  const log = [];
  for (const ed of plan.edits) {
    const cur = out.get(ed.file) ?? text(entries, ed.file);
    const n = count(cur, ed.find);
    if (n !== ed.count) fail(`${ed.file}: expected ${ed.count} of ${JSON.stringify(ed.find)}, found ${n}`);
    out.set(ed.file, cur.split(ed.find).join(ed.replace));
    log.push(`${ed.file}: ${n}× ${JSON.stringify(ed.find)} → ${JSON.stringify(ed.replace)}`);
  }
  out.set(opfPath, setModified(out.get(opfPath) ?? text(entries, opfPath), plan.modified));
  const result = entries.map((e) => (out.has(e.name) ? { name: e.name, data: Buffer.from(out.get(e.name), 'utf8') } : e));
  return { entries: result, changed: [...out.keys()], log };
}

/** Which entries a plan is allowed to change, and which it adds. */
export function allowedChanges(entries, plan) {
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const epub = parseEpub(files);
  if (plan.op === 'split') {
    return { changed: [plan.file, epub.opfPath, epub.navItem?.full, epub.ncxItem?.full].filter(Boolean), added: plan.new.map((n) => n.file) };
  }
  return { changed: [...new Set([...plan.edits.map((e) => e.file), epub.opfPath])], added: [] };
}

export function applyPlan(entries, plan) {
  if (plan.op === 'split') return splitChapter(entries, plan);
  if (plan.op === 'relabel') return relabel(entries, plan);
  return fail(`unknown op ${plan.op}`);
}
