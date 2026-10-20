#!/usr/bin/env node
// SECURITY-R1 — does every consumer of the Firebase admin key authenticate, and with WHICH key?
//
//   node scripts/security/verify-admin-key.mjs                    # every check this Codespace can make
//   node scripts/security/verify-admin-key.mjs --expect <kid>     # …and FAIL any consumer not on <kid>
//   node scripts/security/verify-admin-key.mjs --probe-pages      # …and exercise the Pages key (see below)
//
// PRINTS ONLY: pass / fail / n/a, the consumer's name, and the private_key_id in use. Never a key,
// never part of one, never a token. Credentials are parsed by ./service-account.mjs, whose errors
// name the source and withhold the value (the reason that file exists).
//
// Read-only. It mints OAuth tokens (that is the proof of authentication), reads the database root
// SHALLOW (key names only, discarded), reads Google's PUBLISHED certificates for the account, reads
// the Cloudflare and GitHub APIs (names, types, run results), and writes nothing anywhere.
//
// The one exception is opt-in: --probe-pages asks the live site for one story, which is the only
// way to make the Pages key mint a token from outside. functions/api/story.js then adds one to
// story_clients/<day>/story/key-verify__noversion — a reader-shaped counter, labelled so it can never
// be mistaken for app traffic (an unlabelled call would land in `unknown`, the bucket T3 waits on).
// Off by default; the round that runs it says so.
//
// What it CANNOT see, and says so rather than guessing: the GitHub Actions secret and the two
// Cloudflare secret_text keys (Pages FIREBASE_PRIVATE_KEY, Worker calvary-auth) are write-only by
// design. For those, security/KEY-ROTATION.md gives the read-only way to learn the key ID: the
// service account's Metrics tab, "Authentication traffic per key".

import { createSign, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBase64ServiceAccount, readServiceAccountFile } from './service-account.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EMAIL = 'firebase-adminsdk-fbsvc@calvary-scribblings.iam.gserviceaccount.com';
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const SITE = 'https://calvaryscribblings.co.uk';
const REPO = 'calvaryscribblings/calvary-scribblings';

// The workflows that materialise secrets.FIREBASE_SERVICE_ACCOUNT. Scheduled ones prove the
// secret works every time they succeed; the rest run on a push or by hand.
const ACTIONS_WORKFLOWS = [
  'covers.yml', 'account-scrub.yml', 'index-reconcile.yml', 'push-announce.yml', 'withdrawals.yml',
  'square-horizon.yml', 'backup-liveness.yml', 'launch-check.yml', 'rules-and-hygiene.yml', 'w33-proof.yml',
];
// Workflows where the key is used by ONE step of a larger run: judge that step, not the run.
// (rules-and-hygiene is the whole CI suite; a lint failure there says nothing about the key, and
// its rules:check step runs only on a push that changes a rules file.)
const KEY_STEP = { 'rules-and-hygiene.yml': 'rules:check' };
// The optional one-shot workflow from KEY-ROTATION.md that prints the Actions key's ID.
const KEY_ID_WORKFLOW = 'admin-key-id.yml';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const EXPECT = opt('--expect');

const results = [];
function report(status, consumer, kid, note = '') {
  let s = status;
  if (s === 'PASS' && EXPECT && kid && kid !== EXPECT) s = 'FAIL';
  const why = s !== status ? `holds ${kid}, expected ${EXPECT}. ${note}` : note;
  results.push(s);
  console.log(`${s.padEnd(4)}  ${consumer.padEnd(44)}  kid=${kid || '—'}${why ? `  ${why}` : ''}`);
}

// ── Google ────────────────────────────────────────────────────────────────────────────────────

async function mintToken(sa, scope = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email') {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
  const body = enc({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300 });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }),
  });
  const j = await r.json().catch(() => ({}));
  // Google's error codes (invalid_grant etc.) carry no secret; the description can name the key ID.
  if (!r.ok || !j.access_token) throw new Error(`token refused: ${r.status} ${j.error || ''}`.trim());
  return j.access_token;
}

/** A read the admin key is needed for: the database root, SHALLOW (top-level names, discarded). */
async function shallowRead(token) {
  const r = await fetch(`${DB_URL}/.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`database read refused: ${r.status}`);
  await r.arrayBuffer();
}

let published = null;
async function publishedCerts() {
  if (!published) {
    const r = await fetch(`https://www.googleapis.com/service_accounts/v1/metadata/x509/${encodeURIComponent(EMAIL)}`);
    published = r.ok ? await r.json() : {};
  }
  return published;
}

