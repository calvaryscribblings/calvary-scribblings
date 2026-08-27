// Build-time generator for public/_redirects.
//
// Cloudflare Pages reads `_redirects` from the build output to apply HTTP
// redirects at the edge. This script reads CMS story slugs from Firebase
// (mirroring app/sitemap.js) and emits one 301 per legacy URL form so that
// pre-Next.js URLs Google still has indexed redirect to their canonical
// /stories/<slug> location instead of 404'ing.
//
// Wired into `npm run build` as a pre-step. Idempotent and safe to re-run.

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRead, fetchJsonWithDeadline } from '../app/lib/build-read.mjs';
import { assertServable, isDynamic, LIMITS } from './redirects-limits.mjs';

// REST API (not the Firebase JS SDK) — the SDK keeps a persistent WebSocket
// open which prevents Node from exiting after the read, hanging the build.
// We only need a single read of cms_stories metadata, so REST is simpler
// and exits cleanly. Public read access is already permitted by the same
// rules sitemap.js relies on.
const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Non-story legacy routes from the pre-Next.js static site that don't map
// 1:1 to a current category. Kept hand-maintained because they're stable
// and few; new entries only get added if a route is renamed/removed.
const STATIC_LEGACY_REDIRECTS = [
  // Legacy "Creative Writing" category — folded into /inspiring at migration.
  ['/creative',       '/inspiring'],
  ['/creative.html',  '/inspiring'],
  // Legacy PWA offline page — no longer ships. Points at the reading platform rather
  // than the gateway at /, since it's readers landing here, not new arrivals.
  ['/offline.html',   '/public-library'],
  // The reader's purchased-books shelf, absorbed into /my-library (STORIES + BOOKS behind one
  // switch). /library was platform territory, not bookstore retail — it WAS the BOOKS half.
  // The route no longer builds, so this rule has no static asset shadowing it.
  ['/library',        '/my-library'],
  ['/library.html',   '/my-library'],
  // /serial → /series. The old route was a hardcoded "Coming Soon — our first serial story
  // is in the works" stub that shipped for months while three Serial-subcategory stories were
  // live under /book-reader, and it was IN app/sitemap.js the whole time, so search engines
  // were told a placeholder was a page. It is now retired rather than repointed: the section
  // is called The Series and the old route said "Serial Stories", and letting the URL keep
  // the discarded vocabulary is how the word "instalment" starts losing to "serial" again.
  //
  // A 301 rather than a delete because the route was linked from the navbar dropdown, the
  // mobile drawer, the footer and the sitemap — four public surfaces, any of which a reader
  // may have bookmarked from. Nothing shadows /serial in public/, and app/serial/page.js was
  // removed in the same change, so this rule has no static asset competing with it.
  ['/serial',         '/series'],
  ['/serial.html',    '/series'],
  // Summer Reading Program — the shareable short form for the seasonal board.
  // The canonical route is /leaderboard/summer-2026 (a literal segment, so it
  // static-exports without generateStaticParams). Verified nothing shadows this
  // path: there is no app/summer-reading route and no public/summer-reading asset.
  ['/summer-reading',  '/leaderboard/summer-2026'],
  // Author profile shorthand — Open Pages cards/detail link to /u/<handle>; the live profile
  // page is /user?handle=<handle>. Cloudflare placeholder syntax (:handle) forwards the
  // captured segment into the query string.
  //
  // ⭑ R24.1 — THIS RULE IS NOW THE WHOLE MECHANISM, not a fallback for one. app/u/[handle]
  // used to prerender a page per known handle as "belt and braces"; measurement showed
  // Cloudflare applies this rule whether or not an asset matches, so those 98 pages had never
  // been served once. The rule covers every handle including any created since the last
  // deploy, and /user resolves the handle live, showing "User not found." when it does not.
  //
  // ⛔ It is also the file's ONLY dynamic rule, and R24 is why that matters: the generator
  // partitions so it is emitted LAST. A second dynamic rule is fine; a dynamic rule that ends
  // up ahead of the static ones caps the whole file at ~100. See redirects-limits.mjs.
  ['/u/:handle',      '/user?handle=:handle'],
];

// ⛔ PL-12 — THIS READ IS NOT ALLOWED TO DEGRADE, AND IT USED TO.
//
// MEASURED against a fault-injection rig, 27 Aug 2026 — a 500, an empty body and a truncated
// JSON body all produced the same thing:
//
//     [generate-redirects] wrote public/_redirects (0 slugs from CMS, 9 static)
//     exit=0
//
// Nine rules where there had been 335. Every one of the 326 legacy pre-migration story URLs
// that Google still has indexed would start 404'ing, on a green build, silently. That is
// exactly the diminished shop Ikenna's ruling of 27 Aug names — "a broken deploy that announces
// itself is recoverable, a silently thinner catalogue is not."
//
// A non-2xx is an ERROR, not an empty result. Conflating them is what made a 500 look like "no
// stories". fetchJsonWithDeadline draws that line and carries the deadline; buildRead carries
// the retries and the exit. See app/lib/build-read.mjs.
function loadCmsSlugs() {
  return buildRead(
    'cms_stories (REST)',
    'public/_redirects — the 301 for every pre-migration story URL still in Google\'s index',
    async () => {
      const data = await fetchJsonWithDeadline(`${FB_DB}/cms_stories.json`);
      // `null` is what RTDB returns for a node that does not exist. That is EMPTY, not
      // unreadable, and it is a valid answer: a site with no stories has no story redirects.
      if (data === null) return [];
      if (typeof data !== 'object') throw new Error(`cms_stories was ${typeof data}, not an object`);
      return Object.entries(data)
        .filter(([, s]) => s?.published !== false)
        .map(([slug]) => slug);
    },
  );
}

