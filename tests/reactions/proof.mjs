// W13 — THE REACTION PROOF, on the real components in WebKit (Safari is Ikenna's browser) and
// Chromium.
//
//   node tests/reactions/proof.mjs <outDir> [--quick] [--only=frames,row,count,behaviour,stability,hole,zero] [--engine=webkit]
//
// 1. FRAMES. Every reaction, turned on and turned off, frozen at the same instants on two pages:
//    web.html (the real Reaction) and bare.html (the prototype's code VERBATIM from
//    tests/reactions/prototype.verbatim.txt, with its globals). At 390, 820 and 1180 and at 1×
//    and ¼× (K = 4). Math.random is seeded identically, so fire's embers match. Each pair must be
//    PIXEL-IDENTICAL. Side-by-side sheets land in <outDir>/frames (local only, never committed).
// 2. THE ROW, measured as the app's A14: 44px slots, 16px icons, count 5px after, 14px lining
//    tabular figures, cream 72% → full, and 0–99 never moving a neighbour.
// 3. THE COUNT: nothing slides on mount or on a same-value echo; a real change slides once.
// 4. REDUCE MOTION, A FORCED FAILURE, THE PRESS-DOWN, THE 9ms TICK.
// 5. NO LAYOUT SHIFT, NO LONG TASKS while an effect plays.
// 6. THE HOLE: painted in the exact ground, or masked where the ground isn't flat.
// 7. ZERO (W15, ruling 37): a zero is not painted; 0→1 and 1→0 move nothing; 44px throughout.
//
// Exit code 1 on any failure. --quick runs frames at 390 only.
/* global H */ // the harness page's probe handle, used inside page.evaluate callbacks
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHarness } from './harness/build.mjs';
import { serve } from './harness/server.mjs';
import { FAIL_COPY } from '../../app/components/conversation/Reaction.js';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tests/reactions/proof.mjs <outDir> [--quick]'); process.exit(2); }
const QUICK = process.argv.includes('--quick');
const WIDTHS = QUICK ? [390] : [390, 820, 1180];
const KINDS = ['heart', 'like', 'fire'];
mkdirSync(join(OUT, 'frames'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); if (!ok) console.log(`  ✗ ${name} ${detail}`); };

await buildHarness(join(OUT, 'bundle'));
const srv = await serve(join(OUT, 'bundle'));
const U = (side, qs) => `${srv.url}/${side}.html?${new URLSearchParams(qs)}`;

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.rx') && window.H);
  await page.evaluate(() => document.fonts.ready);
}

