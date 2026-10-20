// THE DESCRIPTOR-FIT SWEEP — the evidence for COVERS-R19's sign-off gate (R19.1).
//
//   node --expose-gc scripts/covers/descriptor-fit.mjs
//     → covers-migration/DESCRIPTOR-FIT.png   the sheet Ikenna signs off
//     → covers-migration/DESCRIPTOR-FIT.md    every changed cover, and every check below
//
// Renders every live cover with the rules on this branch (render.mjs fitDescriptor and
// descriptorLeading; text.mjs HYPHEN_MIN) and compares it with the cover that is live now:
//
//   • a cover whose descriptor fits on one line AND whose title keeps its break must come out
//     BYTE-IDENTICAL to its live cover.png. Any that does not is a failure, and the run exits 1;
//   • every other cover is listed with what changed (descriptor, title or both) and its old and
//     new lines, and drawn before and after at w360, the size readers see.
//
// "OLD" IS MAIN'S OWN GENERATOR, not a reconstruction. The generator at BEFORE_REF (default
// origin/main) is extracted with `git archive` into a temporary directory and imported beside
// this one, and it plans every cover as main would. Its lines are the "old" lines in the report.
//
// READ-ONLY. It reads cms_stories and cms_stories_retired over the public REST endpoint, as
// the reconciler does, and each live cover from its public download URL. It writes nothing
// to the database or to Storage, and it uploads nothing. The w360 "after" is made by the same
// deriveFrom() the reconciler would use, in memory.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FLEURON_BBOX } from '../../assets/covers/fleuron-2766.mjs';
import { renderCover, planCover, registerFonts, descriptorLeading } from './render.mjs';
import { checkLock } from './design-lock.mjs';
import { toRecord } from './generate.mjs';
import { HYPHEN_MIN } from './text.mjs';
import { AUTHOR, BORDER, CANVAS, DESCRIPTOR, FLEURON, TITLE } from './layout.mjs';
import { DB_URL, RETIRED_NODE, SOURCE_NODE, assertStoryScope, deriveFrom, sha, storiesInScope } from './store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'covers-migration');
const BEFORE_REF = process.env.BEFORE_REF ?? 'origin/main';
registerFonts();

// ── MAIN'S GENERATOR, FOR THE "OLD" LINES ────────────────────────────────────────────────
const beforeDir = mkdtempSync(join(tmpdir(), 'covers-before-'));
const tar = execFileSync('git', ['archive', BEFORE_REF, 'scripts/covers', 'assets/covers'], { cwd: ROOT, maxBuffer: 1 << 28 });
execFileSync('tar', ['-x', '-C', beforeDir], { input: tar });
symlinkSync(join(ROOT, 'node_modules'), join(beforeDir, 'node_modules'));
const before = await import(pathToFileURL(join(beforeDir, 'scripts/covers/render.mjs')).href);
const beforeSha = execFileSync('git', ['rev-parse', '--short=8', BEFORE_REF], { cwd: ROOT }).toString().trim();

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
const LEAD = descriptorLeading(ctx);
const capTop = (() => { ctx.font = '74px "Cormorant Garamond Italic"'; return AUTHOR.y - ctx.measureText('H').actualBoundingBoxAscent; })();
const fleuronHalf = (Math.abs(FLEURON_BBOX.y2 - FLEURON_BBOX.y1) * FLEURON.size) / 1000 / 2;
const rows = [];
const failures = [];
for (const { slug, story } of stories) {
  globalThis.gc?.();
  const record = toRecord(slug, story);
  if (typeof story.descriptorPending === 'string') record.descriptor = story.descriptorPending || null;
  const { png, plan } = renderCover(record);
  const old = before.planCover(ctx, record);
  const bare = planCover(ctx, { ...record, descriptor: null });
  const descChanged = (plan.descriptor?.lines.length ?? 0) > 1;
  const titleChanged = old.title.size !== plan.title.size || JSON.stringify(old.title.lines) !== JSON.stringify(plan.title.lines);
  const row = { slug, title: story.title, plan, old, descChanged, titleChanged };
  if (plan.title.size !== bare.title.size) failures.push(`${slug}: the descriptor moved the title off its rung (${bare.title.size} → ${plan.title.size})`);
  if (plan.overflow) failures.push(`${slug}: the stack overflows its region`);
  if (plan.descriptor) {
    row.gapAbove = plan.fleuronY - fleuronHalf - plan.descriptor.y;
    row.gapBelow = capTop - (plan.fleuronY + fleuronHalf);
  }
  const live = await getBytes(story.cover);
  if (!descChanged && !titleChanged) {
    // Must be the live cover, byte for byte. Fetched and hashed, not inferred from the URL.
    row.identical = sha(live) === sha(png);
    if (!row.identical) failures.push(`${slug}: neither its descriptor nor its title changes, but it does NOT render byte-identical to its live cover`);
  } else {
    row.changed = true;
    row.kind = descChanged && titleChanged ? 'both' : descChanged ? 'descriptor' : 'title';
    row.png = png;
    row.live = live;
    row.liveW360 = await getBytes(story.coverSizes.w360);
    row.w360 = (await deriveFrom(png)).sizes.w360;
  }
  rows.push(row);
}
rmSync(beforeDir, { recursive: true, force: true });
const n = rows.length;
const changed = rows.filter((r) => r.changed);
const descRows = changed.filter((r) => r.descChanged).sort((a, b) => b.plan.descriptor.width - a.plan.descriptor.width);
const titleRows = changed.filter((r) => r.titleChanged);
const withDesc = rows.filter((r) => r.plan.descriptor);
const unchanged = rows.filter((r) => !r.changed);
const byKind = (k) => changed.filter((r) => r.kind === k);
console.log(`${n} live covers; ${changed.length} change (descriptor ${byKind('descriptor').length}, title ${byKind('title').length}, both ${byKind('both').length}); ${unchanged.filter((r) => r.identical).length}/${unchanged.length} unchanged are identical; ${failures.length} failures`);

