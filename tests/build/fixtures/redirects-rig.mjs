// A cms_stories rig for R24. fault-rig.mjs answers the PL-12 question — is the read alive —
// and its catalogue is deliberately tiny. This one answers a different question: what does the
// generator do when the catalogue it reads is legitimately shaped in a way that cannot be
// served? Every mode below is a real answer a real database could give.
import { createServer } from 'node:http';

export const CATALOGUES = {
  // 1,001 ordinary stories → 2,002 static rules, past Cloudflare's 2,000-rule static limit.
  'over-static': () => Object.fromEntries(
    Array.from({ length: 1001 }, (_, i) => [`story-${String(i).padStart(4, '0')}`, { published: true }]),
  ),
  // RTDB keys may contain ':' — and ':name' in the SOURCE is what makes a rule dynamic. It must
  // be ':' followed by a LETTER: Cloudflare's PLACEHOLDER_REGEX is /:[A-Za-z]\w*/, so '/chapter:0'
  // is static and '/chapter:part0' is not. That distinction is why this rig says 'part'.
  // 51 such slugs become 102 dynamic rules, past the 100-rule dynamic limit.
  'over-dynamic': () => Object.fromEntries(
    Array.from({ length: 51 }, (_, i) => [`chapter:part${i}`, { published: true }]),
  ),
  // A key with a space in it emits a line with five whitespace-separated tokens. Cloudflare
  // ignores it silently; before R24 so did we.
  'unparseable': () => ({ 'a good slug': { published: true }, 'ordinary': { published: true } }),
  // A key long enough that the emitted declaration passes the 1,000-character limit.
  'over-length': () => ({ ['x'.repeat(1200)]: { published: true }, 'ordinary': { published: true } }),
  // The healthy case: three published, one not.
  healthy: () => ({ alpha: { published: true }, beta: { published: true }, gamma: { published: true }, hidden: { published: false } }),
};

export function startRig(mode) {
  const body = JSON.stringify(CATALOGUES[mode]());
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${srv.address().port}`,
      close: () => new Promise((r) => srv.close(r)),
    }));
  });
}
