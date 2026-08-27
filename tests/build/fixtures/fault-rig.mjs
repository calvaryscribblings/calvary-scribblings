// The fault-injection rig PL-12's verification was done on, kept as a fixture.
//
// Modes mirror the four failures the ruling names, plus the healthy case:
//   500        Firebase answers with an error   → unreadable, must fail the build
//   malformed  a truncated JSON body            → unreadable, must fail the build
//   empty      `null`, RTDB's answer for a node that does not exist → VALID, must stay green
//   slow       never responds at all            → the deadline's job
//   ok         a small healthy catalogue
import { createServer } from 'node:http';

export function startRig(mode) {
  const srv = createServer((req, res) => {
    if (mode === '500') { res.writeHead(500); res.end('upstream error'); return; }
    if (mode === 'malformed') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"a-slug": {"published": true}, "b-slug": {"published"');   // truncated
      return;
    }
    if (mode === 'empty') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('null'); return; }
    if (mode === 'slow') return;                                            // never responds
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ 'alpha-tale': { published: true }, 'beta-tale': { published: true }, 'hidden': { published: false } }));
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }));
  });
}