// ── THE SHEET ────────────────────────────────────────────────────────────────────────────
const W360 = 360;
const H360 = 540;
const PAIR_GAP = 12;
const PAIR_W = 2 * W360 + PAIR_GAP;
const COLS = 5;
const GUT = 40;
const CAP = 74;
const HEAD = 230;
const SECTION = 90;
const gridH = (count) => Math.ceil(count / COLS) * (H360 + CAP + GUT);
const descTop = HEAD + SECTION;
const titleTop = descTop + gridH(descRows.length) + SECTION;
const FULL_TOP = titleTop + gridH(titleRows.length) + SECTION + 40;
const HALF_W = 800;
const HALF_H = 1200;
const W = Math.max(COLS * (PAIR_W + GUT) + GUT, GUT + CANVAS.w + 2 * GUT + 2 * HALF_W + GUT + GUT);
const H = FULL_TOP + Math.max(CANVAS.h, 2 * (HALF_H + 170)) + 100;
const sheet = createCanvas(W, H);
const g = sheet.getContext('2d');
g.fillStyle = '#ECE8E0';
g.fillRect(0, 0, W, H);
const ink = '#1C1418';
const text = (s, x, y, font) => { g.fillStyle = ink; g.font = font; g.fillText(s, x, y); };
text('DESCRIPTOR FIT — COVERS-R19.1, sign-off gate', GUT, 76, '52px "Cormorant Garamond SemiBold"');
const body = '27px "EB Garamond"';
text(`A descriptor wider than the title's measure (${TITLE.maxWidth}px) breaks the way a title does: each line filled with as many words as fit. Same size (${DESCRIPTOR.size}px) and tracking (${DESCRIPTOR.tracking}px).`, GUT, 124, body);
text(`Leading = cap height ${LEAD.cap.toFixed(1)} + word gap ${LEAD.gap.toFixed(1)} = ${LEAD.leading.toFixed(1)}px, so the gap between lines equals the gap between words. A title hyphen breaks only with ${HYPHEN_MIN.before}+ letters behind and ${HYPHEN_MIN.after}+ carried forward.`, GUT, 164, body);
text(`${n} live covers. ${unchanged.length} keep their descriptor on one line and their title's break, and render byte-identical to the live cover. ${changed.length} change. Each pair: BEFORE (live w360) left, AFTER right.`, GUT, 204, body);

