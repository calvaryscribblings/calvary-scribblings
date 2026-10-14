// AN EPUB'S PLAIN TEXT, IN THE WORKER — W46, for draft-questions (ruling 164).
//
// The admin's "Draft three from the text" asks the quiz's model for three questions about an
// instalment. The model needs the words; the words are in series_epubs/{id}/master.epub, which
// storage.rules keeps at `allow read: if false` for every client, founders included. So the
// endpoint (functions/api/series/notes.js) downloads the bytes with the service account and
// this module turns them into text — on workerd, where there is no JSZip, no Node `zlib`, and
// no appetite for a new dependency in the one Pages Function bundle.
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────────────────────
//
// A minimal ZIP reader and the same container.xml → OPF → manifest → spine walk that
// app/lib/epubExtract.js does with JSZip in the browser:
//
//   1. find the End Of Central Directory record (scanning back from the end, because a ZIP
//      comment may follow it);
//   2. read the central directory — the authoritative list of entries, with their compressed
//      sizes. Local headers are only trusted for their own name/extra lengths, because a
//      streamed entry (general-purpose flag bit 3) carries zeros there;
//   3. inflate each entry we need: method 0 is stored, method 8 is raw DEFLATE through
//      `new DecompressionStream('deflate-raw')`, which workerd and Node ≥ 18 both provide.
//
// What it is NOT: ZIP64 (an instalment is a few hundred KB), encryption, or any compression
// method but stored and deflate. Each of those THROWS rather than guessing — the caller
// answers "couldn't read the instalment", and an editor writes the questions by hand.
//
// ── THE CAP ──────────────────────────────────────────────────────────────────────────────
//
// TEXT_CAP (~150,000 characters, roughly a 25,000-word instalment) bounds the prompt, and so
// the cost of one draft. The walk stops inflating spine items once it is reached. A separate
// ENTRY_CAP refuses any single entry that declares more than 16 MB uncompressed, so a crafted
// file cannot make the Worker inflate a bomb before the text cap is ever consulted.
//
// Pure: bytes in, string out. It performs no I/O and is tested in node
// (tests/series-notes/epub-text.test.mjs) against a ZIP built in the test with node:zlib.

export const TEXT_CAP = 150_000;
const ENTRY_CAP = 16 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('epubText: expected bytes');
}

/**
 * The entries of a ZIP, by name: Map<name, { method, compSize, size, localOffset, flags }>.
 * Throws on anything this reader does not understand.
 */
export function readZipDirectory(input) {
  const b = toBytes(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 22) throw new Error('epubText: not a zip (too short)');

  // The EOCD is 22 bytes plus a comment of up to 65,535 — so it starts somewhere in the last
  // 65,557 bytes. The comment can itself contain the signature's bytes, so a candidate counts
  // only if its own comment length runs exactly to the end of the file.
  let eocd = -1;
  const floor = Math.max(0, b.length - 65_557);
  for (let i = b.length - 22; i >= floor; i--) {
    if (v.getUint32(i, true) === SIG_EOCD && i + 22 + v.getUint16(i + 20, true) === b.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('epubText: not a zip (no end of central directory)');

  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('epubText: ZIP64 is not supported');
  }
  if (cdOffset + cdSize > b.length) throw new Error('epubText: central directory out of range');

  const dec = new TextDecoder('utf-8');
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== SIG_CEN) throw new Error('epubText: bad central directory entry');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const compSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, size, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One entry's uncompressed bytes. */
export async function readZipEntry(input, entry) {
  const b = toBytes(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (entry.flags & 0x1) throw new Error('epubText: encrypted entries are not supported');
  if (entry.size > ENTRY_CAP) throw new Error('epubText: entry too large');
  const at = entry.localOffset;
  if (at + 30 > b.length || v.getUint32(at, true) !== SIG_LOC) throw new Error('epubText: bad local header');
  const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
  const end = start + entry.compSize;
  if (end > b.length) throw new Error('epubText: entry out of range');
  const data = b.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const out = await inflateRaw(data);
    if (out.length > ENTRY_CAP) throw new Error('epubText: entry too large');
    return out;
  }
  throw new Error(`epubText: compression method ${entry.method} is not supported`);
}

// ── the walk ─────────────────────────────────────────────────────────────────────────────

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

/** The same stripping app/lib/epubExtract.js does, plus the handful of named entities prose uses. */
export function stripXhtml(xml) {
  return String(xml)
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (NAMED[name.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ')
    .trim();
}
function safeChar(cp) {
  try { return String.fromCodePoint(cp); } catch { return ' '; }
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[2] ?? m[3]) : null;
};

/** Resolve an href against a directory inside the zip: decode, drop the fragment, fold `..`. */
function resolve(dir, href) {
  let h = String(href).split('#')[0];
  try { h = decodeURIComponent(h); } catch { /* leave as written */ }
  const parts = (h.startsWith('/') ? h.slice(1) : dir + h).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/**
 * The instalment's prose, in spine order, as one string of at most `max` characters.
 * Sections are separated by a blank line. Throws on a file that is not a readable EPUB.
 */
export async function epubPlainText(input, { max = TEXT_CAP } = {}) {
  const bytes = toBytes(input);
  const entries = readZipDirectory(bytes);
  const dec = new TextDecoder('utf-8');
  const readText = async (name) => {
    const e = entries.get(name);
    return e ? dec.decode(await readZipEntry(bytes, e)) : null;
  };

  const container = await readText('META-INF/container.xml');
  if (container == null) throw new Error('epubText: missing META-INF/container.xml');
  const rootfile = /<rootfile\b[^>]*>/i.exec(container);
  const opfPath = rootfile ? attr(rootfile[0], 'full-path') : null;
  if (!opfPath) throw new Error('epubText: container.xml names no package');
  const opf = await readText(opfPath);
  if (opf == null) throw new Error('epubText: package file not found');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const manifest = new Map();
  for (const m of opf.matchAll(/<(?:opf:)?item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id && href) manifest.set(id, href);
  }
  const spine = /<(?:opf:)?spine\b[^>]*>([\s\S]*?)<\/(?:opf:)?spine>/i.exec(opf);
  if (!spine) throw new Error('epubText: package has no spine');

  const parts = [];
  let length = 0;
  for (const m of spine[1].matchAll(/<(?:opf:)?itemref\b[^>]*>/gi)) {
    if (length >= max) break;
    const href = manifest.get(attr(m[0], 'idref'));
    if (!href) continue;
    const xhtml = await readText(resolve(opfDir, href));
    if (xhtml == null) continue;
    const text = stripXhtml(xhtml);
    if (!text) continue;
    parts.push(text);
    length += text.length + 2;
  }
  return parts.join('\n\n').slice(0, max);
}
