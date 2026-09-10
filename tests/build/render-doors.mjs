// R50 — WHAT MOVES WHEN THE NOTE GOES. Both states, phone and desktop.
//
//   node tests/build/render-doors.mjs [outDir]
//
// The doors are a CLOCK now, so the only way to photograph the open state is to move the
// clock. Two builds: one with LAUNCH in the future (today's state, doors shut) and one with
// LAUNCH in the past (opening day and after). Restores app/lib/launch.js on every exit path.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
const run = promisify(execFile);
const ROOT = '/workspaces/calvary-scribblings';
const M = `${ROOT}/app/lib/launch.js`;
const OUT = process.argv[2] || `${ROOT}/.render-doors`;
const PORT = 4333;

const orig = await readFile(M, 'utf8');
let done = false;
const restore = async () => { if (!done) { done = true; await writeFile(M, orig, 'utf8'); } };
process.on('SIGINT', async () => { await restore(); process.exit(130); });
await mkdir(OUT, { recursive: true });

const STATES = [
  { key: 'shut', launch: '{ y: 2027, m: 3, d: 14 }', name: 'DOORS SHUT (launch in the future)' },
  { key: 'open', launch: '{ y: 2025, m: 1, d: 2 }', name: 'DOORS OPEN (launch has passed)' },
];
const report = [];

try {
  for (const st of STATES) {
    console.log(`\n── ${st.name}`);
    await writeFile(M, orig.replace(/export const LAUNCH = \{[^}]*\};/, `export const LAUNCH = ${st.launch};`), 'utf8');
    process.stdout.write('   building… ');
    await run('npm', ['run', 'build'], { cwd: ROOT, maxBuffer: 128e6, timeout: 900e3 });
    console.log('done');
    const srv = spawn('npx', ['serve', 'out', '-l', String(PORT), '--no-clipboard'], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 4000));
    const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      for (const [w, tag] of [[390, 'phone'], [1280, 'desktop']]) {
        const p = await b.newPage({ viewport: { width: w, height: 1000 } });
        const seen = {};
        const clean = async () => p.evaluate(() => { for (const el of document.querySelectorAll('.cs-cookie')) el.remove(); });

        // THE GATEWAY — the countdown note under the Book Store door.
        await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await clean(); await p.waitForTimeout(2500);
        seen.gatewayNote = await p.$$eval('.cs-gw-opens', (a) => a.map((x) => x.textContent.trim()));
        seen.gatewayProse = (await p.$$eval('.cs-gw-seo p', (a) => a.map((x) => x.textContent.trim())))[0] || '';
        await p.screenshot({ path: `${OUT}/${st.key}-gateway-${tag}.png` });

        // THE BOOK STORE — the curtain itself. This is the launch-day risk.
        await p.goto(`http://localhost:${PORT}/bookstore`, { waitUntil: 'networkidle' });
        await clean(); await p.waitForTimeout(2800);
        seen.curtain = (await p.$$eval('.bg-gate', (a) => a.length)) > 0;
        seen.curtainDate = (await p.$$eval('.bg-date', (a) => a.map((x) => x.textContent.trim())))[0] || null;
        await p.screenshot({ path: `${OUT}/${st.key}-bookstore-${tag}.png` });

        // /links — the Book Store label suffix.
        await p.goto(`http://localhost:${PORT}/links`, { waitUntil: 'networkidle' });
        await clean(); await p.waitForTimeout(1500);
        seen.linksLabel = (await p.$$eval('.cs-lk-stack a, .cs-lk-stack span', (a) => a.map((x) => x.textContent.trim())))
          .find((t) => /Book Store/.test(t)) || null;
        await p.screenshot({ path: `${OUT}/${st.key}-links-${tag}.png`, fullPage: true });

        report.push({ state: st.name, width: tag, ...seen });
        console.log(`   ${tag.padEnd(8)} gateway note=${JSON.stringify(seen.gatewayNote)}  curtain=${seen.curtain}${seen.curtainDate ? ' ("' + seen.curtainDate + '")' : ''}  /links="${seen.linksLabel}"`);
        await p.close();
      }
    } finally { await b.close(); srv.kill(); await new Promise((r) => setTimeout(r, 800)); }
  }
} finally { await restore(); console.log('\n  launch.js restored.'); }

console.log(`\n${'─'.repeat(78)}\nWHAT MOVES WHEN THE NOTE GOES\n`);
for (const r of report) {
  console.log(`${r.state.split(' (')[0].padEnd(12)} ${r.width.padEnd(8)} gateway note: ${r.gatewayNote.join('') || '— (absent)'}`);
  console.log(`${''.padEnd(12)} ${''.padEnd(8)} curtain: ${r.curtain ? 'UP' : 'DOWN — the shop is open'}`);
  console.log(`${''.padEnd(12)} ${''.padEnd(8)} /links:  ${r.linksLabel}`);
  console.log(`${''.padEnd(12)} ${''.padEnd(8)} prose:   …${r.gatewayProse.slice(-58)}`);
}
console.log(`\nScreenshots in ${OUT}`);
