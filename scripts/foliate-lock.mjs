// R11.18 — THE FOLIATE PIN, WEB SIDE.
//
// "Both surfaces run the same engine" was a convention. The app repo enforces it inside its
// own test; this repo enforced nothing, so the two could drift apart silently and the first
// symptom would have been a CFI that resolves to a different place on each surface — which
// is the one bug a cross-surface round-trip test cannot even be written until this exists.
//
//   node scripts/foliate-lock.mjs                 # print the aggregate and the summary
//   node scripts/foliate-lock.mjs --write         # (re)write FOLIATE.lock
//   node scripts/foliate-lock.mjs --check         # CI: recompute and NAME what moved
//   node scripts/foliate-lock.mjs --list          # the diffable artefact: name:digest lines
//   node scripts/foliate-lock.mjs --diff other.txt  # our list vs another repo's list
//
// ── THE AGGREGATE, AND THE FOUR DETAILS THAT SILENTLY CHANGE IT ──────────────
//
//   aggregate = sha256( entries.map(([name, digest]) => `${name}:${digest}`).join('\n') )
//
//   1. OVER name:digest LINES, NOT DIGESTS ALONE. Summing or concatenating digests calls a
//      RENAME an add plus a delete, and the two cancel: the total does not move. Binding the
//      path into the hashed text is what makes a rename visible, and a rename is exactly the
//      kind of change that looks harmless in a diff and breaks an import path.
//
//   2. VENDOR-RELATIVE PATHS, NOT REPO-RELATIVE. Repo-relative cannot match across two repos
//      that vendor at different paths — it is broken by construction, not merely fragile.
//      Names here are relative to the vendored root, so the comparison is about the ENGINE
//      rather than about where each repo happens to keep it.
//
//   3. SORTED BEFORE JOINING. readdirSync order is not guaranteed across filesystems, so an
//      unsorted list makes the number depend on the machine that computed it. The comparator
//      is JavaScript's default (UTF-16 code unit), which for these ASCII paths is byte order;
//      it is named here because "sorted" alone is not a specification.
//
//   4. POSIX SEPARATORS. A Windows checkout would otherwise hash backslashes and disagree
//      with CI about every file in a subdirectory.
//
// ── THE TREE IS GIT-TRACKED FILES, NOT FILES ON DISK ─────────────────────────
// This is the correction that mattered most. Walking the directory picks up whatever the
// working copy happens to contain: this checkout carries three gitignored files under
// public/vendor/foliate-js-main/.next/ (trace, trace-build, cache/config.json) left by a
// build that ran with the wrong cwd. A pin whose value depends on whether someone has run a
// build is not a pin — CI and a developer's machine would compute different numbers from
// identical committed content, and the pin would report drift that does not exist.
//
// So the tree is `git ls-files`. 231 files. If git is unavailable the script fails loudly
// rather than falling back to a directory walk, because a quiet fallback would reintroduce
// exactly the machine-dependence this paragraph exists to remove.
//
// ── WHAT IS AND IS NOT EXEMPT ────────────────────────────────────────────────
// SUBSTITUTIONS are files this repo deliberately serves in a different form from the app's.
// They are exempt from the CROSS-REPO comparison (--diff) and NEVER from the pin: a
// substituted file still has to be pinned here, or it could change under us unnoticed.
//
// NOT-VENDORED is the list of upstream files neither surface ships. It has to match on both
// sides or the two repos are comparing different subsets of the same engine and agreeing for
// the wrong reason. This side does not know the app's value yet, so it is recorded as null
// and --diff REFUSES to declare parity while it is null. An unknown is not a pass.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = 'public/vendor/foliate-js-main';
const LOCK_PATH = resolve(ROOT, 'FOLIATE.lock');

