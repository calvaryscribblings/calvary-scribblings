// SAFETY-2B — a real accounts restore goes through `firebase auth:import`, which refuses any key or
// provider outside its list and prints the whole record, hash included, when it does. So the vault's
// Identity Toolkit records are reshaped first (scripts/backup/accounts-select.mjs). This checks the
// reshaped records and the hash flags against firebase-tools' OWN validators, so a CLI upgrade that
// changes the list fails here, not in Cloud Shell on the day of a restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { toCliUser, hashFlags, select } from '../../scripts/backup/accounts-select.mjs';

const require = createRequire(import.meta.url);
const { validateUserJson, validateOptions } = require('firebase-tools/lib/accountImporter.js');

// The shape accounts:batchGet returns (what the puller stores), with the keys the CLI rejects.
const RAW = {
  localId: 'uidAAAAAAAAAAAAAAAAAAAAAAAA1', email: 'reader@example.invalid', emailVerified: true, displayName: 'A Reader',
  passwordHash: 'aGFzaC1ieXRlcw==', salt: 'c2FsdA==', passwordUpdatedAt: 1700000000000, validSince: '1700000000',
  lastLoginAt: '1700000001000', createdAt: '1700000000000', lastRefreshAt: '2026-11-01T00:00:00Z', customAuth: false,
  providerUserInfo: [
    { providerId: 'password', federatedId: 'reader@example.invalid', email: 'reader@example.invalid', rawId: 'reader@example.invalid' },
    { providerId: 'google.com', federatedId: '1234', rawId: '1234', email: 'reader@example.invalid', displayName: 'A Reader', photoUrl: 'https://example.invalid/p.png' },
  ],
};
const HASH = { algorithm: 'SCRYPT', signerKey: 'c2lnbmVyLWtleQ==', saltSeparator: 'Bw==', rounds: 8, memoryCost: 14 };

test('a raw vault record fails the CLI as it is, and passes once reshaped', () => {
  assert.ok(validateUserJson(RAW).error, 'the CLI rejects the raw record (this is why the converter exists)');
  const u = toCliUser(RAW);
  assert.deepEqual(validateUserJson(u), {});
  assert.equal(u.lastSignedInAt, RAW.lastLoginAt);
  assert.equal(u.passwordHash, RAW.passwordHash);
  assert.deepEqual(u.providerUserInfo.map((p) => p.providerId), ['google.com'], 'the password provider is carried by the hash, not a provider row');
});

test('the hash flags are what the CLI accepts for SCRYPT', () => {
  const flags = hashFlags(HASH);
  const o = Object.fromEntries(flags.map((f) => f.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
  const opts = validateOptions({ hashAlgo: o['hash-algo'], hashKey: o['hash-key'], saltSeparator: o['salt-separator'], rounds: o.rounds, memCost: o['mem-cost'] });
  assert.equal(opts.valid, true);
  assert.equal(opts.hashAlgo, 'SCRYPT');
  assert.throws(() => hashFlags(null));
  assert.throws(() => hashFlags({ ...HASH, signerKey: '' }));
  assert.throws(() => hashFlags({ ...HASH, algorithm: 'BCRYPT' }));
});

test('only the named accounts, each exactly once, or nothing', () => {
  const file = { format: 'vault-accounts/1', hashConfig: HASH, users: [RAW, { ...RAW, localId: 'uidBBBBBBBBBBBBBBBBBBBBBBBB2' }] };
  assert.equal(select(file, [RAW.localId, '']).users.length, 1);
  assert.throws(() => select(file, ['uidZZZZZZZZZZZZZZZZZZZZZZZZ9']), /not in the accounts file/);
  assert.throws(() => select({ ...file, users: [RAW, RAW] }, [RAW.localId]), /more than once/);
  assert.throws(() => select(file, []), /no uids/);
  assert.throws(() => select({ users: [] }, [RAW.localId]), /not a vault accounts file/);
});
