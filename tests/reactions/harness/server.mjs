// Serves the two sides of the proof:
//   /web.html   the real components (bundle.js from build.mjs)
//   /bare.html  the prototype's code VERBATIM (tests/reactions/prototype.verbatim.txt), as a
//               classic script with its globals K and reduce, on the same markup and the same
//               stylesheet — "the same code running bare".
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Reaction, REACTION_CSS, REACTION_REST, REACTION_FULL } from '../../../app/components/conversation/Reaction.js';
import { PALETTE } from '../../../app/lib/reactionMotion.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROTO = join(here, '../prototype.verbatim.txt');

function bare(params) {
  const kind = params.get('kind') || 'heart', count = Number(params.get('count') ?? 12), size = Number(params.get('size') || 16);
  const ground = params.get('ground') || '#0a0a0a';
  const markup = renderToStaticMarkup(h(Reaction, { kind, size, on: false, count: 0 })).replace(/<style[^>]*>[\s\S]*?<\/style>/, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&display=swap">
<style>${REACTION_CSS}</style></head>
<body style="margin:0;background:${ground};color:#f5f0e8;font-family:'Cormorant Garamond',Georgia,serif">
<div id="stage" style="position:absolute;left:120px;top:120px"></div>
<script>var K = 1; var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;</script>
<script src="/proto.js"></script>
<script>
const P = ${JSON.stringify(PALETTE)}, MARKUP = ${JSON.stringify(markup)}, COUNT = ${count}, GROUND = ${JSON.stringify(ground)};
let on = false;
function mount() {
  const stage = document.getElementById('stage');
  stage.innerHTML = MARKUP; on = false;
  const b = stage.querySelector('button');
  b.st = { n: COUNT, icon: b.querySelector('.rx-icon'), fx: b.querySelector('.rx-fx'), off: b.querySelector('.rx-off'), on: b.querySelector('.rx-on'), count: b.querySelector('.rx-count'), timers: [] };
  b.st.icon.style.width = b.st.icon.style.height = '${size}px';
  setCount(b, COUNT);
  b.onclick = () => {
    on = !on; clear(b);
    if (on) play(b, { ...P, bg: GROUND }); else off(b);
    b.st.off.style.opacity = on ? 0 : 1; b.st.on.style.opacity = on ? 1 : 0;
    b.st.count.style.color = on ? ${JSON.stringify(REACTION_FULL)} : ${JSON.stringify(REACTION_REST)};
    setCount(b, b.st.n + (on ? 1 : -1));
  };
}
mount();
window.H = { remount: mount, speed: (k) => { K = k; }, seed: (s) => { let a = s >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; } };
</script></body></html>`;
}

export function serve(outDir, port = 0) {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (type, body) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/web.html') return send('text/html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&display=swap">
<style>.cs-reply-btn { background: none; border: none; font-size: 15px; font-weight: 500; line-height: 44px; color: #9062DA; cursor: pointer; padding: 0 4px; font-family: Cormorant Garamond, Georgia, serif; }</style>
</head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
    if (u.pathname === '/bare.html') return send('text/html', bare(u.searchParams));
    if (/^\/[\w.-]*bundle\.js$/.test(u.pathname)) return send('text/javascript', readFileSync(join(outDir, u.pathname.slice(1))));
    if (u.pathname === '/proto.js') return send('text/javascript', readFileSync(PROTO));
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}
