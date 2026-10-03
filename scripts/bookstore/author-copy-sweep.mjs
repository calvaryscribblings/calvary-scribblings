#!/usr/bin/env node
// W33 — THE SWEEP: is a private title visible anywhere a stranger can look?
//
//   node scripts/bookstore/author-copy-sweep.mjs <titleId> [--out out]
//
// Takes the titleId AT RUN TIME — it is written nowhere in this repo — and expects ZERO hits in:
//   1. the built export (out/, every file), for the id and, when the private handover exists
//      (~/calvary-private/author-copies/<titleId>/handover.json), for its title too;
//   2. every WORLD-READABLE bookstore node: the nodes whose `.read` PARSES to true in
//      database.rules.json (the parsed value, never a grep of the file), each read SHALLOW and
//      unauthenticated, plus a direct read of <node>/<titleId>, plus the full text of the two
//      small curated nodes whose entries carry slugs as VALUES (sections, signals).
//
// ⚠ AN INSTRUMENT THAT SEES NOTHING IS INDISTINGUISHABLE FROM ONE THAT CANNOT SEE. So it first
// runs the same search for a CONTROL — a title that is published today — and refuses to report
// a clean result unless the control is found in both places. It searches the build output, never
// the repo, so it cannot photograph itself; and it prints counts and node names, never a title.
//
// Unauthenticated by design: a stranger has no credentials, so neither does this. Exit 1 on any
// hit, or on a blind control.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const VALUE_NODES = ['bookstore_sections', 'bookstore_signals'];

/** Bookstore nodes whose top-level `.read` rule is exactly true. Parsed, not grepped. */
export function worldReadableBookstoreNodes(rules) {
  return Object.entries(rules?.rules || {})
    .filter(([k, v]) => k.startsWith('bookstore_') && v && v['.read'] === true)
    .map(([k]) => k)
    .sort();
}

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p); else yield p;
  }
}

/** Files under out/ containing any needle. Pure over the filesystem; returns relative paths. */
export function searchOut(outDir, needles) {
  const hits = [];
  const ns = needles.filter(Boolean).map((n) => Buffer.from(n));
  for (const f of files(outDir)) {
    const buf = readFileSync(f);
    if (ns.some((n) => buf.includes(n))) hits.push(f.slice(outDir.length + 1));
  }
  return hits;
}

const getJson = async (path) => {
  const r = await fetch(`${DB}/${path}`);
  if (!r.ok) throw new Error(`${path.split('?')[0]} → HTTP ${r.status}`);
  return r.json();
};

/** Where in the world-readable nodes the id or a title appears. Returns node names. */
async function searchNodes(nodes, id, needles) {
  const hits = [];
  for (const n of nodes) {
    const keys = Object.keys((await getJson(`${n}.json?shallow=true`)) || {});
    if (keys.includes(id)) hits.push(`${n} (key)`);
    if ((await getJson(`${n}/${encodeURIComponent(id)}.json`)) != null) hits.push(`${n}/<id> (record)`);
  }
  for (const n of VALUE_NODES) {
    const text = JSON.stringify(await getJson(`${n}.json`));
    if (needles.some((s) => s && text.includes(s))) hits.push(`${n} (value)`);
  }
  return hits;
}

async function main() {
  const argv = process.argv.slice(2);
  const id = argv[0];
  const outIdx = argv.indexOf('--out');
  const outDir = resolve(outIdx >= 0 ? argv[outIdx + 1] : 'out');
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) { console.error('usage: author-copy-sweep.mjs <titleId> [--out out]'); process.exit(2); }
  if (!existsSync(outDir)) { console.error(`no build at ${outDir} — run the build first`); process.exit(2); }

  const handoverPath = join(homedir(), 'calvary-private', 'author-copies', id, 'handover.json');
  const handover = existsSync(handoverPath) ? JSON.parse(readFileSync(handoverPath, 'utf8')) : null;
  const needles = [id, handover?.title].filter(Boolean);

  const nodes = worldReadableBookstoreNodes(JSON.parse(readFileSync(resolve('database.rules.json'), 'utf8')));
  console.log(`world-readable bookstore nodes (parsed from database.rules.json): ${nodes.length} — ${nodes.join(', ')}`);

  // ── the control: a title published today must be found, or the instrument is blind ────────
  const published = await getJson(`bookstore_titles.json?orderBy=%22status%22&equalTo=%22published%22`);
  const [controlId, control] = Object.entries(published || {})[0] || [];
  if (!controlId) { console.error('✗ no published title to use as a control — the sweep cannot prove it sees'); process.exit(1); }
  const cOut = searchOut(outDir, [controlId, control.title]);
  const cNodes = await searchNodes(nodes, controlId, [controlId]);
  console.log(`control (a published title): ${cOut.length} file(s) in out/, ${cNodes.length} node hit(s)`);
  if (!cOut.length || !cNodes.length) { console.error('✗ the control was not found — the sweep is blind; no clean result can be reported'); process.exit(1); }

  // ── the subject ─────────────────────────────────────────────────────────────────────────────
  const sOut = searchOut(outDir, needles);
  const sNodes = await searchNodes(nodes, id, needles);
  console.log(`subject (${handover ? 'id and title, from the private handover' : 'id only — no private handover on this machine'}): ${sOut.length} file(s) in out/, ${sNodes.length} node hit(s)`);
  for (const h of sOut.slice(0, 20)) console.log(`  out/${h}`);
  for (const h of sNodes) console.log(`  ${h}`);
  if (sOut.length || sNodes.length) { console.error('✗ VISIBLE — see above'); process.exit(1); }
  console.log('✓ zero hits: not in the export, not in any world-readable bookstore node.');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message || e); process.exit(1); });
