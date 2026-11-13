// SAFETY-2B — THE VAULT'S PULLER. docs/VAULT.md §3, §4, §10.
//
// A Cloud Run job in the VAULT's project. It reads the site and writes copies into the vault
// bucket. The site holds no credential for the vault: this job pulls, with its own keyless
// service account, under read-only grants on the site (VAULT.md §4).
//
//   node puller.mjs                    the daily run: files, accounts, workers, rules (+ manual on its weekday)
//   node puller.mjs --dry-run          every read, no write; counts of what it would write
//   node puller.mjs --check-accounts   proves the accounts role returns hashes + hash parameters (counts only)
//   node puller.mjs --force-manual     copy the private copies bucket today, whatever the weekday
//   node puller.mjs --only files,rules a subset of the parts
//
// What goes where (VAULT.md §3). Every name is unique by construction and every write carries
// ifGenerationMatch=0, so the puller can only ever CREATE an object, never replace one:
//   files/<generation>/<path>            each live object of the file bucket, once per generation
//   files-manifest/<date>.json           the day's list: name, generation, size, MD5, metadata
//   manual/<generation>/<path>           the private copies bucket, weekly
//   manual-manifest/<date>.json          its list, the same shape
//   accounts/<stamp>.json.age            every account + the hash parameters, age-encrypted in memory
//   accounts-check/<key id>.txt.age      a fixed sentence encrypted to the same key (VAULT.md §5)
//   workers/<name>/<sha256>.js           each Worker's script content, stored only when it changes
//   rules/<date>/<bucket>/<ruleset>/<file>  the live Storage rules
//
// ZERO DEPENDENCIES, on purpose. The job runs the stock node:22-slim image and fetches this one
// file at a pinned commit (vault/puller/BOOTSTRAP.txt checks its SHA-256 first). No npm install
// means nothing from a registry runs inside the vault. age (age-encryption.org/v1) is implemented
// below with node:crypto, and tests/vault/age.test.mjs decrypts its output with the reference
// implementation's own library.
//
// LOGS ARE COUNTS ONLY (W12): never an object name, a uid, an email, a Worker's name or a value.
// An error is logged as the part, the operation and the HTTP status, nothing from the response.
//
// Exit status: 0 when every part succeeded, 1 when any part failed (the others still run),
// 2 when the configuration is incomplete. Cloud Monitoring alerts on a failed execution.

