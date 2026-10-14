// W46 — DO THE ASSERTIONS BITE? Targeted mutants of the contract module and of the rules, each
// of which must turn its suite red.
//
//   node tests/series-notes/contract-mutations.mjs            # the pure module (fast)
//   node tests/series-notes/contract-mutations.mjs --rules    # the rules, on the emulator (~1 min each)
//
// Each mutant edits ONE file in place, runs the suite, and puts the file back from a copy taken
// before it started (never git stash: other work may be in the tree). A mutant whose suite stays
// green SURVIVED, and the run exits non-zero.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = process.argv.includes('--rules');

const NOTES = 'app/lib/series/notes.js';
const DB = 'database.rules.json';

const PURE = [
  ['the flag goes back off', NOTES, 'export const SERIES_NOTES_ENABLED = true;', 'export const SERIES_NOTES_ENABLED = false;'],
  ['the light: bright for 12h', NOTES, 'if (age <= 6 * HOUR) return \'bright\';', 'if (age <= 12 * HOUR) return \'bright\';'],
  ['breathes for a day', NOTES, 'now - lastAt <= HOUR &&', 'now - lastAt <= DAY &&'],
  ['note limit 501', NOTES, 'if (n > NOTE_MAX) return { ok: false, error: \'too_long\' };', 'if (n > NOTE_MAX + 1) return { ok: false, error: \'too_long\' };'],
  ['side taken from the body', NOTES, 'if (!SIDE_OPTIONS.includes(recordedSide)) return { ok: false, error: \'no_side\' };\n    out.side = recordedSide;', 'out.side = recordedSide || arguments[0].side || \'a\';'],
  ['publish with fewer than three', NOTES, 'if (readyCount(draft) !== 3)', 'if (readyCount(draft) < 1)'],
  ['the public half leaks the line', NOTES, 'public: { sit: clean(draft.sit), publishedAt: now },', 'public: { sit: clean(draft.sit), line: clean(draft.line), publishedAt: now },'],
  ['faces carry names', NOTES, 'return author?.photoURL ? { photoURL: author.photoURL } : { initials: initialsOf(author?.name) };', 'return { name: author?.name, initials: initialsOf(author?.name) };'],
  ['the writer is not pinned', NOTES, 'if (!!b.writer !== !!a.writer) return b.writer ? 1 : -1;', ''],
  ['replies newest first', NOTES, '.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));', '.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));'],
  ['three replies before folding', NOTES, 'export const REPLIES_SHOWN = 2;', 'export const REPLIES_SHOWN = 3;'],
  ['tally can go negative', NOTES, 't[from] = Math.max(0, (Number(t[from]) || 0) - 1);', 't[from] = (Number(t[from]) || 0) - 1;'],
  ['a door leads with an unreleased instalment', NOTES, 'const released = list.filter((r) => isReleased(r, now))', 'const released = list'],
];

const ROOM = "(auth != null && root.child('series_finished').child(auth.uid).child($inst).exists() && root.child('series_room_members').child($inst).child(auth.uid).exists())";
const RULE_MUTANTS = [
  ['notes readable without membership', DB, ` && root.child('series_room_members').child($inst).child(auth.uid).exists())"`, ')"'],
  ['questions readable without finishing', DB, `"(auth != null && (auth.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || auth.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1')) || (auth != null && root.child('series_finished').child(auth.uid).child($inst).exists())"`, '"auth != null"'],
  ['notes writable by a reader', DB, `"series_notes": {\n      ".write": false,`, `"series_notes": {\n      ".write": "auth != null",`],
  ['held notes listable by anyone', DB, ` || (auth != null && query.orderByChild == 'uid' && query.equalTo == auth.uid)`, ' || auth != null'],
  ['finished may be in the future', DB, 'newData.val() <= now && root.child', 'root.child'],
  ['finished on an unreleased instalment', DB, ` && root.child('series_instalments').child($inst).child('releaseAtMs').val() <= now))"`, '))"'],
  ['the public questions take any field', DB, `"publishedAt": {\n          ".validate": "newData.isNumber() && newData.val() > 0"\n        },\n        "$other": {\n          ".validate": false\n        }\n      }\n    },\n    "series_questions": {`, `"publishedAt": {\n          ".validate": "newData.isNumber() && newData.val() > 0"\n        }\n      }\n    },\n    "series_questions": {`],
  ['underline as anyone', DB, `".write": "auth != null && auth.uid === $uid && root.child('series_finished').child(auth.uid).child($inst).exists() && root.child('series_room_members').child($inst).child(auth.uid).exists() && root.child('series_notes').child($inst).child($noteId).exists() && (!newData.exists() || newData.val() === true)"`, `".write": "auth != null"`],
  ['drafts readable by readers', DB, `"series_question_drafts": {\n      ".read": "auth != null && (auth.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || auth.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1')",`, `"series_question_drafts": {\n      ".read": "auth != null",`],
  ['the margin readable by others', DB, `"series_margin": {\n      "$uid": {\n        ".read": "auth != null && auth.uid === $uid",`, `"series_margin": {\n      "$uid": {\n        ".read": "auth != null",`],
];
void ROOM;

const run = RULES
  ? ['npx', ['firebase', 'emulators:exec', '--only', 'database,storage', '--project', 'demo-calvary-rules', 'node --test --test-concurrency=1 tests/rules/w46-series-notes.test.mjs']]
  : ['node', ['--test', 'tests/series-notes/contract.test.mjs']];

let killed = 0;
const survivors = [];
const list = RULES ? RULE_MUTANTS : PURE;
for (const [name, file, from, to] of list) {
  const path = resolve(ROOT, file);
  const aside = `${path}.mutant-original`;
  const src = readFileSync(path, 'utf8');
  if (!src.includes(from)) { console.error(`✗ mutant "${name}": anchor not found — the mutant is stale`); process.exitCode = 1; continue; }
  copyFileSync(path, aside);
  try {
    writeFileSync(path, src.replace(from, to));
    const r = spawnSync(run[0], run[1], { cwd: ROOT, encoding: 'utf8' });
    const red = r.status !== 0;
    if (red) killed += 1; else survivors.push(name);
    console.log(`${red ? 'killed  ' : 'SURVIVED'}  ${name}`);
  } finally {
    copyFileSync(aside, path);
    spawnSync('rm', ['-f', aside]);
  }
}
console.log(`\n${killed}/${list.length} mutants killed${survivors.length ? ` — SURVIVORS: ${survivors.join('; ')}` : ''}`);
if (survivors.length) process.exitCode = 1;
