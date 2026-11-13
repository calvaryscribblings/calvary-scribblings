// SAFETY-2B — choose accounts out of a decrypted vault accounts file, for `firebase auth:import`.
// A REAL restore (RESTORE.md, "The accounts"). The test uses accounts-drill.mjs instead.
//
//   node scripts/backup/accounts-select.mjs --accounts /tmp/accounts.json --uids /tmp/uids.txt --out /tmp/import.json
//
// --uids is a file with one uid per line: the accounts that need putting back, never "everyone"
// (importing over a live uid REPLACES that account; VAULT.md §7). Every uid must be in the file,
// once, or nothing is written.
//
// Why a converter: the vault holds the Identity Toolkit's own records (accounts:batchGet), and
// `firebase auth:import` refuses any key outside its list, and any provider it doesn't link
// (the password provider among them). Its refusal prints the WHOLE record, hash included, to the
// terminal. So the records are reshaped here to exactly the CLI's keys before the CLI sees them.
// Keys and providers checked against firebase-tools 15.24 (lib/accountImporter.js).
//
// It also writes <out>.flags: the CLI's hash flags from the file's hash parameters, for
//   npx firebase-tools@15.24.0 auth:import /tmp/import.json $(cat /tmp/import.json.flags) --project <site>
// so the signer key is never typed or shown. Both files hold secrets: in Cloud Shell's /tmp only,
// deleted when done. This prints counts only.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_KEYS = ['localId', 'email', 'emailVerified', 'passwordHash', 'salt', 'displayName', 'photoUrl', 'createdAt', 'lastSignedInAt', 'providerUserInfo', 'phoneNumber', 'disabled', 'customAttributes'];
export const CLI_PROVIDERS = ['google.com', 'facebook.com', 'twitter.com', 'github.com', 'apple.com', 'microsoft.com', 'gc.apple.com', 'playgames.google.com', 'linkedin.com', 'yahoo.com'];
const PROVIDER_KEYS = ['providerId', 'rawId', 'email', 'displayName', 'photoUrl'];

/** One Identity Toolkit record → the CLI's import shape. Pure. */
export function toCliUser(u) {
  const out = {};
  for (const k of CLI_KEYS) {
    if (k === 'lastSignedInAt') { if (u.lastLoginAt != null) out.lastSignedInAt = u.lastLoginAt; continue; }
    if (k === 'providerUserInfo') continue;
    if (u[k] !== undefined && u[k] !== null) out[k] = u[k];
  }
  const providers = (u.providerUserInfo || [])
    .filter((p) => CLI_PROVIDERS.includes(p.providerId))
    .map((p) => Object.fromEntries(PROVIDER_KEYS.filter((k) => p[k] != null).map((k) => [k, p[k]])))
    .map((p) => (p.rawId ? p : { ...p, rawId: p.email || '' }))
    .filter((p) => p.rawId);
  if (providers.length) out.providerUserInfo = providers;
  return out;
}

export function hashFlags(h) {
  if (!h || !h.algorithm) throw new Error('the file carries no hash parameters');
  if (h.algorithm !== 'SCRYPT') throw new Error(`hash algorithm ${h.algorithm} is not the Firebase SCRYPT this script maps`);
  for (const k of ['signerKey', 'saltSeparator', 'rounds', 'memoryCost']) if (h[k] == null || h[k] === '') throw new Error(`the hash parameters lack ${k}`);
  return ['--hash-algo=SCRYPT', `--hash-key=${h.signerKey}`, `--salt-separator=${h.saltSeparator}`, `--rounds=${h.rounds}`, `--mem-cost=${h.memoryCost}`];
}

export function select(file, uids) {
  if (!file || file.format !== 'vault-accounts/1' || !Array.isArray(file.users)) throw new Error('not a vault accounts file (format vault-accounts/1)');
  const want = [...new Set(uids.map((s) => s.trim()).filter(Boolean))];
  if (!want.length) throw new Error('no uids given');
  const users = [];
  for (const uid of want) {
    const hits = file.users.filter((u) => u.localId === uid);
    if (hits.length !== 1) throw new Error(`${hits.length === 0 ? 'a uid is not' : 'a uid is more than once'} in the accounts file; nothing written`);
    users.push(toCliUser(hits[0]));
  }
  return { users, flags: hashFlags(file.hashConfig) };
}

const direct = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const a = process.argv.slice(2);
    const opt = (n) => { const i = a.indexOf(n); return i > -1 ? a[i + 1] : null; };
    if (!opt('--accounts') || !opt('--uids') || !opt('--out')) throw new Error('usage: --accounts <decrypted.json> --uids <file> --out <import.json>');
    const { users, flags } = select(JSON.parse(readFileSync(opt('--accounts'), 'utf8')), readFileSync(opt('--uids'), 'utf8').split('\n'));
    writeFileSync(opt('--out'), JSON.stringify({ users }), { mode: 0o600 });
    writeFileSync(`${opt('--out')}.flags`, flags.join(' '), { mode: 0o600 });
    console.log(`${users.length} account(s) chosen, ${users.filter((u) => u.passwordHash).length} with a password; hash flags written beside the file`);
  } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
