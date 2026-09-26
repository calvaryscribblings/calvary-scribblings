// W13 — THE REACTION CHOREOGRAPHY. Ikenna approved it on 25 Sept, tapping the prototype
// ("definitely the one"); on 26 Sept he called what it replaces "the worst reaction effect on
// the internet". The block between the PROTOTYPE markers below is that prototype's code,
// VERBATIM, beat for beat. tests/reactions/motion.test.mjs holds it byte-identical to
// tests/reactions/prototype.verbatim.txt, so a "small tidy" inside it fails CI.
//
// Do not retune a duration, an offset, an easing or a colour inside the block. The motion
// is a ruling, not a starting point. The ONE line added inside it is marked W13-MASK: when
// nothing flat sits behind a button, the burst's hole cannot be painted in a colour, so it
// is cut out of the disc with a mask instead (burstMasked, below the block).
//
// The prototype ran on globals: K (speed multiplier) and reduce (Reduce Motion). They are
// module state here. K is 1 in production; only the proof harness changes it (setSpeed).
//
// Everything here runs on click, in the browser. Nothing touches document at import.

let K = 1;
let reduce = false;
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduce = mq.matches;
  mq.addEventListener?.('change', (e) => { reduce = e.matches; });
}
export const setSpeed = (k) => { K = k; };
export const reducedMotion = () => reduce;

// Ikenna's palette, 26 Sept, replacing the prototype's night values. heart and fire are his
// picks by eye; the burst still starts at plum; the rose sparks are hsl(350, 66%, 58%). The
// rest stay as in the prototype. bg is NOT here: it is the exact colour behind each button,
// resolved at the moment of the tap (resolveBg).
export const PALETTE = Object.freeze({
  plum: '#7B3FC4', heart: '#A92339', fire: '#B6281B', rose: 'hsl(350, 66%, 58%)',
  like: '#D4941A', tongue: '#F6B640', gold: '#D8B45A', cream: '#F1E4C8', amber: '#F59E0B',
});

