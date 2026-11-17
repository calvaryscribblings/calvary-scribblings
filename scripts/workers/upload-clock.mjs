// CLOCK-2 — create (or update the code of) the calvary-clock Worker from workers-external/calvary-clock/.
// docs/CLOCK-1.md is the go-live plan; this is its step 2.
//
//   node scripts/workers/upload-clock.mjs            # DRY (default): what exists, what would be sent
//   node scripts/workers/upload-clock.mjs --apply    # create it, or replace its CODE ONLY; then read back
//
// CREATE (the Worker does not exist yet): one PUT with the three modules, the Durable Object binding
// CLOCK → ClockState and its migration (new_sqlite_classes: SQLite-backed, the kind every plan has).
// NO cron trigger and NO CLOCK_MODE: the clock stays in dry run and nothing ticks. Then the Worker's own
// workers.dev address is switched on, so GET /heartbeat answers (previews stay off).
//
// UPDATE (it exists): PUT .../content — code only. The binding, the migration, the cron, CLOCK_MODE and
// GITHUB_DISPATCH_TOKEN are all kept. Never wrangler deploy, never a dashboard paste.
//
// Either way the modules must be committed and equal to origin/main: the upload is always a version
// that is on main. Afterwards everything is READ BACK, by name and type only: the modules (sha256
// prefixes), the bindings (names and types — never a value), the cron count, and the workers.dev flag.
//
// Never prints the token, the account id, the account's workers.dev subdomain, or any value.
// CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID come from the environment; only their presence is reported.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'calvary-clock';
const DIR = 'workers-external/calvary-clock';
const MODULES = ['worker.mjs', 'tick.mjs', 'clock.mjs'];
const MAIN = 'worker.mjs';
const COMPATIBILITY_DATE = '2025-09-01';
const BINDING = { type: 'durable_object_namespace', name: 'CLOCK', class_name: 'ClockState' };
const MIGRATION = { new_tag: 'v1', new_sqlite_classes: ['ClockState'] };

const APPLY = process.argv.slice(2).includes('--apply');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const die = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(`git ${a[0]} failed`);
  return r.stdout;
};

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) die(`CLOUDFLARE_API_TOKEN ${TOKEN ? 'set' : 'MISSING'}, CLOUDFLARE_ACCOUNT_ID ${ACCOUNT ? 'set' : 'MISSING'}.`);
if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) die('CLOUDFLARE_ACCOUNT_ID is not a 32-hex account id (value not shown).');
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`;
const AUTH = { Authorization: `Bearer ${TOKEN}` };

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const body = /json/.test(res.headers.get('content-type') || '') ? await res.json().catch(() => null) : null;
  return { res, body };
}
const failed = ({ res, body }, what) => {
  const codes = (body?.errors || []).map((e) => e.code).join(',');
  die(`${what}: HTTP ${res.status}${codes ? ` (Cloudflare error ${codes})` : ''}. Nothing further was changed.`);
};

// ── the modules: committed, and the same as on main ──────────────────────────────────────────────
const code = {};
for (const m of MODULES) {
  const rel = `${DIR}/${m}`;
  const tree = readFileSync(resolve(ROOT, rel), 'utf8');
  if (tree !== git('show', `HEAD:${rel}`)) die(`${rel} has uncommitted changes.`);
  if (tree !== git('show', `origin/main:${rel}`)) die(`${rel} is not what origin/main holds. Upload only what is on main.`);
  code[m] = tree;
}
if (!/export class ClockState\b/.test(code[MAIN]) || !/export default clock;/.test(code[MAIN])) die('worker.mjs does not export ClockState and the default handler.');

// ── what exists ──────────────────────────────────────────────────────────────────────────────────
const exists = await cf('/settings');
if (!exists.res.ok && exists.res.status !== 404) failed(exists, 'reading the Worker');
const isNew = exists.res.status === 404;
console.log(`\n  ${SCRIPT}: ${APPLY ? 'APPLY' : 'DRY RUN (add --apply)'} — ${isNew ? 'does not exist yet: CREATE' : 'exists: replace CODE ONLY'}`);
for (const m of MODULES) console.log(`  ${m.padEnd(12)} ${String(Buffer.byteLength(code[m])).padStart(6)} bytes  sha256 ${sha(code[m])}`);
if (isNew) console.log(`  binding ${BINDING.name} → ${BINDING.class_name} (Durable Object), migration ${MIGRATION.new_tag} new_sqlite_classes; no cron, no variables, no secrets`);

if (!APPLY) { console.log('\n  DRY RUN: nothing sent.\n'); process.exit(0); }

// ── upload ───────────────────────────────────────────────────────────────────────────────────────
const form = new FormData();
const metadata = isNew
  ? { main_module: MAIN, compatibility_date: COMPATIBILITY_DATE, bindings: [BINDING], migrations: MIGRATION }
  : { main_module: MAIN };
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
for (const m of MODULES) form.append(m, new Blob([code[m]], { type: 'application/javascript+module' }), m);
const put = await cf(isNew ? '' : '/content', { method: 'PUT', body: form });
if (!put.res.ok || put.body?.success !== true) failed(put, 'upload refused');
console.log(`  ✓ ${isNew ? 'created' : 'code replaced (bindings, secrets, variables and cron kept)'}`);

if (isNew) {
  const sub = await cf('/subdomain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  if (!sub.res.ok || sub.body?.success !== true) failed(sub, 'switching on the workers.dev address');
  console.log('  ✓ workers.dev address on (previews off)');
}

// ── read back: names and types only ──────────────────────────────────────────────────────────────
const back = await fetch(`${API}/content/v2`, { headers: AUTH });
if (!back.ok) die(`read-back of the code failed: HTTP ${back.status}`);
const parts = Object.fromEntries(await Promise.all([...(await back.formData()).entries()].map(async ([k, v]) => [k, typeof v === 'string' ? v : await v.text()])));
const names = Object.keys(parts).sort();
if (names.join() !== [...MODULES].sort().join()) die(`live modules are [${names.join(', ')}], expected [${MODULES.join(', ')}].`);
for (const m of MODULES) if (parts[m] !== code[m]) die(`live ${m} does not equal main's.`);
console.log(`  ✓ live code === origin/main (${MODULES.length} modules)`);

const settings = await cf('/settings');
if (!settings.res.ok) failed(settings, 'reading settings back');
const bindings = (settings.body?.result?.bindings || []).map((b) => `${b.name}:${b.type}`).sort();
console.log(`  bindings (name:type): ${bindings.length ? bindings.join(', ') : 'none'}`);

const sched = await cf('/schedules');
if (!sched.res.ok) failed(sched, 'reading cron triggers');
console.log(`  cron triggers: ${(sched.body?.result?.schedules || []).length}`);

const subOn = await cf('/subdomain');
if (subOn.res.ok) console.log(`  workers.dev address: ${subOn.body?.result?.enabled ? 'on' : 'off'}, previews ${subOn.body?.result?.previews_enabled ? 'on' : 'off'}`);
console.log('');
