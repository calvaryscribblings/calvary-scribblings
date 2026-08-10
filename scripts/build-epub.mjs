// R11.18 — THE HOUSE EPUB BUILDER.
//
// Builds ONE Calvary title from markdown into a shippable EPUB, using the house
// stylesheet at scripts/epub-style.css. It exists because the build did not: until
// now a book was a pandoc line re-typed from notes into an ad-hoc session, which is
// how the house template came to exist in at least two versions of itself with no
// way to tell which one any shipped file was built from.
//
//   node scripts/build-epub.mjs book.md --title "…" --author "…" --cover cover.jpg
//   node scripts/build-epub.mjs book.md --slug my-book --out dist/my-book.epub …
//   node scripts/build-epub.mjs --check some-book.epub      # audit only, builds nothing
//
// ── THIS SCRIPT WILL NOT REBUILD THE CATALOGUE ───────────────────────────────
// One book per invocation, by design, and there is deliberately no --all. A rebuild
// is not free: it bumps the title's version, which drops every reader of that title
// from an exact-position resume to an approximate one and triggers a silent
// re-download. Regenerating the catalogue is a scheduled operation with its own
// preconditions, not a side effect of running a build script. If you want to know
// what the template change WOULD do without doing it, build to a scratch path and
// diff — never over the live file.
//
// ── DEPENDENCIES ─────────────────────────────────────────────────────────────
// pandoc on PATH, and Node. Nothing from npm. The ZIP reader is the one already in
// scripts/make-sample-epub.mjs; see the note on the writer below for why that half
// is not shared.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, basename, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { readZip, parseEpub, crc32 } from './make-sample-epub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = resolve(ROOT, 'scripts/epub-style.css');

const DEFAULT_PUBLISHER = 'Calvary Scribblings';
const DEFAULT_LANG = 'en-GB';
const TOC_DEPTH = 1;

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILD REFUSALS
//
// Three of the template's refusals are pandoc flags rather than CSS, so they live
// here. They are ENFORCED, not merely documented: a build that would violate one
// stops with the reason. The stylesheet's own refusals are in scripts/epub-style.css
// under REFUSALS, and are the other half of this list.
// ─────────────────────────────────────────────────────────────────────────────

// REFUSAL A — NEVER `--epub-title-page=false`.
//   The generated title page is the only page that states, inside the file, what the
//   book is and who published it. A reader who sideloads the EPUB, or opens it in
//   anything that does not show our shop metadata, has nothing else to go on. It is
//   also the page the inline stamp below exists to protect, so switching it off
//   quietly disables that too. Suppressing it is a decision about the artefact, not
//   about the build, and this script does not have the authority to take it.
//
// REFUSAL B — NEVER `--toc` WITHOUT `--toc-depth`.
//   Pandoc's default depth walks down into every subheading it can find, so a book
//   that uses <h2> for scene titles or section numbers gets a contents page listing
//   them all — a table of contents of the inside of chapters. Depth 1 lists the
//   chapters, which is what a contents page is for. The flags must move together;
//   `--toc` alone is the version that silently produces the wrong book.
//
// REFUSAL C — NEVER A BUILD WITHOUT AN EMBEDDED COVER IMAGE.
//   A cover is not decoration: it is what a library grid, a shelf, a sideloaded
//   file listing and every third-party reader use to identify the book. A coverless
//   EPUB is indistinguishable from every other coverless EPUB on the device. There
//   is no --no-cover escape hatch here on purpose.

/** Flags this script refuses to pass through, with the reason printed on refusal. */
const FORBIDDEN_PASSTHROUGH = [
  [/^--epub-title-page(=|$)/, 'REFUSAL A — the title page is not optional. See the note above this list.'],
  [/^--toc-depth(=|$)/, 'REFUSAL B — the contents depth is a house setting; it is not overridable per book.'],
  [/^--css(=|$)/, 'The house stylesheet is the point of this script. Edit scripts/epub-style.css.'],
  [/^(-o|--output)(=|$)/, 'Use --out; the builder needs to know the path in order to repack it.'],
];

