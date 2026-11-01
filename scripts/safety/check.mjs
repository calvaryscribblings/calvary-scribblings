// SAFETY-1 — the static check behind tests/ci/safety-guard.test.mjs.
//
//   node scripts/safety/check.mjs                 # every file under scripts/
//   node scripts/safety/check.mjs <file> [...]    # just these (exit 1 on a finding)
//
// A file under scripts/ may write to production ONLY through scripts/safety/guard.mjs. This finds
// the ways it could do otherwise:
//
//   rest      a fetch() with a write method (anything but GET/HEAD, or a method held in a variable),
//             unless the call's URL is plainly another service (Stripe, Paystack, Anthropic, Expo,
//             Facebook, a deploy hook, this site's own API). Every file, not only those that name
//             the database: a URL can arrive as a parameter.
//   admin-db  a firebase-admin Database handle (getDatabase(), admin.database()) that is not
//             handed straight to guard.adminDb(), or to readOnlyDb() (which throws on any write).
//   storage   a Cloud Storage bucket (getStorage()…bucket(), new Storage()…bucket()) that is not
//             handed straight to guard.adminBucket() or readOnlyBucket().
//   client    the Firebase CLIENT SDK's database or storage module (browser code; no place here).
//
// A file can be exempt only by name, in EXEMPT below, with one of a fixed set of reasons. That list
// is the whole of the exceptions; adding to it is a reviewed diff, not a comment in the script.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REASONS = {
  'the-guard': 'is the guard, or restores through it',
  'emulator-only': 'writes only to a local emulator, never production',
  'single-record': 'writes one fixed record (a heartbeat or a per-title record) and is not a bulk write',
  'bucket-config': 'changes bucket configuration, not data; refuses to drop rules it does not know',
};

export const EXEMPT = {
  'scripts/safety/guard.mjs': ['the-guard', 'the only place a raw write is allowed'],
  'scripts/safety/restore.mjs': ['the-guard', 'reads backups by REST and writes only through openGuard'],
  'scripts/backup/rehearse.mjs': ['emulator-only', 'its round trip PUTs and DELETEs only in the database emulator (SAFETY-1 moved it off production)'],
  'scripts/backup/restore-drill.mjs': ['emulator-only', 'PUT/DELETE go to the database emulator root; production is only read'],
  'scripts/backup/liveness.mjs': ['single-record', 'one heartbeat PUT to ops/backup_liveness, daily'],
  'scripts/audit/states-shots.mjs': ['single-record', 'creates the live test reader account record only (tests/live/test-reader.mjs)'],
  'scripts/bookstore/author-copy.mjs': ['single-record', 'one title per run: create-only uploads (ifGenerationMatch 0), a create-if-absent transaction, and its own verified backup before a revoke'],
  'scripts/storage/lifecycle.mjs': ['bucket-config', 'sets the main bucket lifecycle rules from storage/lifecycle.json'],
};

// api.cloudflare.com: Worker code uploads (scripts/workers/upload-newsletter.mjs, LIVE-PATHS-1), which
// back up the live code and verify it first; not the database.
const OTHER_SERVICE = /anthropic|stripe|paystack|facebook|graph\.|exp\.host|expo|hook|HOOK|calvaryscribblings\.co|SITE|resend|oauth2\.googleapis|firebaserules|api\.cloudflare\.com|\/api\//;

