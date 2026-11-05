// RADIO-B1 — Calvary Radio's records (app/lib/radio/schema.js) and the rules generated from them.
// The rules themselves are proved against the emulator in tests/rules/radio-b1.test.mjs; this file
// holds the pure half: the validators, the windows, the generator being in step, and deletion.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateCollection, validateAudio, validatePosition, liveWindow, visibleFromMs, collectionKey,
  COLLECTION_STORIES, COLLECTION_INSTALMENTS, MAX_PER_WRITER, LIVE_GRACE_MS, READ_ALONG_RE,
} from '../../app/lib/radio/schema.js';
import { build, RADIO_NODES, RADIO_RULES } from '../../scripts/radio/write-rules.mjs';
import { build as buildNotify } from '../../scripts/notify/write-rules.mjs';
import { OWNED_NODES } from '../../functions/api/account/_deletion.js';

const RULES_TEXT = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');
const RULES = JSON.parse(RULES_TEXT);

const running = (stories, instalments) => {
  const items = [
    ...Array.from({ length: stories }, (_, i) => ({ kind: 'story', id: `s${i + 1}` })),
    ...Array.from({ length: instalments }, (_, i) => ({ kind: 'instalment', id: `bp-i${i + 1}` })),
  ];
  return Object.fromEntries(items.map((it, i) => [`o${i + 1}`, it]));
};
const coll = (o = {}) => ({ number: 1, releaseAtMs: 1, running: running(12, 2), status: 'scheduled', updatedAt: 1, ...o });

describe('collections', () => {
  test('a scheduled collection holds 10–15 stories and exactly two instalments', () => {
    assert.deepEqual(validateCollection(coll(), { key: 'c1' }), []);
    assert.deepEqual(validateCollection(coll({ running: running(COLLECTION_STORIES.min, 2) })), []);
    assert.deepEqual(validateCollection(coll({ running: running(COLLECTION_STORIES.max, 2) })), []);
    assert.ok(validateCollection(coll({ running: running(COLLECTION_STORIES.min - 1, 2) })).length);
    assert.ok(validateCollection(coll({ running: running(COLLECTION_STORIES.max + 1, 2) })).length);
    assert.ok(validateCollection(coll({ running: running(12, 1) })).length);
    assert.ok(validateCollection(coll({ running: running(12, 3) })).length);
    assert.equal(COLLECTION_INSTALMENTS, 2);
  });
  test('a draft is built up one item at a time', () => {
    assert.deepEqual(validateCollection(coll({ status: 'draft', running: running(1, 0) })), []);
  });
  test('the key is c{n}, positions run o1…oN, nothing repeats', () => {
    assert.equal(collectionKey(3), 'c3');
    assert.throws(() => collectionKey(0));
    assert.ok(validateCollection(coll(), { key: 'c2' }).length);
    assert.ok(validateCollection(coll({ running: { o1: { kind: 'story', id: 'a' }, o3: { kind: 'story', id: 'b' } }, status: 'draft' })).length);
    assert.ok(validateCollection(coll({ running: { o1: { kind: 'story', id: 'a' }, o2: { kind: 'story', id: 'a' } }, status: 'draft' })).length);
  });
  test(`at most ${MAX_PER_WRITER} stories by one writer (ruling 334)`, () => {
    const authorOf = (slug) => (['s1', 's2', 's3'].includes(slug) ? 'w1' : `w-${slug}`);
    assert.match(validateCollection(coll(), { authorOf }).join(' '), /ruling 334/);
    assert.deepEqual(validateCollection(coll(), { authorOf: (slug) => (['s1', 's2'].includes(slug) ? 'w1' : `w-${slug}`) }), []);
  });
});

describe('recordings', () => {
  const st = (o = {}) => ({ releaseAtMs: 10, durationMs: 600000, readAlong: '/stories/tale', status: 'scheduled', updatedAt: 1, ...o });
  const ins = (o = {}) => ({ premiereAtMs: 1000, durationMs: 3000000, releaseAtMs: 3001000, readAlong: '/series/instalment/bp-i1', status: 'scheduled', updatedAt: 1, ...o });
  test('a story: on demand from its release, no premiere needed, no collection needed', () => {
    assert.deepEqual(validateAudio('stories', st(), { id: 'tale' }), []);
    assert.deepEqual(validateAudio('stories', st({ collection: 'c1', narrator: { name: 'N' }, engineer: { name: 'E', uid: 'abc' }, version: 'g1' }), { id: 'tale' }), []);
  });
  test('an instalment premieres without a collection, and opens on demand only after its premiere ends', () => {
    assert.deepEqual(validateAudio('instalments', ins(), { id: 'bp-i1' }), []);
    assert.ok(validateAudio('instalments', ins({ releaseAtMs: 2000 })).length);
  });
  test('only an instalment has an access override, and openToFree needs freeForGold', () => {
    assert.deepEqual(validateAudio('instalments', ins({ access: { freeForGold: true, openToFree: true } })), []);
    assert.ok(validateAudio('instalments', ins({ access: { openToFree: true } })).length);
    assert.ok(validateAudio('stories', st({ access: { freeForGold: true } })).length);
  });
  test('duration is measured (positive), readAlong is the text\'s own address, no storage path on the record', () => {
    assert.ok(validateAudio('stories', st({ durationMs: 0 })).length);
    assert.ok(validateAudio('stories', st(), { id: 'other' }).length);
    assert.ok(validateAudio('stories', st({ path: 'x.mp3' })).length);
    assert.ok(READ_ALONG_RE.test('/series/instalment/bp-i1'));
    assert.ok(!READ_ALONG_RE.test('/bookstore/x'));
  });
  test('the live window runs from the premiere to the end of the audio plus the grace', () => {
    assert.deepEqual(liveWindow(ins()), { startMs: 1000, endMs: 1000 + 3000000 + LIVE_GRACE_MS });
    assert.equal(liveWindow(st()), null);
    assert.equal(visibleFromMs(ins()), 1000);
    assert.equal(visibleFromMs(st()), 10);
  });
});

test('positions: inside the file, against a version', () => {
  assert.deepEqual(validatePosition({ positionMs: 0, durationMs: 10, version: 'g', updatedAt: 1 }), []);
  assert.ok(validatePosition({ positionMs: 11, durationMs: 10, version: 'g', updatedAt: 1 }).length);
  assert.ok(validatePosition({ positionMs: 1, durationMs: 10, updatedAt: 1 }).length);
});

describe('the generated rules', () => {
  test('database.rules.json is exactly what both generators write', () => {
    assert.equal(JSON.stringify(build(RULES), null, 2) + '\n', RULES_TEXT, 'run node scripts/radio/write-rules.mjs');
    assert.equal(JSON.stringify(buildNotify(RULES), null, 2) + '\n', RULES_TEXT, 'run node scripts/notify/write-rules.mjs');
  });
  test('every Radio node is in the file, and nothing in it lets a client write the counts', () => {
    for (const n of RADIO_NODES) assert.ok(RULES.rules[n], `${n} missing`);
    const room = RADIO_RULES.radio_live.instalments.$id;
    assert.equal(room.counts['.write'], undefined);
    assert.equal(room.listeners['.read'], undefined, 'no reading every listener');
    assert.equal(room.hearts['.read'], undefined, 'no summing every heart');
  });
  test('listening_position is deleted with the account', () => {
    assert.ok(OWNED_NODES.includes('listening_position'));
  });
});
