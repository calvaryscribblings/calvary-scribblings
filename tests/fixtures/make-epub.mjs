// Deterministic fixture EPUBs for the reader harness.
//
// Written by hand rather than with a zip dependency: an EPUB is a store-only ZIP with the
// mimetype first, which is ~70 lines of Node and no supply chain. The output is
// byte-identical on every run, so the harness has a fixed book to measure against — page
// counts and CFIs are stable, which is the whole point of a geometry fixture.
//
// TWO BOOKS, and they are not interchangeable:
//
//   harness-book.epub        6 chapters x 12 paragraphs — EVEN. At the harness viewport
//                            (400x800, 18px base) it paginates to comfortably more than 10
//                            pages, which is what the tap-zone tests need in order to
//                            sample an early page, a middle page and a late one. Every
//                            existing spec measures against this book, so its bytes are
//                            FROZEN: change nothing above the second builder.
//
//   harness-book-short.epub  R7.3 §D — UNEVEN on purpose. A one-line half-title section and
//                            two three-paragraph chapters sit among long ones, so a page's
//                            width in whole-book fraction terms differs several-fold from
//                            one section to the next and chapter-end pages are slivers.
//                            This is the book that catches minStep-as-ruler: the smallest
//                            step in it belongs to the half-title and describes nowhere
//                            else. Used by page-geometry.spec.mjs.
//
// Run: node tests/fixtures/make-epub.mjs   (the test:reader script does this for you)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── store-only ZIP ────────────────────────────────────────────────────────────
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

// A fixed DOS timestamp keeps the archive byte-stable across runs.
const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2000-01-01

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);   // version needed: 1.0 (store)
    local.writeUInt16LE(0, 6);    // flags
    local.writeUInt16LE(0, 8);    // method: stored
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
    central.writeUInt16LE(20, 4);  // version made by
    central.writeUInt16LE(10, 6);  // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
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

const B = (s) => Buffer.from(s, 'utf8');

// ── the book ──────────────────────────────────────────────────────────────────
const CHAPTERS = [
  'The Harbour at First Light',
  'A Letter Never Posted',
  'What the Ferryman Knew',
  'Salt, and the Long Way Round',
  'The House with Two Doors',
  'Everything the Tide Returns',
];

// Deterministic filler. Every paragraph names its own chapter and index, so an excerpt
// pulled from any page identifies exactly where it came from — which is what makes the
// ribbon round-trip test able to assert on content rather than on length alone.
const WORDS = ('the quiet water held its line against the wall and the morning came over '
  + 'slate roofs without hurry while somewhere below a rope went tight and slack again as '
  + 'though the harbour itself were breathing in its sleep and no one had yet thought to '
  + 'wake it or to ask what the night had carried in on the turning tide').split(' ');

function paragraph(ch, idx) {
  const words = [];
  for (let i = 0; i < 58; i++) words.push(WORDS[(ch * 31 + idx * 7 + i) % WORDS.length]);
  return `Chapter ${ch} paragraph ${idx}. ${words.join(' ')}.`;
}

