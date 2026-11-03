// EDGE-2 — after `next build`: out/_routes.json and out/_edge/ledger.json (ruling 265).
//
// Reads the LIVE deployment's ledger, works out which pages may still hold a preserved copy that
// this build no longer has, and routes exactly those to the guard Function. Every other address,
// every live page view included, goes straight to the asset server. The design, and the
// asset-server source it rests on, are in app/lib/edgeGuard.mjs.
//
// LOGS COUNTS ONLY. The guarded pages include stories that are not live (some unreleased), and
// build logs are not the place to name them.
//
// Inputs (all read-only):
//   out/                                   this build's pages
//   functions/                             the Functions' own routes
//   EDGE_LEDGER_KEY                        REQUIRED. The secret the ledger's guarded entries are
//                                          sealed under (Cloudflare Pages → Settings → Variables and
//                                          Secrets, type Secret, Production and Preview). The build
//                                          fails without it: an unsealed ledger would name pages
//                                          that are not live.
//   EDGE_LEDGER_URL                        default https://calvaryscribblings.co.uk/_edge/ledger.json;
//                                          file:// is accepted (tests)
//   EDGE_LEDGER=none                       treat the live ledger as absent (bootstrap). For builds that
//                                          are never deployed (CI). REFUSED when CF_PAGES is set: a
//                                          production build never skips the live ledger.
//   cms_stories (public REST)              read ONLY when there is no readable live ledger, for the
//                                          bootstrap seed
//   EDGE_OUT_DIR, EDGE_DB_URL, EDGE_DB_NS,  tests only: another out/, the database emulator, and a
//   EDGE_NOW                               fixed clock
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRead, fetchJsonWithDeadline, BUILD_READ } from '../app/lib/build-read.mjs';
import { hasStaticPage } from '../app/lib/storyAccess.js';
import {
  PAGE_FAMILIES, GUARD_MS, LEDGER_PATH, LEDGER_VERSION, MAX_ROUTE_RULES, MAX_RULE_LENGTH,
  UNRELEASED_1_LIVE_MS, hadPageBeforeUnreleased1, foldLedger, ledgerFor, ledgerKey, readLedgerEntries, routesFor,
} from '../app/lib/edgeGuard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(process.env.EDGE_OUT_DIR || join(ROOT, 'out'));
const FUNCTIONS = join(ROOT, 'functions');
const FB_DB = process.env.EDGE_DB_URL || 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const LEDGER_URL = process.env.EDGE_LEDGER_URL || `https://calvaryscribblings.co.uk${LEDGER_PATH}`;
const GUARD_DIRS = new Set(PAGE_FAMILIES);

/** Every file under out/, as the URL path the asset server would answer it at. */
async function builtPathsOf(dir) {
  const paths = [];
  async function walk(d, rel) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(join(d, e.name), r);
      else {
        paths.push(r);
        if (r.endsWith('.html')) paths.push(r.slice(0, -5));
      }
    }
  }
  for (const fam of PAGE_FAMILIES) if (existsSync(join(dir, fam))) await walk(join(dir, fam), `/${fam}`);
  return paths;
}

/** The pages this build serves, by key: every .html at any depth under out/<family> (never a segment file). */
async function pagesOf(dir) {
  const pages = new Set();
  async function walk(d, rel) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith('__next')) continue;
      if (e.isDirectory()) await walk(join(d, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith('.html')) pages.add(`${rel}/${e.name.slice(0, -5)}`);
    }
  }
  for (const fam of PAGE_FAMILIES) if (existsSync(join(dir, fam))) await walk(join(dir, fam), fam);
  return pages;
}

/** The Functions' own routes, as Pages would route them: a directory → /<dir>/*, a file → /<name>. */
export async function functionIncludesOf(dir) {
  const include = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === '_middleware.js' || e.name === '_middleware.ts') {
      throw new Error('[edge-guard] functions/_middleware routes EVERY request through a Function; the guard cannot keep live stories off it');
    }
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (e.isDirectory()) { if (!GUARD_DIRS.has(e.name)) include.push(`/${e.name}/*`); }
    else if (/\.(m?js|ts)$/.test(e.name)) {
      const name = e.name.replace(/\.(m?js|ts)$/, '');
      if (!name.includes('[')) include.push(name === 'index' ? '/' : `/${name}`);
      else throw new Error(`[edge-guard] functions/${e.name}: a top-level dynamic route cannot be listed exactly`);
    }
  }
  return include;
}

/** The same checks wrangler's validateRoutes makes before it will deploy (src/pages/functions/routes-validation.ts). */
export function assertDeployable(routes) {
  const all = [...routes.include, ...routes.exclude];
  if (routes.version !== 1 || !routes.include.length) throw new Error('[edge-guard] _routes.json: version 1 with at least one include');
  if (all.length > MAX_ROUTE_RULES) throw new Error(`[edge-guard] _routes.json: ${all.length} rules > ${MAX_ROUTE_RULES}`);
  if (all.some((r) => r.length > MAX_RULE_LENGTH)) throw new Error(`[edge-guard] _routes.json: a rule over ${MAX_RULE_LENGTH} characters`);
  if (all.some((r) => !r.startsWith('/'))) throw new Error('[edge-guard] _routes.json: every rule starts with /');
  for (const list of [routes.include, routes.exclude]) {
    for (const splat of list.filter((r) => r.endsWith('/*'))) {
      const stem = splat.slice(0, -1);
      if (list.some((r) => r !== splat && r.startsWith(stem))) throw new Error('[edge-guard] _routes.json: overlapping rules');
    }
  }
}

