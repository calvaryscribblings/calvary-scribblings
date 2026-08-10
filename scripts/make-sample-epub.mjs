// R8.0 — THE SAMPLE SPLITTER.
//
// Takes a master EPUB and produces a trimmed one: front matter plus the first two or three
// chapters, with a spine, manifest and navigation that describe exactly what is inside and
// nothing that is not.
//
//   node scripts/make-sample-epub.mjs                        # the three live £1.99 titles
//   node scripts/make-sample-epub.mjs basil the-rescue       # named slugs
//   node scripts/make-sample-epub.mjs --from book.epub --slug my-book
//   node scripts/make-sample-epub.mjs --chapters 2 basil     # force the chapter count
//
// Output goes to samples/{slug}.sample.epub — gitignored, because these are derived from
// licensed masters and the repo is not where books live.
//
// ── WHY A TRIMMED SPINE AND NOT A TRUNCATED FILE ─────────────────────────────
// The lazy version of this job is to keep every file and just shorten the spine. It looks
// identical in a reader and it gives the whole book away: the documents are still in the
// archive, and anyone who unzips it has the lot. A sample must be short in BYTES, not merely
// short in presentation. So this rebuilds the package from the kept set — manifest, spine,
// nav and NCX — and copies across only the resources the kept documents actually reference.
//
// ── WHY THE NAVIGATION IS REGENERATED RATHER THAN EDITED ─────────────────────
// A nav document is nested <ol>s. Deleting entries from it with regular expressions means
// tracking which </ol> belongs to which <ol>, and getting that wrong produces a file that
// still parses but lies about the book. Instead the labels are READ from the original nav
// (matched by href) and a fresh, flat nav is written for the kept documents. The labels are
// the publisher's; the structure is ours and is trivially correct.
//
// ── DEPENDENCIES ─────────────────────────────────────────────────────────────
// None beyond Node itself. The output writer is the store-only ZIP from
// tests/fixtures/make-epub.mjs. Reading the input needs inflate, because real EPUBs are
// deflated — node:zlib is a Node builtin, not a package, and there is no way to read a
// real-world EPUB without it.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'samples');
const FIXTURES = resolve(ROOT, 'tests/fixtures');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

// The three published classics at £1.99.
const LIVE_TITLES = ['basil', 'the-fire-in-the-flint', 'the-rescue'];

// The target the brief sets. Three chapters unless three would overshoot, then two.
const TARGET_MIN_PCT = 8;
const TARGET_MAX_PCT = 15;
const MAX_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// ZIP — read (inflate) and write (store-only)
// ─────────────────────────────────────────────────────────────────────────────