function chapterDoc(n, title) {
  const paras = [];
  for (let i = 1; i <= 12; i++) paras.push(`    <p>${paragraph(n, i)}</p>`);
  return B(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>${title}</title></head>
  <body>
    <h1 id="ch${n}">${title}</h1>
${paras.join('\n')}
  </body>
</html>
`);
}

const manifest = CHAPTERS.map((_, i) =>
  `    <item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
const spine = CHAPTERS.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n');
const navList = CHAPTERS.map((t, i) =>
  `        <li><a href="ch${i + 1}.xhtml">${t}</a></li>`).join('\n');

const entries = [
  // mimetype MUST be first and stored — every entry here is stored, so that holds.
  { name: 'mimetype', data: B('application/epub+zip') },
  {
    name: 'META-INF/container.xml',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`),
  },
  {
    name: 'OEBPS/content.opf',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:calvary-reader-harness-0001</dc:identifier>
    <dc:title>The Harness Book</dc:title>
    <dc:creator>Calvary Test Press</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`),
  },
  {
    name: 'OEBPS/nav.xhtml',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${navList}
      </ol>
    </nav>
  </body>
</html>
`),
  },
  ...CHAPTERS.map((t, i) => ({ name: `OEBPS/ch${i + 1}.xhtml`, data: chapterDoc(i + 1, t) })),
];

mkdirSync(HERE, { recursive: true });
const out = join(HERE, 'harness-book.epub');
writeFileSync(out, zip(entries));
console.log(`fixture: ${out} (${entries.length} entries, ${CHAPTERS.length} chapters)`);

// ── THE UNEVEN BOOK (R7.3 §D) ─────────────────────────────────────────────────
//
// A separate builder rather than a parameterised one, so the frozen book above cannot
// change by accident: its bytes are what every pre-R7.3 spec measures against.
//
// WHY UNEVENNESS IS THE TEST. foliate's whole-book fraction is SIZE-weighted
// (progress.js:73-83) while pagination is measured in SCREENFULS, so one page of the book
// is worth `(sectionSize / bookSize) / pagesInSection`. In an even book those two terms
// cancel and every section's page is the same width — which is precisely why the even book
// never caught minStep. Break the evenness and they stop cancelling:
//
//   • a one-line half-title occupies a whole PAGE but almost none of the book's WEIGHT, so
//     its page is a fraction of the width of a page anywhere else. minStep latches onto it
//     on the first turn and reports it as the width of every page in the book.
//   • a three-paragraph chapter has the same problem in miniature, and its last page is a
//     sliver of text that still counts as a full page.
//
// THE LEVER IS BYTES PER PAGE, and it has to be pulled hard.
//
// A section's page width in whole-book terms is (sectionBytes / bookBytes) / itsPages,
// i.e. bytesPerPage / bookBytes. So making sections merely SHORT is not enough: a short
// chapter has fewer bytes AND fewer pages, and the two very nearly cancel — measured on the
// first draft of this fixture, an unevenness of 9.4x in section SIZE produced only 1.6x in
// page width, because how much prose fits on a 400x800 screen is roughly fixed.
//
// What actually differs between real EPUBs is MARKUP DENSITY. A page of heavily tagged
// prose — inline emphasis, per-word spans, the sort of thing a converted manuscript is full
// of — weighs several times what the same visible page weighs in clean markup, while
// occupying exactly the same screen. So the fixture mixes the two: `dense` sections carry
// per-word inline markup, plain ones do not, and a one-line half-title carries almost
// nothing at all. That is where minStep goes badly wrong in the wild, and now here.
const UNEVEN = [
  { title: 'Half Title', paras: 0, dense: false },   // one line: a whole page, almost no weight
  { title: 'The Long Crossing', paras: 10, dense: true },
  { title: 'An Interlude', paras: 3, dense: false },
  { title: 'What the Tide Left', paras: 9, dense: true },
  { title: 'A Short Coda', paras: 2, dense: false },
  { title: 'Everything After', paras: 8, dense: true },
];

// Same visible words, ~5x the bytes. `<i>`/`<b>` rather than classed spans so no stylesheet
// is needed and the text still reads as prose on the page.
function densify(text) {
  return text.split(' ')
    .map((w, i) => (i % 2 ? `<i>${w}</i>` : `<b>${w}</b>`))
    .join(' ');
}

function unevenDoc(n, title, paras, dense) {
  const body = [];
  for (let i = 1; i <= paras; i++) {
    const p = paragraph(n, i);
    body.push(`    <p>${dense ? densify(p) : p}</p>`);
  }
  return B(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>${title}</title></head>
  <body>
    <h1 id="s${n}">${title}</h1>
${body.join('\n')}
  </body>
</html>
`);
}

const uManifest = UNEVEN.map((_, i) =>
  `    <item id="s${i + 1}" href="s${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
const uSpine = UNEVEN.map((_, i) => `    <itemref idref="s${i + 1}"/>`).join('\n');
const uNav = UNEVEN.map((s, i) =>
  `        <li><a href="s${i + 1}.xhtml">${s.title}</a></li>`).join('\n');

const unevenEntries = [
  { name: 'mimetype', data: B('application/epub+zip') },
  {
    name: 'META-INF/container.xml',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`),
  },
  {
    name: 'OEBPS/content.opf',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:calvary-reader-harness-uneven-0001</dc:identifier>
    <dc:title>The Uneven Book</dc:title>
    <dc:creator>Calvary Test Press</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${uManifest}
  </manifest>
  <spine>
${uSpine}
  </spine>
</package>
`),
  },
  {
    name: 'OEBPS/nav.xhtml',
    data: B(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${uNav}
      </ol>
    </nav>
  </body>
</html>
`),
  },
  ...UNEVEN.map((s, i) => ({ name: `OEBPS/s${i + 1}.xhtml`, data: unevenDoc(i + 1, s.title, s.paras, s.dense) })),
];

const unevenOut = join(HERE, 'harness-book-short.epub');
writeFileSync(unevenOut, zip(unevenEntries));
const sizes = unevenEntries.filter(e => /s\d+\.xhtml$/.test(e.name)).map(e => e.data.length);
console.log(`fixture: ${unevenOut} (${unevenEntries.length} entries, ${UNEVEN.length} sections, `
  + `section bytes ${sizes.join('/')} — ratio ${(Math.max(...sizes) / Math.min(...sizes)).toFixed(1)}x)`);