// ─────────────────────────────────────────────────────────────────────────────
// THE TITLE PAGE — a check, not a stamp
//
// The build this script recovers post-processed the generated title page with inline
// styles. That step is NOT reproduced here, and the reason it is not is the only
// reason worth having: it was measured rather than believed.
//
//   · pandoc's generated title page LINKS the embedded stylesheet
//     (<link rel="stylesheet" href="../styles/stylesheet1.css"/>), and the embedded
//     copy is byte-identical to scripts/epub-style.css.
//   · the classes pandoc emits on it are exactly titlepage / title / author /
//     publisher / rights, which are exactly the classes the stylesheet targets.
//
// The sheet reaches the element and the selectors match, so an inline duplicate of
// those declarations could only ever agree with the sheet or drift from it. The
// original step therefore had no effect that the sheet does not already have — in
// pandoc 3.1.3's output. What it plausibly guarded against is a FUTURE in which one
// of those two facts stops being true, and that is a thing to detect, not to
// pre-emptively paper over.
//
// So the stamp became this list, asserted on every build. If pandoc renames a class,
// stops linking the sheet, or drops an element, the build fails and names what moved.
// See REFUSAL 6 in scripts/epub-style.css, and reinstate the stamp only with a
// specific reading system named as the reason.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The title-page selectors in scripts/epub-style.css, as {class: required element}.
 * `null` means the stylesheet's selector is not element-qualified and any element does.
 *
 * The ELEMENT matters as much as the class: the sheet says `section.titlepage h1.title`
 * and `p.author`, so pandoc emitting <div class="author"> would leave that rule dead
 * while a class-only check went on reporting a match. Keep in step with the sheet.
 */
const TITLE_PAGE_SELECTORS = {
  titlepage: 'section',
  title: 'h1',
  author: 'p',
  publisher: 'p',
  rights: null,      // sheet says `section.titlepage .rights`; pandoc emits a <div>
};

// ─────────────────────────────────────────────────────────────────────────────
// ZIP writing
//
// The reader (readZip) is imported from make-sample-epub.mjs rather than copied. The
// WRITER is not, and the difference is deliberate: that one stores every entry
// uncompressed, which is right for a sample assembled from an already-compressed
// master, and wrong here — a full novel's XHTML deflates to roughly a third of its
// size, and this is the file every reader downloads. So this writer stores the
// mimetype and deflates the rest. crc32 is shared; there is no second copy of it.
// ─────────────────────────────────────────────────────────────────────────────

const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2000-01-01 — fixed, so two builds of one source are byte-identical.

/**
 * Write a ZIP. `entries[0]` MUST be the mimetype and is always STORED.
 *
 * OCF §4.3: the first entry is `mimetype`, uncompressed, with no extra field. It is
 * how a reading system identifies the file before it has parsed anything, so a
 * container that gets this wrong is not a slightly-wrong EPUB — it is a zip file
 * that some readers decline to open. Any tool that rewrites an EPUB has to close it
 * back up by hand for this reason; `zip -r` over an unpacked directory does not.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const { name, data } = entries[i];
    const store = i === 0 || entries[i].store === true || data.length === 0;
    if (i === 0 && name !== 'mimetype') throw new Error(`first entry must be "mimetype", got "${name}"`);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const body = store ? data : deflateRawSync(data, { level: 9 });
    // Deflate is only worth it if it actually won; a compressed image usually grows.
    const useStore = store || body.length >= data.length;
    const payload = useStore ? data : body;
    const method = useStore ? 0 : 8;
    const version = useStore ? 10 : 20;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // no extra field — required for entry 0, harmless elsewhere
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
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
// Post-processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this document THE title page?
 *
 * Deliberately narrow. The obvious test — does the file contain the string "titlepage" —
 * matches any nav document with an `href="titlepage.xhtml"` in it, and then the builder
 * stamps the contents page and leaves the real title page untouched. (It did exactly that
 * the first time this ran.) So: the marker must be an epub:type or class attribute, on an
 * element that can actually be a title page.
 */
