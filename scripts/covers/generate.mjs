// THE GENERATOR CLI — one story record in, one finished PNG on disk.
//
//   node scripts/covers/generate.mjs --slug odeluwa                    # from live cms_stories
//   node scripts/covers/generate.mjs --slug odeluwa --out cover.png
//   node scripts/covers/generate.mjs --title "Arrival: Again" --author "Tricia Ajax" \
//        --category flash --subcategory Horror --descriptor "rain. repetition. dread."
//   node scripts/covers/generate.mjs --slug odeluwa --plan            # geometry only, no PNG
//
// The ONLY network call this file can make is reading the story record when `--slug` is
// given without the other fields. Rendering itself never touches the network — see the
// determinism contract at the top of render.mjs. `--plan` and any fully-specified record
// run completely offline.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { renderCover, planCover, registerFonts } from './render.mjs';
import { createCanvas } from '@napi-rs/canvas';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

/** Fetch one published story record and project it to the generator's input shape. */
export async function recordFromSlug(slug) {
  const res = await fetch(`${DB}/cms_stories/${encodeURIComponent(slug)}.json`);
  if (!res.ok) throw new Error(`cms_stories/${slug} read failed: ${res.status}`);
  const s = await res.json();
  if (!s) throw new Error(`no such story: ${slug}`);
  return toRecord(slug, s);
}

/** The projection. ONE place decides what the generator reads off a story. */
export function toRecord(slug, s) {
  return {
    slug,
    title: s.title || '',
    author: s.author || '',
    category: s.category || '',
    categoryName: s.categoryName || '',
    subcategory: s.subcategory || '',
    descriptor: s.descriptor ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let record;
  if (args.title) {
    record = {
      slug: args.slug || String(args.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: args.title,
      author: args.author || '',
      category: args.category || '',
      categoryName: args.categoryName || '',
      subcategory: args.subcategory || '',
      descriptor: args.descriptor || null,
      liveryKey: args.livery || undefined,
      instalmentOrdinal: args.instalment != null && args.instalment !== true ? Number(args.instalment) : undefined,
    };
  } else if (args.slug) {
    record = await recordFromSlug(String(args.slug));
    if (args.descriptor) record.descriptor = args.descriptor;
  } else {
    console.error('usage: --slug <slug>  |  --title <title> [--author --category --subcategory --descriptor]');
    process.exit(2);
  }

  if (args.plan) {
    registerFonts();
    const plan = planCover(createCanvas(1600, 2400).getContext('2d'), record);
    console.log(JSON.stringify({
      slug: record.slug, livery: plan.livery.key, eyebrow: plan.eyebrow,
      titleSize: plan.title.size, titleLines: plan.title.lines,
      ruleY: +plan.ruleY.toFixed(1),
      descriptor: plan.descriptor && { text: plan.descriptor.text, y: +plan.descriptor.y.toFixed(1) },
      fleuronY: +plan.fleuronY.toFixed(1), author: plan.author, footer: plan.footer,
      stack: { top: +plan.stack.top.toFixed(1), bottom: +plan.stack.bottom.toFixed(1), slack: +plan.stack.slack.toFixed(1) },
      overflow: plan.overflow,
    }, null, 2));
    return;
  }

  const { png, plan } = renderCover(record);
  const out = args.out ? String(args.out) : `${record.slug}.png`;
  writeFileSync(out, png);
  console.log(
    `${basename(out)}  ${png.length} bytes  sha256 ${createHash('sha256').update(png).digest('hex')}\n` +
    `  livery ${plan.livery.key}  title ${plan.title.size}px × ${plan.title.lines.length} line(s)` +
    `  descriptor ${plan.descriptor ? 'yes' : 'none'}  footer ${JSON.stringify(plan.footer)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
