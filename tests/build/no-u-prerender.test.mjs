// ═══════════════════════════════════════════════════════════════════════════════════════════
// R24.1 — THE /u PRERENDER WAS NEVER SERVED, AND MUST NOT COME BACK
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:no-u-prerender          (~2 real `next build` runs — see the cost note below)
//
// ── THE FACT (measured live, 27 Aug 2026) ───────────────────────────────────────────────────
//
//   app/u/[handle] prerendered 98 pages, 5.4 MB of out/. Not one of them had ever been served.
//   Cloudflare applies a _redirects rule whether or not an asset matches, so
//
//       /u/:handle    /user?handle=:handle    301
//
//   answered first, every time: /u/5yh7sr997w — a handle WITH a prerendered page — 301'd to
//   /user?handle=5yh7sr997w on the live site.
//
//   The route's own comment, and the degrade argument in app/lib/build-read.mjs that rested on
//   it, both claimed the opposite — "a static page at /u/<handle> SHADOWS that rule". Backwards.
//   The pages shadowed nothing but themselves, and the exception PL-12 granted for their sake
//   was arguing for the weaker of the two mechanisms.
//
// ── WHY THE REDIRECT IS THE PRODUCT ────────────────────────────────────────────────────────
//
//   The rule covers EVERY handle, including one created a minute after the last deploy — the
//   exact degrade path the removed exception was written to protect. The prerender covered only
//   handles that existed at build time. /user?handle= resolves the handle live against
//   usernames/<handle> and renders an honest "User not found." when it does not resolve.
//
// ⚠ WHAT THIS SUITE REFUSES TO BE. "out/ contains no /u pages" is true of a build that emitted
// nothing at all, and true of a grep aimed at a path that never existed. So it is not asserted
// on its own: the second group RESTORES the route, builds again, and requires the pages to come
// back — if they do not, the first group was measuring nothing. That costs two real builds, and
// that is the price of an assertion that can fail.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'out');
const ROUTE_DIR = join(ROOT, 'app/u/[handle]');

async function attempt(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...opts });
    return { code: 0, stdout, stderr, said: stdout + stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout || '', stderr: e.stderr || '', said: (e.stdout || '') + (e.stderr || '') };
  }
}

/** Every /u/<handle> page in the export, however the exporter chose to lay them out. */
function uPagesInOut() {
  const dir = join(OUT, 'u');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.html'));
}