// ── 1. FRAMES ────────────────────────────────────────────────────────────────
const ON_T = Array.from({ length: 23 }, (_, i) => i * 50);   // 0 … 1100
const OFF_T = Array.from({ length: 14 }, (_, i) => i * 20);  // 0 … 260
async function diff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = async (x) => { const i = new Image(); i.src = `data:image/png;base64,${x}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const A = await load(a), B = await load(b); let n = 0, max = 0;
    for (let k = 0; k < A.length; k += 4) { const d = Math.max(Math.abs(A[k] - B[k]), Math.abs(A[k + 1] - B[k + 1]), Math.abs(A[k + 2] - B[k + 2])); if (d) { n++; max = Math.max(max, d); } }
    return { n, max };
  }, [a.toString('base64'), b.toString('base64')]);
}
async function frames(engine, browser) {
  let pairs = 0, same = 0; const noise = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 420 }, deviceScaleFactor: 2 });
    for (const kind of KINDS) {
      for (const K of [1, 4]) {
        const pages = {};
        for (const side of ['web', 'bare']) {
          pages[side] = await ctx.newPage();
          await pages[side].goto(U(side, { case: 'single', kind, count: 12 }));
          await ready(pages[side]);
          await pages[side].evaluate((k) => H.speed(k), K);
        }
        const sheet = [];
        for (const [phase, times] of [['on', ON_T], ['off', OFF_T]]) {
          for (const t of times) {
            const shot = {};
            for (const side of ['web', 'bare']) {
              const p = pages[side];
              await p.evaluate(async ({ phase, t }) => {
                H.remount(); await new Promise((r) => setTimeout(r, 0));
                H.seed(7);
                if (phase === 'off') {
                  document.querySelector('.rx').click(); await new Promise((r) => setTimeout(r, 0));
                  for (const a of document.getAnimations()) a.finish();
                  document.querySelector('.rx-fx').innerHTML = '';
                }
                document.querySelector('.rx').click(); await new Promise((r) => setTimeout(r, 0));
                for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
                // Two frames, so Chromium has painted the frozen frame before the shot (without
                // this, ~1 in 20 Chromium shots caught the frame before: same DOM, other pixels).
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              }, { phase, t: t * K });
              shot[side] = await p.screenshot({ clip: { x: 84, y: 76, width: 136, height: 92 } });
            }
            pairs++;
            if (shot.web.equals(shot.bare)) same++;
            else {
              // Chromium's rasteriser is not deterministic to the last bit: replaying one frame,
              // ~1 shot in 20 differs by 9 pixels at ≤2/255 on the fire's edge, on whichever side
              // drew second, with identical DOM. That is counted as noise and reported; anything
              // larger fails.
              const d = await diff(pages.web, shot.web, shot.bare);
              if (engine === 'chromium' && d.max <= 2 && d.n <= 32) noise.push(`${w} ${kind} ${K === 1 ? '1×' : '¼×'} ${phase} t=${t}: ${d.n}px ≤${d.max}/255`);
              else check(`frames ${engine} ${w} ${kind} ${K === 1 ? '1×' : '¼×'} ${phase} t=${t}`, false, `web ≠ bare: ${d.n}px, up to ${d.max}/255`);
            }
            sheet.push([phase, t, shot.web.toString('base64'), shot.bare.toString('base64')]);
          }
        }
        for (const p of Object.values(pages)) await p.close();
        const sp = await ctx.newPage();
        await sp.setContent(`<body style="margin:0;padding:12px;background:#111;color:#bbb;font:11px -apple-system,sans-serif">
          <div style="margin-bottom:8px">${engine} · ${w}px · ${kind} · ${K === 1 ? '1×' : '¼×'} — left: web (the real Reaction), right: bare (the prototype verbatim)</div>
          <div style="display:grid;grid-template-columns:repeat(4,auto);gap:6px 18px;justify-content:start">
          ${sheet.map(([ph, t, a, b]) => `<div><div>${ph} ${t}ms</div><img src="data:image/png;base64,${a}" style="width:136px"><img src="data:image/png;base64,${b}" style="width:136px;margin-left:2px"></div>`).join('')}
          </div></body>`);
        writeFileSync(join(OUT, 'frames', `${engine}-${w}-${kind}-${K === 1 ? '1x' : 'quarter'}.png`), await sp.screenshot({ fullPage: true }));
        await sp.close();
      }
    }
    await ctx.close();
  }
  check(`frames ${engine}: web and bare identical`, pairs === same + noise.length, `${same}/${pairs} pixel-exact${noise.length ? `, ${noise.length} within Chromium raster noise` : ''}`);
  if (noise.length) results.push({ name: `frames ${engine}: raster noise`, ok: true, detail: noise.join('; ') });
  return { pairs, same, noise: noise.length };
}

// ── 2. THE ROW ───────────────────────────────────────────────────────────────
async function row(engine, browser) {
  for (const w of [390, 820, 1180]) {
    for (const set of ['comment', 'square']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 600 }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.goto(U('web', { case: 'row', set, count: 0 }));
      await ready(p);
      const m = await p.evaluate(() => [...document.querySelectorAll('.rx')].map((b) => {
        const r = b.getBoundingClientRect(), i = b.querySelector('.rx-icon').getBoundingClientRect(), c = b.querySelector('.rx-count').getBoundingClientRect();
        const cs = getComputedStyle(b.querySelector('.rx-count'));
        return { kind: b.dataset.kind, w: r.width, h: r.height, iconL: i.left - r.left, iconW: i.width, gap: c.left - i.right, fs: cs.fontSize, fvn: cs.fontVariantNumeric, color: cs.color };
      }));
      const tag = `row ${engine} ${w} ${set}`;
      check(`${tag}: kinds`, m.map((x) => x.kind).join() === (set === 'comment' ? 'heart,fire' : 'heart,like,fire'), m.map((x) => x.kind).join());
      for (const x of m) {
        check(`${tag} ${x.kind}: 44×44 slot`, x.w === 44 && x.h === 44, `${x.w}×${x.h}`);
        check(`${tag} ${x.kind}: 16px icon at the slot's edge`, x.iconW === 16 && x.iconL === 0, `${x.iconW}px at ${x.iconL}`);
        check(`${tag} ${x.kind}: count 5px after`, Math.abs(x.gap - 5) < 0.01, x.gap);
        check(`${tag} ${x.kind}: 14px lining tabular`, x.fs === '14px' && /lining-nums/.test(x.fvn) && /tabular-nums/.test(x.fvn), `${x.fs} ${x.fvn}`);
        check(`${tag} ${x.kind}: cream 72% at rest`, x.color === 'rgba(241, 228, 200, 0.72)', x.color);
      }
      // Tabular: all ten digits the same advance in the count's own face.
      const adv = await p.evaluate(() => {
        const box = document.querySelector('.rx-count');
        return [...'0123456789'].map((d) => { const s = document.createElement('span'); s.textContent = d + d; box.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; });
      });
      check(`${tag}: digits share one advance`, Math.max(...adv) - Math.min(...adv) < 0.01, adv.map((x) => x.toFixed(2)).join(' '));
      // 0–99 never moves a neighbour; beyond that a slot widens only as far as it must.
      const geom = async () => p.evaluate(() => ({
        slots: [...document.querySelectorAll('.rx')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.width]; }),
        reply: document.getElementById('reply').getBoundingClientRect().left,
        need: [...document.querySelectorAll('.rx')].map((b) => 16 + 5 + b.querySelector('.rx-count').getBoundingClientRect().width + 10),
      }));
      const base = await geom();
      let moved = [];
      for (const n of [0, 1, 7, 9, 10, 42, 88, 99]) {
        await p.evaluate((n) => { for (const k of ['heart', 'like', 'fire']) H.set(k, { count: n }); }, n);
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
        const g = await geom();
        if (JSON.stringify(g.slots) !== JSON.stringify(base.slots) || g.reply !== base.reply) moved.push(n);
      }
      check(`${tag}: 0–99 never moves a neighbour`, moved.length === 0, moved.length ? `moved at ${moved}` : '');
      await p.evaluate(() => { for (const k of ['heart', 'like', 'fire']) H.set(k, { count: 88 }); });
      await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
      const clear2 = await p.evaluate(() => { const b = document.querySelector('.rx'); return b.getBoundingClientRect().right - b.querySelector('.rx-count').getBoundingClientRect().right; });
      // Ruling 36 (26 Sept): the 44px slot stays, with 9.25px after a two-digit count. That is
      // WebKit's measure (Safari: two Cormorant digits at 14px are 13.75px). Headless Chromium on
      // Linux has no subpixel glyph positioning and rounds each digit's advance to 7px, so there
      // the clear is what the same slot leaves, 9px: held to the slot's arithmetic, not to 9.25.
      const pair = adv[8];
      const ruled = engine === 'webkit' ? Math.abs(clear2 - 9.25) < 0.02 : Math.abs(clear2 - (44 - 16 - 5 - pair)) < 0.02 && clear2 >= 9;
      check(`${tag}: two digits clear ${engine === 'webkit' ? '9.25px' : 'what the 44 leaves'} (ruling 36, 26 Sept)`, ruled, `${clear2.toFixed(2)}px, digits ${pair.toFixed(2)}px`);
      results.push({ name: `${tag}: two-digit clear`, ok: true, detail: `${clear2.toFixed(2)}px` });
      for (const n of [100, 999, 12345]) {
        await p.evaluate((n) => { for (const k of ['heart', 'like', 'fire']) H.set(k, { count: n }); }, n);
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
        const g = await geom();
        const ok = g.slots.every(([, wd], i) => Math.abs(wd - Math.max(44, g.need[i])) < 0.02) && g.slots.some(([, wd]) => wd > 44);
        check(`${tag}: ${n} widens only as far as it must`, ok, g.slots.map(([, wd], i) => `${wd.toFixed(2)}/${g.need[i].toFixed(2)}`).join(' '));
      }
      await ctx.close();
    }
  }
}