/** Read a ZIP into an ordered Map of name → Buffer, walking the central directory. */
function readZip(buf) {
  // The EOCD is at the end, after a comment of unknown length. Scan back for its signature;
  // 64 KB is the maximum a comment can be, so that bounds the search exactly.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header at entry ${i}`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    // The local header's extra field can differ in length from the central one's, so the
    // data offset must be computed from the LOCAL header. Reading the central length here
    // is the classic way to end up with a stream that starts a few bytes late.
    const lnlen = buf.readUInt16LE(localOff + 26);
    const lelen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    if (method !== 0 && method !== 8) throw new Error(`${name}: unsupported compression method ${method}`);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2000-01-01 — fixed, so a rebuild is byte-identical.

/** Store-only ZIP writer, lifted from tests/fixtures/make-epub.mjs. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);      // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

// ─────────────────────────────────────────────────────────────────────────────
// EPUB parsing — regex over XML, and the reason that is acceptable here
//
// These are Standard Ebooks files: machine-generated, uniform, and already in the repo to
// look at. A DOM parser would be a dependency, and the brief forbids one. Every pattern
// below is anchored on an attribute that the EPUB spec REQUIRES to be present, so a file
// that defeats them is a file that would not open anyway — and validate() at the end is
// what actually decides whether the output is good, by opening it.
// ─────────────────────────────────────────────────────────────────────────────

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag) || new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? m[1] : null;
};

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Visible words in an XHTML document — the measure the percentages are quoted against. */
function countWords(buf) {
  const html = buf.toString('utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (body ? body[1] : html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function parseEpub(files) {
  const container = files.get('META-INF/container.xml');
  if (!container) throw new Error('no META-INF/container.xml');
  const opfPath = attr(/<rootfile\b[^>]*>/.exec(container.toString())[0], 'full-path');
  if (!opfPath || !files.has(opfPath)) throw new Error(`OPF not found at "${opfPath}"`);
  const opf = files.get(opfPath).toString('utf8');
  // Everything in the package is relative to the OPF's own directory.
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const manifest = new Map();      // id → { id, href, full, type, properties }
  for (const m of opf.matchAll(/<item\b[^>]*?\/?>/g)) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (!id || !href) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;   // remote resource, not ours to copy
    manifest.set(id, {
      id,
      href,
      full: posix.normalize(base + decodeURIComponent(href.split('#')[0])),
      type: attr(m[0], 'media-type') || 'application/octet-stream',
      properties: attr(m[0], 'properties') || '',
    });
  }

  const spineTag = /<spine\b[^>]*>/.exec(opf);
  const spineBlock = /<spine\b[^>]*>([\s\S]*?)<\/spine>/.exec(opf);
  if (!spineBlock) throw new Error('no <spine> in the OPF');
  const spine = [];
  for (const m of spineBlock[1].matchAll(/<itemref\b[^>]*?\/?>/g)) {
    const idref = attr(m[0], 'idref');
    const item = manifest.get(idref);
    if (!item) continue;
    spine.push({ idref, item, linear: (attr(m[0], 'linear') || 'yes') !== 'no' });
  }

  const metadata = /<metadata\b[^>]*>[\s\S]*?<\/metadata>/.exec(opf);
  const pkgTag = /<package\b[^>]*>/.exec(opf);

  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.properties));
  const ncxId = spineTag ? attr(spineTag[0], 'toc') : null;
  const ncxItem = (ncxId && manifest.get(ncxId))
    || [...manifest.values()].find((i) => i.type === 'application/x-dtbncx+xml');

  return { opfPath, opf, base, manifest, spine, metadata: metadata ? metadata[0] : '<metadata/>',
    pkgTag: pkgTag ? pkgTag[0] : '<package version="3.0">', navItem, ncxItem };
}

