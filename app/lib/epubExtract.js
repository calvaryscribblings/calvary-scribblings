'use client';

const JSZIP_SRC = '/vendor/jszip.min.js';
const MAX_TEXT_LENGTH = 500_000;

let jszipPromise = null;
async function loadJSZip() {
  if (typeof window === 'undefined') throw new Error('EPUB extraction must run in the browser.');
  if (window.JSZip) return window.JSZip;
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_SRC;
      script.async = true;
      script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('jszip loaded but window.JSZip missing'));
      script.onerror = () => reject(new Error('Failed to load ' + JSZIP_SRC));
      document.head.appendChild(script);
    });
  }
  return jszipPromise;
}

function stripXhtml(xml) {
  return xml
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk an EPUB's spine, yielding the stripped plain text of each section in reading order.
 *
 * Factored out of extractEpubText() in R12.4 so countEpubWords() below can reuse the container
 * → OPF → manifest → spine walk without inheriting MAX_TEXT_LENGTH. The two callers want
 * genuinely different things from the same walk: extractEpubText wants a bounded string to put
 * in a textarea, and a word count wants the whole book or it is not a word count.
 *
 * A generator rather than an array because the count never needs two sections in memory at
 * once, and an EPUB is the largest thing this app asks a browser to hold.
 */
async function* epubSections(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Invalid EPUB: missing META-INF/container.xml');
  const containerXml = await containerFile.async('string');
  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) throw new Error('Invalid EPUB: container.xml missing full-path');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('Invalid EPUB: opf file not found at ' + opfPath);
  const opfXml = await opfFile.async('string');

  const manifest = {};
  const manifestRegex = /<item\s+([^>]+?)\/?>/g;
  let m;
  while ((m = manifestRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/);
    if (idMatch && hrefMatch) manifest[idMatch[1]] = hrefMatch[1];
  }

  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/);
  if (!spineMatch) throw new Error('Invalid EPUB: missing spine');
  const spineRefs = [];
  const idrefRegex = /<itemref\s+[^>]*idref="([^"]+)"/g;
  while ((m = idrefRegex.exec(spineMatch[1])) !== null) {
    spineRefs.push(m[1]);
  }

  for (const idref of spineRefs) {
    const href = manifest[idref];
    if (!href) continue;
    const file = zip.file(opfDir + href);
    if (!file) continue;
    const text = stripXhtml(await file.async('string'));
    if (text) yield text;
  }
}

/**
 * How many words are in this EPUB. Whole book, no cap.
 *
 * ── WHY THIS RUNS IN THE ADMIN'S BROWSER AND NOWHERE ELSE ────────────────────────────────
 *
 * A series instalment's EPUB lives at series_epubs/{id}/master.epub, which storage.rules keeps
 * at `allow read: if false` for EVERY client including the two admin UIDs. Nothing can open
 * those bytes again except a ~300-second signed URL minted by functions/api/series/stream.js
 * after it has checked release and entitlement. So there is exactly one moment in the life of
 * an instalment at which the words are countable without defeating that: while the editor's
 * browser still holds the File it is about to upload. app/lib/series/admin-writes.js:
 * uploadInstalmentEpub calls this there, on the same bytes, in the same call.
 *
 * Counting is over PROSE, not markup — stripXhtml has already removed the tags — which is
 * deliberately unlike app/lib/storyIndex.js:indexReadTime. See the note above WORDS_PER_MINUTE
 * in app/lib/series/format.js for why that one's quirk is not inherited here.
 */
export async function countEpubWords(blob) {
  let words = 0;
  for await (const text of epubSections(blob)) {
    words += text.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

/**
 * The whole book as one plain-text string, CAPPED at MAX_TEXT_LENGTH.
 *
 * The cap is unchanged from before the R12.4 refactor and so is the accumulation it guards:
 * sections are joined with a blank line, the running total charges the two joining characters,
 * and the walk stops on the first section that crosses the line. Callers put the result in a
 * textarea (app/admin/page.js, app/admin/extract-text/page.js), which is why a bound exists at
 * all — and is why countEpubWords() above does NOT share it.
 */
export async function extractEpubText(blob) {
  const parts = [];
  let totalLength = 0;
  for await (const text of epubSections(blob)) {
    parts.push(text);
    totalLength += text.length + 2;
    if (totalLength >= MAX_TEXT_LENGTH) break;
  }

  let result = parts.join('\n\n');
  if (result.length > MAX_TEXT_LENGTH) result = result.slice(0, MAX_TEXT_LENGTH);
  return result;
}

export async function extractEpubFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch EPUB: HTTP ' + res.status);
  const blob = await res.blob();
  return extractEpubText(blob);
}
