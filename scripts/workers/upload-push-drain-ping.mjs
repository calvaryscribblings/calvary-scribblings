// P4-B5 — upload the push-drain-ping Worker's CODE ONLY, from the mirror, safely. A copy of
// scripts/workers/upload-newsletter.mjs (LIVE-PATHS-1) for the second Worker this repo ships code to;
// only the names and the content check differ.
//
//   node scripts/workers/upload-push-drain-ping.mjs                 # DRY (default): download + back up + compare
//   node scripts/workers/upload-push-drain-ping.mjs --apply         # the same, then upload, then read back
//   node scripts/workers/upload-push-drain-ping.mjs --expect=<ref>  # the commit whose mirror must equal live
//                                                                   #   (default origin/main; once P4-B5 is on
//                                                                   #   main, pass the commit before it)
//   node scripts/workers/upload-push-drain-ping.mjs --restore=<backup file> --apply
//
// THE ORDER, every run:
//   1. Download the LIVE Worker's code (Cloudflare API, content/v2) and back it up to
//      /workspaces/calvary-private/backups/push-drain-ping-live-<stamp>.js (private, never the repo).
//   2. Require it to equal the mirror at --expect. If not, the dashboard was edited: REFUSE.
//   3. Require the working-tree mirror to be committed (== HEAD) and to carry the queue() handler.
//   4. --apply only: PUT .../workers/scripts/push-drain-ping/content. CODE ONLY: the cron trigger,
//      PUSH_DRAIN_SECRET and every setting are kept. Never wrangler deploy, never a dashboard paste.
//   5. Read the live code back and require it to equal the mirror byte for byte.
//
// Prints sizes, sha256 prefixes and the entry-point name. Never prints the token, the account id,
// any binding, or the Worker's source. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID come from the
// environment; only their PRESENCE is reported.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'push-drain-ping';
const MIRROR_REL = 'workers-external/push-drain-ping.worker.js';
const BACKUP_DIR = '/workspaces/calvary-private/backups';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EXPECT = (args.find((a) => a.startsWith('--expect=')) || '--expect=origin/main').slice('--expect='.length);
const RESTORE = (args.find((a) => a.startsWith('--restore=')) || '').slice('--restore='.length) || null;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const fp = (label, s) => console.log(`  ${label.padEnd(30)} ${String(Buffer.byteLength(s)).padStart(7)} bytes  sha256 ${sha(s).slice(0, 16)}`);
const die = (msg) => { console.error(`\n  ✗ ${msg}\n  Nothing was uploaded.\n`); process.exit(1); };
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(`git ${a.join(' ')} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
};

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) die(`CLOUDFLARE_API_TOKEN ${TOKEN ? 'set' : 'MISSING'}, CLOUDFLARE_ACCOUNT_ID ${ACCOUNT ? 'set' : 'MISSING'}.`);
if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) die('CLOUDFLARE_ACCOUNT_ID is not a 32-hex account id (value not shown).');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

async function downloadLive() {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/content/v2`, { headers: AUTH });
  if (!res.ok) die(`download failed: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  let entry = res.headers.get('cf-entrypoint');
  let code;
  if (/multipart\/form-data/i.test(type)) {
    // content/v2 answers a form with one part per module, even for a single-module Worker.
    const form = await res.formData();
    const parts = [...form.entries()];
    if (parts.length !== 1) die(`the live Worker has ${parts.length} parts; this script handles a single-module Worker only.`);
    const [name, value] = parts[0];
    entry ||= name;
    if (name !== entry) die('the module part is not the entry point.');
    code = typeof value === 'string' ? value : await value.text();
  } else {
    code = await res.text();
  }
  entry ||= 'worker.js';
  if (!/^[A-Za-z0-9._-]{1,64}\.(m?js)$/.test(entry)) die('the live entry-point name is not a plain .js file name.');
  return { code, entry };
}

function backup(code) {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${BACKUP_DIR}/push-drain-ping-live-${stamp}.js`;
  writeFileSync(file, code, { mode: 0o600, flag: 'wx' });
  const back = readFileSync(file, 'utf8');
  if (back !== code) die('the backup did not read back identical.');
  return file;
}

async function upload(code, entry) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ main_module: entry })], { type: 'application/json' }));
  form.append(entry, new Blob([code], { type: 'application/javascript+module' }), entry);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/content`, { method: 'PUT', headers: AUTH, body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success !== true) {
    const codes = (body?.errors || []).map((e) => e.code).join(',');
    die(`upload refused: HTTP ${res.status}${codes ? ` (Cloudflare error ${codes})` : ''}.`);
  }
}

// ── 1. download + back up ──────────────────────────────────────────────────────────────────
console.log(`\n  ${SCRIPT}: ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to upload)'}${RESTORE ? ' — RESTORE from a backup' : ''}\n`);
const live = await downloadLive();
const backupFile = backup(live.code);
fp('live (downloaded)', live.code);
console.log(`  entry point                    ${live.entry}`);
console.log(`  backed up to                   ${backupFile}`);

// ── what will be uploaded ────────────────────────────────────────────────────────────────────
let next;
if (RESTORE) {
  if (!RESTORE.startsWith(`${BACKUP_DIR}/push-drain-ping-live-`)) die(`--restore takes a file this script wrote under ${BACKUP_DIR}.`);
  next = readFileSync(RESTORE, 'utf8');
  fp('restore source', next);
} else {
  // ── 2. live must equal the mirror we believe is live ────────────────────────────────────────
  const expected = git('show', `${EXPECT}:${MIRROR_REL}`);
  fp(`mirror @ ${EXPECT}`, expected);
  if (live.code !== expected) {
    die(`the live Worker is NOT the mirror at ${EXPECT}. The dashboard has changed since the mirror was synced.\n`
      + `    Compare: diff ${backupFile} ${MIRROR_REL}`);
  }
  console.log(`  ✓ live === mirror @ ${EXPECT}`);

  // ── 3. the new code: committed, and carrying the queue() handler ─────────────────────────────
  next = readFileSync(resolve(ROOT, MIRROR_REL), 'utf8');
  const head = git('show', `HEAD:${MIRROR_REL}`);
  fp('mirror (working tree)', next);
  if (next !== head) die('the working-tree mirror has uncommitted changes. Commit first; the upload is always a committed version.');
  if (!next.includes('async queue(batch, env)') || !next.includes('?via=wake')) die('the mirror does not carry the P4-B5 queue() handler.');
  if (next === live.code) { console.log('\n  Live already runs this code. Nothing to do.\n'); process.exit(0); }
  console.log('  ✓ mirror committed, queue() handler present');
}

if (!APPLY) {
  console.log('\n  DRY RUN: checks passed; nothing uploaded. Re-run with --apply inside the release window.\n');
  process.exit(0);
}

// ── 4. upload (code only) ────────────────────────────────────────────────────────────────────
await upload(next, live.entry);
console.log('  ✓ uploaded (content only: bindings, secrets and cron kept)');

// ── 5. read back ─────────────────────────────────────────────────────────────────────────────
const after = await downloadLive();
fp('live (read back)', after.code);
if (after.code !== next) {
  console.error(`\n  ✗ LIVE DOES NOT MATCH WHAT WAS UPLOADED. Put the previous code back now:\n`
    + `    node scripts/workers/upload-push-drain-ping.mjs --restore=${backupFile} --apply\n`);
  process.exit(2);
}
console.log(`  ✓ live === ${RESTORE ? 'the restored backup' : 'the mirror'}. Previous code kept at ${backupFile}\n`);