import { createHash, createHmac, createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 'vault-puller/1';
const GCS = 'https://storage.googleapis.com';
const IDT = 'https://identitytoolkit.googleapis.com';
const RULES = 'https://firebaserules.googleapis.com';
const CF = 'https://api.cloudflare.com/client/v4';
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
export const CANARY_TEXT = "The vault's accounts key opens this file.\n";
const PARALLEL = 8;

// ── errors that are safe to log ─────────────────────────────────────────────────────────────
// The message is built from an operation label and a status. Nothing from a URL (object names)
// or a response body ever reaches it.
export class PullError extends Error {
  constructor(op, status) { super(`${op}${status ? ` (HTTP ${status})` : ''}`); this.name = 'PullError'; this.op = op; this.status = status || null; }
}

// ── arguments and configuration ─────────────────────────────────────────────────────────────
export const ALL_PARTS = ['files', 'manual', 'accounts', 'workers', 'rules'];

export function parseArgs(argv = []) {
  const a = { dryRun: false, checkAccounts: false, forceManual: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry-run') a.dryRun = true;
    else if (x === '--check-accounts') a.checkAccounts = true;
    else if (x === '--force-manual') a.forceManual = true;
    else if (x === '--only') a.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--') continue;
    else throw new PullError(`unknown argument ${JSON.stringify(x).slice(0, 40)}`);
  }
  if (a.only) for (const p of a.only) if (!ALL_PARTS.includes(p)) throw new PullError('unknown part in --only');
  return a;
}

const NEEDS = {
  files: ['VAULT_BUCKET', 'SITE_FILES_BUCKET'],
  manual: ['VAULT_BUCKET', 'SITE_PRIVATE_BUCKET'],
  accounts: ['VAULT_BUCKET', 'SITE_PROJECT_ID', 'AGE_RECIPIENT'],
  workers: ['VAULT_BUCKET', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'],
  rules: ['VAULT_BUCKET', 'SITE_PROJECT_ID'],
  check: ['SITE_PROJECT_ID'],
};

/** The parts this run does, given the arguments and the day (UTC weekday for the manual copy). */
export function partsFor(args, env, now) {
  if (args.checkAccounts) return ['check'];
  if (args.only) return args.only;
  const weekday = Number.isInteger(Number(env.MANUAL_WEEKDAY)) && env.MANUAL_WEEKDAY !== '' && env.MANUAL_WEEKDAY != null ? Number(env.MANUAL_WEEKDAY) : 0;
  return ALL_PARTS.filter((p) => p !== 'manual' || args.forceManual || now.getUTCDay() === weekday);
}

/** Missing variable NAMES (never values) for the chosen parts. */
export function missingConfig(parts, env) {
  const miss = new Set();
  for (const p of parts) for (const k of NEEDS[p] || []) if (!String(env[k] ?? '').trim()) miss.add(k);
  if (parts.includes('accounts') && env.AGE_RECIPIENT && !/^age1[02-9ac-hj-np-z]{58}$/.test(String(env.AGE_RECIPIENT).trim())) miss.add('AGE_RECIPIENT (not an age1… public key)');
  return [...miss];
}

// ── age (age-encryption.org/v1), X25519 recipient, encrypt only ─────────────────────────────
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
/** Decode an age1… recipient to its 32 raw bytes (bech32, not bech32m, as age uses). */
export function decodeRecipient(s) {
  const str = String(s || '').trim();
  if (str !== str.toLowerCase()) throw new PullError('the age recipient is not lowercase');
  const sep = str.lastIndexOf('1');
  const hrp = str.slice(0, sep);
  if (hrp !== 'age') throw new PullError('the age recipient is not an age1… key');
  const data = [...str.slice(sep + 1)].map((c) => BECH32.indexOf(c));
  if (data.some((d) => d < 0) || data.length < 7) throw new PullError('the age recipient has invalid characters');
  const hrpx = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (bech32Polymod(hrpx.concat(data)) !== 1) throw new PullError('the age recipient fails its checksum');
  let acc = 0, bits = 0; const out = [];
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v; bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) throw new PullError('the age recipient has non-zero padding');
  if (out.length !== 32) throw new PullError('the age recipient is not 32 bytes');
  return Buffer.from(out);
}

const b64raw = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '');
const hkdf = (ikm, salt, info) => Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info), 32));
function chachaSeal(key, nonce, plaintext) {
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}
function x25519Public(raw) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' });
}

/** Encrypt bytes to one age X25519 recipient. Returns the binary age file. */
export function ageEncrypt(plaintext, recipient, rand = randomBytes) {
  const pk = decodeRecipient(recipient);
  const fileKey = rand(16);
  const eph = generateKeyPairSync('x25519');
  const share = Buffer.from(eph.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: x25519Public(pk) });
  if (shared.every((b) => b === 0)) throw new PullError('the age recipient is a low-order point');
  const wrapKey = hkdf(shared, Buffer.concat([share, pk]), 'age-encryption.org/v1/X25519');
  const body = b64raw(chachaSeal(wrapKey, Buffer.alloc(12), fileKey));
  // A stanza body is wrapped at 64 columns and always ends with a line shorter than 64.
  const lines = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  if (body.length % 64 === 0) lines.push('');
  const header = `age-encryption.org/v1\n-> X25519 ${b64raw(share)}\n${lines.join('\n')}\n---`;
  const mac = createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header')).update(header).digest();
  const nonce = rand(16);
  const payloadKey = hkdf(fileKey, nonce, 'payload');
  const data = Buffer.from(plaintext);
  const CHUNK = 64 * 1024;
  const chunks = [];
  const count = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let i = 0; i < count; i++) {
    const n = Buffer.alloc(12);
    n.writeUIntBE(i, 5, 6); // an 11-byte big-endian counter; JS-safe to 2^48 chunks, far beyond any file here
    if (i === count - 1) n[11] = 1;
    chunks.push(chachaSeal(payloadKey, n, data.subarray(i * CHUNK, (i + 1) * CHUNK)));
  }
  return Buffer.concat([Buffer.from(`${header} ${b64raw(mac)}\n`), nonce, ...chunks]);
}

