// Apply a repair plan to an EPUB. Writes the candidate; does not upload anything.
//
//   node scripts/epub-repair/repair.mjs --in <original.epub> --plan <plan.json> --out <repair.epub>
//
// All three paths must be OUTSIDE the repo (see paths.mjs). Then run verify.mjs on the pair:
// a candidate is not a candidate until every check there passes. Plan format: lib.mjs.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntries, writeEntries, applyPlan } from './lib.mjs';
import { outsideRepo, args } from './paths.mjs';

async function main() {
  const a = args(process.argv.slice(2), ['in', 'plan', 'out']);
  const inp = outsideRepo(a.in, '--in');
  const plan = JSON.parse(await readFile(outsideRepo(a.plan, '--plan'), 'utf8'));
  const out = outsideRepo(a.out, '--out');
  const r = applyPlan(readEntries(await readFile(inp)), plan);
  await writeFile(out, writeEntries(r.entries), { mode: 0o600 });
  for (const l of r.log) console.log(`  · ${l}`);
  console.log(`  changed: ${r.changed.join(', ')}`);
  if (r.added) console.log(`  added: ${r.added.map((n) => `${n.file} (${n.blocks} blocks)`).join(', ')}`);
  console.log('  candidate written. Run verify.mjs before treating it as one.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`refused: ${e.message}`); process.exit(1); });
}
