/**
 * THE CONTROL — a real EPUB 3, built from source, byte-identical every run.
 *
 *     node harness/reader/fixture/make-epub.mjs
 *     → harness/reader/fixture/build/fixture.epub   (gitignored)
 *     → harness/reader/fixture/build/tree/…         (the same files, unzipped,
 *                                                    so a human can read what
 *                                                    actually went in)
 *
 * WHY GENERATED. A binary in git is a fixture nobody can review. This one is
 * built from a seeded generator, so the *source of truth* is this file — which
 * is readable in a diff — and the artefact is derived from it.
 *
 * ⚠ CORRECTED 2026-08-10. This block used to say "`fixture.sha256` is committed
 * instead". **THERE IS NO `fixture.sha256`, and there never was.** A comment
 * describing a pin that does not exist is §5b rule 7 again — a description is
 * not evidence — and it was believed twice before anyone ran `ls`.
 *
 * WHAT ACTUALLY PINS IT, and it is stronger than a digest file:
 *
 *   · `harness/reader/fixture/build/` is gitignored — the BUILD output is not
 *     committed;
 *   · `assets/reader/sample.epub` IS committed, because Metro must bundle it
 *     into the binary;
 *   · `scripts/reader-assets.test.mjs` rebuilds the fixture on every `npm test`
 *     and asserts the shipped copy is BYTE-IDENTICAL to it.
 *
 * So the generator and the shipped bytes cannot drift apart without a red test.
 * A digest file would only have caught a change to the artefact; this catches a
 * change to EITHER SIDE, which is the failure that actually happens.
 *
 * ─── AND IT IS THE UNIT OF EXCHANGE WITH THE WEB ──────────────────────────
 *
 * §6h needs both surfaces reading the SAME book. The web does not receive a
 * copied binary — it receives THIS FILE plus `zip.mjs`, runs it, and matches
 * the published sha256. **Byte-identity is then derived rather than
 * transferred:** a copied binary can only be checked against a number someone
 * sent, a generated one is reproduced from the source that defines it.
 *
 *   sha256  cb344c79f7e2abf2d9a6e872a31d81eebdef1c5c0b78518c1a2d5540e2fcbfff
 *   bytes   54981
 *
 * WHAT IT IS SHAPED FOR. Four spine sections of deliberately different
 * lengths, each long enough to paginate to many screens at any sane font size.
 * That shape exists to make three things assertable:
 *
 *   · MANY page turns within one section — liveness with counts.
 *   · SPINE CROSSINGS, at least three of them. This is the exact place the web
 *     reader broke twice: foliate emits an identical `fraction` at a section
 *     boundary while the next section loads, and the web misread that as
 *     end-of-book. A fixture with one section could never have caught it.
 *   · A REAL END, so terminal behaviour is a positive observation and not the
 *     absence of further events.
 *
 * Section 3 is deliberately SHORT — one screen or so. A section that fits in a
 * single page is the degenerate case where "turn the page" and "cross the
 * spine" are the same action, and it is the case a hand-written fixture never
 * happens to include.
 *
 * NO Date.now(), NO Math.random(). Both would break the digest and with it the
 * reason this file exists.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeZip } from './zip.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, 'build')
const TREE = join(BUILD, 'tree')

// ── deterministic prose ────────────────────────────────────────────────────
// A linear congruential generator with a fixed seed. The text is nonsense on
// purpose: real prose invites someone to "fix a typo" in a file whose bytes
// are load-bearing.
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const WORDS =
  `island lantern harbour vellum quill cinder tide chapel ember furrow
   grackle hollow ivory jetty kestrel loam marrow nettle orchard plinth
   quarry rushes sable thicket umber vesper willow yarrow zephyr bracken
   cobble dovecote elder fennel gorse hawthorn inkwell juniper kiln lichen`
    .split(/\s+/)
    .filter(Boolean)

function paragraph(rand, words) {
  const out = []
  for (let i = 0; i < words; i++)
    out.push(WORDS[Math.floor(rand() * WORDS.length)])
  const text = out.join(' ')
  return text[0].toUpperCase() + text.slice(1) + '.'
}

function body(rand, paras, wordsPer) {
  const ps = []
  for (let i = 0; i < paras; i++)
    ps.push(`    <p>${paragraph(rand, wordsPer)}</p>`)
  return ps.join('\n')
}

// ── the sections ───────────────────────────────────────────────────────────
// `paras` chosen so sections 1, 2 and 4 span many screens and section 3 spans
// roughly one. Seeds are fixed per section so editing one does not reflow the
// others — a diff should stay local.
const SECTIONS = [
  { id: 's1', title: 'The Harbour', seed: 1001, paras: 40, wordsPer: 48 },
  { id: 's2', title: 'The Lantern', seed: 2002, paras: 55, wordsPer: 52 },
  { id: 's3', title: 'A Short Crossing', seed: 3003, paras: 2, wordsPer: 26 },
  { id: 's4', title: 'The Vesper Tide', seed: 4004, paras: 45, wordsPer: 50 },
]

function sectionXhtml({ id, title, seed, paras, wordsPer }) {
  const rand = lcg(seed)
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>${title}</title>
    <meta charset="utf-8"/>
  </head>
  <body>
    <h1 id="${id}-h">${title}</h1>
${body(rand, paras, wordsPer)}
  </body>
</html>
`
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

// A FIXED identifier and a FIXED modified date. `dcterms:modified` is required
// by EPUB 3; using a real timestamp here would change the bytes every build.
const PACKAGE = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-4000-8000-000000000001</dc:identifier>
    <dc:title>Story Island Reader Fixture</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Story Island Harness</dc:creator>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${SECTIONS.map((s) => `    <item id="${s.id}" href="${s.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
${SECTIONS.map((s) => `    <itemref idref="${s.id}"/>`).join('\n')}
  </spine>
</package>
`

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head><title>Contents</title><meta charset="utf-8"/></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${SECTIONS.map((s) => `        <li><a href="${s.id}.xhtml">${s.title}</a></li>`).join('\n')}
      </ol>
    </nav>
  </body>
</html>
`

// ── build ──────────────────────────────────────────────────────────────────
// Entry ORDER is part of the contract: `mimetype` must come first and be
// stored, or a strict reader rejects the file. zip.mjs stores everything, so
// the only thing to get right here is the position.
const files = [
  { name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') },
  { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER, 'utf8') },
  { name: 'EPUB/package.opf', data: Buffer.from(PACKAGE, 'utf8') },
  { name: 'EPUB/nav.xhtml', data: Buffer.from(NAV, 'utf8') },
  ...SECTIONS.map((s) => ({
    name: `EPUB/${s.id}.xhtml`,
    data: Buffer.from(sectionXhtml(s), 'utf8'),
  })),
]

export const FIXTURE_ENTRY_NAMES = files.map((f) => f.name)
export const FIXTURE_SECTION_COUNT = SECTIONS.length
export const FIXTURE_PATH = join(BUILD, 'fixture.epub')
export const FIXTURE_TITLE = 'Story Island Reader Fixture'

export function buildFixture() {
  rmSync(BUILD, { recursive: true, force: true })
  mkdirSync(TREE, { recursive: true })

  for (const f of files) {
    const dest = join(TREE, f.name)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.data)
  }

  const zip = makeZip(files)
  writeFileSync(FIXTURE_PATH, zip)
  const sha256 = createHash('sha256').update(zip).digest('hex')
  return { bytes: zip.length, sha256, path: FIXTURE_PATH }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildFixture()
  console.log(`fixture.epub  ${r.bytes} bytes`)
  console.log(`sha256        ${r.sha256}`)
  console.log(`tree          ${TREE}`)
}