const TITLE_PAGE_MARKER = /<(?:section|div|body)\b[^>]*(?:epub:type|class)\s*=\s*"[^"]*\btitlepage\b[^"]*"/;

/**
 * The parity check that replaced the stamp. Returns what it FOUND, per class, plus
 * whether the document links a stylesheet at all — never a bare pass/fail, because a
 * check that can only say "no" cannot tell you what moved.
 */
function checkTitlePage(html) {
  const found = [];
  const missing = [];
  for (const [cls, wantEl] of Object.entries(TITLE_PAGE_SELECTORS)) {
    const m = new RegExp(`<([a-zA-Z0-9]+)\\b[^>]*class\\s*=\\s*"[^"]*\\b${cls}\\b[^"]*"`).exec(html);
    if (!m) missing.push(`.${cls} (nothing emitted with this class)`);
    else if (wantEl && m[1].toLowerCase() !== wantEl) {
      missing.push(`${wantEl}.${cls} — pandoc emitted <${m[1]}> instead, so that rule is dead`);
    } else found.push(`${m[1]}.${cls}`);
  }
  const links = [...html.matchAll(/<link\b[^>]*rel\s*=\s*"stylesheet"[^>]*>/g)]
    .map((m) => (/\bhref\s*=\s*"([^"]+)"/.exec(m[0]) || [, '?'])[1]);
  return { found, missing, links };
}

/** The build stamp, as an XML comment in the OPF — always valid, and greppable in the wild:
 *    unzip -p book.epub '*.opf' | grep calvary-build   */
function stampOpf(opfXml, stamp) {
  const pkg = /<package\b[^>]*>/.exec(opfXml);
  const comment = `<!-- calvary-build: ${stamp} -->`;
  if (!pkg) return `${comment}\n${opfXml}`;
  return opfXml.replace(pkg[0], `${pkg[0]}\n  ${comment}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification — the postconditions, checked on the bytes we are about to ship
//
// Each check reports WHAT it found, not how many things it counted. A check that can
// only print a number is a check that passes when the thing it is looking for has
// been renamed.
// ─────────────────────────────────────────────────────────────────────────────

const EM_SPACE = ' ';

function verify(bytes, { expectStamp = null } = {}) {
  const problems = [];
  const notes = [];

  // 1. The mimetype entry, read from the raw bytes rather than from a parsed listing —
  //    the whole point of the rule is the first thirty bytes of the file.
  if (bytes.readUInt32LE(0) !== 0x04034b50) problems.push('byte 0 is not a local file header');
  else {
    const method = bytes.readUInt16LE(8);
    const nlen = bytes.readUInt16LE(26);
    const elen = bytes.readUInt16LE(28);
    const name = bytes.toString('utf8', 30, 30 + nlen);
    const data = bytes.toString('utf8', 30 + nlen + elen, 30 + nlen + elen + bytes.readUInt32LE(18));
    if (name !== 'mimetype') problems.push(`first entry is "${name}", must be "mimetype"`);
    if (method !== 0) problems.push(`mimetype is compressed (method ${method}), must be stored`);
    if (elen !== 0) problems.push(`mimetype has a ${elen}-byte extra field, must have none`);
    if (data !== 'application/epub+zip') problems.push(`mimetype content is "${data}"`);
    if (!problems.length) notes.push('mimetype: first, stored, no extra field, correct content');
  }

  const files = readZip(bytes);
  const epub = parseEpub(files);

  // 2. The title page still exists (REFUSAL A), and carries the stamp.
  const titlePages = [...files].filter(([n, d]) => /\.x?html$/i.test(n)
    && TITLE_PAGE_MARKER.test(d.toString('utf8')));
  if (!titlePages.length) problems.push('no title page in the package (REFUSAL A)');
  else {
    const [name, data] = titlePages[0];
    const tp = checkTitlePage(data.toString('utf8'));
    notes.push(`title page: ${name} — links ${tp.links.join(', ') || 'NOTHING'}; matched ${tp.found.join(', ') || 'nothing'}`);
    if (!tp.links.length) problems.push(`${name} links no stylesheet — the front-matter rules are dead there`);
    if (tp.missing.length) problems.push(`title-page selector parity: ${tp.missing.join('; ')}`);
  }

  // 3. A cover image, declared as one (REFUSAL C).
  const cover = [...epub.manifest.values()].find((i) => /\bcover-image\b/.test(i.properties));
  if (!cover) problems.push('no manifest item with properties="cover-image" (REFUSAL C)');
  else if (!files.has(cover.full)) problems.push(`cover declared as ${cover.href} but that file is not in the container`);
  else notes.push(`cover: ${cover.href} (${cover.type}, ${files.get(cover.full).length.toLocaleString('en-GB')} bytes)`);

  // 4. A navigation document.
  if (!epub.navItem) problems.push('no nav document in the manifest');
  else notes.push(`nav: ${epub.navItem.href}`);

  // 5. The house stylesheet is actually in the package. `--css` that silently missed
  //    produces a book that looks like a default pandoc book, which is not obviously
  //    wrong until you put it next to one that is right.
  const css = [...files].filter(([n]) => /\.css$/i.test(n));
  if (!css.length) problems.push('no stylesheet in the package — did --css take effect?');
  else {
    const houseVersion = css.map(([n, d]) => [n, /template version (\d+)/.exec(d.toString('utf8'))])
      .filter(([, m]) => m);
    if (!houseVersion.length) problems.push(`stylesheet(s) present (${css.map(([n]) => n).join(', ')}) but none is the house template — no version header found`);
    else notes.push(`stylesheet: ${houseVersion.map(([n, m]) => `${n} (template v${m[1]})`).join(', ')}`);
  }

  // 6. THE CHARACTER CHECK. A CSS mistake is one template edit; a character mistake is
  //    a regeneration of the catalogue, because character-level typography cannot be
  //    un-decided by a stylesheet on any surface by any reader ever. The house indent
  //    is CSS. Nothing may bake it into the text.
  //
  //    This reports the FILES and the CONTEXT, never just a count.
  const emSpaceHits = [];
  for (const [name, data] of files) {
    if (!/\.x?html$/i.test(name)) continue;
    const text = data.toString('utf8');
    let idx = text.indexOf(EM_SPACE);
    let n = 0;
    while (idx !== -1) {
      n++;
      if (emSpaceHits.length < 5) {
        emSpaceHits.push(`${name}: …${text.slice(Math.max(0, idx - 30), idx + 30).replace(/\s+/g, ' ')}…`);
      }
      idx = text.indexOf(EM_SPACE, idx + 1);
    }
    if (n) emSpaceHits.push(`${name}: ${n} occurrence(s)`);
  }
  if (emSpaceHits.length) {
    problems.push(`U+2003 EM SPACE found in the text — typography baked into the characters:\n      ${emSpaceHits.join('\n      ')}`);
  } else {
    notes.push(`U+2003 EM SPACE: none, across ${[...files].filter(([n]) => /\.x?html$/i.test(n)).length} document(s)`);
  }

  // 7. The build stamp.
  const opfText = files.get(epub.opfPath).toString('utf8');
  const found = /<!--\s*calvary-build:\s*([^>]*?)\s*-->/.exec(opfText);
  if (!found) notes.push('build stamp: ABSENT (built by something other than this script, or before v1)');
  else {
    notes.push(`build stamp: ${found[1]}`);
    if (expectStamp && found[1] !== expectStamp) problems.push(`build stamp is "${found[1]}", expected "${expectStamp}"`);
  }

  return { problems, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// The build
// ─────────────────────────────────────────────────────────────────────────────

function pandocVersion() {
  try {
    const out = execFileSync('pandoc', ['--version'], { encoding: 'utf8' });
    return out.split('\n')[0].trim();
  } catch (e) {
    throw new Error('pandoc is not on PATH. This script shells out to it; there is no fallback.\n'
      + '  Debian/Ubuntu:  sudo apt-get install pandoc\n'
      + '  macOS:          brew install pandoc');
  }
}

async function templateVersion() {
  const css = await readFile(CSS_PATH, 'utf8');
  const m = /template version (\d+)/.exec(css);
  if (!m) throw new Error(`${CSS_PATH} has no "template version N" header — the builder refuses to ship an unversioned template.`);
  return m[1];
}

export async function build(opts) {
  const { source, out, title, author, cover, publisher, lang, rights, extra = [] } = opts;

  // ── Refusals, enforced before anything runs ──
  if (!cover) throw new Error('REFUSAL C — --cover is required. A coverless EPUB is unidentifiable on a shelf.');
  await stat(cover).catch(() => { throw new Error(`cover image not found: ${cover}`); });
  await stat(source).catch(() => { throw new Error(`source not found: ${source}`); });
  for (const arg of extra) {
    for (const [re, why] of FORBIDDEN_PASSTHROUGH) {
      if (re.test(arg)) throw new Error(`refusing "${arg}"\n  ${why}`);
    }
  }

  const version = pandocVersion();
  const tpl = await templateVersion();
  console.log(`  ${version}`);
  console.log(`  template v${tpl} — ${posix.relative(ROOT.replace(/\\/g, '/'), CSS_PATH.replace(/\\/g, '/'))}`);

  const args = [
    '--from=markdown',
    // Explicit, though `-o *.epub` already defaults here: the default has changed once
    // between pandoc majors, and a book's format is not a thing to leave to a default.
    '--to=epub3',
    '--output', out,
    '--css', CSS_PATH,
    '--epub-cover-image', cover,          // REFUSAL C
    '--metadata', `title=${title}`,
    '--metadata', `author=${author}`,
    '--metadata', `lang=${lang}`,
    '--metadata', `publisher=${publisher}`,
    ...(rights ? ['--metadata', `rights=${rights}`] : []),
    '--toc',
    `--toc-depth=${TOC_DEPTH}`,           // REFUSAL B — never one without the other
    ...extra,
    source,
  ];
  // Belt and braces on REFUSAL B: if a future edit above ever separates them, stop here
  // rather than shipping a contents page listing the inside of every chapter.
  if (args.includes('--toc') && !args.some((a) => a.startsWith('--toc-depth'))) {
    throw new Error('REFUSAL B — --toc without --toc-depth. The flags move together.');
  }

  await mkdir(dirname(out), { recursive: true });
  console.log(`\n  pandoc ${args.map((a) => (/[ "]/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
  execFileSync('pandoc', args, { stdio: ['ignore', 'inherit', 'inherit'] });

  const raw = await readFile(out);
  const rawSize = raw.length;

  // ── Post-process ──
  const files = readZip(raw);
  const epub = parseEpub(files);

  let titlePage = null;
  for (const [name, data] of files) {
    if (!/\.x?html$/i.test(name)) continue;
    const html = data.toString('utf8');
    if (!TITLE_PAGE_MARKER.test(html)) continue;
    titlePage = { name, ...checkTitlePage(html) };
    break;
  }
  if (!titlePage) {
    // Not a warning. REFUSAL A guarantees a title page exists; if none was found, pandoc's
    // output shape has changed and the sheet's whole front-matter section is dead.
    throw new Error('no title page found in pandoc\'s output. REFUSAL A says there must be one — '
      + 'pandoc\'s title-page markup has probably changed shape. Fix TITLE_PAGE_MARKER before shipping.');
  }
  console.log(`  title page ${titlePage.name}`);
  console.log(`    stylesheet reaches it: ${titlePage.links.length ? titlePage.links.join(', ') : 'NO <link> AT ALL'}`);
  console.log(`    selectors matched: ${titlePage.found.join(', ') || 'none'}`);
  if (!titlePage.links.length) {
    throw new Error('the generated title page links no stylesheet. Every front-matter rule in '
      + 'epub-style.css is dead on that page, which is the exact condition REFUSAL 6 says to '
      + 'detect rather than paper over with inline styles. Investigate before shipping.');
  }
  if (titlePage.missing.length) {
    throw new Error('title-page selector parity failed — the stylesheet targets things pandoc '
      + `did not emit:\n      ${titlePage.missing.join('\n      ')}\n`
      + '  Either the metadata for them was not supplied (--publisher, --rights), or pandoc\'s\n'
      + '  title-page markup changed. Fix TITLE_PAGE_SELECTORS and epub-style.css together.');
  }

  const stamp = `build-epub.mjs template=v${tpl} ${version.replace(/^pandoc /, 'pandoc=')}`;
  files.set(epub.opfPath, Buffer.from(stampOpf(files.get(epub.opfPath).toString('utf8'), stamp), 'utf8'));

  // ── Repack. mimetype first and stored; container.xml next by convention; the rest in
  //    the order pandoc chose, which is the order its own manifest walks. ──
  const entries = [{ name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8') }];
  if (files.has('META-INF/container.xml')) entries.push({ name: 'META-INF/container.xml', data: files.get('META-INF/container.xml') });
  for (const [name, data] of files) {
    if (name === 'mimetype' || name === 'META-INF/container.xml') continue;
    entries.push({ name, data });
  }
  const bytes = zip(entries);
  await writeFile(out, bytes);

  return { out, bytes, rawSize, stamp, entries: entries.length };
}

function fmt(n) { return n.toLocaleString('en-GB'); }

function report(label, { problems, notes }) {
  console.log(`\n  ${label}`);
  for (const n of notes) console.log(`    ✓ ${n}`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  return problems.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { publisher: DEFAULT_PUBLISHER, lang: DEFAULT_LANG, extra: [] };
  let checkOnly = null;
  let force = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') checkOnly = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--author') opts.author = argv[++i];
    else if (a === '--cover') opts.cover = resolve(argv[++i]);
    else if (a === '--publisher') opts.publisher = argv[++i];
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a === '--rights') opts.rights = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--force') force = true;
    else if (a === '--') opts.extra.push(...argv.slice(i + 1)), i = argv.length;
    else if (a.startsWith('-')) throw new Error(`unknown option "${a}". Pandoc flags go after a bare --.`);
    else positional.push(a);
  }

  if (checkOnly) {
    const bytes = await readFile(resolve(checkOnly));
    console.log(`\n${'═'.repeat(78)}\nCHECK  ${checkOnly} — ${fmt(bytes.length)} bytes\n${'═'.repeat(78)}`);
    const failed = report('postconditions', verify(bytes));
    console.log(failed ? `\n  ${failed} problem(s).\n` : '\n  clean.\n');
    process.exit(failed ? 1 : 0);
  }

  if (positional.length !== 1) {
    throw new Error(positional.length
      ? `one book per invocation — got ${positional.length}. There is no --all; see the header.`
      : 'usage: node scripts/build-epub.mjs <book.md> --title … --author … --cover …');
  }
  opts.source = resolve(positional[0]);
  opts.slug = opts.slug || basename(opts.source).replace(/\.[^.]+$/, '');
  opts.out = opts.out || resolve(ROOT, 'dist', `${opts.slug}.epub`);
  if (!opts.title) throw new Error('--title is required; it is what the book calls itself, not what the file is called.');
  if (!opts.author) throw new Error('--author is required.');

  const exists = await stat(opts.out).then(() => true, () => false);
  if (exists && !force) {
    throw new Error(`${opts.out} already exists.\n`
      + '  Overwriting a shipped title bumps its version: every reader of it loses an exact-position\n'
      + '  resume and re-downloads it silently. Build to a scratch path to compare, or pass --force\n'
      + '  if that cost is one you have actually decided to pay.');
  }

  console.log(`\n${'═'.repeat(78)}\nBUILD  ${opts.title} — ${opts.author}\n${'═'.repeat(78)}`);
  const r = await build(opts);
  console.log(`\n  wrote ${r.out}`);
  console.log(`  ${fmt(r.entries)} entries — ${fmt(r.rawSize)} bytes from pandoc, ${fmt(r.bytes.length)} after repack`);

  const failed = report('postconditions', verify(r.bytes, { expectStamp: r.stamp }));
  if (failed) {
    console.log(`\n  ${failed} problem(s). The file was written; do not ship it.\n`);
    process.exit(1);
  }
  console.log('\n  clean.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
}

export { zip, verify, checkTitlePage, stampOpf, TITLE_PAGE_SELECTORS, CSS_PATH };