// ── HTTP, with the job's own identity ───────────────────────────────────────────────────────
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/** A token source for the job's service account, from the Cloud Run metadata server. */
export function metadataToken(fetchFn, now = () => Date.now()) {
  let cached = null;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    const r = await fetchFn(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) throw new PullError('reading the job\'s token from the metadata server', r.status);
    const j = await r.json();
    cached = { token: j.access_token, until: now() + Math.max(0, (Number(j.expires_in) || 0) - 60) * 1000 };
    return cached.token;
  };
}

/** fetch with the Google token (or a given header), and retries on 429/5xx and network errors. */
export function makeHttp({ fetchFn, googleToken, sleep = sleepReal, attempts = 4 }) {
  async function call(op, url, init = {}, { google = true, ok = [200], allow = [] } = {}) {
    let last = null;
    for (let i = 0; i < attempts; i++) {
      const headers = { ...(init.headers || {}) };
      if (google) headers.Authorization = `Bearer ${await googleToken()}`;
      let r;
      try { r = await fetchFn(url, { ...init, headers }); }
      catch { last = new PullError(`${op}: network error`); await sleep(250 * 2 ** i); continue; }
      if (ok.includes(r.status) || allow.includes(r.status)) return r;
      if (r.status === 429 || r.status >= 500) { last = new PullError(op, r.status); await sleep(250 * 2 ** i); continue; }
      throw new PullError(op, r.status);
    }
    throw last;
  }
  return call;
}

