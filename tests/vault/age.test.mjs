// SAFETY-2B — the puller's age encryption (vault/puller/puller.mjs, ageEncrypt) against the
// reference implementation's own library (age-encryption, typage, by age's author). The puller
// implements age-encryption.org/v1 with node:crypto so the vault job installs nothing; this is
// what proves the files it writes open with the real tool. The round also decrypted its output
// with the age CLI (1.1.1) at 0 B, 5 B, 64 KiB, 64 KiB + 1 and 200 KB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as age from 'age-encryption';
import { ageEncrypt, decodeRecipient } from '../../vault/puller/puller.mjs';

const id = await age.generateX25519Identity();
const rcpt = await age.identityToRecipient(id);
const open = async (b) => { const d = new age.Decrypter(); d.addIdentity(id); return Buffer.from(await d.decrypt(new Uint8Array(b))); };

test('the reference library opens what the puller writes, at every chunk boundary', async () => {
  for (const n of [0, 1, 65535, 65536, 65537, 131072, 200001]) {
    const p = randomBytes(n);
    assert.deepEqual(await open(ageEncrypt(p, rcpt)), p, `${n} bytes`);
  }
});

test('each file is fresh: the same plaintext never encrypts to the same bytes', () => {
  const p = Buffer.from('same');
  assert.notDeepEqual(ageEncrypt(p, rcpt), ageEncrypt(p, rcpt));
});

test('a file for one key does not open with another', async () => {
  const other = await age.generateX25519Identity();
  const d = new age.Decrypter(); d.addIdentity(other);
  await assert.rejects(d.decrypt(new Uint8Array(ageEncrypt(Buffer.from('x'), rcpt))));
});

test('the header is age v1 with one X25519 stanza', () => {
  const head = ageEncrypt(Buffer.from('x'), rcpt).toString('latin1').split('\n');
  assert.equal(head[0], 'age-encryption.org/v1');
  assert.match(head[1], /^-> X25519 [A-Za-z0-9+/]{43}$/);
  assert.match(head[2], /^[A-Za-z0-9+/]{43}$/);
  assert.match(head[3], /^--- [A-Za-z0-9+/]{43}$/);
});

test('a malformed recipient is refused', () => {
  assert.equal(decodeRecipient(rcpt).length, 32);
  const flipped = rcpt.slice(0, -1) + (rcpt.endsWith('q') ? 'p' : 'q');
  assert.throws(() => decodeRecipient(flipped), /checksum/);
  assert.throws(() => decodeRecipient(rcpt.toUpperCase()), /lowercase/);
  assert.throws(() => decodeRecipient('age1'), /invalid|checksum/);
  assert.throws(() => decodeRecipient(rcpt.replace(/^age/, 'agf')), /not an age1/);
});
