// Fixtures for scripts/epub-repair/ — invented text, never a real book's.
//
// Built in memory (no EPUB is written to the work tree) in the shape the house converter emits:
// pandoc file names, a <section> per document, an <h1> and a div.opener per chapter, a flat nav
// with sequential li ids, and an NCX with sequential navPoint ids.

import { zip } from '../../scripts/build-epub.mjs';

const W = 'the ferryman counted lanterns along the quay while the tide turned slowly under grey skies'.split(' ');
const prose = (n, seed) => `<p>${Array.from({ length: n }, (_, i) => W[(i * 7 + seed) % W.length]).join(' ')}.</p>`;

const head = (file) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en-GB" xml:lang="en-GB">
<head>
  <meta charset="utf-8" />
  <title>${file}</title>
  <link rel="stylesheet" type="text/css" href="../styles/s.css" />
</head>
<body epub:type="bodymatter">
`;
const tail = '\n</section>\n</body>\n</html>\n';
const opener = (label) => `<h1>${label}</h1>\n<div class="opener">\n<p class="only">\n${label}\n</p>\n<p class="ofleuron">\n❦\n</p>\n</div>\n`;
const numbered = (num, title) => `<h1>${title}</h1>\n<div class="opener">\n<p class="onum">\n${num}\n</p>\n<p class="otitle">\n${title}\n</p>\n</div>\n`;
const chapter = (file, id, lead, body) => `${head(file)}<section id="${id}" class="level1">\n${lead}${body.join('\n')}${tail}`;

function book(docs, { title = 'Fixture' } = {}) {
  const items = docs.map((d) => `    <item id="${d.file.replace('.', '_')}" href="text/${d.file}" media-type="application/xhtml+xml" />\n`).join('');
  const refs = docs.map((d) => `    <itemref idref="${d.file.replace('.', '_')}" />\n`).join('');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en-GB</dc:language>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="s" href="styles/s.css" media-type="text/css" />
${items}  </manifest>
  <spine toc="ncx">
${refs}  </spine>
</package>
`;
  const lis = docs.map((d, i) => `<li id="toc-li-${i + 1}"><a href="text/${d.file}">${d.label}</a></li>`).join('');
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en-GB">
<head><meta charset="utf-8" /><title>${title}</title></head>
<body epub:type="frontmatter">
<nav epub:type="toc" id="toc"><h1 id="toc-title">${title}</h1><ol class="toc">${lis}</ol></nav>
</body>
</html>
`;
  const nps = docs.map((d, i) => `    <navPoint id="navPoint-${i + 1}">\n      <navLabel>\n        <text>${d.label}</text>\n      </navLabel>\n      <content src="text/${d.file}" />\n    </navPoint>\n`).join('');
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:uuid:00000000-0000-4000-8000-000000000000" />
  </head>
  <docTitle>
    <text>${title}</text>
  </docTitle>
  <navMap>
${nps}  </navMap>
</ncx>
`;
  return zip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'EPUB/content.opf', data: Buffer.from(opf) },
    { name: 'EPUB/nav.xhtml', data: Buffer.from(nav) },
    { name: 'EPUB/toc.ncx', data: Buffer.from(ncx) },
    ...docs.map((d) => ({ name: `EPUB/text/${d.file}`, data: Buffer.from(d.html) })),
    { name: 'EPUB/styles/s.css', data: Buffer.from('p { margin: 0 }\n') },
    { name: 'META-INF/container.xml', data: Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
  ]);
}

const body = (n, seed) => Array.from({ length: n }, (_, i) => prose(30 + ((i * 11) % 25), seed + i));

/**
 * A book whose last chapter swallowed the two after it and the epilogue: "CHAPTER FOUR",
 * "CHAPTER FIVE" and "EPILOGUE" sit as bare paragraphs inside ch004.xhtml ("Three"). A short
 * line, "Yes.", recurs — once in Two and twice in the folded epilogue — so occurrence matters.
 */
export function foldedBook({ headingMarkup = (t) => `<p>${t}</p>` } = {}) {
  const three = [
    ...body(6, 30),
    headingMarkup('CHAPTER FOUR'), ...body(5, 40),
    headingMarkup('CHAPTER FIVE'), ...body(7, 50),
    headingMarkup('EPILOGUE'), ...body(2, 60), '<p>Yes.</p>', ...body(2, 61), '<p>Yes.</p>', ...body(1, 62),
  ];
  return book([
    { file: 'ch001.xhtml', label: 'Prologue', html: chapter('ch001.xhtml', 'prologue', opener('Prologue'), body(4, 1)) },
    { file: 'ch002.xhtml', label: 'One', html: chapter('ch002.xhtml', 'one', opener('One'), body(6, 10)) },
    { file: 'ch003.xhtml', label: 'Two', html: chapter('ch003.xhtml', 'two', opener('Two'), [...body(3, 20), '<p>Yes.</p>', ...body(3, 21)]) },
    { file: 'ch004.xhtml', label: 'Three', html: chapter('ch004.xhtml', 'three', opener('Three'), three) },
    { file: 'ch005.xhtml', label: 'Colophon', html: chapter('ch005.xhtml', 'colophon', '<h1>Colophon</h1>\n', ['<p>Set for the fixture.</p>']) },
  ]);
}

export const SPLIT_PLAN = () => ({
  op: 'split',
  file: 'EPUB/text/ch004.xhtml',
  modified: '2026-10-14T12:00:00Z',
  chapterPatterns: [{ file: 'EPUB/text/ch003.xhtml', label: 'Two' }, { file: 'EPUB/text/ch004.xhtml', label: 'Three' }],
  new: [
    { heading: 'CHAPTER FOUR', file: 'EPUB/text/ch006.xhtml', id: 'ch006_xhtml', sectionId: 'four', label: 'Four' },
    { heading: 'CHAPTER FIVE', file: 'EPUB/text/ch007.xhtml', id: 'ch007_xhtml', sectionId: 'five', label: 'Five' },
    { heading: 'EPILOGUE', file: 'EPUB/text/ch008.xhtml', id: 'ch008_xhtml', sectionId: 'epilogue', label: 'Epilogue',
      pattern: { file: 'EPUB/text/ch001.xhtml', label: 'Prologue' } },
  ],
});

/** A book whose third chapter's opener says "II" — and whose printed contents says so too. */
export function mislabelledBook() {
  const titles = ['First Light', 'The Quay', 'Low Water', 'Home'];
  const nums = ['I', 'II', 'II', 'IV'];
  const contents = titles.map((t, i) => `<p>${nums[i]} ${t}</p>`);
  return book([
    { file: 'ch001.xhtml', label: 'Contents', html: chapter('ch001.xhtml', 'contents', '<h1>Contents</h1>\n', contents) },
    ...titles.map((t, i) => ({ file: `ch00${i + 2}.xhtml`, label: t, html: chapter(`ch00${i + 2}.xhtml`, t.toLowerCase().replace(/ /g, '-'), numbered(nums[i], t), body(5, i * 9)) })),
  ]);
}

export const RELABEL_PLAN = () => ({
  op: 'relabel',
  modified: '2026-10-14T12:00:00Z',
  edits: [
    { file: 'EPUB/text/ch004.xhtml', find: '<p class="onum">\nII\n</p>', replace: '<p class="onum">\nIII\n</p>', count: 1 },
    { file: 'EPUB/text/ch001.xhtml', find: '<p>II Low Water</p>', replace: '<p>III Low Water</p>', count: 1 },
  ],
});