// ── Cloud Storage ───────────────────────────────────────────────────────────────────────────
const enc = encodeURIComponent;
export function makeGcs(call) {
  async function list(bucket, { prefix = '', fields }) {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ fields: `items(${fields}),nextPageToken`, maxResults: '1000' });
      if (prefix) q.set('prefix', prefix);
      if (pageToken) q.set('pageToken', pageToken);
      const r = await call('listing a bucket', `${GCS}/storage/v1/b/${enc(bucket)}/o?${q}`);
      const j = await r.json();
      out.push(...(j.items || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }
  /** Copy one generation into the vault, create-only. → 'copied' | 'exists' | 'vanished' */
  async function copy(src, srcName, generation, dst, dstName) {
    let rewriteToken = '';
    for (;;) {
      const q = new URLSearchParams({ sourceGeneration: String(generation), ifGenerationMatch: '0' });
      if (rewriteToken) q.set('rewriteToken', rewriteToken);
      const r = await call('copying an object into the vault',
        `${GCS}/storage/v1/b/${enc(src)}/o/${enc(srcName)}/rewriteTo/b/${enc(dst)}/o/${enc(dstName)}?${q}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, { allow: [404, 412] });
      if (r.status === 412) return 'exists';
      if (r.status === 404) return 'vanished'; // replaced or deleted on the site since the listing
      const j = await r.json();
      if (j.done) return 'copied';
      rewriteToken = j.rewriteToken;
      if (!rewriteToken) throw new PullError('copying an object into the vault: no rewrite token');
    }
  }
  /** Create an object, never replace one. → 'created' | 'exists' */
  async function create(bucket, name, body, contentType) {
    const q = new URLSearchParams({ uploadType: 'media', name, ifGenerationMatch: '0' });
    const r = await call('writing an object to the vault', `${GCS}/upload/storage/v1/b/${enc(bucket)}/o?${q}`,
      { method: 'POST', headers: { 'Content-Type': contentType }, body }, { allow: [412] });
    return r.status === 412 ? 'exists' : 'created';
  }
  async function exists(bucket, name) {
    const r = await call('checking the vault', `${GCS}/storage/v1/b/${enc(bucket)}/o/${enc(name)}?fields=name`, {}, { allow: [404] });
    return r.status === 200;
  }
  return { list, copy, create, exists };
}

async function pool(items, fn, n = PARALLEL) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

const day = (now) => now.toISOString().slice(0, 10);
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const OBJECT_FIELDS = 'name,generation,size,md5Hash,crc32c,contentType,contentEncoding,contentDisposition,contentLanguage,cacheControl,metadata,updated';

/** A manifest name for the date; a second run the same day gets a time suffix instead of colliding. */
async function writeManifest(ctx, prefix, now, manifest) {
  const body = JSON.stringify(manifest);
  if (ctx.dryRun) return { manifest: 'dry' };
  const first = await ctx.gcs.create(ctx.env.VAULT_BUCKET, `${prefix}/${day(now)}.json`, body, 'application/json');
  if (first === 'created') return { manifest: 'written' };
  await ctx.gcs.create(ctx.env.VAULT_BUCKET, `${prefix}/${day(now)}.${stamp(now).slice(9)}.json`, body, 'application/json');
  return { manifest: 'written (second run today)' };
}

/** Files by (name, generation): copy every live generation the vault doesn't hold, then the manifest. */
export async function pullBucket(ctx, { source, prefix, manifestPrefix }) {
  const { gcs, env, now } = ctx;
  const live = (await gcs.list(source, { fields: OBJECT_FIELDS })).filter((o) => !o.name.endsWith('/') || Number(o.size) > 0);
  const held = new Set((await gcs.list(env.VAULT_BUCKET, { prefix: `${prefix}/`, fields: 'name' })).map((o) => o.name.slice(prefix.length + 1)));
  const todo = live.filter((o) => !held.has(`${o.generation}/${o.name}`));
  const c = { listed: live.length, alreadyHeld: live.length - todo.length, copied: 0, raced: 0, vanished: 0, failed: 0, bytesCopied: 0 };
  const gone = new Set();
  if (ctx.dryRun) {
    c.wouldCopy = todo.length;
    c.wouldCopyBytes = todo.reduce((s, o) => s + Number(o.size || 0), 0);
  } else {
    await pool(todo, async (o) => {
      try {
        const r = await gcs.copy(source, o.name, o.generation, env.VAULT_BUCKET, `${prefix}/${o.generation}/${o.name}`);
        if (r === 'copied') { c.copied++; c.bytesCopied += Number(o.size || 0); }
        else if (r === 'exists') c.raced++;
        else { c.vanished++; gone.add(o); }
      } catch { c.failed++; gone.add(o); }
    });
  }
  const objects = live.filter((o) => !gone.has(o)).map((o) => ({
    name: o.name, generation: String(o.generation), size: Number(o.size || 0), md5Hash: o.md5Hash || null, crc32c: o.crc32c || null,
    contentType: o.contentType || null, contentEncoding: o.contentEncoding || null, contentDisposition: o.contentDisposition || null,
    contentLanguage: o.contentLanguage || null, cacheControl: o.cacheControl || null, metadata: o.metadata || null, updated: o.updated || null,
  }));
  const manifest = { format: 'vault-files-manifest/1', source, vaultPrefix: `${prefix}/`, takenAt: now.toISOString(),
    count: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0), objects };
  Object.assign(c, await writeManifest(ctx, manifestPrefix, now, manifest), { manifestObjects: objects.length });
  if (c.failed) throw Object.assign(new PullError(`${c.failed} object(s) could not be copied`), { counts: c });
  return c;
}

// ── accounts ────────────────────────────────────────────────────────────────────────────────
const HASH_FIELDS = ['algorithm', 'signerKey', 'saltSeparator', 'rounds', 'memoryCost'];
async function readHashConfig(ctx) {
  const r = await ctx.call('reading the project\'s auth config', `${IDT}/admin/v2/projects/${enc(ctx.env.SITE_PROJECT_ID)}/config`);
  const j = await r.json();
  return (j && j.signIn && j.signIn.hashConfig) || null;
}
async function readUsers(ctx) {
  const users = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ maxResults: '1000' });
    if (pageToken) q.set('nextPageToken', pageToken);
    const r = await ctx.call('listing accounts', `${IDT}/v1/projects/${enc(ctx.env.SITE_PROJECT_ID)}/accounts:batchGet?${q}`);
    const j = await r.json();
    users.push(...(j.users || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return users;
}
const isPasswordUser = (u) => (u.providerUserInfo || []).some((p) => p.providerId === 'password') || Boolean(u.passwordHash);

/** Counts only, for the log and the role check. */
export function accountCounts(users, hashConfig) {
  const pw = users.filter(isPasswordUser);
  return {
    accounts: users.length,
    passwordAccounts: pw.length,
    withPasswordHash: pw.filter((u) => u.passwordHash).length,
    withSalt: pw.filter((u) => u.salt).length,
    hashParameterFields: HASH_FIELDS.filter((k) => hashConfig && hashConfig[k] != null && hashConfig[k] !== '').length,
    hashParameterFieldsExpected: HASH_FIELDS.length,
  };
}
/** Why the counts don't prove the role, or null when they do. */
export function accountsProblem(c) {
  if (c.hashParameterFields < 2) return 'the hash parameters were not returned (the role lacks firebaseauth.configs.getHashConfig?)';
  if (c.passwordAccounts === 0) return 'no password account was found, so the hashes cannot be proved';
  if (c.withPasswordHash < c.passwordAccounts || c.withSalt < c.passwordAccounts) return 'password hashes or salts were not returned for every password account';
  return null;
}

export async function checkAccounts(ctx) {
  const hashConfig = await readHashConfig(ctx);
  const c = accountCounts(await readUsers(ctx), hashConfig);
  const problem = accountsProblem(c);
  if (problem) throw Object.assign(new PullError(problem), { counts: c });
  return { ...c, proved: true };
}

export async function pullAccounts(ctx) {
  const { env, now } = ctx;
  const hashConfig = await readHashConfig(ctx);
  const users = await readUsers(ctx);
  const c = accountCounts(users, hashConfig);
  const problem = accountsProblem(c);
  if (problem) throw Object.assign(new PullError(problem), { counts: c });
  // The plaintext exists only here, in memory, for the length of one encryption.
  let plain = Buffer.from(JSON.stringify({ format: 'vault-accounts/1', project: env.SITE_PROJECT_ID, exportedAt: now.toISOString(), hashConfig, users }));
  const sealed = ageEncrypt(plain, env.AGE_RECIPIENT);
  plain.fill(0); plain = null;
  c.encryptedBytes = sealed.length;
  const keyId = createHash('sha256').update(String(env.AGE_RECIPIENT).trim()).digest('hex').slice(0, 16);
  if (ctx.dryRun) {
    c.file = 'dry';
    c.check = (await ctx.gcs.exists(env.VAULT_BUCKET, `accounts-check/${keyId}.txt.age`)) ? 'present' : 'would write';
    return c;
  }
  c.file = await ctx.gcs.create(env.VAULT_BUCKET, `accounts/${stamp(now)}.json.age`, sealed, 'application/octet-stream');
  if (c.file !== 'created') throw Object.assign(new PullError('an accounts file with this stamp already exists'), { counts: c });
  c.check = await ctx.gcs.create(env.VAULT_BUCKET, `accounts-check/${keyId}.txt.age`, ageEncrypt(Buffer.from(CANARY_TEXT), env.AGE_RECIPIENT), 'application/octet-stream');
  return c;
}

// ── Workers: script content only ────────────────────────────────────────────────────────────
// Two Cloudflare endpoints and no others: the script list (only `id` is read from it) and each
// script's content. Never /settings, /bindings, /secrets, /schedules or any other: a binding's
// value must never reach the vault (CLAUDE.md, credential rule 5). tests/vault/puller.test.mjs
// fails if any other URL is requested.
export const CF_ALLOWED = [/^\/accounts\/[^/]+\/workers\/scripts$/, /^\/accounts\/[^/]+\/workers\/scripts\/[^/]+\/content\/v2$/];
export async function pullWorkers(ctx) {
  const { env } = ctx;
  const cf = { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } };
  const base = `${CF}/accounts/${enc(env.CF_ACCOUNT_ID)}/workers/scripts`;
  const r = await ctx.call('listing Workers', base, cf, { google: false });
  const j = await r.json();
  if (!j || j.success === false || !Array.isArray(j.result)) throw new PullError('listing Workers: unexpected answer');
  const ids = j.result.map((s) => s && s.id).filter((id) => typeof id === 'string' && id);
  const c = { workers: ids.length, stored: 0, unchanged: 0, failed: 0 };
  for (const id of ids) {
    try {
      const res = await ctx.call('reading a Worker\'s content', `${base}/${enc(id)}/content/v2`, cf, { google: false });
      const bytes = Buffer.from(await res.arrayBuffer());
      const sha = createHash('sha256').update(bytes).digest('hex');
      const name = `workers/${id}/${sha}.js`;
      if (ctx.dryRun) { (await ctx.gcs.exists(env.VAULT_BUCKET, name)) ? c.unchanged++ : (c.wouldStore = (c.wouldStore || 0) + 1); continue; }
      const w = await ctx.gcs.create(env.VAULT_BUCKET, name, bytes, 'application/javascript');
      w === 'created' ? c.stored++ : c.unchanged++;
    } catch { c.failed++; }
  }
  if (c.failed) throw Object.assign(new PullError(`${c.failed} Worker(s) could not be copied`), { counts: c });
  return c;
}

// ── the live Storage rules ──────────────────────────────────────────────────────────────────
export async function pullRules(ctx) {
  const { env, now } = ctx;
  const releases = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await ctx.call('listing rules releases', `${RULES}/v1/projects/${enc(env.SITE_PROJECT_ID)}/releases?${q}`);
    const j = await r.json();
    releases.push(...(j.releases || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  const storage = releases.filter((x) => /\/releases\/firebase\.storage\/[^/]+$/.test(x.name || '') && x.rulesetName);
  const c = { storageReleases: storage.length, files: 0, written: 0, alreadyToday: 0 };
  if (!storage.length) throw Object.assign(new PullError('no live Storage rules release was found'), { counts: c });
  for (const rel of storage) {
    const bucket = rel.name.split('/releases/firebase.storage/')[1];
    const rulesetId = rel.rulesetName.split('/').pop();
    const r = await ctx.call('reading a ruleset', `${RULES}/v1/${rel.rulesetName.split('/').map(enc).join('/')}`);
    const files = ((await r.json()).source || {}).files || [];
    for (const f of files) {
      c.files++;
      const name = `rules/${day(now)}/${bucket}/${rulesetId}/${String(f.name || 'storage.rules').replace(/^\/+/, '')}`;
      if (ctx.dryRun) continue;
      (await ctx.gcs.create(env.VAULT_BUCKET, name, String(f.content ?? ''), 'text/plain; charset=utf-8')) === 'created' ? c.written++ : c.alreadyToday++;
    }
  }
  return c;
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────
const RUNNERS = {
  files: (ctx) => pullBucket(ctx, { source: ctx.env.SITE_FILES_BUCKET, prefix: 'files', manifestPrefix: 'files-manifest' }),
  manual: (ctx) => pullBucket(ctx, { source: ctx.env.SITE_PRIVATE_BUCKET, prefix: 'manual', manifestPrefix: 'manual-manifest' }),
  accounts: pullAccounts,
  workers: pullWorkers,
  rules: pullRules,
  check: checkAccounts,
};

/**
 * Run the puller. Returns the exit status. Everything external comes in through `deps`, so the
 * tests run it against fakes: fetchFn, now, log, sleep, googleToken.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || ((o) => console.log(JSON.stringify(o)));
  const now = deps.now ? deps.now() : new Date();
  let args;
  try { args = parseArgs(argv); }
  catch (e) { log({ severity: 'ERROR', version: VERSION, error: e instanceof PullError ? e.message : 'bad arguments' }); return 2; }
  const parts = partsFor(args, env, now);
  const missing = missingConfig(parts, env);
  if (missing.length) { log({ severity: 'ERROR', version: VERSION, error: 'configuration incomplete', missing }); return 2; }
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const call = makeHttp({ fetchFn, googleToken: deps.googleToken || metadataToken(fetchFn), sleep: deps.sleep });
  const ctx = { env, now, dryRun: args.dryRun, call, gcs: makeGcs(call) };
  log({ severity: 'INFO', version: VERSION, start: true, dryRun: args.dryRun, parts });
  const result = {};
  for (const p of parts) {
    const t0 = Date.now();
    try {
      const counts = await RUNNERS[p](ctx);
      result[p] = 'ok';
      log({ severity: 'INFO', part: p, ok: true, dryRun: args.dryRun, ms: Date.now() - t0, ...counts });
    } catch (e) {
      result[p] = 'failed';
      log({ severity: 'ERROR', part: p, ok: false, dryRun: args.dryRun, ms: Date.now() - t0,
        error: e instanceof PullError ? e.message : 'unexpected error', ...(e && e.counts ? e.counts : {}) });
    }
  }
  const failed = Object.values(result).filter((v) => v !== 'ok').length;
  log({ severity: failed ? 'ERROR' : 'INFO', version: VERSION, summary: true, dryRun: args.dryRun, ok: parts.length - failed, failed, parts: result });
  return failed ? 1 : 0;
}

// Run directly (node puller.mjs …), or through the bootstrap, which imports this file and calls main().
// (Under the bootstrap, process.argv[1] is the first puller argument, never this file's path.)
const direct = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().then((code) => { process.exitCode = code; });
