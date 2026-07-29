// Deterministic fixture EPUB for the reader harness.
//
// Written by hand rather than with a zip dependency: an EPUB is a store-only ZIP with the
// mimetype first, which is ~70 lines of Node and no supply chain. The output is
// byte-identical on every run, so the harness has a fixed book to measure against — page
// counts and CFIs are stable, which is the whole point of a geometry fixture.
//
// 6 chapters x 12 paragraphs. At the harness viewport (400x800, 18px base) this paginates
// to comfortably more than 10 pages, which is what the tap-zone tests need in order to
// sample an early page, a middle page and a late one.
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