function sitemapUrls() {
  const path = join(OUT, 'sitemap.xml');
  if (!existsSync(path)) return null;
  return [...readFileSync(path, 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the route is gone from the source, and nothing still argues for it', () => {
  // These cost nothing and run everywhere. They are not a substitute for the build group —
  // a source tree can be clean while the export is not — but a reappearing route file is the
  // likeliest way this regresses, and it should not need a build to catch.
  test('app/u/ does not exist', () => {
    assert.ok(!existsSync(join(ROOT, 'app/u')), 'app/u/ is back — R24.1 removed it');
  });

  test('app/sitemap.js emits no /u/ URLs', () => {
    // ⭑ The sitemap must never list a URL the build does not produce. It never listed these,
    // which is its own small piece of evidence that the prerender was doing nothing.
    const src = readFileSync(join(ROOT, 'app/sitemap.js'), 'utf8');
    assert.ok(!/\/u\//.test(src), 'app/sitemap.js references /u/ — it must not list what the build no longer emits');
  });

  test('buildReadOptional has one degrade case left, and it is the gateway', async () => {
    // The removed route was one of exactly two reads PL-12 allowed to degrade. Its argument
    // went with it; a caller reappearing without a written argument is the thing to catch.
    const { readdirSync: rd } = await import('node:fs');
    const callers = [];
    const walk = (dir) => {
      for (const e of rd(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === 'out') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        // build-read.mjs DECLARES buildReadOptional; it is the contract, not a caller of it.
        else if (/\.(js|jsx|mjs)$/.test(e.name) && !p.endsWith('app/lib/build-read.mjs')
                 && /buildReadOptional\s*\(/.test(readFileSync(p, 'utf8'))) {
          callers.push(p.slice(ROOT.length));
        }
      }
    };
    for (const d of ['app', 'scripts']) walk(join(ROOT, d));
    assert.deepEqual(callers.sort(), ['app/lib/gateway-build.js', 'scripts/generate-gateway-wall.mjs'],
      'the only read allowed to degrade is the gateway wall — see the argument in app/lib/build-read.mjs');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the export carries no /u pages — and the same check finds them when they return', () => {
  // ⛔ TWO REAL BUILDS, and they are the point. PL-12 §6 set the precedent: an assertion about
  // what a build produces is worth what a real build says, and nothing else.
  after(() => {
    // ⚠ RESTORE-FIRST discipline, as in liveness.test.mjs: the mutation writes a real route
    // into the source tree. An interrupted run must not leave it there for a deploy to build.
    if (existsSync(ROUTE_DIR)) rmSync(join(ROOT, 'app/u'), { recursive: true, force: true });
  });

  test('a clean build emits zero /u pages and a sitemap naming none', async () => {
    rmSync(OUT, { recursive: true, force: true });
    const r = await attempt('npm', ['run', 'build']);
    assert.equal(r.code, 0, `the build must succeed:\n${r.said.slice(-4000)}`);

    assert.deepEqual(uPagesInOut(), [], 'out/u/ must be empty — the prerender is removed');
    const urls = sitemapUrls();
    assert.ok(urls && urls.length > 0, 'the sitemap must exist and list pages');
    assert.deepEqual(urls.filter((u) => /\/u\//.test(u)), [], 'the sitemap must not list /u/ URLs');

    // The redirect is the product and it must still be in the export, still last, still the
    // file's only dynamic rule — R24's gate expressed as an assertion about out/, not public/.
    const redirects = readFileSync(join(OUT, '_redirects'), 'utf8');
    const froms = redirects.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
    assert.ok(froms.includes('/u/:handle'), 'the /u/:handle rule is the forwarder now — it must ship');
    assert.equal(froms.at(-1), '/u/:handle', 'and it must be the last rule in the file');
  }, { timeout: 900000 });

  test('PROOF THE CHECK WORKS — restore the route and the pages come back', async () => {
    // ⭑ Without this, "out/u is empty" is unfalsifiable: it would also pass against a typo in
    // the path, a build that produced nothing, or a route that never existed. The route below
    // is deliberately MINIMAL — no Firebase read — because what is being proved is that the
    // check can see prerendered /u pages, not that the old read worked.
    mkdirSync(ROUTE_DIR, { recursive: true });
    writeFileSync(join(ROUTE_DIR, 'page.js'),
      'export function generateStaticParams() {\n'
      + "  return [{ handle: 'r241-canary-a' }, { handle: 'r241-canary-b' }];\n"
      + '}\n\n'
      + 'export default function UHandlePage() {\n'
      + '  return null;\n'
      + '}\n');

    rmSync(OUT, { recursive: true, force: true });
    const r = await attempt('npm', ['run', 'build']);
    assert.equal(r.code, 0, `the canary build must succeed:\n${r.said.slice(-4000)}`);

    const pages = uPagesInOut();
    assert.ok(pages.length >= 2,
      `restoring the route must make out/u/ non-empty, or the assertion above proves nothing — found ${pages.length}`);
    assert.ok(pages.some((p) => String(p).includes('r241-canary-a')), 'the canary handles must be the pages found');

    // And the same sitemap assertion must still hold — the prerender never put them there,
    // which is why the sitemap check alone could never have caught this.
    assert.deepEqual((sitemapUrls() || []).filter((u) => /\/u\//.test(u)), [],
      'the sitemap listed no /u/ URLs even WITH the route — it was never the signal');

    rmSync(join(ROOT, 'app/u'), { recursive: true, force: true });
  }, { timeout: 900000 });
});