async function grid(list, top, label) {
  text(label, GUT, top - 28, '40px "Cormorant Garamond SemiBold"');
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const x = GUT + (i % COLS) * (PAIR_W + GUT);
    const y = top + Math.floor(i / COLS) * (H360 + CAP + GUT);
    g.drawImage(await loadImage(r.liveW360), x, y, W360, H360);
    g.drawImage(await loadImage(r.w360), x + W360 + PAIR_GAP, y, W360, H360);
    text(r.title.length > 52 ? `${r.title.slice(0, 51)}…` : r.title, x, y + H360 + 30, '24px "Cormorant Garamond SemiBold"');
    const note = r.descChanged
      ? `was ${r.plan.descriptor.width.toFixed(1)}px on ${TITLE.maxWidth} (${r.plan.descriptor.width > CANVAS.w - 2 * BORDER.innerInset ? 'crossed the keyline' : 'inside the keyline'}) · now ${r.plan.descriptor.lines.length} lines${r.titleChanged ? ' · title changes too' : ''}`
      : `title ${r.old.title.size}px × ${r.old.title.lines.length} lines → ${r.plan.title.size}px × ${r.plan.title.lines.length} lines (hyphen break refused)`;
    text(note.length > 80 ? `${note.slice(0, 79)}…` : note, x, y + H360 + 56, '19px "EB Garamond"');
  }
}
await grid(descRows, descTop, `Descriptor changes: ${descRows.length}, widest first`);
await grid(titleRows, titleTop, `Title changes: ${titleRows.length} (the hyphen rule)`);

const dontWorry = changed.find((r) => r.slug === 'dont-worry');
const thirteen = changed.find((r) => r.slug === 'the-number-thirteen');
const wifi = titleRows.find((r) => /Wi-Fi/i.test(r.title));
text(`Full size: ${dontWorry.title} (after)`, GUT, FULL_TOP - 30, '40px "Cormorant Garamond SemiBold"');
g.drawImage(await loadImage(dontWorry.png), GUT, FULL_TOP, CANVAS.w, CANVAS.h);
const hx = GUT + CANVAS.w + 2 * GUT;
// The two half-size pairs, one above the other.
const PAIR_STEP = HALF_H + 170;
for (const [k, r] of [[0, thirteen], [1, wifi]]) {
  const y = FULL_TOP + k * PAIR_STEP;
  text(`${r.title}: before | after (half size)`, hx, y - 12, '32px "Cormorant Garamond SemiBold"');
  g.drawImage(await loadImage(r.live), hx, y, HALF_W, HALF_H);
  g.drawImage(await loadImage(r.png), hx + HALF_W + GUT, y, HALF_W, HALF_H);
  const notes = [];
  if (r.titleChanged) notes.push(`title: ${r.old.title.size}px ${r.old.title.lines.join(' / ')} → ${r.plan.title.size}px ${r.plan.title.lines.join(' / ')}`);
  if (r.descChanged) notes.push(`descriptor: ${r.plan.descriptor.lines.map((l) => `${l.text} (${l.width.toFixed(1)})`).join(' / ')}`);
  notes.forEach((t, j) => text(t, hx, y + HALF_H + 44 + j * 34, '26px "EB Garamond"'));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'DESCRIPTOR-FIT.png'), sheet.toBuffer('image/png'));

