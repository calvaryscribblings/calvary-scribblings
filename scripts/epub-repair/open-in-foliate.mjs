// OPEN A REPAIR IN THE READER — the vendored foliate, through public/reading-room.html, in Chromium.
//
//   node scripts/epub-repair/open-in-foliate.mjs --epub <repair.epub> --plan <plan.json> --shots <dir>
//
// Checks that the contents list is in spine order and that every chapter the plan adds or edits
// opens at its own heading (the reader lands on the section's h1 or opener and reports that
// chapter's label). Screenshots go to --shots, which must be outside the repo, like the book.
// The book is served to the page from where it lies; nothing is copied into the work tree.
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { outsideRepo, args, ROOT } from './paths.mjs';
import { readZip, parseEpub } from '../make-sample-epub.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const ORIGIN = 'http://reader.invalid';

/** The files a plan touches, with the label each should open on. */
export function targetsOf(plan) {
  if (plan.op === 'split') return plan.new.map((n) => ({ file: n.file, label: n.label }));
  return [...new Set(plan.edits.map((e) => e.file))].map((file) => ({ file, label: null }));
}

async function main() {
  const a = args(process.argv.slice(2), ['epub', 'plan', 'shots']);
  const epubPath = outsideRepo(a.epub, '--epub');
  const plan = JSON.parse(await readFile(outsideRepo(a.plan, '--plan'), 'utf8'));
  const shots = outsideRepo(a.shots, '--shots');
  await mkdir(shots, { recursive: true, mode: 0o700 });
  const bytes = await readFile(epubPath);
  const epub = parseEpub(readZip(bytes));
  const spineFiles = epub.spine.map((s) => s.item.full);
  const navDir = posix.dirname(epub.navItem.full);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, serviceWorkers: 'block' });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    if (u.pathname === '/__book.epub') return route.fulfill({ body: bytes, contentType: 'application/epub+zip' });
    try {
      const body = await readFile(join(ROOT, 'public', decodeURIComponent(u.pathname)));
      return route.fulfill({ body, contentType: TYPES[extname(u.pathname)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.addInitScript(() => {
    window.__msgs = [];
    window.addEventListener('message', (e) => { if (e.data && typeof e.data === 'object' && e.data.type !== 'goTo') window.__msgs.push(e.data); });
  });
  await page.goto(`${ORIGIN}/reading-room.html?url=${encodeURIComponent('/__book.epub')}`);
  const ready = await page.waitForFunction(() => window.__msgs.find((m) => m.type === 'ready'), null, { timeout: 60000 }).then((h) => h.jsonValue());
  // The open itself relocates (to the cover) after 'ready'. Let it land before the first jump,
  // or that relocate is read as the jump's.
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'relocate'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Contents order: every TOC href resolves to a spine file, and they run in spine order.
  // foliate hands TOC hrefs back already resolved to package paths; a relative one is joined to
  // the nav's folder only if it does not already name a spine file.
  const tocFiles = ready.toc.map((t) => {
    const h = String(t.href || '').split('#')[0];
    return spineFiles.includes(h) ? h : posix.normalize(posix.join(navDir, h));
  });
  const idx = tocFiles.map((f) => spineFiles.indexOf(f));
  const inOrder = idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1]));
  const problems = [];
  if (!inOrder) problems.push('the contents list is not in spine order');
  console.log(`contents: ${ready.toc.length} entries, ${inOrder ? 'in spine order' : 'OUT OF ORDER'}`);
  console.log(`  labels: ${ready.toc.map((t) => t.label).join(' · ')}`);

  for (const t of targetsOf(plan)) {
    const entry = ready.toc[tocFiles.indexOf(t.file)];
    const spineIndex = spineFiles.indexOf(t.file);
    if (!entry && t.label) { problems.push(`${t.file}: not in the contents`); continue; }
    if (!entry) { problems.push(`${t.file}: not in the contents`); continue; }
    const { href } = entry;
    await page.evaluate(() => { window.__msgs.length = 0; });
    await page.evaluate((h) => window.postMessage({ type: 'goTo', cfi: h, id: 1 }, location.origin), href);
    // The relocate INTO the target's spine item; any other is the reader on its way there.
    const step6 = `/6/${(spineIndex + 1) * 2}`;
    const rel = await page.waitForFunction((st) => [...window.__msgs].reverse().find((m) => m.type === 'relocate' && String(m.cfi).startsWith(`epubcfi(${st}`)), step6, { timeout: 20000 })
      .then((h) => h.jsonValue())
      .catch(() => page.evaluate(() => [...window.__msgs].reverse().find((m) => m.type === 'relocate') || { cfi: 'none', chapterLabel: null }));
    await page.waitForTimeout(400);
    // Lands at the heading: in this spine item, on the section's first or second child (h1/opener).
    const m = /^epubcfi\(\/6\/(\d+)(?:\[[^\]]*\])?!\/4\/2(?:\[[^\]]*\])?(?:\/(\d+))?/.exec(rel.cfi || '');
    const atIndex = m ? Number(m[1]) / 2 - 1 : -1;
    const step = m && m[2] ? Number(m[2]) : 0;
    const atHeading = atIndex === spineIndex && step <= 4;
    const labelOk = t.label ? rel.chapterLabel === t.label : true;
    const shot = join(shots, `${posix.basename(t.file, '.xhtml')}.png`);
    await page.screenshot({ path: shot });
    console.log(`  ${t.file}: spine ${spineIndex + 1}, reader label "${rel.chapterLabel}", lands ${atHeading ? 'AT ITS HEADING' : `ELSEWHERE (${rel.cfi})`}${labelOk ? '' : ` — expected "${t.label}"`}`);
    if (!atHeading) problems.push(`${t.file}: does not open at its heading`);
    if (!labelOk) problems.push(`${t.file}: reader reports "${rel.chapterLabel}", expected "${t.label}"`);
  }
  await browser.close();
  console.log(`screenshots: ${shots}`);
  if (problems.length) { for (const p of problems) console.log(`  ✗ ${p}`); process.exit(1); }
  console.log('OPENS CLEAN.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`open failed: ${e.message}`); process.exit(2); });
}