/** Is this key's ID published by Google, and is the published certificate THIS key's public half? */
async function pairsWithPublished(sa) {
  const pem = (await publishedCerts())[sa.private_key_id];
  if (!pem) return 'not listed';
  const der = (k) => k.export({ type: 'spki', format: 'der' }).toString('hex');
  return der(new X509Certificate(pem).publicKey) === der(createPublicKey(createPrivateKey(sa.private_key))) ? 'pairs' : 'MISMATCH';
}

async function checkKey(consumer, load) {
  let sa;
  try {
    sa = load();
  } catch (e) {
    return report('FAIL', consumer, null, e.message);
  }
  if (sa.client_email !== EMAIL) return report('FAIL', consumer, sa.private_key_id, `a different account: ${sa.client_email}`);
  try {
    const pair = await pairsWithPublished(sa);
    await shallowRead(await mintToken(sa));
    report(pair === 'pairs' ? 'PASS' : 'FAIL', consumer, sa.private_key_id, `token minted, database read; published cert ${pair}`);
  } catch (e) {
    report('FAIL', consumer, sa.private_key_id, e.message);
  }
  return sa;
}

// ── GitHub ────────────────────────────────────────────────────────────────────────────────────

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

function checkActions() {
  let kid = null;
  try {
    const runs = gh(`repos/${REPO}/actions/workflows/${KEY_ID_WORKFLOW}/runs?per_page=1&status=success`).workflow_runs || [];
    if (runs[0]) {
      const log = execFileSync('gh', ['run', 'view', String(runs[0].id), '--repo', REPO, '--log'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      kid = (log.match(/private_key_id=([0-9a-f]{40})/) || [])[1] || null;
    }
  } catch { /* the one-shot workflow is optional and may not exist yet */ }

  for (const wf of ACTIONS_WORKFLOWS) {
    const name = `Actions FIREBASE_SERVICE_ACCOUNT · ${wf}`;
    if (KEY_STEP[wf]) { checkKeyStep(wf, name, kid); continue; }
    let run;
    try {
      run = (gh(`repos/${REPO}/actions/workflows/${wf}/runs?per_page=1&status=completed`).workflow_runs || [])[0];
    } catch {
      report('N/A', name, kid, 'cannot read runs from here');
      continue;
    }
    if (!run) { report('N/A', name, kid, 'no completed run'); continue; }
    const when = `${run.event} run ${run.updated_at}`;
    report(run.conclusion === 'success' ? 'PASS' : 'FAIL', name, kid, `last ${when}: ${run.conclusion}${kid ? '' : ' (key ID: see KEY-ROTATION.md §2)'}`);
  }
}

/** The latest run (of the last 30) in which the key-using step actually ran, judged by that step. */
function checkKeyStep(wf, name, kid) {
  try {
    for (const run of gh(`repos/${REPO}/actions/workflows/${wf}/runs?per_page=30&status=completed`).workflow_runs || []) {
      for (const job of gh(`repos/${REPO}/actions/runs/${run.id}/jobs`).jobs || []) {
        const step = (job.steps || []).find((s) => s.name.startsWith(KEY_STEP[wf]) && s.conclusion !== 'skipped');
        if (step) {
          return report(step.conclusion === 'success' ? 'PASS' : 'FAIL', name, kid,
            `step "${KEY_STEP[wf]}" in ${run.event} run ${run.updated_at}: ${step.conclusion}`);
        }
      }
    }
    report('N/A', name, kid, `step "${KEY_STEP[wf]}" has not run in the last 30 runs`);
  } catch {
    report('N/A', name, kid, 'cannot read runs from here');
  }
}

// ── Cloudflare ────────────────────────────────────────────────────────────────────────────────

async function cf(path) {
  const { CLOUDFLARE_ACCOUNT_ID: A, CLOUDFLARE_API_TOKEN: T } = process.env;
  if (!A || !T) return null;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}${path}`, { headers: { Authorization: `Bearer ${T}` } });
  const j = await r.json().catch(() => ({}));
  return j.success ? j.result : null;
}

async function checkPages(sa) {
  const name = 'Cloudflare Pages · calvary-scribblings (prod)';
  const project = await cf('/pages/projects/calvary-scribblings');
  if (!project) return report('N/A', name, null, 'Cloudflare API not reachable from here');
  const vars = project.deployment_configs?.production?.env_vars || {};
  // FIREBASE_CLIENT_EMAIL is plain_text, so it can be COMPARED. It is never printed.
  const emailOk = vars.FIREBASE_CLIENT_EMAIL?.value === EMAIL;
  const keyType = vars.FIREBASE_PRIVATE_KEY?.type || 'absent';
  if (!emailOk || keyType !== 'secret_text') {
    return report('FAIL', name, null, `FIREBASE_CLIENT_EMAIL ${emailOk ? 'ok' : 'WRONG/absent'}; FIREBASE_PRIVATE_KEY ${keyType}`);
  }
  if (!flag('--probe-pages')) {
    return report('N/A', name, null, 'configured (email matches, key is secret_text); not exercised: pass --probe-pages');
  }
  try {
    const index = await (await fetch(`${DB_URL}/stories_index.json?shallow=true`, { headers: { Authorization: `Bearer ${await mintToken(sa)}` } })).json();
    const slug = Object.keys(index || {})[0];
    const r = await fetch(`${SITE}/api/story`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, client: 'key-verify' }),
    });
    // story.js mints, then reads the record, then answers 200 or 404. 502 'unavailable' is what it
    // answers when the mint (or the read after it) fails — the one status that means a bad key.
    const ok = r.status === 200 || r.status === 404;
    report(ok ? 'PASS' : 'FAIL', name, null, `POST /api/story → ${r.status} (key ID: see KEY-ROTATION.md §2)`);
  } catch (e) {
    report('FAIL', name, null, e.message);
  }
}

async function checkAuthWorker() {
  const name = 'Cloudflare Worker · calvary-auth';
  const settings = await cf('/workers/scripts/calvary-auth/settings');
  if (!settings) return report('N/A', name, null, 'Cloudflare API not reachable from here');
  const b = Object.fromEntries((settings.bindings || []).map((x) => [x.name, x.type]));
  const ok = b.FIREBASE_CLIENT_EMAIL === 'secret_text' && b.FIREBASE_PRIVATE_KEY === 'secret_text';
  // Both are secret_text (even the email), and its only key-using route SENDS AN EMAIL. Never probed.
  report(ok ? 'N/A' : 'FAIL', name, null, ok
    ? 'configured (both secret_text); unreadable and not probed: every use sends mail (KEY-ROTATION.md §2)'
    : `bindings: FIREBASE_CLIENT_EMAIL ${b.FIREBASE_CLIENT_EMAIL || 'absent'}, FIREBASE_PRIVATE_KEY ${b.FIREBASE_PRIVATE_KEY || 'absent'}`);
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────

console.log(`Admin key verification — ${new Date().toISOString()}${EXPECT ? `, expecting kid=${EXPECT}` : ''}\n`);

const fromSecret = process.env.FIREBASE_SA_KEY
  ? await checkKey('Codespace secret FIREBASE_SA_KEY (base64)', () => decodeBase64ServiceAccount(process.env.FIREBASE_SA_KEY))
  : (report('N/A', 'Codespace secret FIREBASE_SA_KEY (base64)', null, 'not set in this shell'), null);

const file = join(ROOT, 'serviceAccountKey.json');
const fromFile = existsSync(file)
  ? await checkKey('Codespace file serviceAccountKey.json', () => readServiceAccountFile(file))
  : (report('N/A', 'Codespace file serviceAccountKey.json', null, 'absent'), null);

if (fromSecret?.private_key_id && fromFile?.private_key_id && fromSecret.private_key_id !== fromFile.private_key_id) {
  // The file is decoded from the secret only when the Codespace is CREATED or REBUILT.
  report('FAIL', 'Codespace file vs secret', fromFile.private_key_id, `file is stale: secret holds ${fromSecret.private_key_id}. Rebuild the Codespace`);
}

checkActions();
await checkPages(fromSecret || fromFile);
await checkAuthWorker();

const certs = await publishedCerts();
console.log(`\nGoogle publishes ${Object.keys(certs).length} key(s) for the account: ${Object.keys(certs).join(', ')}`);
const failed = results.filter((s) => s === 'FAIL').length;
console.log(`${results.filter((s) => s === 'PASS').length} pass, ${failed} fail, ${results.filter((s) => s === 'N/A').length} n/a`);
process.exit(failed ? 1 : 0);
