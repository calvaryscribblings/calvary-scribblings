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

export async function extractEpubText(blob) {
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

  const parts = [];
  let totalLength = 0;
  for (const idref of spineRefs) {
    const href = manifest[idref];
    if (!href) continue;
    const filePath = opfDir + href;
    const file = zip.file(filePath);
    if (!file) continue;
    const xml = await file.async('string');
    const text = stripXhtml(xml);
    if (text) {
      parts.push(text);
      totalLength += text.length + 2;
      if (totalLength >= MAX_TEXT_LENGTH) break;
    }
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
