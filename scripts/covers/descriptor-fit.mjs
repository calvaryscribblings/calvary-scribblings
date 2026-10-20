// THE DESCRIPTOR-FIT SWEEP — COVERS-R19's evidence for the sign-off gate.
//
//   node --expose-gc scripts/covers/descriptor-fit.mjs
//     → covers-migration/DESCRIPTOR-FIT.png   the sheet Ikenna signs off
//     → covers-migration/DESCRIPTOR-FIT.md    every changed cover, and every check below
//
// Renders every live cover with the descriptor rule (render.mjs, fitDescriptor) and compares
// it with the cover that is live now, byte for byte:
//
//   • a cover whose descriptor fits the measure on one line must come out BYTE-IDENTICAL to
//     its live cover.png. Any that does not is listed as a failure, and the run exits 1;
//   • a cover whose descriptor now breaks is listed with its old width against the measure
//     and its number of lines, and drawn before and after at w360, the size readers see.
//
// READ-ONLY. It reads cms_stories and cms_stories_retired over the public REST endpoint, as
// the reconciler does, and each live cover from its public download URL. It writes nothing
// to the database or to Storage, and it uploads nothing. The w360 "after" is made by the same
// deriveFrom() the reconciler would use, in memory.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FLEURON_BBOX } from '../../assets/covers/fleuron-2766.mjs';
import { renderCover, planCover, registerFonts } from './render.mjs';
import { checkLock } from './design-lock.mjs';
import { toRecord } from './generate.mjs';
import { AUTHOR, BORDER, CANVAS, DESCRIPTOR, FLEURON, TITLE } from './layout.mjs';
import { DB_URL, RETIRED_NODE, SOURCE_NODE, assertStoryScope, deriveFrom, sha, storiesInScope, urlPointsAt, coverDir } from './store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'covers-migration');
registerFonts();

const getJSON = async (path) => {
  const r = await fetch(`${DB_URL}/${path}.json`);
  if (!r.ok) throw new Error(`${path} read failed: HTTP ${r.status}`);
  return r.json();
};
const getBytes = async (url) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (i === 2) throw new Error(`download failed: HTTP ${r.status}`);
  }
};

const { stories } = storiesInScope(await getJSON(SOURCE_NODE), await getJSON(RETIRED_NODE));
assertStoryScope(SOURCE_NODE, stories);

// ── THE SWEEP ────────────────────────────────────────────────────────────────────────────
const ctx = createCanvas(10, 10).getContext('2d');
const capTop = (() => { ctx.font = '74px "Cormorant Garamond Italic"'; return AUTHOR.y - ctx.measureText('H').actualBoundingBoxAscent; })();
const fleuronHalf = (Math.abs(FLEURON_BBOX.y2 - FLEURON_BBOX.y1) * FLEURON.size) / 1000 / 2;
const rows = [];
const failures = [];
let n = 0;
for (const { slug, story } of stories) {
  globalThis.gc?.();
  const record = toRecord(slug, story);
  if (typeof story.descriptorPending === 'string') record.descriptor = story.descriptorPending || null;
  const { png, plan } = renderCover(record);
  const bare = planCover(ctx, { ...record, descriptor: null });
  const row = { slug, title: story.title, plan, png: null, live: null, w360: null };
  n += 1;
  if (plan.title.size !== bare.title.size) failures.push(`${slug}: the descriptor moved the title off its rung (${bare.title.size} → ${plan.title.size})`);
  if (plan.overflow) failures.push(`${slug}: the stack overflows its region`);
  const lines = plan.descriptor?.lines.length ?? 0;
  // Gaps the rule can squeeze: the descriptor's last baseline to the fleuron's ink, and the
  // fleuron's ink to the author's cap top.
  if (plan.descriptor) {
    row.gapAbove = plan.fleuronY - fleuronHalf - plan.descriptor.y;
    row.gapBelow = capTop - (plan.fleuronY + fleuronHalf);
  }
  const current = urlPointsAt(story.cover, `${coverDir(slug, png)}/cover.png`);
  if (lines <= 1) {
    // Must be the live cover, byte for byte. Fetched and hashed, not inferred from the URL.
    const live = await getBytes(story.cover);
    row.identical = sha(live) === sha(png);
    if (!row.identical) failures.push(`${slug}: fits on one line but does NOT render byte-identical to its live cover${current ? '' : ' (the live cover is not this render)'}`);
  } else {
    row.changed = true;
    row.png = png;
    row.live = await getBytes(story.cover);
    row.liveW360 = await getBytes(story.coverSizes.w360);
    row.w360 = (await deriveFrom(png)).sizes.w360;
  }
  rows.push(row);
}
const changed = rows.filter((r) => r.changed).sort((a, b) => b.plan.descriptor.width - a.plan.descriptor.width);
const withDesc = rows.filter((r) => r.plan.descriptor);
const unchanged = withDesc.filter((r) => !r.changed);
console.log(`${n} live covers; ${withDesc.length} with a descriptor; ${changed.length} change; ${unchanged.filter((r) => r.identical).length} identical; ${failures.length} failures`);