/** Drop block comments and whole-line // comments (strings with "//" in them survive). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

/** The text of each call to `name(` with balanced parentheses, with its line number. */
function calls(src, name) {
  const out = [];
  const re = new RegExp(`(^|[^\\w.$])${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, q = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push({ text: src.slice(m.index, i), line: src.slice(0, m.index).split('\n').length + (m[1] === '\n' ? 1 : 0) });
  }
  return out;
}

const firstArg = (callText) => {
  const inner = callText.slice(callText.indexOf('(') + 1);
  let depth = 0, q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (!depth) return inner.slice(0, i); depth--; }
    else if (c === ',' && !depth) return inner.slice(0, i);
  }
  return inner;
};

/** Every unguarded production write in one file's source. [] means clean. */
export function findRawWrites(source) {
  const src = stripComments(source);
  const found = [];

  {
    for (const c of calls(src, 'fetch')) {
      const mm = /\bmethod\s*:\s*([^,}\n]+)|[{,]\s*method\s*[,}]/.exec(c.text);
      if (!mm) continue;
      const val = (mm[1] || 'method').trim();
      if (/^['"`](GET|HEAD)['"`]$/i.test(val)) continue;
      if (OTHER_SERVICE.test(firstArg(c.text))) continue;
      // A call to another service whose URL is in a variable carries its reason on the line:
      //   fetch(url, { method: 'POST' })  // safety-guard: not-firebase (the deploy hook)
      const callLine = src.split('\n')[c.line - 1] || '';
      if (/safety-guard:\s*not-firebase\s*\(.+\)/.test(callLine)) continue;
      found.push({ kind: 'rest', line: c.line, detail: `fetch with method ${val.slice(0, 30)}` });
    }
  }

  // firebase-admin database handles
  const dbHandles = [
    ...calls(src, 'getDatabase'),
    ...src.split('\n').flatMap((l, i) => (/\.database\s*\(/.test(l) ? [{ line: i + 1 }] : [])),
  ];
  for (const c of dbHandles) {
    const lineText = src.split('\n')[c.line - 1] || '';
    if (/(adminDb|readOnlyDb)\s*\(/.test(lineText)) continue;
    if (/import\s|from\s+['"]/.test(lineText)) continue;
    found.push({ kind: 'admin-db', line: c.line, detail: 'a firebase-admin Database not passed to guard.adminDb()' });
  }

  // Cloud Storage buckets
  if (/getStorage\s*\(|@google-cloud\/storage|firebase-admin\/storage/.test(src)) {
    src.split('\n').forEach((l, i) => {
      if (/\.bucket\s*\(/.test(l) && !/(adminBucket|readOnlyBucket)\s*\(/.test(l)) {
        found.push({ kind: 'storage', line: i + 1, detail: 'a Storage bucket not passed to guard.adminBucket()' });
      }
    });
  }

  if (/from\s+['"]firebase\/(database|storage)['"]/.test(src)) {
    found.push({ kind: 'client', line: 0, detail: 'the Firebase client SDK has no place in scripts/' });
  }
  return found;
}

export function scriptFiles(dir = join(ROOT, 'scripts')) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') out.push(...scriptFiles(p)); }
    else if (/\.(mjs|js|cjs)$/.test(e)) out.push(p);
  }
  return out;
}

/** Findings for the whole tree, after exemptions. */
export function checkTree(root = ROOT) {
  const bad = [];
  for (const f of scriptFiles(join(root, 'scripts'))) {
    const rel = relative(root, f).split('\\').join('/');
    if (EXEMPT[rel]) continue;
    const hits = findRawWrites(readFileSync(f, 'utf8'));
    if (hits.length) bad.push({ file: rel, hits });
  }
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const files = process.argv.slice(2);
  const results = files.length
    ? files.map((f) => ({ file: f, hits: findRawWrites(readFileSync(f, 'utf8')) })).filter((r) => r.hits.length)
    : checkTree();
  for (const r of results) {
    console.log(`✗ ${r.file}`);
    for (const h of r.hits) console.log(`    line ${h.line}: ${h.kind}: ${h.detail}`);
  }
  if (results.length) {
    console.log(`\n${results.length} file(s) write to production without going through scripts/safety/guard.mjs.`);
    console.log('A bulk write goes through the guard: a dry run first, then a fresh, verified backup, then the write.');
    process.exit(1);
  }
  console.log('✓ every production write under scripts/ goes through the guard.');
}