// ── 3. THE COUNT ─────────────────────────────────────────────────────────────
async function count(engine, browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 420 } });
  const p = await ctx.newPage();
  await p.goto(U('web', { case: 'single', kind: 'heart', count: 12 }));
  await ready(p);
  const state = () => p.evaluate(() => ({
    ns: [...document.querySelectorAll('.rx-count .n')].map((n) => n.textContent),
    anims: document.querySelector('.rx-count').getAnimations({ subtree: true }).length,
  }));
  const tick = () => p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  let s = await state();
  check(`count ${engine}: mount shows the number, no slide`, s.ns.join() === '12' && s.anims === 0, JSON.stringify(s));
  await p.evaluate(() => H.set('heart', { count: 12 })); await tick();
  s = await state();
  check(`count ${engine}: a same-value echo moves nothing`, s.ns.join() === '12' && s.anims === 0, JSON.stringify(s));
  await p.evaluate(() => H.set('heart', { count: 13 })); await tick();
  s = await state();
  const dirUp = await p.evaluate(() => { const [o, n] = document.querySelectorAll('.rx-count .n'); return [o.getAnimations()[0]?.effect.getKeyframes().at(-1).transform, n.getAnimations()[0]?.effect.getKeyframes()[0].transform]; });
  check(`count ${engine}: a real change slides once, upward`, s.ns.join() === '12,13' && s.anims === 2 && dirUp[0] === 'translateY(-100%)' && dirUp[1] === 'translateY(100%)', JSON.stringify({ ...s, dirUp }));
  await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => H.set('heart', { count: 13 })); await tick();
  s = await state();
  check(`count ${engine}: the echo after a change moves nothing`, s.ns.join() === '13' && s.anims === 0, JSON.stringify(s));
  await p.evaluate(() => H.set('heart', { count: 12 })); await tick();
  const dirDown = await p.evaluate(() => { const [o, n] = document.querySelectorAll('.rx-count .n'); return [o.getAnimations()[0]?.effect.getKeyframes().at(-1).transform, n.getAnimations()[0]?.effect.getKeyframes()[0].transform]; });
  check(`count ${engine}: a decrease slides downward`, dirDown[0] === 'translateY(100%)' && dirDown[1] === 'translateY(-100%)', JSON.stringify(dirDown));
  await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => H.remount()); await tick();
  s = await state();
  check(`count ${engine}: a remount is a mount — no slide`, s.anims === 0 && s.ns.length === 1, JSON.stringify(s));
  // The tap itself: exactly one slide, and the count at full strength.
  await p.evaluate(() => document.querySelector('.rx').click()); await tick();
  s = await state();
  const col = await p.evaluate(() => getComputedStyle(document.querySelector('.rx-count')).color);
  check(`count ${engine}: a tap slides once and goes to full strength`, s.ns.join() === '12,13' && s.anims === 2 && col === 'rgb(241, 228, 200)', JSON.stringify({ ...s, col }));
  await ctx.close();
}

