// W48 — MUTATION CHECKS for the launch-morning fixes (the line's guidance and way back, the badge
// in the room, "Underlined · n").
//
//   node tests/series-notes/w48-mutations.mjs              unit mutants only (no emulator)
//   firebase emulators:exec --only auth,database --project calvary-scribblings \
//     "node tests/series-notes/w48-mutations.mjs --browser" unit + browser mutants
//
// Each mutant breaks ONE W48 change the way a careless edit would, runs the suite that claims to
// hold it, and asserts that suite goes RED. A survivor exits 1. Files are copied aside and back
// after every mutant (and in a finally, and on SIGINT), never `git stash` (CLAUDE.md, "Parallel
// workers"). An anchor that no longer occurs exactly once fails THIS script, so a refactor cannot
// quietly turn a mutant into a no-op that "passes".
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const BROWSER = process.argv.includes('--browser');

const UNIT = [process.execPath, ['--test', 'tests/series-notes/contract.test.mjs', 'tests/series-notes/ui/room-model.test.mjs']];
const UI = (grep) => ['npx', ['playwright', 'test', '-c', 'tests/series-notes/ui/playwright.config.mjs', '-g', grep]];
const READER = (grep) => ['npx', ['playwright', 'test', '-c', 'tests/series-notes/reader/playwright.reader.config.mjs', '-g', grep], { W46_NOTES: '1' }];

const NOTES = 'app/lib/series/notes.js';
const MODEL = 'app/components/seriesNotes/roomModel.js';
const CARD = 'app/components/seriesNotes/NoteCard.js';
const COMPOSER = 'app/components/seriesNotes/Composer.js';
const ROOM = 'app/series/[slug]/notes/RoomClient.js';
const PAGE = 'app/series/read/[instalmentId]/page-reader.js';

// [name, file, anchor, replacement, suite]
const MUTANTS = [
  ['§3 drop the count once underlined', NOTES, 'underlined: (n) => `Underlined · ${n}`,', "underlined: () => 'Underlined',", UNIT],
  ['§1 reword the guidance', NOTES, 'press on it and tap “This is my line”.', 'select it.', UNIT],
  ['§1 send the reader to a CFI, not their own place', NOTES, 'export const chooseLineHref = (inst) => `/series/read/${encodeURIComponent(inst)}?from=${FROM_COMPOSER}`;', 'export const chooseLineHref = (inst) => `/series/read/${encodeURIComponent(inst)}?at=x&from=${FROM_COMPOSER}`;', UNIT],
  ['§1 the way back forgets the composer', NOTES, 'roomHref(slug, inst, { compose: COMPOSE_LINE })', 'roomHref(slug, inst)', UNIT],
  ['§2 a writer gets a reader’s badge (the old isAuthor={false})', MODEL, "isAuthor: id?.isAuthor === true };", 'isAuthor: false };', UNIT],
  ['§2 the series’ writer loses the WRITER mark', MODEL, "if (note?.writer === true) return { mark: 'writer' };", "if (false) return { mark: 'writer' };", UNIT],
  ['§2 the snapshot instead of the live count', MODEL, "readCount: id?.readCount || 0,", 'readCount: note?.author?.badge || 0,', UNIT],
];
const BROWSER_MUTANTS = [
  ['ui §2 NoteCard back to isAuthor={false}', CARD, 'isAuthor={m.isAuthor} />}', 'isAuthor={false} />}', UI('W48 · the badge')],
  ['ui §2 the line view draws no readers', ROOM, '<li key={n.id}><Who note={n} identities={identities} size={28} /></li>', 'null', UI('W48 · the badge')],
  ['ui §3 the count stays put', CARD, 'NOTES_COPY.underlined(count)', 'NOTES_COPY.underlined(0)', UI('open: writer pinned')],
  ['ui §1 no guidance on an empty margin', COMPOSER, "{kind === 'line' && !margin && marginRead && (\n              <p data-line-first", "{false && (\n              <p data-line-first", UI('W48 · The line')],
  ['ui §1 Post live without a line', COMPOSER, "const lineReady = kind !== 'line' || (attach && margin);", 'const lineReady = true;', UI('W48 · The line')],
  ['ui §1 the room ignores ?compose=line', ROOM, 'if (composedOnce.current || composeParam !== COMPOSE_LINE || !instId) return;', 'if (true) return;', UI('W48 · The line')],
  ['reader §1 the notice carries no way back', PAGE, 'fromComposer && slug ? backToNoteHref(slug, instalmentId) : null', 'null', READER('Back to your note')],
  ['reader §1 the way back times out', PAGE, 'noticeTimer.current = back ? null : setTimeout(() => setLineNotice(null), NOTICE_MS);', 'noticeTimer.current = setTimeout(() => setLineNotice(null), NOTICE_MS);', READER('Back to your note')],
];

const backups = new Map();
function restoreAll() {
  for (const [file, bak] of backups) {
    try { if (existsSync(bak)) { copyFileSync(bak, file); unlinkSync(bak); } } catch { /* nothing to restore */ }
  }
  backups.clear();
}
process.on('SIGINT', () => { restoreAll(); process.exit(130); });

function run([cmd, args, env = {}]) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0;
}

const list = BROWSER ? [...MUTANTS, ...BROWSER_MUTANTS] : MUTANTS;
const suites = new Map(list.map((m) => [JSON.stringify(m[4]), m[4]]));
for (const s of suites.values()) {
  if (!run(s)) { console.error(`The unmutated suite is not green — fix that first: ${s[0]} ${s[1].join(' ')}`); process.exit(1); }
}

let killed = 0;
const survivors = [];
const broken = [];
try {
  for (const [name, rel, from, to, suite] of list) {
    const file = join(root, rel);
    const src = readFileSync(file, 'utf8');
    const n = src.split(from).length - 1;
    if (n !== 1) { broken.push(`${name}: anchor occurs ${n} times in ${rel}`); continue; }
    const bak = `${file}.w48-mutation-backup`;
    copyFileSync(file, bak);
    backups.set(file, bak);
    try {
      writeFileSync(file, src.replace(from, to));
      const green = run(suite);
      if (green) survivors.push(name); else killed += 1;
      console.log(`${green ? 'SURVIVED' : 'killed  '}  ${name}`);
    } finally {
      copyFileSync(bak, file);
      unlinkSync(bak);
      backups.delete(file);
    }
  }
} finally { restoreAll(); }

console.log(`\n${killed} of ${list.length} mutants killed.`);
if (broken.length) console.error(`Broken anchors:\n  ${broken.join('\n  ')}`);
if (survivors.length) console.error(`Survivors:\n  ${survivors.join('\n  ')}`);
process.exit(survivors.length || broken.length ? 1 : 0);
