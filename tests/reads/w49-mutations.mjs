// W49 — MUTATION CHECKS for reads counted once (rulings 176–180).
//
//   firebase emulators:exec --only database --project demo-calvary-reads "node tests/reads/w49-mutations.mjs"
//   … "node tests/reads/w49-mutations.mjs --browser"     also the Series reader's browser mutant
//
// Each mutant breaks ONE rule the way a careless edit would and runs the suite that claims to hold
// it; that suite must go RED. A survivor, or an anchor that no longer occurs exactly once, exits 1.
// Files are copied aside and back after every mutant (and on SIGINT), never `git stash`.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BROWSER = process.argv.includes('--browser');
const node = (...files) => [process.execPath, ['--test', '--test-concurrency=1', ...files]];
const UNIT = node('tests/reads/read-hit.test.mjs', 'tests/reads/read-credit.test.mjs', 'tests/series-notes/contract.test.mjs', 'tests/account/deletion.test.mjs', 'tests/series-notes/ui/room-model.test.mjs');
const HIT = node('tests/reads/hit.emulator.test.mjs');
const READ = node('tests/reads/series-read.emulator.test.mjs');
const SEED = node('tests/reads/seed.emulator.test.mjs');
const RULES = node('tests/rules/w49-reads.test.mjs');
const WORKER = node('tests/ci/hit-counter.test.mjs');
const READER = ['npx', ['playwright', 'test', '-c', 'tests/series-notes/reader/playwright.reader.config.mjs', '-g', 'the read: fired once'], { W46_NOTES: '0' }];

const HITJS = 'functions/api/hit.js';
const LEDGER = 'functions/api/_ledger.js';
const LIMIT = 'functions/api/_ratelimit.js';
const SREAD = 'functions/api/series/read.js';
const SEEDJS = 'scripts/series/seed-reads.mjs';
const CREDIT = 'app/lib/readCredit.js';
const READHIT = 'app/lib/readHit.js';
const DELETION = 'functions/api/account/_deletion.js';
const NOTES = 'app/lib/series/notes.js';
const MODEL = 'app/components/seriesNotes/roomModel.js';
const WK = 'workers-external/calvary-hit-counter.worker.js';
const PAGE = 'app/series/read/[instalmentId]/page-reader.js';