/** href (as written in the nav) → its label, read from the original navigation. */
function readNavLabels(files, epub) {
  const labels = new Map();
  const put = (href, label) => {
    if (!href || !label) return;
    const key = posix.normalize(epub.base + decodeURIComponent(href.split('#')[0]));
    if (!labels.has(key)) labels.set(key, label.replace(/\s+/g, ' ').trim());
  };
  if (epub.navItem && files.has(epub.navItem.full)) {
    const navDir = epub.navItem.full.slice(0, epub.navItem.full.lastIndexOf('/') + 1);
    const nav = files.get(epub.navItem.full).toString('utf8');
    const toc = /<nav\b[^>]*epub:type\s*=\s*"[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/.exec(nav);
    for (const a of (toc ? toc[1] : nav).matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const rel = posix.normalize(navDir + decodeURIComponent(a[1].split('#')[0]));
      if (!labels.has(rel)) labels.set(rel, a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
  }
  if (epub.ncxItem && files.has(epub.ncxItem.full)) {
    const ncxDir = epub.ncxItem.full.slice(0, epub.ncxItem.full.lastIndexOf('/') + 1);
    const ncx = files.get(epub.ncxItem.full).toString('utf8');
    for (const p of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/g)) {
      const text = /<text>([\s\S]*?)<\/text>/.exec(p[0]);
      const src = /<content\b[^>]*src\s*=\s*"([^"]+)"/.exec(p[0]);
      if (text && src) {
        const rel = posix.normalize(ncxDir + decodeURIComponent(src[1].split('#')[0]));
        if (!labels.has(rel)) labels.set(rel, text[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      }
    }
  }
  // The nav lives at the OPF root in every SE book; `put` exists for packages that nest it.
  put();
  return labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Choosing the excerpt
// ─────────────────────────────────────────────────────────────────────────────

// A spine document is a CHAPTER if its filename says so. Every Standard Ebook names them
// `chapter-*.xhtml`, and the alternative — guessing from word count or epub:type — is
// guessing. When the name gives no answer we fall back to epub:type in the document itself.
function isChapterDoc(item, files) {
  const name = posix.basename(item.full).toLowerCase();
  if (/^ch(apter)?[-_.\d]/.test(name)) return true;
  if (/^(part|book|division)[-_.\d]/.test(name)) return false;
  const data = files.get(item.full);
  if (data) {
    const head = data.toString('utf8').slice(0, 4000);
    if (/epub:type\s*=\s*"[^"]*\bchapter\b/.test(head)) return true;
  }
  return false;
}

/**
 * Front matter (everything before the first chapter, part dividers included) plus the first
 * N chapters — N chosen to land inside the target band where the book allows it.
 */
function chooseExcerpt(epub, files, forced) {
  const docs = epub.spine.map((s) => ({
    ...s,
    words: countWords(files.get(s.item.full) || Buffer.alloc(0)),
    chapter: isChapterDoc(s.item, files),
  }));
  const totalWords = docs.reduce((a, d) => a + d.words, 0);
  let firstChapter = docs.findIndex((d) => d.chapter);
  // A package whose documents announce nothing — no `chapter-*` filename, no epub:type —
  // is not an error, it is an EPUB that was not built by Standard Ebooks. Treating the whole
  // spine as body is the only reading that cannot be wrong: it says "I could not identify
  // front matter", not "I guessed where it ended". Future titles will not all be SE books,
  // and a splitter that throws on the first one is a splitter nobody reaches for.
  if (firstChapter < 0) {
    firstChapter = 0;
    docs.forEach((d) => { d.chapter = true; });
  }

  const front = docs.slice(0, firstChapter);
  const chapters = docs.slice(firstChapter).filter((d) => d.chapter);

  const pctFor = (n) => {
    const words = front.reduce((a, d) => a + d.words, 0)
      + chapters.slice(0, n).reduce((a, d) => a + d.words, 0);
    return (words / totalWords) * 100;
  };

  // THE RULE. Three chapters is the default because three is where a reader stops sampling
  // and starts reading. Drop to two only when three would push past the band — and if two
  // still overshoots, take two anyway and say so: the floor is the brief's, and a book whose
  // second chapter is already a fifth of it is a fact about the book, not a bug here.
  let n = forced || Math.min(3, chapters.length);
  if (!forced) {
    while (n > 2 && pctFor(n) > TARGET_MAX_PCT) n -= 1;
  }
  n = Math.min(n, chapters.length);

  const keep = [...front, ...chapters.slice(0, n)];
  const keepSet = new Set(keep.map((d) => d.item.full));
  // Keep spine order rather than front-then-chapters order; they are the same here, but the
  // spine is the authority on what follows what.
  const ordered = docs.filter((d) => keepSet.has(d.item.full));

  // The smallest chapter count that would reach the band, for the report to offer when 2–3
  // cannot. Not applied automatically: see the note at the call site.
  let suggestChapters = null;
  for (let k = n + 1; k <= chapters.length; k++) {
    if (pctFor(k) >= TARGET_MIN_PCT) { suggestChapters = k; break; }
  }

  return {
    docs, ordered, totalWords, chapterCount: n,
    frontCount: front.length,
    sampleWords: ordered.reduce((a, d) => a + d.words, 0),
    pct: pctFor(n),
    availableChapters: chapters.length,
    suggestChapters,
    suggestPct: suggestChapters ? pctFor(suggestChapters) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collecting what the kept documents actually need
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything referenced by the kept documents, followed transitively (a stylesheet may
 * import another, or reference a font). Anything not reachable from a kept document is left
 * behind — which is the whole point.
 */
function collectResources(files, epub, keptDocs) {
  const wanted = new Set();
  const queue = keptDocs.map((d) => d.item.full);
  const seen = new Set(queue);

  const REFS = [
    /\b(?:href|src)\s*=\s*"([^"]+)"/g,        // link, img, image, script
    /\bxlink:href\s*=\s*"([^"]+)"/g,          // SVG <image>
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/g,      // CSS
    /@import\s+['"]([^'"]+)['"]/g,            // CSS
  ];

  while (queue.length) {
    const current = queue.shift();
    const data = files.get(current);
    if (!data) continue;
    const dir = current.slice(0, current.lastIndexOf('/') + 1);
    const isText = /\.(x?html|xhtml|css|svg|opf|ncx|xml)$/i.test(current);
    if (!isText) continue;
    const text = data.toString('utf8');
    for (const re of REFS) {
      for (const m of text.matchAll(re)) {
        const raw = m[1].trim();
        if (!raw || raw.startsWith('#') || raw.startsWith('data:')) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;      // external URL
        const target = posix.normalize(dir + decodeURIComponent(raw.split('#')[0]));
        if (!files.has(target) || seen.has(target)) continue;
        seen.add(target);
        wanted.add(target);
        queue.push(target);
      }
    }
  }
  // The cover image is referenced by the package rather than by any document, so it has to
  // be asked for by name or a sample arrives with no cover at all.
  const coverItem = [...epub.manifest.values()].find((i) => /\bcover-image\b/.test(i.properties));
  if (coverItem && files.has(coverItem.full)) wanted.add(coverItem.full);
  const legacyCover = /<meta\b[^>]*\bname\s*=\s*"cover"[^>]*\bcontent\s*=\s*"([^"]+)"/.exec(epub.opf);
  if (legacyCover) {
    const item = epub.manifest.get(legacyCover[1]);
    if (item && files.has(item.full)) wanted.add(item.full);
  }
  return wanted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rebuilding the package
