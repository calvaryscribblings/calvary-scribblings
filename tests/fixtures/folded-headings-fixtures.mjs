// Fixtures for scripts/audit-folded-headings.mjs — invented text, never a real book's.
//
// Built in memory as Buffers (store-only ZIP from scripts/make-sample-epub.mjs), so no EPUB
// file is ever written into the work tree. The markup mirrors the house converter's output:
// a section per spine document, an <h1>, then div.opener (chapters) or div.partpage (parts).

import { zip } from '../../scripts/make-sample-epub.mjs';

const WORDS = 'the lantern keeper walked along the harbour wall counting gulls and boats until evening came'.split(' ');
const prose = (n, seed = 0) => Array.from({ length: n }, (_, i) => WORDS[(i + seed) % WORDS.length]).join(' ');
const para = (n, seed) => `<p>${prose(n, seed)}.</p>`;

const doc = (id, inner) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en-GB">
<head><meta charset="utf-8" /><title>${id}</title></head>
<body epub:type="bodymatter">
<section id="${id}" class="level1">
${inner}
</section>
</body>
</html>`;

const opener = (label) => `<h1>${label}</h1>\n<div class="opener">\n<p class="only">\n${label}\n</p>\n<p class="ofleuron">\n❦\n</p>\n</div>`;
const partpage = (label, title) => `<h1>${label}</h1>\n<div class="partpage">\n<p class="pnum">\n${label.toUpperCase()}\n</p>\n<p class="ptitle">\n${title}\n</p>\n</div>`;

/** A chapter body: `paras` paragraphs of ~60 words, with optional extra <p>s spliced in at `at`. */
const chapterBody = (paras, inserts = []) => {
  const out = [];
  for (let i = 0; i < paras; i++) {
    for (const ins of inserts) if (ins.at === i) out.push(...ins.ps);
    out.push(para(60, i));
  }
  return out.join('\n');
};

function epub(docs) {
  const manifest = docs.map((d) => `<item id="${d.id}" href="text/${d.id}.xhtml" media-type="application/xhtml+xml"${d.props ? ` properties="${d.props}"` : ''}/>`).join('\n');
  const spine = docs.filter((d) => !d.props).map((d) => `<itemref idref="${d.id}"/>`).join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Fixture</dc:title><dc:language>en-GB</dc:language></metadata>
<manifest>
${manifest}
</manifest>
<spine>
${spine}
</spine>
</package>`;
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  return zip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from(container) },
    { name: 'EPUB/content.opf', data: Buffer.from(opf) },
    ...docs.map((d) => ({ name: `EPUB/text/${d.id}.xhtml`, data: Buffer.from(d.html) })),
  ]);
}

const NUMBER_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** Front matter every fixture shares — all of it in the audit's skip list except the nav. */
const front = () => [
  { id: 'nav', props: 'nav', html: doc('toc', '<nav epub:type="toc"><ol><li><a href="ch01.xhtml">One</a></li></ol></nav>') },
  { id: 'title_page', html: doc('title', '<p>Chapter One</p>').replace('class="level1"', 'class="titlepage" epub:type="titlepage"') },
  { id: 'copyright', html: doc('copyright', '<p>Chapter 1</p>') },
  { id: 'contents', html: doc('contents', ['Prologue', 'One', 'Two', 'Chapter 3: The Gull'].map((s) => `<p>${s}</p>`).join('\n')) },
];
const back = () => [{ id: 'colophon', html: doc('colophon', '<p>Epilogue</p>') }];

/**
 * A book of six chapters in two parts, split correctly. `fold` puts the given heading lines
 * into chapter six's body as plain paragraphs — the All Shadows Are Black fault.
 */
function book({ fold = [], dropLast = 0 } = {}) {
  const docs = [...front(), { id: 'part1', html: doc('part-one', partpage('Part One', 'The Shore')) }];
  const count = 6 - dropLast;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // The folded chapters' bodies all land in the last split chapter, which is what makes it long.
    const inserts = last ? fold.map((line, k) => ({ at: 3 + k * 4, ps: [`<p>${line}</p>`] })) : [];
    const paras = last ? 6 + fold.length * 4 : 6;
    docs.push({ id: `ch0${i + 1}`, html: doc(NUMBER_WORDS[i].toLowerCase(), `${opener(NUMBER_WORDS[i])}\n${chapterBody(paras, inserts)}`) });
    if (i === 2) docs.push({ id: 'part2', html: doc('part-two', partpage('Part Two', 'The Town')) });
  }
  docs.push(...back());
  return epub(docs);
}

/** No openers — a plain <h2> per chapter, the Standard Ebooks shape — with chapter three folded into two. */
function headingsBook() {
  const docs = [...front(), { id: 'part1', html: doc('part-1', '<h2>Part I</h2>\n' + chapterBody(3)) }];
  ['I', 'II', 'IV', 'V'].forEach((n, i) => {
    const folded = n === 'II' ? chapterBody(14, [{ at: 6, ps: ['<p>III</p>'] }]) : chapterBody(4);
    docs.push({ id: `chapter-${i + 1}`, html: doc(`chapter-${i + 1}`, `<h2>${n}</h2>\n${folded}`) });
  });
  docs.push(...back());
  return epub(docs);
}

/** Two parts numbered afresh, and in the second a "3" where the "4" should be. Number and title are separate lines. */
function restartsAndMislabel() {
  const titled = (n, t) => `<h1>${n}</h1>\n<div class="opener">\n<p class="cnum">${n}</p>\n<p class="ctitle">${t}</p>\n</div>`;
  const docs = [...front()];
  const nums = ['I', 'II', 'III', 'I', 'II', 'III', 'III', 'V'];
  nums.forEach((n, i) => docs.push({ id: `c${i}`, html: doc(`c${i}`, `${titled(n, 'I Wonder Where')}\n${chapterBody(4)}`) }));
  docs.push(...back());
  return epub(docs);
}

export const FIXTURES = {
  /** Restarted numbering per part, plus one mislabelled opener. */
  restartsAndMislabel,
  /** No openers: the sequence and length checks fall back to headings. */
  foldedNoOpeners: headingsBook,
  /** "CHAPTER THIRTY-TWO" set as a body paragraph. */
  foldedWords: () => book({ fold: ['CHAPTER THIRTY-TWO'] }),
  /** "Chapter 32: The Return" set as a body paragraph. */
  foldedTitled: () => book({ fold: ['Chapter 32: The Return'] }),
  /** Chapters four to six folded into chapter three, as plain lines — six headings' worth. */
  foldedRun: () => book({ dropLast: 3, fold: ['CHAPTER FOUR', 'CHAPTER FIVE', 'CHAPTER SIX'] }),
  /** Correctly split: every heading is an opener, nothing in the body looks like one. */
  clean: () => book(),
};