// [name, file, anchor, replacement, suite]
const MUTANTS = [
  // §1 the story counter
  ['§1 the body beats the token', HITJS, '    key = uid;\n', '    key = readerId || uid;\n', HIT],
  ['§1 the back-compat branch returns (no identity counts)', HITJS, '  if (!key) return notCounted();', "  if (!key) key = `anon${Date.now()}${Math.random()}`;", HIT],
  ['§1 a forged token falls back to the device id', HITJS, '    if (!uid) return notCounted();\n    key = uid;', '    key = uid || readerId;', HIT],
  ['§1 "null" counts as a reader', HITJS, "  if (readerId === 'null' || readerId === 'undefined') readerId = '';", '', HIT],
  ['§1 the claim races (no if-match)', LEDGER, "'if-match': etag", "'x-ignored': etag", HIT],
  ['§1 the ledger check is skipped', LEDGER, '  if (current !== null && current !== undefined) return false;', '', HIT],
  ['§1 counted reads write no day bucket', HITJS, "    [`stories/${slug}/hitsByDay/${utcDayKey()}`]: { '.sv': { increment: 1 } },\n", '', HIT],
  ['§1 an IPv4 limiter key RTDB refuses', LIMIT, "String(id).replace(/[.#$[\\]/]/g, '_')", 'String(id)', HIT],
  // §2 the website
  ['§2 the hit does not wait for sign-in', READHIT, '  if (typeof auth.authStateReady === \'function\') await auth.authStateReady();', "  if (typeof auth.authStateReady === 'function') auth.authStateReady();", UNIT],
  ['§2 a missing device id is sent anyway', READHIT, '      if (id) body.readerId = id;', '      body.readerId = String(id);', UNIT],
  // §3 the instalment counter
  ['§3 an unreleased instalment counts', SREAD, "    if (!isReleased(row, now)) return fail('not_released', 409);", '', READ],
  ['§3 an unreadable instalment counts', SREAD, "      if (grant.access !== 'granted') {", '      if (false) {', READ],
  ['§3 every read counts', SREAD, '    if (!won) return json({ count: await countNow(), counted: false });', '', READ],
  // The claim is shared, so its race is held where it is driven directly (twenty simultaneous
  // claims, one winner): the endpoints' own concurrency tests depend on their timing.
  ['§3 two first reads at once both count', LEDGER, "  if (put.status === 412) return false;", '  if (put.status === 412) return true;', HIT],
  ['§3 the ledger is client-readable', 'database.rules.json', '    "series_read_ledger": {\n      ".read": false,', '    "series_read_ledger": {\n      ".read": true,', RULES],
  ['§3 the count is client-writable', 'database.rules.json', '    "series_reads": {\n      ".read": true,\n      ".write": false', '    "series_reads": {\n      ".read": true,\n      ".write": "auth != null"', RULES],
  ['§3 the marker takes any value', 'database.rules.json', '".validate": "newData.isBoolean() && newData.val() === true && $inst.matches(/^[A-Za-z0-9_-]{1,128}$/)"', '".validate": "true"', RULES],
  ['§3 deletion forgets the ledger', DELETION, "    if (/^[A-Za-z0-9_-]{1,128}$/.test(inst)) u[`series_read_ledger/${inst}/${uid}`] = null;", '', UNIT],
  // §4 the credit
  ['§4 an instalment is credited into readStories', CREDIT, '  const readRef = ref(db, `users/${uid}/${node}/${key}`);', '  const readRef = ref(db, `users/${uid}/readStories/${key}`);', UNIT],
  ['§4 the credit fires every time', CREDIT, '  if (snap.exists()) return { credited: false, readCount: null };', '', UNIT],
  ['§4 the tenth read pays nothing', CREDIT, '    if (newCount > 0 && newCount % 10 === 0) {', '    if (newCount > 0 && newCount % 11 === 0) {', UNIT],
  // §5 the copy
  ['§5 no en-GB grouping', NOTES, "  reads: (n) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? 'read' : 'reads'}`,", "  reads: (n) => `${n} ${n === 1 ? 'read' : 'reads'}`,", UNIT],
  ['§5 the count line drops the reads', NOTES, "  roomCounts: (r, n, m) => `${Number(r).toLocaleString('en-GB')} ${r === 1 ? 'read' : 'reads'} · ", '  roomCounts: (r, n, m) => `', UNIT],
  // §6 the seeder
  ['§6 the count is the plan, not the ledger', SEEDJS, '    const { count } = await settleCount(db, inst, opts);', "    const cur = await db.getWithEtag(readsPath(inst)); await db.putIfMatch(readsPath(inst), uids.length, cur.etag); const count = uids.length;", SEED],
  ['§6 existing entries are re-created and re-counted', SEEDJS, '    for (const uid of uids) if (await claimOnce(db.url(ledgerPath(inst, uid)), db.headers)) created++;', '    for (const uid of uids) { await claimOnce(db.url(ledgerPath(inst, uid)), db.headers); created++; }', SEED],
  // §7 the snapshot
  ['§7 the snapshot drops isAuthor', NOTES, '  if (p.isAuthor === true) out.isAuthor = true;', '', UNIT],
  ['§7 the fallback ignores the snapshot’s isAuthor', MODEL, '    isAuthor: note?.writer === true || a.isAuthor === true,', '    isAuthor: note?.writer === true,', UNIT],
  // step 3 the Worker
  ['the Worker counts again', WK, "    return new Response(JSON.stringify({ count: await readCount(slug, env) }), { headers });\n  },", "    if (request.method === 'POST') await fetch(dbUrl(env, `stories/${slug}`), { method: 'PATCH', body: JSON.stringify({ hits: { '.sv': { increment: 1 } } }) });\n    return new Response(JSON.stringify({ count: await readCount(slug, env) }), { headers });\n  },", WORKER],
];
const BROWSER_MUTANTS = [
  ['§4 the Series reader credits an uncounted read', PAGE, '      if (res?.counted === true) creditFirstRead(', '      if (res) creditFirstRead(', READER],
];

const backups = new Map();
const restoreAll = () => { for (const [f, b] of backups) { try { if (existsSync(b)) { copyFileSync(b, f); unlinkSync(b); } } catch { /* */ } } backups.clear(); };
process.on('SIGINT', () => { restoreAll(); process.exit(130); });
const run = ([cmd, args, env = {}]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 << 20 }).status === 0;

const list = BROWSER ? [...MUTANTS, ...BROWSER_MUTANTS] : MUTANTS;
for (const s of new Map(list.map((m) => [JSON.stringify(m[4]), m[4]])).values()) {
  if (!run(s)) { console.error(`The unmutated suite is not green: ${s[1].join(' ')}`); process.exit(1); }
}
let killed = 0;
const survivors = [], broken = [];
try {
  for (const [name, rel, from, to, suite] of list) {
    const file = join(root, rel);
    const src = readFileSync(file, 'utf8');
    const n = src.split(from).length - 1;
    if (n !== 1) { broken.push(`${name}: anchor occurs ${n} times in ${rel}`); continue; }
    const bak = `${file}.w49-mutation-backup`;
    copyFileSync(file, bak);
    backups.set(file, bak);
    try {
      writeFileSync(file, src.replace(from, to));
      const green = run(suite);
      if (green) survivors.push(name); else killed++;
      console.log(`${green ? 'SURVIVED' : 'killed  '}  ${name}`);
    } finally { copyFileSync(bak, file); unlinkSync(bak); backups.delete(file); }
  }
} finally { restoreAll(); }
console.log(`\n${killed} of ${list.length} mutants killed.`);
if (broken.length) console.error(`Broken anchors:\n  ${broken.join('\n  ')}`);
if (survivors.length) console.error(`Survivors:\n  ${survivors.join('\n  ')}`);
process.exit(survivors.length || broken.length ? 1 : 0);