// ── 4. REDUCE MOTION, FAILURE, PRESS, TICK ───────────────────────────────────
async function behaviour(engine, browser) {
  // Reduce Motion: state and count change at once, no burst.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 420 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    for (const kind of KINDS) {
      await p.goto(U('web', { case: 'single', kind, count: 12 }));
      await ready(p);
      await p.mouse.move(128, 142); await p.mouse.down(); await p.mouse.up();
      await p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
      const r = await p.evaluate(() => ({
        anims: document.getAnimations().length, fx: document.querySelector('.rx-fx').childNodes.length,
        on: getComputedStyle(document.querySelector('.rx-on')).opacity, off: getComputedStyle(document.querySelector('.rx-off')).opacity,
        ns: [...document.querySelectorAll('.rx-count .n')].map((n) => n.textContent).join(),
      }));
      check(`reduce ${engine} ${kind}: at once, no burst, no slide, no press`, r.anims === 0 && r.fx === 0 && r.on === '1' && r.off === '0' && r.ns === '13', JSON.stringify(r));
    }
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 600 } });
  const p = await ctx.newPage();
  // A forced failure: back off, a ±3px shake over 300ms, and the words.
  for (const kind of ['heart', 'fire']) {
    await p.goto(U('web', { case: 'row', set: 'comment', count: 12 }));
    await ready(p);
    await p.evaluate(() => { H.mode = 'fail'; });
    await p.click(`.rx[data-kind="${kind}"]`);
    await p.waitForFunction(() => document.querySelector('.rx-note').textContent.length > 0, null, { timeout: 3000 });
    const r = await p.evaluate((kind) => {
      const b = document.querySelector(`.rx[data-kind="${kind}"]`);
      const shake = b.querySelector('.rx-icon').getAnimations()[0];
      return {
        pressed: b.getAttribute('aria-pressed'), on: b.querySelector('.rx-on').style.opacity, off: b.querySelector('.rx-off').style.opacity,
        count: [...b.querySelectorAll('.rx-count .n')].map((n) => n.textContent).at(-1),
        note: document.querySelector('.rx-note').textContent, role: document.querySelector('.rx-note').getAttribute('role'),
        shake: shake && { d: shake.effect.getTiming().duration, xs: shake.effect.getKeyframes().map((k) => k.transform) },
        fx: b.querySelector('.rx-fx').childNodes.length,
      };
    }, kind);
    const xs = r.shake?.xs.join('|') || '';
    check(`failure ${engine} ${kind}: back off, count restored`, r.pressed === 'false' && r.on === '0' && r.off === '1' && r.count === '12', JSON.stringify(r));
    check(`failure ${engine} ${kind}: shakes ±3px over 300ms`, r.shake?.d === 300 && xs.includes('translateX(-3px)') && xs.includes('translateX(3px)'), JSON.stringify(r.shake));
    check(`failure ${engine} ${kind}: says so`, r.note === FAIL_COPY && r.role === 'status', r.note);
    check(`failure ${engine} ${kind}: the burst is cleared`, r.fx === 0, `fx children ${r.fx}`);
  }
  // Press-down: .88 over 90ms on pointer down, back over 160ms.
  {
    await p.goto(U('web', { case: 'single', kind: 'heart', count: 12 }));
    await ready(p);
    await p.mouse.move(128, 142); await p.mouse.down();
    const d = await p.evaluate(() => { const a = document.querySelector('.rx-press').getAnimations()[0]; return a && { d: a.effect.getTiming().duration, to: a.effect.getKeyframes().at(-1).transform }; });
    await p.mouse.up();
    const u = await p.evaluate(() => { const a = document.querySelector('.rx-press').getAnimations()[0]; return a && { d: a.effect.getTiming().duration, to: a.effect.getKeyframes().at(-1).transform }; });
    check(`press ${engine}: .88 over 90ms down, back over 160ms`, d?.d === 90 && /^scale\(0?\.88\)$/.test(d?.to) && u?.d === 160 && u?.to === 'scale(1)', JSON.stringify({ d, u }));
  }
  // The 9ms tick lands as the icon arrives (the on-animation's peak). Android only in life;
  // here navigator.vibrate is stubbed so the timing can be read.
  for (const [kind, at] of [['heart', 200 + 470 * .44], ['like', 90 + 540 * .34], ['fire', 90 + 640 * .3]]) {
    await p.goto(U('web', { case: 'single', kind, count: 12 }));
    await ready(p);
    const v = await p.evaluate(() => new Promise((res) => {
      const t0 = performance.now();
      navigator.vibrate = (ms) => { res({ at: performance.now() - t0, ms }); return true; };
      document.querySelector('.rx').click();
      setTimeout(() => res(null), 2000);
    }));
    check(`tick ${engine} ${kind}: 9ms at ${at.toFixed(0)}ms`, v && v.ms === 9 && v.at >= at - 1 && v.at < at + 60, JSON.stringify(v));
  }
  await ctx.close();
}

