// ⚠⚠ THIS SCRIPT WRITES TO PRODUCTION. IT IS MANUAL, AND IT IS NOT IN CI.
//
//   node tests/reconcile/live-probe.mjs
//
// ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────────
// tests/reconcile/reconcile.test.mjs proves the reconciler's DECISION on a corpus built in
// memory. It cannot prove the write path, the credential, the read-back, or that the thing
// actually repairs a real record — and the live index is clean most days, so a green
// scheduled run proves none of that either. A reconciler nobody has watched repair anything
// is a reconciler nobody should trust.
//
// So this damages ONE derived field on ONE live record, watches the reconciler find it, lets
// it repair it, and verifies the record is byte-for-byte what it was before.
//
// ── IT FOLLOWS THE LIVE-PROBE RULES IN CLAUDE.md, AND HERE IS EACH ONE ───────────────────
//   1. READ THE VALUE FIRST — the whole record is read and printed before anything is written,
//      and the restore is `put(before)` on every exit path including SIGINT and the finally.
//   2. NEVER A FOUNDER-AUTHORED RECORD — founder uids hold node-level .write, so a refusal
//      cannot be assumed anywhere near them. The target is filtered to a non-founder author.
//   3. PREFER A RECORD THE PROBE CREATED — not possible here and worth saying why: the
//      reconciler only considers slugs that exist in cms_stories, and seeding a scratch story
//      there would put it on the live site. The mitigation is that cms_stories_index is
//      ENTIRELY DERIVED: every field is a pure function of cms_stories, which this never
//      touches, so the damage is reconstructible by definition rather than by luck.
//   4. VERIFY INTEGRITY AFTERWARDS AND SAY SO — the final block re-reads and diffs against the
//      pre-probe read, and prints the count whether it is zero or not.
//
// ⚠ AND CHECK THE GATE BEFORE RUNNING IT. GATING_ENABLED is false today
// (app/lib/storyAccess.js), so the seconds-long window in which the record is short of a
// field has no reader effect. If the gate is ever switched on, run this against `opening`
// only — never against publishedAtMs, which is the field the free-floor query orders on.
// END-TO-END PROOF against production. Damages ONE derived field on ONE index record, watches
// the reconciler find and repair it, then verifies the record is byte-identical to before.
//
// ⚠ WHY THIS IS SAFE TO RUN ON LIVE DATA, stated before it runs:
//   · cms_stories_index is DERIVED. Every field is a pure function of cms_stories, which is
//     never touched here — so the "damage" is reconstructible by definition.
//   · The full record is READ AND PRINTED FIRST (CLAUDE.md rule 1) and compared field by field
//     afterwards (rule 4).
//   · The target is chosen to be NON-FOUNDER-AUTHORED (rule 2) and is restored within seconds.
//   · GATING_ENABLED is false today, so even the seconds-long window has no reader effect.
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const FOUNDERS = new Set(['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1']);

const get = async (p) => (await fetch(`${DB}/${p}.json`)).json();
const idx = await get('cms_stories_index');

// A non-founder record that currently HAS an opening, so the damage is a real removal.
const target = Object.entries(idx).find(([, r]) => !FOUNDERS.has(r.authorUid) && (r.opening || '').trim());
if (!target) { console.error('no suitable non-founder record'); process.exit(1); }
const [slug, before] = target;
console.log(`target: ${slug}  (author ${before.author}, uid ${before.authorUid})`);
console.log(`  before: ${Object.keys(before).length} keys, opening = "${before.opening.slice(0, 60)}…"`);

const svc = JSON.parse(await readFile('serviceAccountKey.json', 'utf8'));
const token = (await cert(svc).getAccessToken()).access_token;
const put = async (body) => {
  const r = await fetch(`${DB}/cms_stories_index/${slug}.json?access_token=${token}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { console.error('write failed', r.status, await r.text()); process.exit(1); }
};

const restore = async () => { await put(before); };
process.on('SIGINT', async () => { await restore(); process.exit(130); });

let ok = true;
try {
  // ── DAMAGE: exactly what the cron writes — the record minus `opening`.
  const damaged = { ...before };
  delete damaged.opening;
  await put(damaged);
  const readBack = await get(`cms_stories_index/${slug}`);
  console.log(`\n  damaged: ${Object.keys(readBack).length} keys, opening present = ${'opening' in readBack}`);
  if ('opening' in readBack) { console.error('  ✗ the damage did not land'); ok = false; }

  // ── DETECT (dry run — must find it and must NOT write).
  const dry = await run('node', ['scripts/reconcile-index.mjs'], { maxBuffer: 32e6 });
  const sawIt = dry.stdout.includes(slug) && dry.stdout.includes('opening');
  console.log(`  reconciler DRY RUN detected it: ${sawIt}`);
  console.log('    ' + dry.stdout.split('\n').filter(l => l.includes('needing repair') || l.includes(slug)).join('\n    '));
  if (!sawIt) { console.error('  ✗ the reconciler did not detect the damage'); ok = false; }
  const stillDamaged = await get(`cms_stories_index/${slug}`);
  if ('opening' in stillDamaged) { console.error('  ✗ the DRY RUN wrote — it must not'); ok = false; }
  else console.log('  dry run wrote nothing ✓');

  // ── REPAIR.
  const apply = await run('node', ['scripts/reconcile-index.mjs', '--apply'], { maxBuffer: 32e6 });
  console.log('    ' + apply.stdout.split('\n').filter(l => l.includes('repaired')).join('\n    '));

  // ── VERIFY: byte-for-byte against the pre-damage record, field by field.
  const after = await get(`cms_stories_index/${slug}`);
  const diff = [...new Set([...Object.keys(before), ...Object.keys(after || {})])]
    .filter(k => JSON.stringify(before[k]) !== JSON.stringify((after || {})[k]));
  console.log(`\n  after repair: ${Object.keys(after || {}).length} keys`);
  console.log(`  fields differing from the ORIGINAL pre-damage record: ${diff.length}${diff.length ? ' → ' + diff.join(', ') : ''}`);
  if (diff.length) { console.error('  ✗ the record was NOT restored to its original state'); ok = false; }
  else console.log('  ✓ restored byte-for-byte');
} finally {
  // Belt and braces: restore unconditionally, whatever happened above.
  await restore();
  const final = await get(`cms_stories_index/${slug}`);
  const d = [...new Set([...Object.keys(before), ...Object.keys(final || {})])]
    .filter(k => JSON.stringify(before[k]) !== JSON.stringify((final || {})[k]));
  console.log(`\n  FINAL INTEGRITY CHECK — differs from pre-probe read on ${d.length} field(s)${d.length ? ': ' + d.join(', ') : ''}`);
}
process.exit(ok ? 0 : 1);
