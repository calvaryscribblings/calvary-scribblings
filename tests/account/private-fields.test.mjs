// PRIVATE FIELDS — the migration and the 15-minute sweep move dob (and the rest) off the public
// record, and touch nothing else.
//
//   node --test tests/account/private-fields.test.mjs      (npm run test:account)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPrivateSweep, runPrivateSweep, PRIVATE_FIELDS } from '../../scripts/account/private-fields.mjs';
import { signupUpdate, completionUpdate } from '../../app/lib/handle.js';

// An admin-SDK-shaped database over a plain object: ref(path).get() and ref().update(multiPath).
function memoryDb(initial) {
  const root = structuredClone(initial);
  const updates = [];
  const walk = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
  const setPath = (path, value) => {
    const parts = path.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = structuredClone(value);
  };
  return {
    root, updates,
    ref: (path = '') => ({
      get: async () => ({ val: () => structuredClone(walk(path) ?? null) }),
      update: async (u) => { updates.push(u); for (const [k, v] of Object.entries(u)) setPath(k, v); },
    }),
  };
}

const READING = { readCount: 9, readStories: { 'the-flint': true, '1967': true }, readerScore: 88, scoreUpdatedAt: 1781234567890 };
const LIVE = () => ({
  users: {
    web: { displayName: 'Web', dob: '1990-01-01', joinDate: 1, username: 'web', ...READING },
    app: { displayName: 'App', dob: '1995-08-15', ageConfirmed: true, handle: 'app', createdAt: 2, uid: 'app' },
    films: { displayName: 'Films', email: 'films@example.com', handle: 'calvaryfilms', readerProgress: { x: { cfi: 'c' } } },
    legacy: { membership: 'free', platforms: { radio: true }, profile: { avatarUrl: 'https://a', country: '', displayName: 'smollie', email: 'x@example.com', handle: 'smollie', joinedAt: 3 } },
    radio: { profile: { ageConfirmed: true, createdAt: 4, displayName: 'calvaryradio', dob: '1995-01-01', handle: 'calvaryradio', uid: 'radio' } },
    clean: { displayName: 'Clean', ...READING },
    gone: { dob: '2000-02-02', membership: 'gold' },
  },
  users_private: { app: { dob: '1970-01-01' }, films: { country: 'NG' } },
  deletions: { gone: { uid: 'gone', steps: { auth: 1 } } },
});
const log = () => {};

describe('what counts as private', () => {
  test('dob, email, and the private children of the legacy profile object — nothing else', () => {
    assert.deepEqual(PRIVATE_FIELDS.map(([f]) => f), ['dob', 'email', 'profile/dob', 'profile/email', 'profile/country']);
  });
});

describe('the sweep moves and removes', () => {
  test('every private field lands in users_private and leaves users/', async () => {
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, log });
    const { users, users_private: priv } = db.root;
    assert.equal(priv.web.dob, '1990-01-01');
    assert.equal(priv.films.email, 'films@example.com');
    assert.deepEqual(priv.legacy, { email: 'x@example.com' }, 'an empty country carries nothing and is not copied');
    assert.deepEqual(priv.radio, { dob: '1995-01-01' });
    for (const uid of ['web', 'app', 'films', 'legacy', 'radio']) {
      for (const [f] of PRIVATE_FIELDS) {
        const v = f.split('/').reduce((o, k) => o?.[k], users[uid]);
        assert.equal(v, undefined, `${uid}/${f} still public`);
      }
    }
  });

  test('a private field already held is KEPT — the sweep writes leaves, never the node', async () => {
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, log });
    assert.deepEqual(db.root.users_private.films, { country: 'NG', email: 'films@example.com' });
  });

  test('the public copy is the most recent write and wins over an older private value', async () => {
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, log });
    assert.equal(db.root.users_private.app.dob, '1995-08-15');
  });

  test('a DELETED reader is skipped — nothing copied anywhere new', async () => {
    const db = memoryDb(LIVE());
    const counts = await runPrivateSweep(db, { apply: true, log });
    assert.equal(counts.skippedDeleted, 1);
    assert.equal(db.root.users_private.gone, undefined);
  });

  test('ONE update per reader, and each carries its copy and its removal together', async () => {
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, log });
    assert.equal(db.updates.length, 5);
    for (const u of db.updates) {
      const uids = new Set(Object.keys(u).map((k) => k.split('/')[1]));
      assert.equal(uids.size, 1);
      assert.ok(Object.keys(u).some((k) => k.startsWith('users/')));
    }
  });
});