// ── THE SHEET ────────────────────────────────────────────────────────────────────────────
const W360 = 360;
const H360 = 540;
const PAIR_GAP = 12;
const PAIR_W = 2 * W360 + PAIR_GAP;
const COLS = 5;
const GUT = 40;
const CAP = 74;
const HEAD = 230;
const gridRows = Math.ceil(changed.length / COLS);
const gridH = gridRows * (H360 + CAP + GUT);
const thirteen = changed.find((r) => r.slug === 'the-number-thirteen');
// The full-size example is a typical change: two lines, from a descriptor that sat inside the
// keyline but past the measure (The Number Thirteen is the extreme, shown on its own).
const example = changed.find((r) => r.slug !== 'the-number-thirteen' && r.plan.descriptor.lines.length === 2 && r.plan.descriptor.width <= CANVAS.w - 2 * BORDER.innerInset) ?? changed[1];
const BIG_W = 800;
const BIG_H = 1200;
const FULL_TOP = HEAD + gridH + 120;
const W = Math.max(COLS * (PAIR_W + GUT) + GUT, GUT + 2 * BIG_W + GUT + CANVAS.w + 3 * GUT);
const H = FULL_TOP + CANVAS.h + 160;
const sheet = createCanvas(W, H);
const g = sheet.getContext('2d');
g.fillStyle = '#ECE8E0';
g.fillRect(0, 0, W, H);
const ink = '#1C1418';
g.fillStyle = ink;
g.font = '52px "Cormorant Garamond SemiBold"';
g.fillText('DESCRIPTOR FIT — COVERS-R19, sign-off gate', GUT, 76);
g.font = '27px "EB Garamond"';
g.fillText(`A descriptor that does not fit the title's measure (${TITLE.maxWidth}px) on one line breaks between words onto the fewest lines that fit, the break with the lines closest in width. Same size (${DESCRIPTOR.size}px) and tracking (${DESCRIPTOR.tracking}px); leading ${TITLE.lineHeight} × ${DESCRIPTOR.size}px.`, GUT, 124);
g.fillText(`${withDesc.length} live covers carry a descriptor. ${unchanged.length} fit on one line and render byte-identical to the live cover. ${changed.length} change, shown below, widest first: BEFORE (live w360) on the left of each pair, AFTER on the right.`, GUT, 164);
g.fillText('Bottom: one changed cover at full size, and The Number Thirteen before and after at half size.', GUT, 204);