// ── 5. NO LAYOUT SHIFT, NO LONG TASKS ────────────────────────────────────────
async function stability(engine, browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 600 } });
  const p = await ctx.newPage();
  await p.goto(U('web', { case: 'row', set: 'square', count: 12 }));
  await ready(p);
  const r = await p.evaluate(async () => {
    const out = { shifts: 0, longtasks: 0, moved: 0, maxGap: 0, frames: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.shifts += e.value; }).observe({ type: 'layout-shift', buffered: true }); out.cls = true; } catch { out.cls = false; }
    try { new PerformanceObserver((l) => { out.longtasks += l.getEntries().length; }).observe({ type: 'longtask' }); out.lt = true; } catch { out.lt = false; }
    const nodes = [document.querySelector('#above'), document.querySelector('#below'), document.querySelector('#reply'), ...document.querySelectorAll('.rx, .rx-count')];
    const snap = () => nodes.map((n) => { const b = n.getBoundingClientRect(); return `${b.left},${b.top},${b.width},${b.height}`; }).join('|');
    const base = snap();
    for (const b of document.querySelectorAll('.rx')) {
      b.click();
      const t0 = performance.now(); let last = t0;
      while (performance.now() - t0 < 1300) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); out.maxGap = Math.max(out.maxGap, now - last); last = now; out.frames++;
        if (snap() !== base) out.moved++;
      }
    }
    return out;
  });
  check(`stability ${engine}: nothing in the row or around it moves`, r.moved === 0, JSON.stringify(r));
  if (r.cls) check(`stability ${engine}: layout-shift score 0`, r.shifts === 0, r.shifts);
  if (r.lt) check(`stability ${engine}: no long tasks`, r.longtasks === 0, r.longtasks);
  check(`stability ${engine}: no frame over 50ms`, r.maxGap < 50, `${r.maxGap.toFixed(1)}ms over ${r.frames} frames`);
  await ctx.close();
}