function formatRedirect(from, to, code = 301) {
  // Cloudflare Pages _redirects format: from to status (whitespace-separated).
  return `${from.padEnd(60)} ${to.padEnd(60)} ${code}`;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'public', '_redirects');

  // ⚠ READ FIRST, WRITE AFTER. This script's output is a git-tracked file that it overwrites
  // in place, so a read that fails AFTER the write has begun would leave a gutted _redirects
  // on disk for the next build — or for a deploy — to pick up. buildRead exits the process on
  // failure, before this line, so the file on disk is left exactly as it was. That is the
  // "nothing partial" half of the ruling, and for this script it means nothing partial in
  // public/ as well as in out/.
  const cmsSlugs = await loadCmsSlugs();

  const slugs = [...cmsSlugs].sort();

  // ── ORDERING IS LOAD-BEARING, NOT COSMETIC ────────────────────────────────────────────────
  //
  // R24. Cloudflare counts every rule below the FIRST dynamic rule against the 100-rule
  // DYNAMIC limit, however static that rule is, and hard-stops the file at the 101st. Before
  // this change `/u/:handle` sat ninth in a 335-rule file and cost us the other 227: measured
  // live on 27 Aug 2026, rules 1-108 redirected and 109-335 all 404'd, 114 legacy story URLs
  // among them. See scripts/redirects-limits.mjs for the parser this is written against.
  //
  // So the partition below is the fix, and it is a partition rather than a hand-kept ordering
  // ON PURPOSE: a new dynamic entry can be added anywhere in STATIC_LEGACY_REDIRECTS and it
  // still lands at the end of the emitted file. Ordering by construction, not by care.
  const storyRules = slugs.flatMap((slug) => [
    [`/${slug}`, `/stories/${slug}`],
    [`/${slug}.html`, `/stories/${slug}`],
  ]);
  const all = [...STATIC_LEGACY_REDIRECTS, ...storyRules];
  const staticRules  = all.filter(([from]) => !isDynamic(from));
  const dynamicRules = all.filter(([from]) =>  isDynamic(from));

  const lines = [
    '# Auto-generated by scripts/generate-redirects.mjs at build time.',
    '# Do not edit by hand — changes will be overwritten on next build.',
    '# Static legacy entries are defined in the script; story entries come',
    '# from cms_stories. Re-run via `npm run build`.',
    '#',
    '# ⛔ EVERY STATIC RULE COMES FIRST AND EVERY DYNAMIC RULE COMES LAST. Cloudflare counts',
    '#    everything below the first dynamic rule against the 100-rule dynamic limit and then',
    '#    abandons the file. The generator partitions to guarantee this; do not resort by hand.',
    '',
    `# ── Static rules (${staticRules.length} of ${LIMITS.maxStatic} permitted) ───────────────`,
  ];
  for (const [from, to] of staticRules) {
    lines.push(formatRedirect(from, to));
  }

  lines.push(
    '',
    `# ── Dynamic rules — MUST STAY LAST (${dynamicRules.length} of ${LIMITS.maxDynamic} permitted) ──`,
  );
  for (const [from, to] of dynamicRules) {
    lines.push(formatRedirect(from, to));
  }

  lines.push('');
  const body = lines.join('\n');

  // ⛔ GATE BEFORE WRITE. PL-12's ruling, applied to this file: a redirect map that silently
  // loses its tail is the same defect as a catalogue that silently loses its stories, and it
  // must stop the build rather than reach a deploy. Throwing here — before writeFile — is also
  // what keeps the "nothing partial" promise the read above makes: the file already on disk is
  // left exactly as it was.
  const report = assertServable(body);

  await writeFile(outPath, body, 'utf8');
  console.log(`[generate-redirects] wrote ${outPath} (${slugs.length} slugs from CMS, ${STATIC_LEGACY_REDIRECTS.length} static)`);
  console.log(`[generate-redirects] ${report.served}/${report.total} rules servable — ${report.staticCount} static, ${report.dynamicCount} dynamic`);
}

main().catch((e) => {
  // A limits violation has already formatted itself as a banner; anything else is unexpected
  // and gets its stack. Either way the exit is non-zero and the build stops here.
  if (e?.report) console.error(e.message);
  else console.error('[generate-redirects] fatal:', e);
  process.exit(1);
});
