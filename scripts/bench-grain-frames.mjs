// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHAT THE SHIMMER COST — the measurement behind R22's grain removal.
//
//   npx next build && npm run bench:grain
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS IS NOT WHY THE ANIMATION WAS REMOVED, AND THAT MATTERS MORE THAN THE NUMBER.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna, 26 August 2026, shown the animated grain on glass: "doesn't look good at all...
// needs to go very quickly." The look ruled. This script exists so the SECOND reason — R20's
// finding that the shimmer was 22 points of dropped frames — is a number somebody can
// reproduce rather than a claim in a comment, and so that a future round arguing for its
// return has to argue with both halves.
//
// ── WHY BOTH ARMS RUN ON ONE BUILD ────────────────────────────────────────────────────────
//
// R20's figures came from building the site twice. That makes the two arms differ by whatever
// else moved between builds — a re-encoded cover, a different chunk hash, a Chrome update.
// Here the ONLY difference is a stylesheet injected before load:
//
//   with     the removed @keyframes and declaration, read out of GRAIN_ANIMATION_REMOVED
//            in app/bookstore/components/grain.js, put back at runtime
//   without  the build as it ships
//
// Same binary, same covers, same browser process class, same scroll. The delta is the shimmer
// and nothing else. Reading the restored CSS out of the module's own record rather than
// retyping it here is the same discipline the suite uses: one place says what was removed.
//
// ── WHAT "DROPPED" MEANS HERE, AND THE FIRST VERSION OF THIS SCRIPT THAT GOT IT WRONG ─────
//
// Chrome's OWN accounting, out of the trace: every frame the renderer begins emits a
// `PipelineReporter` event, and the ones the compositor failed to present carry
// `state: STATE_DROPPED`. That is the number the DevTools performance panel draws in its
// dropped-frames track, and it is what R20's figures are in.
//
// ⚠ A rAF SAMPLER MEASURES THE WRONG THING HERE, and this script started as one. Counting gaps
// between requestAnimationFrame callbacks reported the shimmer at 1.3 points against R20's 22.
// The sampler was not broken — it was answering a different question. A CSS transform
// animation on a large layer costs the COMPOSITOR, which raster-and-presents; it does not block
// the main thread, so main-thread rAF callbacks keep arriving on time while frames are being
// dropped underneath them. Anyone re-deriving this number with a rAF loop will conclude the
// shimmer was free. It was not.
//
// The ABSOLUTE number depends on the machine, and a Codespace container with --disable-gpu (the
// same launch flags tests/bookstore/playwright.payload.config.mjs uses, deliberately) is a
// harsh one. THE COMPARISON IS THE POINT. Both arms run on the same host, interleaved, three
// times each, and the median is reported.
//
// Do not quote a single run. Do not compare a figure from this script to a figure from a
// laptop. Compare the two arms.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GRAIN_BENCH_PORT || 4337);
const RUNS = Number(process.env.GRAIN_BENCH_RUNS || 3);

// The page and viewport R20 measured, so the figures are comparable to the ones in the header
// of app/bookstore/components/grain.js.
const PATH = '/bookstore';
const VIEWPORT = { width: 1280, height: 900 };

// ~4 seconds of steady wheeling: 120px a tick, a tick every 50ms. Roughly a trackpad flick
// held down, and far enough to pull the lazy covers in below the fold.
const SCROLL_TICKS = 80;
const SCROLL_TICK_MS = 50;

// ── the removed CSS, read from the record rather than retyped ──────────────────────────────
const GRAIN_SRC = readFileSync(join(ROOT, 'app/bookstore/components/grain.js'), 'utf8');
function recorded(name) {
  const m = new RegExp(`^  ${name}: '((?:[^'\\\\]|\\\\.)*)',$`, 'm').exec(GRAIN_SRC);
  if (!m) throw new Error(`GRAIN_ANIMATION_REMOVED no longer records ${name}.`);
  return m[1].replace(/\\'/g, "'");
}
const WAS_KEYFRAMES = recorded('wasKeyframes');
const WAS_DECLARATION = recorded('wasDeclaration');
const GRAIN_CLASS = /^export const GRAIN_CLASS = '([^']+)';/m.exec(GRAIN_SRC)[1];
const RESTORE_CSS = `${WAS_KEYFRAMES}\n.${GRAIN_CLASS}{${WAS_DECLARATION}}`;

// The gate and the currency choice, so the shop renders rather than the curtain.
const GATE_KEY = /^export const GATE_STORAGE_KEY = '([^']+)';/m
  .exec(readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8'))[1];

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, 'tests/reader/app-server.mjs')], {
    env: { ...process.env, APP_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 20000);
    child.stdout.on('data', (b) => {
      if (String(b).includes(String(PORT))) { clearTimeout(t); res(child); }
    });
    child.on('exit', (code) => { clearTimeout(t); rej(new Error(`server exited ${code}`)); });
  });
}

/**
 * One scripted scroll, sampled.
 *
 * The scroll is driven by the SAME rAF loop that samples, so the two cannot get out of step
 * and the measurement is of the frames the page actually produced while moving.
 */