// ── 6. THE HOLE: painted on a flat ground, masked on one that isn't ─────────
// The burst is a disc hollowed into a ring. On a flat ground the hole is painted in that
// ground's colour (resolveBg); on a gradient it is cut out with a mask (W13-MASK). Either way,
// at 200ms into a heart — the outline gone (110ms), the filled heart not yet begun (200ms), no
// spark yet (230ms), the hole opening (165ms) — a point 2.5px above the centre must show the
// GROUND, and a point 7px above must show the RING.
async function hole(engine, browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 420 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const px = async (x, y) => { const png = (await p.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64'); return p.evaluate(async (b) => { const i = new Image(); i.src = `data:image/png;base64,${b}`; await i.decode(); const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); }, png); };
  for (const [label, ground] of [['flat', '#0a0a0a'], ['gradient', 'linear-gradient(90deg, #1a1030, #3a2a10)']]) {
    await p.goto(U('web', { case: 'single', kind: 'heart', count: 12, ground }));
    await ready(p);
    const ic = await p.locator('.rx-icon').boundingBox();
    const cx = ic.x + ic.width / 2, cy = ic.y + ic.height / 2;
    const [hx, hy] = [Math.round(cx), Math.round(cy - 2.5)], [rx, ry] = [Math.round(cx), Math.round(cy - 7)];
    const groundIn = await px(hx, hy + 80), groundRing = await px(rx, ry + 80); // the same x, clear of it all
    const mode = await p.evaluate(async () => {
      document.querySelector('.rx').click(); await new Promise((r) => setTimeout(r, 0));
      for (const an of document.getAnimations()) { an.pause(); an.currentTime = 200; }
      return document.querySelector('.rx-fx mask') ? 'mask' : 'painted';
    });
    const inHole = await px(hx, hy), inRing = await px(rx, ry);
    const near = (u, v, d = 2) => u.every((x, i) => Math.abs(x - v[i]) <= d);
    check(`hole ${engine} ${label}: ${label === 'flat' ? 'painted' : 'masked'}`, mode === (label === 'flat' ? 'painted' : 'mask'), mode);
    check(`hole ${engine} ${label}: the ground shows through the hole`, near(inHole, groundIn), `hole ${inHole} ground ${groundIn}`);
    check(`hole ${engine} ${label}: the ring is there around it`, !near(inRing, groundRing, 12), `ring ${inRing} ground ${groundRing}`);
    await p.screenshot({ path: join(OUT, `hole-${engine}-${label}.png`), clip: { x: cx - 30, y: cy - 30, width: 60, height: 60 } });
  }
  await ctx.close();
}

// ── 7. ZERO (W15, ruling 37, 26 Sept) ──────────────────────────────────────────
// A count is hidden until the first reaction: zero shows the icon alone. The "0" keeps its box
// (visibility, not display), so the slot keeps its 44px and 0→1 / 1→0 move nothing.
async function zero(engine, browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 420 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const tick = () => p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  const settle = async () => { await p.evaluate(() => document.getAnimations().forEach((a) => a.finish())); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const state = () => p.evaluate(() => ({
    ns: [...document.querySelectorAll('.rx-count .n')].map((n) => `${n.textContent}${getComputedStyle(n).visibility === 'hidden' ? ':hidden' : ''}`),
    anims: document.querySelector('.rx-count').getAnimations({ subtree: true }).length,
    w: document.querySelector('.rx').getBoundingClientRect().width,
  }));
  // The button's own pixels; and the same button with its numbers taken out (icon alone).
  const clip = async () => { const b = await p.locator('.rx').boundingBox(); return p.screenshot({ clip: { x: b.x, y: b.y - 4, width: b.width + 20, height: b.height + 8 } }); };
  const iconOnly = async () => {
    const saved = await p.evaluate(() => { const box = document.querySelector('.rx-count'); const w = box.getBoundingClientRect().width; const kids = [...box.childNodes]; window.__kids = kids; box.replaceChildren(); box.style.width = `${w}px`; return true; });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shot = await clip();
    await p.evaluate(() => { const box = document.querySelector('.rx-count'); box.replaceChildren(...window.__kids); box.style.width = ''; });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return shot && saved ? shot : null;
  };
  for (const kind of KINDS) {
    await p.goto(U('web', { case: 'single', kind, count: 0 }));
    await ready(p);
    let s = await state();
    check(`zero ${engine} ${kind}: mount at 0 — the 0 is there but not visible, no slide`, s.ns.join() === '0:hidden' && s.anims === 0, JSON.stringify(s));
    check(`zero ${engine} ${kind}: the 44px slot at 0`, s.w === 44, s.w);
    const a = await clip(), bare = await iconOnly();
    check(`zero ${engine} ${kind}: at 0 no digit is painted (pixel-identical to the icon alone)`, a.equals(bare), a.equals(bare) ? '' : JSON.stringify(await diff(p, a, bare)));
    const aria = await p.evaluate(() => document.querySelector('.rx').getAttribute('aria-label'));
    check(`zero ${engine} ${kind}: the label names no zero`, !/\d/.test(aria), aria);
    // 0 → 1: the 1 slides in once; nothing leaves that can be seen.
    await p.evaluate((k) => H.set(k, { count: 1 }), kind); await tick();
    s = await state();
    check(`zero ${engine} ${kind}: 0→1 slides the 1 in once, no visible 0 leaving`, s.ns.join() === '0:hidden,1' && s.anims === 2, JSON.stringify(s));
    await settle();
    s = await state();
    check(`zero ${engine} ${kind}: at 1 the 1 shows, 44px`, s.ns.join() === '1' && s.w === 44, JSON.stringify(s));
    const one = await clip();
    check(`zero ${engine} ${kind}: at 1 a digit is painted (the pixel check can see one)`, !one.equals(bare));
    // 1 → 0: the 1 slides out; nothing arrives that can be seen.
    await p.evaluate((k) => H.set(k, { count: 0 }), kind); await tick();
    s = await state();
    check(`zero ${engine} ${kind}: 1→0 slides the 1 out, nothing visible arriving`, s.ns.join() === '1,0:hidden' && s.anims === 2, JSON.stringify(s));
    await settle();
    s = await state();
    const back = await clip();
    check(`zero ${engine} ${kind}: back at 0 — icon alone again, 44px`, s.ns.join() === '0:hidden' && s.w === 44 && back.equals(bare), JSON.stringify(s));
    // 99 holds the slot too.
    await p.evaluate((k) => H.set(k, { count: 99 }), kind); await settle();
    s = await state();
    check(`zero ${engine} ${kind}: 44px at 99`, s.w === 44 && s.ns.join() === '99', JSON.stringify(s));
  }
  // A real tap from 0: one slide, the 1 visible, at full strength.
  await p.goto(U('web', { case: 'single', kind: 'heart', count: 0 }));
  await ready(p);
  await p.evaluate(() => document.querySelector('.rx').click()); await tick();
  let s = await state();
  const col = await p.evaluate(() => getComputedStyle(document.querySelector('.rx-count')).color);
  check(`zero ${engine}: a first tap slides the 1 in once, at full strength`, s.ns.join() === '0:hidden,1' && s.anims === 2 && col === 'rgb(241, 228, 200)', JSON.stringify({ ...s, col }));
  await ctx.close();

  // Reduce Motion: the 1 at once; back to nothing at once.
  {
    const rc = await browser.newContext({ viewport: { width: 390, height: 420 }, reducedMotion: 'reduce' });
    const q = await rc.newPage();
    await q.goto(U('web', { case: 'single', kind: 'heart', count: 0 }));
    await ready(q);
    const st = () => q.evaluate(() => ({ ns: [...document.querySelectorAll('.rx-count .n')].map((n) => `${n.textContent}${getComputedStyle(n).visibility === 'hidden' ? ':hidden' : ''}`).join(), anims: document.getAnimations().length }));
    await q.evaluate(() => document.querySelector('.rx').click()); await q.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const up = await st();
    check(`zero ${engine}: Reduce Motion shows the 1 at once`, up.ns === '1' && up.anims === 0, JSON.stringify(up));
    await q.evaluate(() => document.querySelector('.rx').click()); await q.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const down = await st();
    check(`zero ${engine}: Reduce Motion hides it again at once`, down.ns === '0:hidden' && down.anims === 0, JSON.stringify(down));
    await rc.close();
  }

  // Nothing in or around the row moves at 0→1 or 1→0 — the same measure as stability(), every
  // frame through a tap on each button (0→1) and a second tap (1→0), both sets.
  for (const set of ['comment', 'square']) {
    const sc = await browser.newContext({ viewport: { width: 390, height: 600 } });
    const q = await sc.newPage();
    await q.goto(U('web', { case: 'row', set, count: 0 }));
    await ready(q);
    const r = await q.evaluate(async () => {
      const out = { shifts: 0, moved: 0, frames: 0, widths: [] };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.shifts += e.value; }).observe({ type: 'layout-shift', buffered: true }); out.cls = true; } catch { out.cls = false; }
      const nodes = [document.querySelector('#above'), document.querySelector('#below'), document.querySelector('#reply'), ...document.querySelectorAll('.rx, .rx-count')];
      const snap = () => nodes.map((n) => { const b = n.getBoundingClientRect(); return `${b.left},${b.top},${b.width},${b.height}`; }).join('|');
      const base = snap();
      for (const pass of [1, 2]) {
        for (const b of document.querySelectorAll('.rx')) {
          b.click();
          const t0 = performance.now();
          while (performance.now() - t0 < 1300) {
            await new Promise((res) => requestAnimationFrame(res));
            out.frames++;
            if (snap() !== base) out.moved++;
          }
          out.widths.push(b.getBoundingClientRect().width);
        }
        out[`pass${pass}`] = [...document.querySelectorAll('.rx-count .n')].map((n) => `${n.textContent}${getComputedStyle(n).visibility === 'hidden' ? ':hidden' : ''}`).join();
      }
      return out;
    });
    const want = set === 'comment' ? 2 : 3;
    check(`zero ${engine} ${set}: 0→1 and 1→0 move nothing in or around the row`, r.moved === 0 && r.frames > 0, JSON.stringify(r));
    check(`zero ${engine} ${set}: the taps went 0→1→0`, r.pass1 === Array(want).fill('1').join() && r.pass2 === Array(want).fill('0:hidden').join(), `${r.pass1} / ${r.pass2}`);
    check(`zero ${engine} ${set}: every slot 44px throughout`, r.widths.every((w) => w === 44), r.widths.join());
    if (r.cls) check(`zero ${engine} ${set}: layout-shift score 0`, r.shifts === 0, r.shifts);
    await sc.close();
  }
}

const ONLY = (process.argv.find((x) => x.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const ENGINE = (process.argv.find((x) => x.startsWith('--engine=')) || '').slice(9);
const want = (k) => !ONLY.length || ONLY.includes(k);
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => !ENGINE || n === ENGINE)) {
  console.log(`— ${name}`);
  const browser = await engine.launch();
  if (want('frames')) { const f = await frames(name, browser); console.log(`  frames: ${f.same}/${f.pairs} pixel-exact${f.noise ? `, ${f.noise} within raster noise` : ''}`); }
  if (want('row')) await row(name, browser);
  if (want('count')) await count(name, browser);
  if (want('behaviour')) await behaviour(name, browser);
  if (want('stability')) await stability(name, browser);
  if (want('hole')) await hole(name, browser);
  if (want('zero')) await zero(name, browser);
  await browser.close();
}
srv.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);