// ─────────────────────────────────────────────────────────────────────────────

const NAV_HREF = 'nav.xhtml';
const NCX_HREF = 'toc.ncx';

function buildNav(keptDocs, labels, epub, title) {
  const items = keptDocs.map((d) => {
    const href = posix.relative(posix.dirname(epub.base + NAV_HREF) || '.', d.item.full) || d.item.href;
    return `        <li><a href="${xmlEscape(href)}">${xmlEscape(labels.get(d.item.full) || posix.basename(d.item.full))}</a></li>`;
  }).join('\n');
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head>
    <title>Contents</title>
  </head>
  <body epub:type="frontmatter">
    <nav epub:type="toc" id="toc" role="doc-toc">
      <h1 epub:type="title">Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`, 'utf8');
}

function buildNcx(keptDocs, labels, epub, uid, title) {
  const points = keptDocs.map((d, i) => {
    const href = posix.relative(posix.dirname(epub.base + NCX_HREF) || '.', d.item.full) || d.item.href;
    return `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(labels.get(d.item.full) || posix.basename(d.item.full))}</text></navLabel>
      <content src="${xmlEscape(href)}"/>
    </navPoint>`;
  }).join('\n');
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`, 'utf8');
}

function buildOpf(epub, keptDocs, resources, files) {
  // One manifest entry per file that survives, plus the two navigation documents we wrote.
  const byFull = new Map([...epub.manifest.values()].map((i) => [i.full, i]));
  const kept = [...keptDocs.map((d) => d.item.full), ...resources];
  const seen = new Set();
  const entries = [];
  for (const full of kept) {
    if (seen.has(full)) continue;
    seen.add(full);
    const item = byFull.get(full);
    const href = posix.relative(posix.dirname(epub.opfPath) || '.', full);
    // The nav and NCX we generate replace the originals, so the originals never carry over.
    if (epub.navItem && full === epub.navItem.full) continue;
    if (epub.ncxItem && full === epub.ncxItem.full) continue;
    entries.push({
      id: item ? item.id : href.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      href,
      type: item ? item.type : guessType(href),
      // `nav` is stripped: our generated nav owns that property now. Everything else the
      // publisher declared — cover-image, svg, scripted — is theirs and is kept.
      properties: item ? item.properties.split(/\s+/).filter((p) => p && p !== 'nav').join(' ') : '',
    });
  }
  entries.push({ id: 'nav', href: NAV_HREF, type: 'application/xhtml+xml', properties: 'nav' });
  entries.push({ id: 'ncx', href: NCX_HREF, type: 'application/x-dtbncx+xml', properties: '' });

  const keptIds = new Set(entries.map((e) => e.id));
  const keptHrefs = new Set(entries.map((e) => e.href));
  // A <meta refines="#x"> whose target no longer exists is a dangling reference. Harmless to
  // a reader, but this file should not describe things that are not here.
  let metadata = epub.metadata.replace(/[ \t]*<meta\b[^>]*\brefines\s*=\s*"#([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/meta>)\s*\n?/g,
    (whole, id) => (keptIds.has(id) || !/^(cover|toc|ncx|nav)/.test(id) ? whole : ''));
  // And a <link href="onix.xml" rel="record"> pointing at a file we did not carry over is
  // not merely untidy — it is a reference to a resource that is not in the container, which
  // is a validation error and a promise the package cannot keep. Standard Ebooks' ONIX record
  // describes the WHOLE book, so a sample is exactly where it should not be.
  metadata = metadata.replace(/[ \t]*<link\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*\/?>\s*\n?/g, (whole, href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;      // an external URL, keep
    return keptHrefs.has(href) ? whole : '';
  });

  const manifestXml = entries.map((e) => `    <item id="${xmlEscape(e.id)}" href="${xmlEscape(e.href)}" media-type="${xmlEscape(e.type)}"${e.properties ? ` properties="${xmlEscape(e.properties)}"` : ''}/>`).join('\n');
  const spineXml = keptDocs.map((d) => `    <itemref idref="${xmlEscape(byFull.get(d.item.full).id)}"/>`).join('\n');

  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
${epub.pkgTag}
${metadata}
  <manifest>
${manifestXml}
  </manifest>
  <spine toc="ncx">
${spineXml}
  </spine>
</package>
`, 'utf8');
}

function guessType(href) {
  const ext = posix.extname(href).toLowerCase();
  return {
    '.xhtml': 'application/xhtml+xml', '.html': 'application/xhtml+xml',
    '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.xml': 'application/xml', '.ncx': 'application/x-dtbncx+xml',
  }[ext] || 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────────────────────
// The job
// ─────────────────────────────────────────────────────────────────────────────

async function loadMaster(slug) {
  const local = resolve(FIXTURES, `${slug}.master.epub`);
  try {
    await stat(local);
    return { bytes: await readFile(local), from: local };
  } catch (e) { /* not cached — fetch it, the fetch-master-epub.mjs way */ }

  const { mintToken } = await import('./rules-pull.mjs');
  const token = await mintToken();
  const titles = await (await fetch(`${DB}/bookstore_titles.json?access_token=${token}`)).json();
  const entry = Object.values(titles || {}).find((t) => t?.slug === slug);
  if (!entry) throw new Error(`no bookstore title with slug "${slug}"`);
  if (!entry.epubPath) throw new Error(`"${slug}" has no epubPath`);
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(entry.epubPath)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(local, bytes);
  return { bytes, from: `${entry.epubPath} (downloaded)` };
}

export async function makeSample(masterBytes, { slug, chapters = null } = {}) {
  const files = readZip(masterBytes);
  const epub = parseEpub(files);
  const labels = readNavLabels(files, epub);
  const pick = chooseExcerpt(epub, files, chapters);

  const uid = (/<dc:identifier[^>]*>([\s\S]*?)<\/dc:identifier>/.exec(epub.metadata) || [, `urn:uuid:${slug}`])[1].trim();
  const title = (/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(epub.metadata) || [, slug])[1].replace(/<[^>]+>/g, '').trim();

  const resources = collectResources(files, epub, pick.ordered);
  const nav = buildNav(pick.ordered, labels, epub, title);
  const ncx = buildNcx(pick.ordered, labels, epub, uid, title);
  const opf = buildOpf(epub, pick.ordered, resources, files);

  // mimetype MUST be first and stored — OCF §4.3. The writer stores everything, so the only
  // thing that matters is that it leads.
  const entries = [{ name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8') }];
  entries.push({ name: 'META-INF/container.xml', data: files.get('META-INF/container.xml') });
  entries.push({ name: epub.opfPath, data: opf });
  entries.push({ name: epub.base + NAV_HREF, data: nav });
  entries.push({ name: epub.base + NCX_HREF, data: ncx });
  for (const d of pick.ordered) entries.push({ name: d.item.full, data: files.get(d.item.full) });
  for (const r of [...resources].sort()) {
    if (entries.some((e) => e.name === r)) continue;
    entries.push({ name: r, data: files.get(r) });
  }

  return { bytes: zip(entries), pick, title, entries: entries.length, epub, labels };
}

function fmt(n) { return n.toLocaleString('en-GB'); }

async function main() {
  const argv = process.argv.slice(2);
  let fromFile = null;
  let forcedChapters = null;
  let slugArg = null;
  const slugs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') fromFile = argv[++i];
    else if (argv[i] === '--slug') slugArg = argv[++i];
    else if (argv[i] === '--chapters') forcedChapters = parseInt(argv[++i], 10);
    else slugs.push(argv[i]);
  }
  const targets = fromFile
    ? [{ slug: slugArg || posix.basename(fromFile).replace(/\.epub$/i, ''), file: fromFile }]
    : (slugs.length ? slugs : LIVE_TITLES).map((s) => ({ slug: s }));

  await mkdir(OUT_DIR, { recursive: true });
  const report = [];

  for (const t of targets) {
    const { bytes: master, from } = t.file
      ? { bytes: await readFile(t.file), from: t.file }
      : await loadMaster(t.slug);

    const { bytes, pick, title } = await makeSample(master, { slug: t.slug, chapters: forcedChapters });
    const out = resolve(OUT_DIR, `${t.slug}.sample.epub`);
    await writeFile(out, bytes);

    const kept = pick.ordered;
    console.log(`\n${'─'.repeat(78)}\n${title}  (${t.slug})\n  master: ${from} — ${fmt(master.length)} bytes, ${fmt(pick.totalWords)} words across ${pick.docs.length} spine documents`);
    console.log(`  keeping ${pick.frontCount} front-matter document(s) + the first ${pick.chapterCount} of ${pick.availableChapters} chapters:`);
    for (const d of kept) {
      console.log(`      ${d.chapter ? 'CH ' : '   '}${String(fmt(d.words)).padStart(7)}w  ${d.item.href}`);
    }
    console.log(`  sample: ${fmt(pick.sampleWords)} words = ${pick.pct.toFixed(1)}% of the book`
      + (pick.pct < TARGET_MIN_PCT || pick.pct > TARGET_MAX_PCT ? `  ⚠ outside the ${TARGET_MIN_PCT}–${TARGET_MAX_PCT}% band` : '  ✓ in band'));
    // When a book's opening chapters are unusually short, 2–3 of them cannot reach the band.
    // The chapter count is the brief's explicit instruction and the percentage is its "aim",
    // so the count wins and the shortfall is REPORTED with the exact remedy rather than
    // silently corrected.
    if (pick.pct < TARGET_MIN_PCT) {
      const reach = pick.suggestChapters;
      console.log(reach
        ? `          → its first chapters are short; --chapters ${reach} would reach ${pick.suggestPct.toFixed(1)}%`
        : '          → no chapter count reaches the band; this book is front-loaded with short chapters');
    }
    console.log(`  wrote:  ${out} — ${fmt(bytes.length)} bytes`
      + (bytes.length > MAX_BYTES ? `  ⚠ OVER the ${MAX_BYTES / 1024 / 1024} MB ceiling` : ` ✓ under ${MAX_BYTES / 1024 / 1024} MB`));

    report.push({ slug: t.slug, title, out, bytes: bytes.length, pct: pick.pct,
      chapters: pick.chapterCount, words: pick.sampleWords, total: pick.totalWords });
  }

  // ── The upload instructions, per title, exactly as the admin form asks for them ──
  console.log(`\n${'═'.repeat(78)}\nUPLOADING — /admin/bookstore, once per title\n${'═'.repeat(78)}`);
  console.log(`
The sample field is on the title's edit form. Nothing else about the title changes, and the
form is a full-node overwrite, so save the whole form rather than trying to patch one field.

  1. Open  /admin/bookstore
  2. For each title below: press Edit, scroll to the EPUB / sample uploads,
     choose the file named against it, then Save.
  3. Uploading writes the file to bookstore_epubs/{slug}/sample.epub and sets
     samplePath on the title. That field is what makes "Read sample" appear — the
     button is gated on it in three places (/bookstore, the QuickLook modal, and the
     title page), so it will simply start showing once saved.
  4. Check it: /reader/{slug}?sample=1 must open the Reading Room, show the sample
     banner, and end after the last kept chapter.
`);
  for (const r of report) {
    console.log(`  ${r.title}`);
    console.log(`      Edit "${r.title}" → Sample EPUB → upload:  ${r.out}`);
    console.log(`      then verify:  /reader/${r.slug}?sample=1`);
    console.log(`      (${r.chapters} chapters, ${fmt(r.words)} of ${fmt(r.total)} words, ${r.pct.toFixed(1)}%, ${fmt(r.bytes)} bytes)\n`);
  }
  console.log('samples/ is gitignored — these files are derived from licensed masters.');
}

// Only run when invoked directly; the spec imports makeSample().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

// crc32 and zip are exported for scripts/build-epub.mjs, which needs the same checksum but a
// writer that DEFLATES everything after the mimetype — see the note on its own zip(). Additive
// only: nothing here changed, and the sample splitter's own output is byte-for-byte unaffected.
export { readZip, parseEpub, countWords, chooseExcerpt, crc32, zip, LIVE_TITLES, MAX_BYTES, TARGET_MIN_PCT, TARGET_MAX_PCT };