// Exempt from --diff, never from the pin. See the header.
const SUBSTITUTIONS = ['pdf.js'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The tracked files under the vendored root, as vendor-relative POSIX paths. */
function trackedFiles() {
  let out;
  try {
    out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', VENDOR_DIR], { encoding: 'utf8' });
  } catch (e) {
    throw new Error('git ls-files failed. The tree is defined as TRACKED files, and falling back '
      + 'to a directory walk would make the number depend on local build residue — the exact '
      + 'machine-dependence this pin exists to avoid. Fix git, do not add a fallback.');
  }
  // -z: NUL-separated, so a path containing a newline cannot split one entry into two.
  return out.split('\0').filter(Boolean).map((p) => p.slice(VENDOR_DIR.length + 1));
}

/** `[name, digest]` pairs, sorted. `name` is vendor-relative and POSIX-separated. */
export function entries() {
  return trackedFiles()
    .map((name) => {
      const posixName = sep === '/' ? name : name.split(sep).join('/');
      return [posixName, sha256(readFileSync(resolve(ROOT, VENDOR_DIR, name)))];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export const lines = (es) => es.map(([n, d]) => `${n}:${d}`);
export const aggregate = (es) => sha256(lines(es).join('\n'));

function buildLock() {
  const es = entries();
  return {
    _: 'The pin on the vendored foliate-js engine. See scripts/foliate-lock.mjs for the spec '
      + 'and for why the tree is git-tracked files rather than files on disk.',
    spec: {
      tree: 'git ls-files, not a directory walk',
      paths: 'vendor-relative, POSIX separators',
      order: 'sorted by UTF-16 code unit (byte order for these ASCII paths)',
      digest: 'lowercase hex sha256 of the file bytes',
      aggregate: "sha256(entries.map(([name, digest]) => `${name}:${digest}`).join('\\n'))",
    },
    vendorDir: VENDOR_DIR,
    count: es.length,
    aggregate: aggregate(es),
    // Exempt from the cross-repo diff, never from the pin above.
    substitutions: SUBSTITUTIONS,
    // Must match the app side's value. null = not yet known; --diff refuses parity while null.
    notVendored: null,
    entries: lines(es),
  };
}

function readLock() {
  if (!existsSync(LOCK_PATH)) {
    throw new Error(`no FOLIATE.lock. Run:  node scripts/foliate-lock.mjs --write`);
  }
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

/** What moved, per file — never just "the number changed". */
function compare(oldLines, newLines) {
  const toMap = (ls) => new Map(ls.map((l) => {
    const i = l.lastIndexOf(':');
    return [l.slice(0, i), l.slice(i + 1)];
  }));
  const a = toMap(oldLines);
  const b = toMap(newLines);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
  return { added, removed, changed };
}

function printDelta({ added, removed, changed }, labelA, labelB) {
  const show = (title, list) => {
    if (!list.length) return;
    console.log(`  ${title} (${list.length}):`);
    for (const n of list.slice(0, 40)) console.log(`      ${n}`);
    if (list.length > 40) console.log(`      … and ${list.length - 40} more`);
  };
  show(`only in ${labelA}`, removed);
  show(`only in ${labelB}`, added);
  show('same path, different bytes', changed);
}

function main() {
  const argv = process.argv.slice(2);
  const es = entries();
  const agg = aggregate(es);

  if (argv[0] === '--list') {
    // stdout is the artefact. Nothing else may print here.
    process.stdout.write(lines(es).join('\n') + '\n');
    return;
  }

  if (argv[0] === '--write') {
    const lock = buildLock();
    writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
    console.log(`wrote FOLIATE.lock — ${lock.count} files, aggregate ${lock.aggregate}`);
    return;
  }

  if (argv[0] === '--check') {
    const lock = readLock();
    if (lock.aggregate === agg && lock.count === es.length) {
      console.log(`foliate pin OK — ${es.length} files, ${agg}`);
      return;
    }
    console.log('FOLIATE PIN MISMATCH');
    console.log(`  expected  ${lock.aggregate}  (${lock.count} files)`);
    console.log(`  computed  ${agg}  (${es.length} files)`);
    printDelta(compare(lock.entries, lines(es)), 'FOLIATE.lock', 'the working tree');
    console.log('\n  The vendored engine changed. If that was deliberate, re-run with --write and');
    console.log('  say in the commit message what moved and why. If it was not, this is the drift');
    console.log('  the pin exists to catch.');
    process.exit(1);
  }

  if (argv[0] === '--diff') {
    const other = argv[1];
    if (!other) throw new Error('--diff needs a path to the other side\'s name:digest list');
    const theirs = readFileSync(resolve(other), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const lock = existsSync(LOCK_PATH) ? readLock() : buildLock();

    const delta = compare(theirs, lines(es));
    // Substitutions are expected to differ across repos; they are exempt HERE and nowhere else.
    const exempt = (n) => SUBSTITUTIONS.includes(n);
    const real = {
      added: delta.added.filter((n) => !exempt(n)),
      removed: delta.removed.filter((n) => !exempt(n)),
      changed: delta.changed.filter((n) => !exempt(n)),
    };
    const waived = [...delta.added, ...delta.removed, ...delta.changed].filter(exempt);

    console.log(`ours   ${es.length} files, aggregate ${agg}`);
    console.log(`theirs ${theirs.length} files`);
    if (waived.length) console.log(`\n  waived as substitutions: ${[...new Set(waived)].join(', ')}`);

    const clean = !real.added.length && !real.removed.length && !real.changed.length;
    if (!clean) {
      console.log('\n  THE ENGINES DIFFER:');
      printDelta(real, 'theirs', 'ours');
      process.exit(1);
    }
    if (lock.notVendored === null) {
      console.log('\n  Every file matches — but notVendored is still null on this side, so the two');
      console.log('  repos may be comparing different subsets of the same engine. That is an');
      console.log('  UNKNOWN, not a pass. Fill notVendored in from the app side and re-run.');
      process.exit(2);
    }
    console.log('\n  The engines match.');
    return;
  }

  console.log(`vendored engine : ${VENDOR_DIR}`);
  console.log(`tracked files   : ${es.length}`);
  console.log(`aggregate       : ${agg}`);
  console.log(`substitutions   : ${SUBSTITUTIONS.join(', ')} (exempt from --diff, never from the pin)`);
  if (existsSync(LOCK_PATH)) {
    const lock = readLock();
    console.log(`FOLIATE.lock    : ${lock.aggregate === agg ? 'matches' : 'DOES NOT MATCH — run --check'}`);
    console.log(`notVendored     : ${lock.notVendored === null ? 'null — not yet known from the app side' : JSON.stringify(lock.notVendored)}`);
  } else {
    console.log('FOLIATE.lock    : absent — run --write');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`\n${e.message}\n`); process.exit(1); }
}
