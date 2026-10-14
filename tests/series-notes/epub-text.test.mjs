// W46 — app/lib/series/epubText.js: a minimal ZIP reader and the EPUB spine walk, in plain JS
// with DecompressionStream('deflate-raw') — the same code path workerd runs. The EPUBs are built
// IN THIS FILE with node:zlib, so the test owns every byte it reads.
//
//   npm run test:series-notes
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';

import { epubPlainText, readZipDirectory, readZipEntry, stripXhtml, TEXT_CAP } from '../../app/lib/series/epubText.js';

/** A ZIP from [{ name, text, method }] — method 0 stored, 8 deflate. Optional trailing comment. */
function zip(entries, { comment = '' } = {}) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, text, method = 8 } of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(loc, n, data); centrals.push(cen, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const c = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cd, end, c]);
}

const container = (opf) => `<?xml version="1.0"?><container version="1.0"><rootfiles><rootfile media-type="application/oebps-package+xml" full-path='${opf}'/></rootfiles></container>`;
const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignore me</title><style>p{}</style></head><body>${body}</body></html>`;

function epub({ spine = ['c2', 'c1'], chapters = {}, extra = [], comment = '' } = {}) {
  const items = Object.keys(chapters).map((id) => `<item id="${id}" href="text/${id}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  return zip([
    { name: 'mimetype', text: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', text: container('OPS/package.opf') },
    { name: 'OPS/package.opf', text: `<package><manifest>${items}<item href="nav.xhtml" id="nav" properties="nav"/></manifest><spine toc="ncx">${spine.map((s) => `<itemref idref="${s}"/>`).join('')}</spine></package>` },
    ...Object.entries(chapters).map(([id, body]) => ({ name: `OPS/text/${id}.xhtml`, text: xhtml(body) })),
    ...extra,
  ], { comment });
}

describe('W46 · epubText', () => {
  test('reads the central directory of a stored + deflated zip', async () => {
    const z = zip([{ name: 'a.txt', text: 'stored', method: 0 }, { name: 'b.txt', text: 'deflated '.repeat(50), method: 8 }]);
    const dir = readZipDirectory(z);
    assert.deepEqual([...dir.keys()], ['a.txt', 'b.txt']);
    assert.equal(dir.get('a.txt').method, 0);
    assert.equal(dir.get('b.txt').method, 8);
    assert.equal(new TextDecoder().decode(await readZipEntry(z, dir.get('a.txt'))), 'stored');
    assert.equal(new TextDecoder().decode(await readZipEntry(z, dir.get('b.txt'))), 'deflated '.repeat(50));
  });

  test('a trailing zip comment does not hide the end record', () => {
    const z = zip([{ name: 'a.txt', text: 'x' }], { comment: 'PK\u0005\u0006 decoy in the comment? no — just text' });
    assert.deepEqual([...readZipDirectory(z).keys()], ['a.txt']);
  });

  test('walks container → OPF → spine, in SPINE order, stripping markup and entities', async () => {
    const book = epub({
      spine: ['c2', 'c1'],
      chapters: {
        c1: '<h1>One</h1><p>Ama &amp; Kofi counted the boats&#8212;twice.</p><script>alert(1)</script>',
        c2: '<p>It began with rain &rsquo;n&rsquo; salt&nbsp;air.</p>',
      },
    });
    const text = await epubPlainText(book);
    assert.equal(text, 'It began with rain ’n’ salt air.\n\nOne Ama & Kofi counted the boats—twice.');
    assert.doesNotMatch(text, /Ignore me|alert/);
  });

  test('caps the text at TEXT_CAP (150,000 by default), and at a smaller max when asked', async () => {
    assert.equal(TEXT_CAP, 150_000);
    const long = 'word '.repeat(20_000); // ~100k chars per chapter
    const book = epub({ spine: ['c1', 'c2', 'c3'], chapters: { c1: `<p>${long}</p>`, c2: `<p>${long}</p>`, c3: `<p>${long}</p>` } });
    const text = await epubPlainText(book);
    assert.equal(text.length, TEXT_CAP);
    assert.equal((await epubPlainText(book, { max: 1000 })).length, 1000);
  });

  test('a href with ../ and percent-encoding resolves', async () => {
    const z = zip([
      { name: 'META-INF/container.xml', text: container('OPS/pkg/package.opf') },
      { name: 'OPS/pkg/package.opf', text: '<package><manifest><item id="x" href="../text/my%20chapter.xhtml#top"/></manifest><spine><itemref idref="x"/></spine></package>' },
      { name: 'OPS/text/my chapter.xhtml', text: xhtml('<p>Found it.</p>') },
    ]);
    assert.equal(await epubPlainText(z), 'Found it.');
  });

  test('stripXhtml drops head, style, script and decodes numeric entities', () => {
    assert.equal(stripXhtml('<head><title>t</title></head><p>a&#x2019;b &#65;</p>'), 'a’b A');
    assert.equal(stripXhtml('<p>&unknown; stays</p>'), '&unknown; stays');
  });

  test('refuses what it does not understand: not a zip, no container, no spine, an unknown method', async () => {
    await assert.rejects(epubPlainText(Buffer.from('not a zip at all, definitely not')), /not a zip/);
    await assert.rejects(epubPlainText(zip([{ name: 'a.txt', text: 'x' }])), /container/);
    await assert.rejects(epubPlainText(zip([
      { name: 'META-INF/container.xml', text: container('p.opf') },
      { name: 'p.opf', text: '<package><manifest/></package>' },
    ])), /spine/);
    const z = zip([{ name: 'a.txt', text: 'x', method: 0 }]);
    const dir = readZipDirectory(z);
    await assert.rejects(readZipEntry(z, { ...dir.get('a.txt'), method: 12 }), /method 12/);
    await assert.rejects(readZipEntry(z, { ...dir.get('a.txt'), size: 64 * 1024 * 1024 }), /too large/);
  });
});
