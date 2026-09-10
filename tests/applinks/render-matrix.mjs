// R48 — WHAT EACH FLAG COMBINATION ACTUALLY PAINTS, at phone and desktop.
//
//   node tests/applinks/render-matrix.mjs [outDir]
//
// Four states × four surfaces × two widths. Builds the site once per state (the flags are
// build-time constants — see tests/applinks/matrix.mjs for why that is the design), serves
// out/, and screenshots. Restores app/lib/appLinks.js on every exit path.
//
// The surfaces are the four this round touches, and no others:
//   /app             the dedicated page
//   /public-library  the footer row (Home; the footer is mounted by six pages, this is one)
//   /stories/<slug>  the story tail panel, scrolled to it
//   /links           the link-in-bio badges, whose gate this round replaced
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = resolve(ROOT, 'app/lib/appLinks.js');
const OUT = process.argv[2] || resolve(ROOT, '.render-matrix');
const PORT = 4331;

const STATES = [
  { key: 'both-off', ios: false, android: false, name: 'both flags FALSE' },
  { key: 'ios-only', ios: true, android: false, name: 'iOS only — TODAY' },
  { key: 'android-only', ios: false, android: true, name: 'Android only' },
  { key: 'both-on', ios: true, android: true, name: 'both live' },
];

const original = await readFile(MODULE, 'utf8');
let restored = false;
const restore = async () => { if (!restored) { restored = true; await writeFile(MODULE, original, 'utf8'); } };
process.on('SIGINT', async () => { await restore(); process.exit(130); });
process.on('SIGTERM', async () => { await restore(); process.exit(143); });

await mkdir(OUT, { recursive: true });

// A story that is NOT the paywalled one — the tail panel is deliberately suppressed there.
const STORY = '1967';

const report = [];

try {
  for (const st of STATES) {
    console.log(`\n── ${st.name}  (ios=${st.ios} android=${st.android})`);
    await writeFile(MODULE, original
      .replace(/export const IOS_APP_LIVE = (?:true|false);/, `export const IOS_APP_LIVE = ${st.ios};`)
      .replace(/export const ANDROID_APP_LIVE = (?:true|false);/, `export const ANDROID_APP_LIVE = ${st.android};`), 'utf8');

    process.stdout.write('   building… ');
    await run('npm', ['run', 'build'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024, timeout: 900_000 });
    console.log('done');

    const server = spawn('npx', ['serve', 'out', '-l', String(PORT), '--no-clipboard'], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 4000));

    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      for (const [width, tag] of [[390, 'phone'], [1280, 'desktop']]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const base = `http://localhost:${PORT}`;

        // What the reader is offered, read off the DOM rather than off the source.
        const seen = {};

        // /app — the whole page is the subject, so a full-page shot.
        await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
        await page.evaluate(() => { for (const el of document.querySelectorAll('.cs-cookie')) el.remove(); });
        await page.waitForTimeout(700);
        seen.app = await page.$$eval('.cs-appinv-cta, .cs-appinv-link', (a) => a.map((x) => x.textContent.trim()));
        await page.screenshot({ path: `${OUT}/${st.key}-app-${tag}.png`, fullPage: true });

        // the footer row, on Home.
        await page.goto(`${base}/public-library`, { waitUntil: 'networkidle' });
        await page.evaluate(() => { for (const el of document.querySelectorAll('.cs-cookie')) el.remove(); });
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(900);
        seen.footer = await page.$$eval('.cs-appinv-link', (a) => a.map((x) => x.textContent.trim()));
        await page.screenshot({ path: `${OUT}/${st.key}-footer-${tag}.png` });

        // the story tail.
        await page.goto(`${base}/stories/${STORY}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => { for (const el of document.querySelectorAll('.cs-cookie')) el.remove(); });
        await page.waitForTimeout(1800);
        const panel = await page.$('.cs-appinv-panel');
        if (panel) { await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(700); }
        else { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.72)); await page.waitForTimeout(700); }
        seen.story = await page.$$eval('.cs-appinv-cta', (a) => a.map((x) => x.textContent.trim()));
        await page.screenshot({ path: `${OUT}/${st.key}-story-${tag}.png` });

        // /links — the badges.
        await page.goto(`${base}/links`, { waitUntil: 'networkidle' });
        await page.evaluate(() => { for (const el of document.querySelectorAll('.cs-cookie')) el.remove(); });
        await page.waitForTimeout(1400);
        seen.links = await page.$$eval('.cs-lk-badge img', (a) => a.map((x) => x.getAttribute('alt')));
        seen.linksNote = await page.$$eval('.cs-lk-soon-line', (a) => a.map((x) => x.textContent.trim()));
        await page.screenshot({ path: `${OUT}/${st.key}-links-${tag}.png`, fullPage: true });

        report.push({ state: st.name, width: tag, ...seen });
        console.log(`   ${tag.padEnd(8)} app=${JSON.stringify(seen.app)} footer=${JSON.stringify(seen.footer)} story=${JSON.stringify(seen.story)} links=${JSON.stringify(seen.links)}${seen.linksNote.length ? ' note=' + JSON.stringify(seen.linksNote) : ''}`);
        await page.close();
      }
    } finally {
      await browser.close();
      server.kill();
      await new Promise((r) => setTimeout(r, 800));
    }
  }
} finally {
  await restore();
  console.log('\n  appLinks.js restored.');
}

console.log(`\n${'─'.repeat(78)}\nWHAT EACH STATE OFFERS\n`);
for (const r of report) {
  console.log(`${r.state.padEnd(22)} ${r.width.padEnd(8)} /app: ${r.app.join(' + ') || '—'}   footer: ${r.footer.join(' + ') || '—'}   story: ${r.story.join(' + ') || '—'}   /links: ${r.links.join(' + ') || '—'}`);
}
console.log(`\nScreenshots in ${OUT}`);
