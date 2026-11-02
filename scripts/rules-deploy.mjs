// npm run rules:deploy[:db|:storage] — firebase deploy with the admin key found, from any checkout.
//
//   node scripts/rules-deploy.mjs database            (rules:deploy:db)
//   node scripts/rules-deploy.mjs storage             (rules:deploy:storage)
//   node scripts/rules-deploy.mjs database,storage    (rules:deploy)
//   … --dry-run                                       say which key would be used, and stop
//
// Why. The scripts used to be `GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json firebase deploy`,
// a path relative to the checkout. Only the main checkout has that file (the devcontainer writes it
// there), so from a worktree the deploy failed (PROOFS-R3, LIVE-PATHS-2) and the deploy had to be
// retyped by hand with the main checkout's path.
//
// The key file, first found wins:
//   1. GOOGLE_APPLICATION_CREDENTIALS, if it names a file
//   2. serviceAccountKey.json in this checkout
//   3. serviceAccountKey.json in the main checkout (the worktrees' common git directory's parent)
//   4. FIREBASE_SA_KEY / FIREBASE_SERVICE_ACCOUNT, written to a private temporary file (0600, its own
//      0700 directory) that is deleted when the deploy ends, however it ends
//
// NOTHING HERE PRINTS A KEY. The key is checked through scripts/security/service-account.mjs (whose
// errors withhold the value) and only its project_id, client_email and private_key_id are shown.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, publicFields, readServiceAccountFile } from './security/service-account.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'calvary-scribblings';
const TARGETS = new Set(['database', 'storage']);

/** The main checkout's root, from any worktree of it (or this checkout, if it is the main one). */
export function mainCheckoutOf(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(common);
  } catch { return null; }
}

/**
 * Where the key is. Returns { path, source, temporary } — `temporary` when it had to be written
 * from a secret; the caller deletes it. Throws, naming the places looked, when there is none.
 */
export function resolveKeyFile({ root = ROOT, env = process.env } = {}) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return { path: resolve(env.GOOGLE_APPLICATION_CREDENTIALS), source: 'GOOGLE_APPLICATION_CREDENTIALS', temporary: false };
  }
  const own = join(root, 'serviceAccountKey.json');
  if (existsSync(own)) return { path: own, source: 'this checkout', temporary: false };
  const main = mainCheckoutOf(root);
  if (main && resolve(main) !== resolve(root) && existsSync(join(main, 'serviceAccountKey.json'))) {
    return { path: join(main, 'serviceAccountKey.json'), source: 'the main checkout', temporary: false };
  }
  if (env.FIREBASE_SA_KEY || env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = loadServiceAccount({ env });                // throws a value-free error if malformed
    const dir = mkdtempSync(join(tmpdir(), 'rules-deploy-'));
    const path = join(dir, 'key.json');
    writeFileSync(path, JSON.stringify(sa), { mode: 0o600 });
    return { path, source: env.FIREBASE_SA_KEY ? 'FIREBASE_SA_KEY (temporary file)' : 'FIREBASE_SERVICE_ACCOUNT (temporary file)', temporary: true };
  }
  throw new Error('no admin key: set GOOGLE_APPLICATION_CREDENTIALS, or put serviceAccountKey.json in this or the main checkout, or set FIREBASE_SA_KEY');
}

function main(argv) {
  const dry = argv.includes('--dry-run');
  const targets = (argv.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);
  if (!targets.length || targets.some((t) => !TARGETS.has(t))) {
    console.error('usage: node scripts/rules-deploy.mjs database|storage|database,storage [--dry-run]');
    return 2;
  }
  const key = resolveKeyFile();
  try {
    const f = publicFields(readServiceAccountFile(key.path));
    console.log(`[rules-deploy] key from ${key.source}: ${f.client_email}, key id ${f.private_key_id} (project ${f.project_id})`);
    if (f.project_id !== PROJECT) { console.error(`[rules-deploy] that key is for ${f.project_id}, not ${PROJECT}`); return 1; }
    const args = ['firebase', 'deploy', '--only', targets.join(','), '--project', PROJECT, '--non-interactive'];
    if (dry) { console.log(`[rules-deploy] dry run: would run npx ${args.join(' ')}`); return 0; }
    const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: key.path } });
    return r.status ?? 1;
  } finally {
    if (key.temporary) rmSync(dirname(key.path), { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`[rules-deploy] ${e.message}`); process.exitCode = 1; }
}