describe('it never touches anything else', () => {
  test('every other field of every reader is byte-identical', async () => {
    const before = LIVE();
    const db = memoryDb(before);
    await runPrivateSweep(db, { apply: true, log });
    const strip = (node) => {
      const c = structuredClone(node);
      for (const [f] of PRIVATE_FIELDS) { const parts = f.split('/'); let o = c; for (const p of parts.slice(0, -1)) o = o?.[p]; if (o) delete o[parts.at(-1)]; }
      return c;
    };
    for (const uid of Object.keys(before.users)) {
      if (uid === 'gone') { assert.deepEqual(db.root.users.gone, before.users.gone); continue; }
      assert.equal(JSON.stringify(db.root.users[uid]), JSON.stringify(strip(before.users[uid])), uid);
    }
    assert.deepEqual(db.root.deletions, before.deletions);
  });

  test('the plan names only private paths and users_private', () => {
    const { update } = planPrivateSweep(LIVE().users, LIVE().deletions);
    const allowed = new Set(PRIVATE_FIELDS.map(([f]) => f));
    for (const k of Object.keys(update)) {
      const [node, , ...rest] = k.split('/');
      if (node === 'users') assert.ok(allowed.has(rest.join('/')), k);
      else assert.equal(node, 'users_private', k);
    }
  });
});

describe('idempotent', () => {
  test('a second run finds nothing and writes nothing', async () => {
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, log });
    const n = db.updates.length;
    const snapshot = JSON.stringify(db.root);
    await runPrivateSweep(db, { apply: true, log });
    assert.equal(db.updates.length, n);
    assert.equal(JSON.stringify(db.root), snapshot);
  });
});

describe('dry run and backup', () => {
  test('without apply: counts, and not one write', async () => {
    const db = memoryDb(LIVE());
    const counts = await runPrivateSweep(db, { apply: false, log });
    assert.equal(db.updates.length, 0);
    assert.equal(counts.readers, 5);
    assert.equal(counts.dob, 2);
  });
  test('with a backup dir, every value is written to disk BEFORE anything moves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'private-'));
    const db = memoryDb(LIVE());
    await runPrivateSweep(db, { apply: true, backupDir: dir, log, now: () => 0 });
    const [file] = readdirSync(dir);
    const b = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    assert.equal(b.before.web.public.dob, '1990-01-01');
    assert.equal(b.before.app.private.dob, '1970-01-01', 'the private value it overwrote is kept too');
    assert.equal(b.readers, 5);
  });
});

describe('the web writes the date of birth privately', () => {
  for (const [name, u] of [['signup', signupUpdate('U1', { name: 'A', dob: '1990-01-01', handle: 'a', now: 1 })], ['completion', completionUpdate('U1', { name: 'A', dob: '1990-01-01', handle: 'a', since: 1 })]]) {
    test(`${name}: users_private/{uid}/dob, and NO dob under users/{uid}`, () => {
      assert.equal(u['users_private/U1/dob'], '1990-01-01');
      assert.equal(Object.keys(u).some((k) => /^users\/U1\/(dob|email)$/.test(k)), false);
    });
  }
});

describe('account deletion clears the private node too', async () => {
  const { planOwned, OWNED_NODES } = await import('../../functions/api/account/_deletion.js');
  test('users_private is an owned node, removed with the account', () => {
    assert.ok(OWNED_NODES.includes('users_private'));
    assert.equal(planOwned('U1', {}, null)['users_private/U1'], null);
  });
});
