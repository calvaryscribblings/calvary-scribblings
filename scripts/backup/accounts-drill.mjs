// SAFETY-2B — THE ACCOUNTS RESTORE TEST (docs/VAULT.md §7, ruling 271). One account, ever: the
// flagged live test reader. Never a live import.
//
//   node scripts/backup/accounts-drill.mjs --accounts <decrypted.json> --target emulator
//   node scripts/backup/accounts-drill.mjs --accounts <decrypted.json> --target drill --drill-project <id>
//
// <decrypted.json> is a vault accounts file (accounts/<stamp>.json.age) after `age -d`, in a Cloud
// Shell session's /tmp, deleted when the run is done (RESTORE.md, "The accounts test").
//
// What it does, in order, and what makes it stop:
//   1. Reads the test reader's uid from ops/live_test_reader/uid (the flag; tests/live/test-reader.mjs
//      made it). No flag → stop. A founder uid → stop.
//   2. Picks THAT ONE record out of the file. Missing, or there twice → stop. Every other account in
//      the file is never sent anywhere.
//   3. Refuses any target that could be the site: the emulator needs a demo- project; the drill
//      needs --drill-project, and the site's own project ID is refused by name.
//   4. Imports the one record, with the file's hash parameters (Identity Toolkit accounts:batchCreate;
//      the payload is checked to hold exactly that uid immediately before it is sent).
//   5. Looks it up and compares uid, email and sign-in providers with the file.
//   6. Drill only: signs in with the test reader's password (DRILL_PASSWORD, set with `read -rs`,
//      never echoed) and checks the uid that comes back. THE EMULATOR CAN'T DO THIS STEP: it stores
//      an imported hash but never verifies one, so the password proof is the drill project's alone.
//   7. Deletes the imported account from the target, whatever happened above.
//
// Prints verdicts and counts only: never the uid, the email, a hash or the password.
// The live site is only READ (one value, step 1). Nothing here writes to it, by construction: the
// only write calls go to the emulator or to the drill project, and both are checked above.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

export const SITE_PROJECT = 'calvary-scribblings';
export const SITE_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
export const FLAG_PATH = 'ops/live_test_reader/uid';
const IDT = 'https://identitytoolkit.googleapis.com';
const IMPORT_FIELDS = ['localId', 'email', 'emailVerified', 'displayName', 'photoUrl', 'passwordHash', 'salt', 'providerUserInfo', 'disabled', 'createdAt', 'lastLoginAt', 'phoneNumber'];

export class DrillRefusal extends Error { constructor(m) { super(`DRILL REFUSED: ${m}`); this.name = 'DrillRefusal'; } }

/** The one record the drill may touch. Pure. */
export function pickTestReader(file, uid) {
  if (!file || file.format !== 'vault-accounts/1' || !Array.isArray(file.users)) throw new DrillRefusal('the file is not a vault accounts file (format vault-accounts/1).');
  if (!uid || typeof uid !== 'string') throw new DrillRefusal('the test reader is not flagged (ops/live_test_reader/uid is empty).');
  if (FOUNDER_UIDS.includes(uid)) throw new DrillRefusal('the flagged uid is a founder. The test reader must never be one.');
  const hits = file.users.filter((u) => u && u.localId === uid);
  if (hits.length === 0) throw new DrillRefusal('the flagged test reader is not in this accounts file.');
  if (hits.length > 1) throw new DrillRefusal('the flagged test reader is in this file more than once.');
  const rec = Object.fromEntries(IMPORT_FIELDS.filter((k) => hits[0][k] !== undefined).map((k) => [k, hits[0][k]]));
  return { record: rec, others: file.users.length - 1 };
}

/** The batchCreate body, refused unless it holds exactly the one record. Pure. */
export function importBody(record, hashConfig, uid) {
  const body = { users: [record] };
  if (record.passwordHash) {
    if (!hashConfig || !hashConfig.algorithm) throw new DrillRefusal('the file carries no hash parameters, so a password hash cannot be imported.');
    Object.assign(body, {
      hashAlgorithm: hashConfig.algorithm, signerKey: hashConfig.signerKey, saltSeparator: hashConfig.saltSeparator,
      rounds: hashConfig.rounds, memoryCost: hashConfig.memoryCost,
    });
  }
  if (body.users.length !== 1 || body.users[0].localId !== uid) throw new DrillRefusal('the import would carry an account other than the test reader.');
  return body;
}

/** Where the drill writes, after every check that it is not the site. Pure. */
export function resolveTarget({ target, drillProject, env }) {
  if (target === 'emulator') {
    const host = env.FIREBASE_AUTH_EMULATOR_HOST;
    const project = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT || '';
    if (!host) throw new DrillRefusal('--target emulator needs FIREBASE_AUTH_EMULATOR_HOST (run it under firebase emulators:exec).');
    if (!project.startsWith('demo-')) throw new DrillRefusal('the emulator run needs a demo- project ID.');
    if (!env.FIREBASE_DATABASE_EMULATOR_HOST) throw new DrillRefusal('the emulator run reads the flag from the database emulator too; set FIREBASE_DATABASE_EMULATOR_HOST.');
    return { kind: 'emulator', project, idt: `http://${host}/identitytoolkit.googleapis.com`, signIn: null,
      db: `http://${env.FIREBASE_DATABASE_EMULATOR_HOST}`, dbQuery: `ns=${project}` };
  }
  if (target === 'drill') {
    if (!drillProject) throw new DrillRefusal('--target drill needs --drill-project <the drill project ID>.');
    if (drillProject === SITE_PROJECT) throw new DrillRefusal('the drill project is the site. The live site is never the test bed.');
    if (!env.DRILL_API_KEY) throw new DrillRefusal('--target drill needs DRILL_API_KEY (the drill project\'s Web API key).');
    if (!env.DRILL_PASSWORD) throw new DrillRefusal('--target drill needs DRILL_PASSWORD (set it with: read -rs DRILL_PASSWORD; export DRILL_PASSWORD).');
    if (env.FIREBASE_AUTH_EMULATOR_HOST) throw new DrillRefusal('FIREBASE_AUTH_EMULATOR_HOST is set: a drill run must not mix with the emulator.');
    return { kind: 'drill', project: drillProject, idt: IDT, signIn: `${IDT}/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.DRILL_API_KEY)}`,
      db: SITE_DB, dbQuery: '' };
  }
  throw new DrillRefusal('--target must be emulator or drill.');
}