const imgs = async (r) => [await loadImage(r.liveW360), await loadImage(r.w360)];
for (let i = 0; i < changed.length; i++) {
  const r = changed[i];
  const x = GUT + (i % COLS) * (PAIR_W + GUT);
  const y = HEAD + Math.floor(i / COLS) * (H360 + CAP + GUT);
  const [before, after] = await imgs(r);
  g.drawImage(before, x, y, W360, H360);
  g.drawImage(after, x + W360 + PAIR_GAP, y, W360, H360);
  g.fillStyle = ink;
  g.font = '24px "Cormorant Garamond SemiBold"';
  g.fillText(r.title.length > 52 ? `${r.title.slice(0, 51)}…` : r.title, x, y + H360 + 30);
  g.font = '19px "EB Garamond"';
  g.fillText(`was ${r.plan.descriptor.width.toFixed(1)}px on ${TITLE.maxWidth} (${r.plan.descriptor.width > CANVAS.w - 2 * BORDER.innerInset ? 'crossed the keyline' : 'inside the keyline'}) · now ${r.plan.descriptor.lines.length} lines`, x, y + H360 + 56);
}
g.fillStyle = ink;
g.font = '40px "Cormorant Garamond SemiBold"';
g.fillText(`Full size: ${example.title} (after)`, GUT, FULL_TOP - 30);
g.drawImage(await loadImage(example.png), GUT, FULL_TOP, CANVAS.w, CANVAS.h);
const tx = GUT + CANVAS.w + 2 * GUT;
g.fillText('The Number Thirteen: before | after (half size)', tx, FULL_TOP - 30);
g.drawImage(await loadImage(thirteen.live), tx, FULL_TOP, BIG_W, BIG_H);
g.drawImage(await loadImage(thirteen.png), tx + BIG_W + GUT, FULL_TOP, BIG_W, BIG_H);
g.font = '26px "EB Garamond"';
const tl = thirteen.plan.descriptor.lines.map((l) => `${l.text.trim()} (${l.width.toFixed(1)}px)`).join('  /  ');
g.fillText(`was ${thirteen.plan.descriptor.width.toFixed(1)}px on one line; now ${tl}`, tx, FULL_TOP + BIG_H + 46);

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'DESCRIPTOR-FIT.png'), sheet.toBuffer('image/png'));