// ─── BEGIN PROTOTYPE (verbatim, 25 Sept) ────────────────────────────────────────────────
const HEART = "M12 20.4c-.28 0-.56-.1-.78-.28C6.7 16.36 3.6 13.6 3.6 9.86 3.6 7.2 5.66 5.1 8.2 5.1c1.52 0 2.88.72 3.8 1.9.92-1.18 2.28-1.9 3.8-1.9 2.54 0 4.6 2.1 4.6 4.76 0 3.74-3.1 6.5-7.62 10.26-.22.18-.5.28-.78.28z";
const LIKE = "M7.4 10.6 10.9 4.3c.35-.62 1.1-.9 1.76-.64.95.37 1.46 1.4 1.2 2.38L13.2 9h4.95c1.32 0 2.3 1.23 2 2.52l-1.35 6.1c-.22 1.02-1.12 1.75-2.17 1.75H7.4zM3.6 10.6h2.6v8.8H3.6z";
const FIRE = "M12 21.2c-3.8 0-6.6-2.7-6.6-6.3 0-2.5 1.3-4.3 2.8-5.9.35 1.35 1.05 2.3 2.05 2.8-.35-3.2 1.05-6.2 3.75-8.5.2 2.5 1.3 4.05 2.6 5.55 1.25 1.45 2 3.05 2 5.1 0 4.35-2.9 7.25-6.6 7.25z";
const TONGUE = "M12 21.2c-1.7 0-2.95-1.15-2.95-2.8 0-1.5 1-2.55 2.15-3.45.2.9.7 1.45 1.35 1.65-.1-1.15.3-2.15 1.15-3 .95 1.2 1.7 2.35 1.7 4 0 2.1-1.45 3.6-3.4 3.6z";
const NS = "http://www.w3.org/2000/svg";
const E = { out:"cubic-bezier(.16,.84,.24,1)", inq:"cubic-bezier(.55,0,.9,.45)", spring:"cubic-bezier(.22,.9,.32,1)" };
function A(el, frames, dur, delay = 0, easing = "linear", fill = "both") { return el.animate(frames, { duration: dur * K, delay: delay * K, easing, fill }); }
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
const at = (a, r) => `translate(${(Math.cos(a) * r).toFixed(2)}px,${(Math.sin(a) * r).toFixed(2)}px)`;
const rad = d => d * Math.PI / 180;
function later(b, ms, fn) { b.st.timers.push(setTimeout(fn, ms * K)); }
function tick(b, ms) { if (navigator.vibrate) later(b, ms, () => navigator.vibrate(9)); }
function clear(b) { b.st.timers.forEach(clearTimeout); b.st.timers = []; [b.st.off, b.st.on, b.st.icon, ...b.st.on.querySelectorAll("path")].forEach(el => el.getAnimations().forEach(a => a.cancel())); b.st.fx.innerHTML = ""; }
function prepFx(b) { const S = b.st.icon.getBoundingClientRect().width || 24; b.st.fx.setAttribute("viewBox", `${-1.5 * S} ${-1.5 * S} ${3 * S} ${3 * S}`); return S; }
function play(b, p) { const S = prepFx(b); ({ heart: heartOn, like: likeOn, fire: fireOn })[b.dataset.kind](b, S, p); later(b, 1100, () => { b.st.fx.innerHTML = ""; }); }
function burst(b, S, R, from, to, delay, bg) {
  if (bg == null) return burstMasked(b, S, R, from, to, delay); // W13-MASK
  const disc = svgEl("circle", { cx: 0, cy: 0, r: R, fill: from });
  const hole = svgEl("circle", { cx: 0, cy: 0, r: R * 1.03, fill: bg });
  b.st.fx.append(disc, hole);
  A(disc, [{ transform: "scale(0)", fill: from }, { transform: "scale(1)", fill: to, offset: .5 }, { transform: "scale(1.1)", opacity: 1, offset: .86 }, { transform: "scale(1.14)", opacity: 0 }], 400, delay, E.out);
  A(hole, [{ transform: "scale(0)" }, { transform: "scale(1.16)" }], 290, delay + 125, E.out);
}
function heartOn(b, S, p) {
  const { off, on } = b.st;
  A(off, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0)", opacity: 0 }], 110, 0, E.inq, "none");
  burst(b, S, S * .6, p.plum, p.heart, 40, p.bg);
  A(on, [{ transform: "scale(0)", opacity: 0 }, { opacity: 1, offset: .1 }, { transform: "scale(1.24)", offset: .44 }, { transform: "scale(.93)", offset: .7 }, { transform: "scale(1)", opacity: 1 }], 470, 200, E.spring, "backwards");
  const cols = [p.rose, p.gold, p.plum, p.cream, p.rose, p.gold];
  for (let i = 0; i < 6; i++) {
    const th = rad(-78 + i * 60);
    [[-8, .085, .95, 0], [8, .055, 1.08, 24]].forEach(([da, r, r1, dl]) => {
      const a = th + rad(da), r0 = S * .42, R1 = S * r1;
      const c = svgEl("circle", { cx: 0, cy: 0, r: S * r, fill: cols[i] });
      b.st.fx.append(c);
      A(c, [{ transform: at(a, r0) + " scale(.4)", opacity: 0 }, { transform: at(a, r0 + (R1 - r0) * .45) + " scale(1)", opacity: 1, offset: .2 }, { transform: at(a, R1) + " scale(.12)", opacity: 0 }], 520, 230 + dl, "cubic-bezier(.12,.72,.26,1)");
    });
  }
  tick(b, 200 + 470 * .44);
}
function likeOn(b, S, p) {
  const { off, on } = b.st, wind = "translateY(1px) rotate(10deg) scale(.86)";
  A(off, [{ transform: "none", opacity: 1 }, { transform: wind, opacity: 1, offset: .75 }, { transform: wind, opacity: 0 }], 100, 0, E.inq, "none");
  burst(b, S, S * .56, "#8a4f10", p.like, 60, p.bg);
  A(on, [{ transform: wind, opacity: 0 }, { opacity: 1, offset: .08 }, { transform: "translateY(-2px) rotate(-22deg) scale(1.3)", offset: .34 }, { transform: "rotate(6deg) scale(.95)", offset: .62 }, { transform: "rotate(-2deg) scale(1.015)", offset: .82 }, { transform: "none", opacity: 1 }], 540, 90, E.spring, "backwards");
  const angs = [-160, -125, -90, -55, -20], cols = [p.gold, p.like, p.cream, p.like, p.gold];
  angs.forEach((d, i) => {
    const a = rad(d), r0 = S * .62, L = S * .3;
    const ln = svgEl("line", { x1: Math.cos(a) * r0, y1: Math.sin(a) * r0, x2: Math.cos(a) * (r0 + L), y2: Math.sin(a) * (r0 + L), stroke: cols[i], "stroke-width": Math.max(1.2, S * .075), "stroke-linecap": "round", "stroke-dasharray": `${L} ${L}`, "stroke-dashoffset": L, opacity: 0 });
    b.st.fx.append(ln);
    A(ln, [{ strokeDashoffset: L, transform: at(a, 0), opacity: 0 }, { opacity: 1, offset: .06 }, { strokeDashoffset: 0, offset: .45 }, { opacity: 1, offset: .9 }, { strokeDashoffset: -L, transform: at(a, S * .14), opacity: 0 }], 400, 170 + i * 14, "cubic-bezier(.25,.7,.3,1)");
  });
  tick(b, 90 + 540 * .34);
}
function fireOn(b, S, p) {
  const { off, on } = b.st, squash = "translateY(1px) scale(1.14,.8)";
  A(off, [{ transform: "none", opacity: 1 }, { transform: squash, opacity: 1, offset: .8 }, { transform: squash, opacity: 0 }], 100, 0, E.inq, "none");
  const id = "g" + Math.random().toString(36).slice(2);
  const defs = svgEl("defs", {}); const g = svgEl("radialGradient", { id });
  [[0, p.amber, .85], [.55, p.fire, .3], [1, p.fire, 0]].forEach(([o, c, a]) => g.append(svgEl("stop", { offset: o, "stop-color": c, "stop-opacity": a })));
  defs.append(g);
  const wrap = svgEl("g", { transform: `translate(0 ${S * .14})` });
  const glow = svgEl("circle", { cx: 0, cy: 0, r: S * .75, fill: `url(#${id})` });
  wrap.append(glow); b.st.fx.append(defs, wrap);
  A(glow, [{ transform: "scale(.3)", opacity: 0 }, { transform: "scale(1)", opacity: .9, offset: .3 }, { transform: "scale(1.5)", opacity: 0 }], 600, 70, E.out);
  A(on, [{ transform: squash, opacity: 0 }, { opacity: 1, offset: .08 }, { transform: "scale(.84,1.38) rotate(-4deg)", offset: .3 }, { transform: "scale(1.07,.93) rotate(3deg)", offset: .48 }, { transform: "scale(.97,1.07) rotate(-1.5deg)", offset: .66 }, { transform: "scale(1.01,.99)", offset: .84 }, { transform: "none", opacity: 1 }], 640, 90, E.spring, "backwards");
  A(on.querySelector(".tongue"), [{ fill: "#fff6d8" }, { fill: "#ffd36b", offset: .4 }, { fill: p.tongue }], 620, 90, "ease-out", "backwards");
  const ew = svgEl("g", { transform: `translate(0 ${S * .1})` }); b.st.fx.append(ew);
  const cols = [p.amber, p.fire, "#ffd27a"];
  for (let i = 0; i < 7; i++) {
    const x0 = (Math.random() - .5) * S * .36, dy = -S * (1.05 + Math.random() * .5), d = (Math.random() < .5 ? -1 : 1) * S * (.12 + Math.random() * .14);
    const c = svgEl("circle", { cx: 0, cy: 0, r: S * (.045 + Math.random() * .03), fill: cols[i % 3] });
    ew.append(c);
    const t = (x, y) => `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
    A(c, [{ transform: t(x0, 0) + " scale(.6)", opacity: 0 }, { transform: t(x0 + d, dy * .45) + " scale(1)", opacity: 1, offset: .2 }, { transform: t(x0 - d * .6, dy) + " scale(.3)", opacity: 0 }], 560 + i * 25, 140 + i * 32, "cubic-bezier(.25,.6,.35,1)");
  }
  tick(b, 90 + 640 * .3);
}
function off(b) {
  A(b.st.on, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.8)", opacity: .4, offset: .45 }, { transform: "scale(1)", opacity: 0 }], 240, 0, E.out, "none");
  A(b.st.off, [{ transform: "scale(.8)", opacity: 0 }, { transform: "scale(.8)", opacity: 0, offset: .4 }, { transform: "scale(1)", opacity: 1 }], 240, 0, E.out, "none");
}
function setCount(b, n) {
  const box = b.st.count, cur = box.querySelector(".n:last-child");
  const dir = n > b.st.n ? 1 : -1; b.st.n = n;
  if (cur && +cur.textContent === n) return;
  const nu = document.createElement("span"); nu.className = "n"; nu.textContent = n;
  if (reduce || !cur) { box.replaceChildren(nu); return; }
  box.querySelectorAll(".n").forEach(o => { if (o !== cur) o.remove(); });
  box.append(nu);
  const o = { duration: 260 * K, easing: "cubic-bezier(.2,.8,.2,1)" };
  cur.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-dir * 100}%)`, opacity: 0 }], { ...o, fill: "forwards" }).onfinish = () => cur.remove();
  nu.animate([{ transform: `translateY(${dir * 100}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], o);
}
// ─── END PROTOTYPE ──────────────────────────────────────────────────────────────────────

// W13-MASK. The same burst, with the hole cut out of the disc rather than painted over it —
// for a button whose ground is not one flat colour. Same radii, same frames, same timings.
function burstMasked(b, S, R, from, to, delay) {
  const id = "m" + Math.random().toString(36).slice(2);
  const box = { x: -1.5 * S, y: -1.5 * S, width: 3 * S, height: 3 * S };
  const mask = svgEl("mask", { id, maskUnits: "userSpaceOnUse", ...box });
  const hole = svgEl("circle", { cx: 0, cy: 0, r: R * 1.03, fill: "#000" });
  mask.append(svgEl("rect", { ...box, fill: "#fff" }), hole);
  const defs = svgEl("defs", {}); defs.append(mask);
  const disc = svgEl("circle", { cx: 0, cy: 0, r: R, fill: from, mask: `url(#${id})` });
  b.st.fx.append(defs, disc);
  A(disc, [{ transform: "scale(0)", fill: from }, { transform: "scale(1)", fill: to, offset: .5 }, { transform: "scale(1.1)", opacity: 1, offset: .86 }, { transform: "scale(1.14)", opacity: 0 }], 400, delay, E.out);
  A(hole, [{ transform: "scale(0)" }, { transform: "scale(1.16)" }], 290, delay + 125, E.out);
}

// ── What the prototype left to its page ─────────────────────────────────────────────────

// The exact colour behind a button: its ancestors' background colours composited from the
// first opaque one up. null when any of them paints an image or a gradient, or blurs what
// is behind it. That ground is not flat, and the burst takes the mask.
export function resolveBg(el) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.backgroundImage !== 'none') return null;
    if (cs.backdropFilter && cs.backdropFilter !== 'none') return null;
    if (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') return null;
    const c = rgba(cs.backgroundColor);
    if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
  }
  if (!layers.length || layers[layers.length - 1][3] < 1) layers.push([255, 255, 255, 1]); // the canvas
  let [r, g, bl] = layers.pop();
  while (layers.length) {
    const [r2, g2, b2, a] = layers.pop();
    r = r2 * a + r * (1 - a); g = g2 * a + g * (1 - a); bl = b2 * a + bl * (1 - a);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)})`;
}
function rgba(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

// The press-down, kept from before W13: scale .88 over 90ms on pointer down, back over
// 160ms. It moves a wrapper OUTSIDE b.st.icon, so clear() on the click never snaps it.
export function pressIn(el) {
  if (reduce) return;
  el.getAnimations().forEach((a) => a.cancel());
  A(el, [{ transform: 'scale(1)' }, { transform: 'scale(.88)' }], 90, 0, E.out, 'forwards');
}
export function pressOut(el) {
  const from = getComputedStyle(el).transform;
  el.getAnimations().forEach((a) => a.cancel());
  if (reduce || !from || from === 'none') return;
  A(el, [{ transform: from }, { transform: 'scale(1)' }], 160, 0, E.out, 'none');
}

// A failed save: the reaction has already turned back off. The icon shakes ±3px over 300ms.
export function shake(b) {
  if (reduce) return;
  A(b.st.icon, [{ transform: 'none' }, { transform: 'translateX(-3px)', offset: .15 }, { transform: 'translateX(3px)', offset: .35 },
    { transform: 'translateX(-3px)', offset: .55 }, { transform: 'translateX(3px)', offset: .75 }, { transform: 'none' }], 300, 0, 'ease-in-out', 'none');
}

export { HEART, LIKE, FIRE, TONGUE, E, clear, play, off, setCount };