const providers = (u) => [...new Set((u.providerUserInfo || []).map((p) => p.providerId))].sort().join(',');

export async function runDrill({ argv = process.argv.slice(2), env = process.env, log = console.log, fetchFn = globalThis.fetch, token } = {}) {
  const opt = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
  const t = resolveTarget({ target: opt('--target'), drillProject: opt('--drill-project'), env });
  const accountsPath = opt('--accounts');
  if (!accountsPath) throw new DrillRefusal('--accounts <decrypted.json> is required.');
  // The user's own token in Cloud Shell (Application Default Credentials); "owner" in the emulator.
  const bearer = token || (t.kind === 'emulator' ? 'owner' : execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim());
  const H = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(t.kind === 'drill' ? { 'x-goog-user-project': t.project } : {}) };

  // 1. the flag (a read of one value)
  const fr = await fetchFn(`${t.db}/${FLAG_PATH}.json${t.dbQuery ? `?${t.dbQuery}` : ''}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!fr.ok) throw new DrillRefusal(`the test reader's flag could not be read (HTTP ${fr.status}).`);
  const uid = await fr.json();

  // 2. the one record
  const file = JSON.parse(readFileSync(accountsPath, 'utf8'));
  const { record, others } = pickTestReader(file, uid);
  if (t.kind === 'drill' && !record.passwordHash) {
    throw new DrillRefusal('the test reader has no password in this file, so the drill cannot prove the hashes. Give it one (VAULT.md §7), wait for the next accounts copy, and run again.');
  }
  log(`accounts file: ${file.users.length} account(s); the test reader found once; ${others} other account(s) left untouched`);
  log(`target: ${t.kind === 'emulator' ? 'the Auth emulator' : 'the drill project'}`);

  const admin = (path, body) => fetchFn(`${t.idt}/v1/projects/${encodeURIComponent(t.project)}/${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const result = { imported: false, recordMatches: false, passwordProved: t.kind === 'emulator' ? 'not provable in the emulator' : false, deleted: false };
  try {
    // 4. import exactly one
    const body = importBody(record, file.hashConfig, uid);
    const ir = await admin('accounts:batchCreate', body);
    const ij = await ir.json().catch(() => ({}));
    if (!ir.ok || (ij.error && ij.error.length)) throw new Error(`the import was refused (HTTP ${ir.status}${ij.error ? `, ${ij.error.length} error(s)` : ''})`);
    result.imported = true;
    // 5. compare
    const lr = await admin('accounts:lookup', { localId: [uid] });
    const got = ((await lr.json()).users || [])[0];
    result.recordMatches = Boolean(got && got.localId === uid && (got.email || null) === (record.email || null) && providers(got) === providers(record));
    log(`record: uid ${got && got.localId === uid ? 'matches' : 'DIFFERS'}, email ${got && (got.email || null) === (record.email || null) ? 'matches' : 'DIFFERS'}, providers ${got && providers(got) === providers(record) ? 'match' : 'DIFFER'}`);
    // 6. the password (drill only)
    if (t.kind === 'drill') {
      const sr = await fetchFn(t.signIn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: record.email, password: env.DRILL_PASSWORD, returnSecureToken: true }) });
      const sj = await sr.json().catch(() => ({}));
      result.passwordProved = sr.ok && sj.localId === uid;
      log(`password: ${result.passwordProved ? 'signed in with the imported hash, and the uid matches' : `sign-in FAILED (HTTP ${sr.status})`}`);
    } else {
      log('password: not provable here (the emulator never verifies an imported hash); the drill project proves it');
    }
  } finally {
    // 7. always remove the imported account from the target
    const dr = await admin('accounts:delete', { localId: uid }).catch(() => null);
    result.deleted = Boolean(dr && dr.ok);
    log(`clean-up: the imported account was ${result.deleted ? 'deleted from' : 'NOT deleted from (delete it by hand in'} the ${t.kind === 'emulator' ? 'emulator' : 'drill project'}${result.deleted ? '' : ')'}`);
    if (env.DRILL_PASSWORD) delete env.DRILL_PASSWORD;
  }
  result.ok = result.imported && result.recordMatches && result.deleted && (t.kind === 'emulator' || result.passwordProved === true);
  log(result.ok ? 'DRILL PASSED' : 'DRILL FAILED');
  return result;
}

const direct = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  runDrill().then((r) => { process.exitCode = r.ok ? 0 : 1; }, (e) => {
    console.error(e instanceof DrillRefusal ? e.message : `✗ ${e.message}`);
    process.exitCode = 1;
  });
}
