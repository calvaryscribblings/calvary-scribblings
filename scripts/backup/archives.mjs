// Which objects in the database-backup bucket are which. One predicate, shared by everything
// that reads that bucket, so they cannot disagree.
//
// The bucket holds three kinds of `…_data.json.gz`:
//   · Firebase's own scheduled archives (the backup).
//   · `guard/…` — the SAFETY-1 guard's backups of scripted writes (JSON, but never an archive).
//   · `from-vault/…` — SAFETY-2B: an archive Ikenna copied BACK from the vault for a restore
//     (docs/VAULT.md §7). It is a fresh object with a fresh timeCreated, so if the liveness check
//     counted it, a stopped backup schedule would look healthy the day after a restore was staged.
//
// isScheduledArchive: the backup itself (liveness, the drill, the reports read only these).
// isRestorableArchive: what restore-archive.mjs will put back (the backup, or a vault copy).
import { gunzipSync } from 'node:zlib';

export const FROM_VAULT = 'from-vault/';
const DATA = '_data.json.gz';
const cleanPath = (p) => p.length > 0 && !p.split('/').some((s) => s === '' || s === '.' || s === '..');

export function isScheduledArchive(name) {
  return typeof name === 'string' && name.endsWith(DATA) && !name.startsWith(FROM_VAULT) && !name.startsWith('guard/') && cleanPath(name);
}
export function isVaultArchive(name) {
  return typeof name === 'string' && name.startsWith(FROM_VAULT) && name.endsWith(DATA) && cleanPath(name.slice(FROM_VAULT.length));
}
export function isRestorableArchive(name) {
  return isScheduledArchive(name) || isVaultArchive(name);
}

/**
 * The archive's tree, from the bytes a download returned. Gzip is detected by its magic bytes,
 * not assumed: an object stored with Content-Encoding: gzip is served already inflated (Cloud
 * Storage's decompressive transcoding, and fetch() inflates too), and a copy made back from the
 * vault may carry that metadata where the original did not.
 */
export function parseArchive(bytes) {
  const buf = Buffer.from(bytes);
  const raw = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return JSON.parse(raw.toString('utf8'));
}