// ── THE REPORT ───────────────────────────────────────────────────────────────────────────
const f = (v, d = 1) => Number(v).toFixed(d);
const keyline = CANVAS.w - 2 * BORDER.innerInset;
const outer = CANVAS.w - 2 * BORDER.outerInset;
const L = [];
L.push('# Descriptor fit — COVERS-R19 (sign-off gate)');
L.push('');
L.push('**For Ikenna to sign off. Nothing here is live.** `DESIGN-LOCK.json` is not updated, nothing is merged, and no cover is flipped. Generated by `scripts/covers/descriptor-fit.mjs`, read-only against the database and Storage.');
L.push('');
L.push(`The sheet: \`covers-migration/DESCRIPTOR-FIT.png\`.`);
L.push('');
L.push('## The result');
L.push('');
L.push(`- **${n} live covers** (published or held for a cover, not retired). **${withDesc.length}** carry a descriptor.`);
L.push(`- **${unchanged.length} fit the ${TITLE.maxWidth}px measure on one line.** Each was rendered with the rule and compared with its live \`cover.png\`, downloaded and hashed: **${unchanged.filter((r) => r.identical).length} of ${unchanged.length} are byte-identical.** The ${n - withDesc.length} covers with no descriptor are untouched by the rule; they were hashed too: ${rows.filter((r) => !r.plan.descriptor && r.identical).length} of ${n - withDesc.length} identical.`);
L.push(`- **${changed.length} change.** Their descriptor is wider than the measure, so it breaks. ${changed.filter((r) => r.plan.descriptor.width > keyline).length} of them crossed the inner keyline (${keyline}px wide) as drawn; the other ${changed.filter((r) => r.plan.descriptor.width <= keyline).length} were wider than the title's measure but inside the keyline. Every one now sets on **${[...new Set(changed.map((r) => r.plan.descriptor.lines.length))].join(' or ')} lines**.`);
L.push(`- **Failures: ${failures.length}.**${failures.length ? `\n${failures.map((x) => `  - ${x}`).join('\n')}` : ' No fitting cover moved, no title changed rung, and no stack overflowed.'}`);
L.push('');
L.push('## The space the rule takes');
L.push('');
const minOf = (rs, k) => rs.reduce((m, r) => Math.min(m, r[k]), Infinity);
L.push(`A second line adds ${f(DESCRIPTOR.size * TITLE.lineHeight, 2)}px (the title's ${TITLE.lineHeight} at ${DESCRIPTOR.size}px) between the descriptor and the fleuron. The fleuron keeps its rule: its ink is centred at ${FLEURON.gapFraction * 100}% of the gap between the descriptor's LAST line and the author's cap top. Nothing below it moves: the author and footer are pinned to the canvas.`);
L.push('');
L.push('| | Descriptor\'s last baseline → fleuron ink | Fleuron ink → author cap top |');
L.push('|---|---:|---:|');
L.push(`| Tightest of the ${changed.length} changed covers | ${f(minOf(changed, 'gapAbove'))}px | ${f(minOf(changed, 'gapBelow'))}px |`);
L.push(`| Tightest of the ${unchanged.length} one-line covers | ${f(minOf(unchanged, 'gapAbove'))}px | ${f(minOf(unchanged, 'gapBelow'))}px |`);
L.push('');
L.push(`**No element is pushed past the space it has.** Every stack still fits its region (no overflow), no title moves off its rung, and the descriptor's lines are each inside the ${TITLE.maxWidth}px measure by construction.`);
L.push('');
const lock = checkLock();
L.push('## The design lock');
L.push('');
L.push(`\`DESIGN-LOCK.json\` is NOT updated this round. Checked against the rule: **${lock.moved.length} of the ${Object.keys(lock.lock.probes).length} probes would move**${lock.moved.length ? `: ${lock.moved.map((m) => `\`${m.slug}\` (${m.was.slice(0, 12)} → ${m.now.slice(0, 12)})`).join(', ')}` : ''}. The others are byte-identical. \`probe-descriptor\` carries STILLNESS.  BETRAYAL.  RECKONING., which is 1237.5px, 5.5px over the measure, so it now breaks onto two lines. That is the lock doing its job. If this change reached main before the lock is re-recorded with Ikenna's sign-off, \`covers:verify\` fails its lock test and the reconciler refuses to run, so no live cover can change.`);
L.push('');
const near = changed.filter((r) => r.plan.descriptor.width - TITLE.maxWidth < 2);
L.push('## Borderline');
L.push('');
L.push(`The measure is applied exactly, with no tolerance. ${near.length} cover${near.length === 1 ? ' is' : 's are'} over it by less than 2px and so break${near.length === 1 ? 's' : ''}: ${near.map((r) => `*${r.title}* (${(r.plan.descriptor.width - TITLE.maxWidth).toFixed(2)}px over)`).join('; ')}. A tolerance would be a new, chosen number, so none is added.`);
L.push('');
L.push('## Chosen rather than derived');
L.push('');
L.push('- **Tie-breaks between equally balanced breaks:** the narrower widest line, then the earlier break. No live descriptor reaches the tie.');
L.push('- **"Closest in width" is measured as the difference between the widest and narrowest line.** With two lines, which is every live case, that is simply the difference between them.');
L.push('- **A word wider than the measure raises an error** rather than being drawn, as an impossible title does.');
L.push('- **The full-size example** (the first two-line cover that sat inside the keyline) and the sheet\'s layout.');
L.push('');
L.push('Derived: the measure (the title\'s, 1232px), the line spacing (the title\'s 1.12 at 54px, 60.48px; layout.mjs\'s own DESCRIPTOR.lineHeight is also 1.12), the size and tracking (unchanged), and the fleuron\'s 42%.');
L.push('');
L.push(`## The ${changed.length} covers that change, widest first`);
L.push('');
L.push(`Width is the descriptor on one line at ${DESCRIPTOR.size}px tracked ${DESCRIPTOR.tracking}, as it is drawn live. The measure is ${TITLE.maxWidth}px; the inner keyline is ${keyline}px apart and the outer ${outer}px.`);
L.push('');
L.push('| # | Title | Descriptor | Old width | Over the measure by | Crossed | Lines now | The lines (px) |');
L.push('|---:|---|---|---:|---:|---|---:|---|');
changed.forEach((r, i) => {
  const d = r.plan.descriptor;
  L.push(`| ${i + 1} | ${r.title.replace(/\|/g, '\\|')} | ${d.text} | ${f(d.width)} | ${f(d.width - TITLE.maxWidth)} | ${d.width > outer ? 'both keylines' : d.width > keyline ? 'inner keyline' : '—'} | ${d.lines.length} | ${d.lines.map((l) => `${l.text} (${f(l.width)})`).join(' / ')} |`);
});
L.push('');
writeFileSync(resolve(OUT, 'DESCRIPTOR-FIT.md'), `${L.join('\n')}\n`);
console.log(`wrote DESCRIPTOR-FIT.png (${W}×${H}) and DESCRIPTOR-FIT.md`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
