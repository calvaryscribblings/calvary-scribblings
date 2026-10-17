// W49 — INSTALMENT READS AND THE READ CREDIT, AGAINST THE REAL RULES (emulator). Rulings 176–179.
//
//   series_reads/{inst}                 public read; nobody writes it but the endpoint (Admin SDK)
//   series_read_ledger/{inst}/{uid}     nobody reads or writes it from a client, founders included
//   users/{uid}/readInstalments/{inst}  the reader's own credit marker: true, theirs alone
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A } from './helpers.mjs';

const INST = 'probe-series-i1';
let env, owner, stranger, founder, anon;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, {
    [`series_reads/${INST}`]: 7,
    [`series_read_ledger/${INST}/${OWNER}`]: 1_760_000_000_000,
    [`users/${OWNER}/displayName`]: 'Owner',
  });
});

describe('W49 · series_reads: public read, no client write', () => {
  test('anyone reads a count, signed in or not', async () => {
    assert.equal((await assertSucceeds(anon.ref(`series_reads/${INST}`).get())).val(), 7);
    await assertSucceeds(owner.ref('series_reads').get());
  });
  for (const [who, db] of [['signed out', () => anon], ['a reader', () => owner], ['a founder', () => founder]]) {
    test(`${who} cannot write, bump or delete a count`, async () => {
      await assertFails(db().ref(`series_reads/${INST}`).set(8));
      await assertFails(db().ref(`series_reads/${INST}`).set(null));
      await assertFails(db().ref('series_reads/new-inst').set(1));
    });
  }
});

describe('W49 · series_read_ledger: the endpoint’s alone', () => {
  for (const [who, db] of [['signed out', () => anon], ['the reader themself', () => owner], ['another reader', () => stranger], ['a founder', () => founder]]) {
    test(`${who} can neither read nor write it`, async () => {
      await assertFails(db().ref(`series_read_ledger/${INST}`).get());
      await assertFails(db().ref(`series_read_ledger/${INST}/${OWNER}`).get());
      await assertFails(db().ref(`series_read_ledger/${INST}/${OWNER}`).set(null));
      await assertFails(db().ref(`series_read_ledger/${INST}/${STRANGER}`).set(Date.now()));
    });
  }
});

describe('W49 · users/{uid}/readInstalments: the reader’s own marker', () => {
  test('the reader marks an instalment read: true only', async () => {
    await assertSucceeds(owner.ref(`users/${OWNER}/readInstalments/${INST}`).set(true));
    await assertFails(owner.ref(`users/${OWNER}/readInstalments/${INST}`).set(false));
    await assertFails(owner.ref(`users/${OWNER}/readInstalments/${INST}`).set('yes'));
    await assertFails(owner.ref(`users/${OWNER}/readInstalments/bad key!`).set(true));
  });
  test('nobody else writes it', async () => {
    await assertFails(stranger.ref(`users/${OWNER}/readInstalments/${INST}`).set(true));
    await assertFails(anon.ref(`users/${OWNER}/readInstalments/${INST}`).set(true));
  });
  test('readStories is unchanged beside it (a story slug, still the reader’s own)', async () => {
    await assertSucceeds(owner.ref(`users/${OWNER}/readStories/a-story`).set(true));
    await assertFails(stranger.ref(`users/${OWNER}/readStories/a-story`).set(true));
  });
});