async function readLiveLedger() {
  if (process.env.EDGE_LEDGER === 'none') return { ledger: null, how: 'EDGE_LEDGER=none' };
  if (LEDGER_URL.startsWith('file://')) {
    const p = fileURLToPath(LEDGER_URL);
    if (!existsSync(p)) return { ledger: null, how: 'no ledger file' };
    return { ledger: JSON.parse(await readFile(p, 'utf8')), how: 'file' };
  }
  const ledger = await buildRead('the live deployment\'s edge ledger', 'out/_routes.json — which removed story addresses to guard', async () => {
    const res = await fetch(LEDGER_URL, { signal: AbortSignal.timeout(BUILD_READ.timeoutMs), headers: { accept: 'application/json' } });
    if (res.status === 404) return null;               // no EDGE-2 deployment yet: bootstrap
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j && j.v === 1) return { v: 1, pages: Array.isArray(j.pages) ? j.pages : [], guarded: [] };   // pre-encryption ledger: its pages only
    if (!j || j.v !== LEDGER_VERSION || typeof j.kid !== 'string' || !Array.isArray(j.pages) || !Array.isArray(j.guarded)) throw new Error('malformed ledger');
    return j;
  });
  return { ledger, how: ledger ? 'live site' : 'none on the live site (404)' };
}

async function readCatalogue() {
  const ns = process.env.EDGE_DB_NS ? `?ns=${encodeURIComponent(process.env.EDGE_DB_NS)}` : '';
  return await buildRead('cms_stories', 'the edge guard: the bootstrap seed', () => fetchJsonWithDeadline(`${FB_DB}/cms_stories.json${ns}`)) || {};
}

/** What the deployments before EDGE-2 (or before a key rotation) may have left in the store. */
function bootstrapSeed(cms, now) {
  const seed = [];
  for (const [slug, s] of Object.entries(cms)) {
    let since = null;
    if (hadPageBeforeUnreleased1(s) && !hasStaticPage(s)) since = UNRELEASED_1_LIVE_MS;   // built before 31 Oct
    if (typeof s?.hiddenAt === 'number' && s.hiddenAt + GUARD_MS > now) since = Math.max(since ?? 0, s.hiddenAt);
    if (since !== null) for (const fam of ['stories', 'reader']) seed.push({ key: `${fam}/${slug}`, since });
  }
  return seed;
}

/**
 * EDGE_LEDGER=none is for builds that are never deployed (CI: scripts/ci/edge-ledger-throwaway.mjs).
 * On Cloudflare's own build (CF_PAGES is set) it would publish a deployment whose guard forgot every
 * page the live ledger carries, so there it refuses. Returns the reason, or null.
 */
export function refusalOnPages(env = process.env) {
  if (env.CF_PAGES && env.EDGE_LEDGER === 'none') {
    return '[edge-guard] EDGE_LEDGER=none on a Cloudflare Pages build (CF_PAGES is set): a production build must read the live ledger. Unset EDGE_LEDGER in the Pages project.';
  }
  return null;
}

export async function main({ now = Number(process.env.EDGE_NOW) || Date.now() } = {}) {
  const refusal = refusalOnPages();                                 // before anything is read or written
  if (refusal) throw new Error(refusal);
  if (!existsSync(join(OUT, '404.html'))) throw new Error(`[edge-guard] ${OUT}/404.html is missing — run after next build`);
  const k = await ledgerKey(process.env.EDGE_LEDGER_KEY);           // fails first, before any read
  const [pages, builtPaths, functionIncludes, { ledger: prev, how }] = await Promise.all([
    pagesOf(OUT), builtPathsOf(OUT), functionIncludesOf(FUNCTIONS), readLiveLedger(),
  ]);

  let carried = [];
  let readBack = 'none';
  if (prev && prev.v === LEDGER_VERSION) {
    const r = await readLedgerEntries(prev, k);
    carried = r.entries;
    readBack = r.status;
  } else if (prev) readBack = 'v1 (pages only)';
  // No live ledger, or one sealed under another key (a rotation): the guarded pages it carried
  // cannot be read back, so the seed stands in for them.
  const needSeed = !prev || readBack === 'other-key' || readBack === 'v1 (pages only)';
  const seed = needSeed ? bootstrapSeed(await readCatalogue(), now) : [];

  const guarded = foldLedger({ prevPages: prev ? prev.pages : null, carried, pages, seed, now });
  const { routes, routed, dropped } = routesFor({ functionIncludes, guarded, builtPaths });
  assertDeployable(routes);
  const ledger = await ledgerFor({ pages, guarded, k, builtAt: now });

  await mkdir(join(OUT, '_edge'), { recursive: true });
  await writeFile(join(OUT, LEDGER_PATH), JSON.stringify(ledger) + '\n');
  await writeFile(join(OUT, '_routes.json'), JSON.stringify(routes, null, 2) + '\n');

  const byFamily = PAGE_FAMILIES.map((f) => `${f} ${[...pages].filter((p) => p.startsWith(`${f}/`)).length}`).join(', ');
  console.log(`[edge-guard] live ledger: ${how}; read back: ${readBack}${needSeed ? `; bootstrap seed ${seed.length}` : ''}. `
    + `pages served: ${pages.size} (${byFamily}). guarded: ${guarded.length} (routed ${routed.length}, rules ${routes.include.length}/${MAX_ROUTE_RULES}).`);
  if (readBack === 'other-key') console.log('[edge-guard] ⚠ the live ledger was sealed under a different EDGE_LEDGER_KEY; its guarded pages could not be read back. The bootstrap seed stands in.');
  if (dropped.length) {
    console.log(`[edge-guard] ⚠ ${dropped.length} guarded page(s) did not fit in _routes.json and are NOT guarded by this deployment `
      + '(the oldest removals are the ones left out; each lapses 8 days after its removal). See app/lib/edgeGuard.mjs.');
  }
  return { pages, guarded, routed, dropped, routes, ledger, how, readBack };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