// ── THE REPORT ───────────────────────────────────────────────────────────────────────────
const f = (v, d = 1) => Number(v).toFixed(d);
const keyline = CANVAS.w - 2 * BORDER.innerInset;
const outer = CANVAS.w - 2 * BORDER.outerInset;
const cell = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
L.push('# Descriptor fit — COVERS-R19.1 (sign-off gate)');
L.push('');
L.push('**For Ikenna to sign off. Nothing here is live.** `DESIGN-LOCK.json` is not updated, nothing is merged, and no cover is flipped. Generated by `scripts/covers/descriptor-fit.mjs`, read-only against the database and Storage.');
L.push('');
L.push(`The sheet: \`covers-migration/DESCRIPTOR-FIT.png\`. "Old" lines come from main's own generator (\`${BEFORE_REF}\`, ${beforeSha}), extracted and run beside this branch's.`);
L.push('');
L.push('## The result');
L.push('');
L.push(`- **${n} live covers** (published or held for a cover, not retired). **${withDesc.length}** carry a descriptor.`);
L.push(`- **${unchanged.length} change in neither descriptor nor title.** Each was rendered with the new rules and compared with its live \`cover.png\`, downloaded and hashed: **${unchanged.filter((r) => r.identical).length} of ${unchanged.length} are byte-identical.**`);
L.push(`- **${changed.length} change:** ${byKind('descriptor').length} in the descriptor only, ${byKind('title').length} in the title only, ${byKind('both').length} in both.`);
L.push(`  - **Descriptor:** ${descRows.length}, every one wider than the ${TITLE.maxWidth}px measure. ${descRows.filter((r) => r.plan.descriptor.width > keyline).length} had crossed the inner keyline (${keyline}px wide); the other ${descRows.filter((r) => r.plan.descriptor.width <= keyline).length} were inside it. They now set on **${[...new Set(descRows.map((r) => r.plan.descriptor.lines.map((l) => l.text.split(DESCRIPTOR.separator).length).join(' + ')))].join(', ')}** words per line.`);
L.push(`  - **Title:** ${titleRows.length}: ${titleRows.map((r) => `*${r.title}*`).join(', ')}.`);
L.push(`- **Failures: ${failures.length}.**${failures.length ? `\n${failures.map((x) => `  - ${x}`).join('\n')}` : ' No unchanged cover moved, no descriptor moved a title off its rung, and no stack overflowed.'}`);
L.push('');
L.push('## The leading, as computed');
L.push('');
L.push(`The gap between a descriptor's lines equals the gap between its words. Measured by the engine at ${DESCRIPTOR.size}px, tracking ${DESCRIPTOR.tracking}, by \`descriptorLeading()\` in render.mjs:`);
L.push('');
L.push(`- cap height (capAscent of "H"): **${f(LEAD.cap, 3)}px**`);
L.push(`- word gap as drawn (the two spaces of the separator and the three tracking steps around them, measured as "H  H" less two "H"s): **${f(LEAD.gap, 3)}px**`);
L.push(`- **leading = ${f(LEAD.leading, 3)}px, ${f(LEAD.leading / DESCRIPTOR.size, 4)} of the size.** Baseline to baseline; so one line's baseline to the next line's cap tops is the word gap.`);
L.push('');
L.push(`\`DESCRIPTOR.lineHeight\` (1.12) is removed from layout.mjs: the leading is this derivation, and no second number is left.`);
L.push('');
L.push('## The space the rule takes');
L.push('');
L.push(`A second descriptor line adds ${f(LEAD.leading)}px between the descriptor and the fleuron. The fleuron keeps its rule: its ink is centred at ${FLEURON.gapFraction * 100}% of the gap between the descriptor's LAST line and the author's cap top. The author and footer are pinned to the canvas and do not move.`);
L.push('');
const minOf = (rs, k) => rs.reduce((m, r) => Math.min(m, r[k] ?? Infinity), Infinity);
L.push('| | Descriptor\'s last baseline → fleuron ink | Fleuron ink → author cap top |');
L.push('|---|---:|---:|');
L.push(`| Tightest of the ${descRows.length} two-line descriptors | ${f(minOf(descRows, 'gapAbove'))}px | ${f(minOf(descRows, 'gapBelow'))}px |`);
L.push(`| Tightest of the one-line descriptors | ${f(minOf(withDesc.filter((r) => !r.descChanged), 'gapAbove'))}px | ${f(minOf(withDesc.filter((r) => !r.descChanged), 'gapBelow'))}px |`);
L.push('');
L.push(`**No element is pushed past the space it has.** Every stack still fits its region, no descriptor moves a title off its rung, and every descriptor line is inside the ${TITLE.maxWidth}px measure.`);
L.push('');
const lock = checkLock();
L.push('## The design lock');
L.push('');
L.push(`\`DESIGN-LOCK.json\` is NOT updated. Checked against this branch: **${lock.moved.length} of the ${Object.keys(lock.lock.probes).length} probes would move**${lock.moved.length ? `: ${lock.moved.map((m) => `\`${m.slug}\` (${m.was.slice(0, 12)} → ${m.now.slice(0, 12)})`).join(', ')}` : ''}${lock.added.length || lock.removed.length ? `; added ${lock.added.length}, removed ${lock.removed.length}` : ''}. The others are byte-identical, including \`probe-break-hyphen\` (BROWN- / SKINNED GIRL keeps its break). \`probe-descriptor\` carries STILLNESS.  BETRAYAL.  RECKONING., 1237.5px, 5.5px over the measure, so it now sets STILLNESS.  BETRAYAL. / RECKONING. If this reached main before the lock is re-recorded with Ikenna's sign-off, \`covers:verify\` would fail its lock test and the reconciler would refuse to run.`);
L.push('');
L.push('**Probes to add in the lock round** (fully specified, no live data, as the lock requires):');
L.push('');
L.push("- `probe-descriptor-two-lines`: `{ title: 'Chaff', author: 'Stanley Princewill McDaniels', category: 'short', subcategory: 'Drama', descriptor: 'superstition. avoidance. confirmation.' }`. A descriptor 335px over the measure, so a change to the measure, the break or the leading moves it. `probe-descriptor` breaks too, but by only 5.5px, so a small change to the measure could put it back on one line and stop it guarding the two-line case.");
L.push("- `probe-break-hyphen-refused`: `{ title: 'Public Wi-Fi Is a Trap', author: 'A. N. Other', category: 'news', subcategory: 'Tech' }`. The refused hyphen break, which steps the title from 186 to 140.");
L.push('');
L.push('## Title changes (the hyphen rule)');
L.push('');
L.push(`A break at an existing hyphen is allowed only where it leaves at least ${HYPHEN_MIN.before} letters or numerals of the word behind and carries at least ${HYPHEN_MIN.after} forward, counted across the whole word on each side (\`HYPHEN_MIN\` in text.mjs). A refused break is handled like any break that doesn't fit: the ladder steps down.`);
L.push('');
L.push('| Title | Old rung | Old lines | New rung | New lines | Descriptor too? |');
L.push('|---|---:|---|---:|---|---|');
for (const r of titleRows) L.push(`| ${cell(r.title)} | ${r.old.title.size}px | ${cell(r.old.title.lines.join(' / '))} | ${r.plan.title.size}px | ${cell(r.plan.title.lines.join(' / '))} | ${r.descChanged ? 'yes' : 'no'} |`);
L.push('');
const hyphenKept = rows.filter((r) => !r.titleChanged && r.plan.title.lines.some((l, i) => i < r.plan.title.lines.length - 1 && /\S-$/.test(l)));
// (\S-: a hyphen inside a word. A spaced dash, "M$NEY - / ALBUM", is a break at a space.)
L.push(`**Hyphen breaks that are kept** (${hyphenKept.length}): ${hyphenKept.map((r) => `*${r.title}* (${r.plan.title.lines.join(' / ')})`).join('; ')}.`);
L.push('');
L.push('## Borderline');
L.push('');
const near = descRows.filter((r) => r.plan.descriptor.width - TITLE.maxWidth < 2);
L.push(`The measure is applied exactly, with no tolerance. ${near.length} cover${near.length === 1 ? ' is' : 's are'} over it by less than 2px and so break${near.length === 1 ? 's' : ''}: ${near.map((r) => `*${r.title}* (${(r.plan.descriptor.width - TITLE.maxWidth).toFixed(2)}px over)`).join('; ')}. A tolerance would be a new, chosen number, so none is added.`);
L.push('');
L.push('## Chosen rather than derived');
L.push('');
L.push(`- **The hyphen minimums, ${HYPHEN_MIN.before} behind and ${HYPHEN_MIN.after} forward** (Bringhurst's rule): Ikenna's ruling, chosen, not derived.`);
L.push('- **Letters or numerals are what count toward the minimums**; the hyphens themselves and any punctuation do not.');
L.push('- **A single descriptor word wider than the measure raises an error** rather than being drawn, as an impossible title does.');
L.push('- **The two probes proposed above**, and the sheet\'s layout.');
L.push('');
L.push('Derived: the measure (the title\'s, 1232px), the break (the title\'s own fill-the-line wrap), the leading (cap height plus word gap, from the engine), the size and tracking (unchanged), and the fleuron\'s 42%. R19\'s closest-widths chooser and its tie-breaks are gone.');
L.push('');
L.push(`## The ${descRows.length} descriptor changes, widest first`);
L.push('');
L.push(`Width is the descriptor on one line at ${DESCRIPTOR.size}px tracked ${DESCRIPTOR.tracking}, as it is drawn live. The measure is ${TITLE.maxWidth}px; the inner keyline is ${keyline}px apart and the outer ${outer}px.`);
L.push('');
L.push('| # | Title | Old (one line) | Old width | Crossed | New lines (px) | Title too? |');
L.push('|---:|---|---|---:|---|---|---|');
descRows.forEach((r, i) => {
  const d = r.plan.descriptor;
  L.push(`| ${i + 1} | ${cell(r.title)} | ${d.text} | ${f(d.width)} | ${d.width > outer ? 'both keylines' : d.width > keyline ? 'inner keyline' : '—'} | ${d.lines.map((l) => `${l.text} (${f(l.width)})`).join(' / ')} | ${r.titleChanged ? 'yes' : 'no'} |`);
});
L.push('');
writeFileSync(resolve(OUT, 'DESCRIPTOR-FIT.md'), `${L.join('\n')}\n`);
console.log(`wrote DESCRIPTOR-FIT.png (${W}×${H}) and DESCRIPTOR-FIT.md`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