async function measure(browser, { restore }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(([gateKey]) => {
    try {
      window.localStorage.setItem('cs_cookie_consent', 'accepted');
      window.localStorage.setItem(gateKey, '1');
      window.localStorage.setItem('cs_bookstore_currency', 'gbp');
    } catch { /* private mode */ }
  }, [GATE_KEY]);

  if (restore) {
    // Injected as a document-level stylesheet before any script runs, so it is in place for
    // the very first paint — exactly as the shipped declaration used to be.
    await page.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
      });
    }, RESTORE_CSS);
  }

  await page.goto(`http://127.0.0.1:${PORT}${PATH}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.shelf-entry .entry-title', { timeout: 30000 });
  // Let entrance animations (fadeUp) finish, so what is measured is a scroll and not a load.
  await page.waitForTimeout(2000);

  const running = await page.evaluate((cls) => {
    const el = document.querySelector(`.${cls}`);
    return el ? getComputedStyle(el).animationName : 'NO-GRAIN-ELEMENT';
  }, GRAIN_CLASS);

  // ── the trace ────────────────────────────────────────────────────────────────────────────
  // `disabled-by-default-devtools.timeline.frame` is the category that carries PipelineReporter.
  // The trace is collected to a buffer and read back on stop; the scroll happens in between.
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => { events.push(...value); });
  const complete = new Promise((res) => cdp.once('Tracing.tracingComplete', res));

  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['disabled-by-default-devtools.timeline.frame', 'devtools.timeline'],
    },
  });

  // ⚠ A WHEEL, NOT scrollTo(). The first version drove the scroll from a rAF loop calling
  // window.scrollTo every frame, which is a scroll no human produces: it forces a main-thread
  // scroll commit on every single vsync and pushed BOTH arms to ~40% missed, compressing the
  // difference the script exists to show. Wheel events go through the compositor's own scroll
  // path, which is what a reader's trackpad does and what the shimmer actually has to share a
  // compositor with.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  for (let i = 0; i < SCROLL_TICKS; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(SCROLL_TICK_MS);
  }

  await cdp.send('Tracing.end');
  await complete;
  await ctx.close();

  // ── Chrome's own verdict ─────────────────────────────────────────────────────────────────
  //
  // One PipelineReporter per frame the renderer began, carrying a `state` under
  // `args.frame_reporter`. The states that matter:
  //
  //   STATE_PRESENTED_ALL       the frame made it, whole
  //   STATE_PRESENTED_PARTIAL   some of it made it; the rest missed the deadline
  //   STATE_DROPPED             none of it made it
  //   STATE_NO_UPDATE_DESIRED   nothing wanted to change — not a frame anybody expected
  //
  // ⚠ THE DEFINITION IS STATED, NOT INHERITED. "Dropped frames" here means NOT FULLY
  // PRESENTED — dropped plus partial — over the frames that actually wanted to update. That is
  // the DevTools dropped-frames track's shape. R20's harness is not in this repo, so its exact
  // definition cannot be checked; these figures land in the same neighbourhood as its 19.3%
  // baseline, which is reassuring rather than conclusive. Quote the DELTA between the two arms,
  // which is measured the same way on both sides, not the absolute against R20's.
  const reporters = events
    .filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.args?.frame_reporter)
    .map((e) => e.args.frame_reporter);
  const wanted = reporters.filter((f) => f.state !== 'STATE_NO_UPDATE_DESIRED');
  const missed = wanted.filter((f) => f.state === 'STATE_DROPPED' || f.state === 'STATE_PRESENTED_PARTIAL');
  return {
    frames: wanted.length,
    dropped: missed.length,
    pct: wanted.length ? (missed.length / wanted.length) * 100 : 0,
    animationName: running,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const server = await startServer();
const browser = await chromium.launch({
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
    '--disable-software-rasterizer', '--disable-background-networking'],
});

try {
  const arms = { with: [], without: [] };
  // INTERLEAVED, not batched: a container that warms up or throttles part-way through would
  // otherwise hand the whole advantage to whichever arm ran second.
  for (let i = 0; i < RUNS; i++) {
    const a = await measure(browser, { restore: true });
    const b = await measure(browser, { restore: false });
    arms.with.push(a);
    arms.without.push(b);
    console.log(`run ${i + 1}  with ${a.pct.toFixed(1)}% of ${a.frames} (${a.animationName})   without ${b.pct.toFixed(1)}% of ${b.frames} (${b.animationName})`);
  }

  const w = median(arms.with.map((r) => r.pct));
  const wo = median(arms.without.map((r) => r.pct));

  console.log(`\n${PATH} at ${VIEWPORT.width}, medians of ${RUNS} scripted scrolls:\n`);
  console.log(`  WITH the shimmer      ${w.toFixed(1)}% of frames dropped`);
  console.log(`  WITHOUT (as shipped)  ${wo.toFixed(1)}% of frames dropped`);
  console.log(`  the shimmer cost      ${(w - wo).toFixed(1)} points\n`);
  console.log('The animation was removed on how it LOOKED — Ikenna, 26 Aug 2026. This number');
  console.log('is a bonus, and is not a reason to restore it if it ever moves.');

  if (arms.without.some((r) => r.animationName !== 'none')) {
    console.error('\n::error::the shipped build is still animating the grain.');
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.kill();
}
