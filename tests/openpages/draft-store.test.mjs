// R37 — draft persistence: it survives a reload, and it costs nothing.
//
// The cost test is R36's pattern: stub global fetch, run the real save path many times,
// and require ZERO requests to the Anthropic endpoint and zero to the rate counter. A
// draft is not published, so it must never be screened and must never spend a slot.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readLocal, writeLocal, readSyncedRevs, writeSyncedRevs, deviceId,
  oversizeReason, planSync, allocateSlot, pruneEmpty, draftPath,
} from '../../app/lib/openPagesDraftStore.js';
import { buildDraft, MAX_DRAFTS, slotName, DRAFT_BODY_MAX } from '../../app/lib/openPagesDrafts.js';

// A localStorage that behaves like the real one, including the throwing kind.
function fakeStorage({ throwOnSet = false, throwOnGet = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (throwOnGet) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

const NOW = 1_800_000_000_000;
const UID = 'writer-1';
const mk = (over = {}) => ({ ...buildDraft({ title: 'T', body: 'B' }, { now: NOW, deviceId: 'dev1' }), ...over });

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · a draft survives a reload', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ WRITTEN, THEN READ BACK FROM A FRESH READ — the reload case', () => {
    const s = fakeStorage();
    const drafts = { d0: mk({ body: 'Two paragraphs of a thing.' }) };
    assert.equal(writeLocal(UID, drafts, s), true);
    // A reload is exactly this: nothing in memory, everything from storage.
    const back = readLocal(UID, s);
    assert.deepEqual(back, drafts);
    assert.equal(back.d0.body, 'Two paragraphs of a thing.');
  });

  test('two accounts on one browser do not see each other', () => {
    const s = fakeStorage();
    writeLocal('alice', { d0: mk({ body: 'alice writing' }) }, s);
    writeLocal('bob', { d0: mk({ body: 'bob writing' }) }, s);
    assert.equal(readLocal('alice', s).d0.body, 'alice writing');
    assert.equal(readLocal('bob', s).d0.body, 'bob writing');
  });

  test('⭐ A STORAGE THAT CANNOT WRITE REPORTS IT, rather than pretending', () => {
    // Private mode, or site data blocked. Silently "saving" is how a writer loses an
    // evening, so the composer needs to be able to say so.
    assert.equal(writeLocal(UID, { d0: mk() }, fakeStorage({ throwOnSet: true })), false);
    assert.equal(writeLocal(UID, { d0: mk() }, null), false);
  });

  test('a corrupt or hand-edited store cannot produce an unsyncable draft', () => {
    const s = fakeStorage();
    s.setItem(`cs_op_drafts_${UID}`, JSON.stringify({ d0: mk(), d99: mk(), notASlot: mk(), d1: 'nonsense' }));
    const back = readLocal(UID, s);
    assert.deepEqual(Object.keys(back), ['d0'], 'only real slots survive the read');
  });

  test('junk in storage never throws into a render', () => {
    const s = fakeStorage();
    s.setItem(`cs_op_drafts_${UID}`, 'not json at all');
    assert.deepEqual(readLocal(UID, s), {});
    assert.deepEqual(readLocal(UID, fakeStorage({ throwOnGet: true })), {});
    assert.deepEqual(readSyncedRevs(UID, fakeStorage({ throwOnGet: true })), {});
  });

  test('the device id is stable across reads and survives a reload', () => {
    const s = fakeStorage();
    const a = deviceId(s);
    assert.equal(deviceId(s), a, 'a second call must not mint a new device');
    assert.equal(typeof a, 'string');
    assert.equal(deviceId(fakeStorage({ throwOnSet: true })), 'nodevice', 'and it degrades rather than throwing');
  });

  test('sync markers round-trip so the next reconcile knows the history', () => {
    const s = fakeStorage();
    assert.equal(writeSyncedRevs(UID, { d0: 4 }, s), true);
    assert.deepEqual(readSyncedRevs(UID, s), { d0: 4 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · syncing many slots without losing words', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('a clean set of pushes and pulls', () => {
    const local = { d0: mk({ body: 'only here', rev: 2 }) };
    const remote = { d1: mk({ body: 'only there', rev: 3 }) };
    const p = planSync(local, remote, {});
    assert.deepEqual(p.pushed, ['d0']);
    assert.deepEqual(p.pulled, ['d1']);
    assert.equal(p.forks.length, 0);
    assert.equal(Object.keys(p.merged).length, 2, 'both survive');
  });

  test('⭐ A DIVERGED SLOT IS FORKED INTO A FREE SLOT — the loser gets a home', () => {
    const local = { d0: mk({ body: 'laptop version', rev: 5, updatedAt: NOW + 2000 }) };
    const remote = { d0: mk({ body: 'phone version', rev: 4, updatedAt: NOW + 1000 }) };
    const p = planSync(local, remote, { d0: 3 });

    assert.equal(p.forks.length, 1);
    assert.equal(p.merged.d0.body, 'laptop version', 'the newer one keeps the slot');
    const fork = p.forks[0];
    assert.equal(p.merged[fork.to].body, 'phone version', 'AND THE OTHER ONE IS STILL THERE');
    assert.equal(p.merged[fork.to].forkedFrom, 'd0', 'and it says where it came from');
    assert.notEqual(fork.to, 'd0');
  });

  test('⭐ AT THE CAP A FORK IS REFUSED, NOT DROPPED', () => {
    // Nineteen slots taken plus the diverged one = full. There is nowhere to put the
    // loser, so the sync leaves that slot alone and the writer is told — rather than
    // "we could not keep it, so we deleted it", which is the outcome this design exists
    // to prevent.
    const local = {}; const remote = {};
    for (let i = 1; i < MAX_DRAFTS; i++) { local[slotName(i)] = mk({ rev: 1 }); remote[slotName(i)] = mk({ rev: 1 }); }
    local.d0 = mk({ body: 'laptop', rev: 5, updatedAt: NOW + 2 });
    remote.d0 = mk({ body: 'phone', rev: 4, updatedAt: NOW + 1 });

    const p = planSync(local, remote, { d0: 3 });
    assert.equal(p.capReached, true, 'the caller must be told');
    assert.equal(p.forks.length, 0, 'no fork was invented out of nowhere');
    assert.equal(p.merged.d0.body, 'laptop');
    // The phone copy is still in the database — nothing deleted it. The writer frees a
    // slot and the next sync forks it.
    assert.equal(remote.d0.body, 'phone', 'the remote copy is untouched by a refused fork');
  });

  test('identical copies converge instead of forking', () => {
    const same = mk({ body: 'the same words' });
    const p = planSync({ d0: { ...same, rev: 2 } }, { d0: { ...same, rev: 7 } }, { d0: 1 });
    assert.equal(p.forks.length, 0, 'a spurious fork teaches writers to ignore the warning');
    assert.equal(p.revs.d0, 7);
  });

  test('slots are allocated low-first and refuse at the cap', () => {
    assert.equal(allocateSlot({}), 'd0');
    assert.equal(allocateSlot({ d0: mk(), d1: mk() }), 'd2');
    const full = Object.fromEntries(Array.from({ length: MAX_DRAFTS }, (_, i) => [slotName(i), mk()]));
    assert.equal(allocateSlot(full), null, 'refuse — the caller must not evict');
  });

  test('empty drafts are pruned, so an untouched composer leaves no row', () => {
    const out = pruneEmpty({ d0: mk({ title: '', body: '  ' }), d1: mk({ body: 'real' }) });
    assert.deepEqual(Object.keys(out), ['d1']);
  });

  test('oversize is named, and the device copy is not the thing that refuses', () => {
    assert.equal(oversizeReason(mk({ body: 'x'.repeat(DRAFT_BODY_MAX) })), null, 'exactly at the cap syncs');
    assert.equal(oversizeReason(mk({ body: 'x'.repeat(DRAFT_BODY_MAX + 1) })), 'body');
    assert.equal(oversizeReason(mk({ title: 'x'.repeat(201) })), 'title');
    // Local storage takes it regardless — that is what device-first means.
    const s = fakeStorage();
    assert.equal(writeLocal(UID, { d0: mk({ body: 'x'.repeat(DRAFT_BODY_MAX + 5000) }) }, s), true);
    assert.equal(readLocal(UID, s).d0.body.length, DRAFT_BODY_MAX + 5000, 'nothing was cut');
  });

  test('the path is under the private node, not under users/', () => {
    assert.equal(draftPath('u1', 'd0'), 'open_pages_drafts/u1/d0');
    assert.ok(!draftPath('u1', 'd0').startsWith('users/'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R37 · ⭐ A SAVE COSTS NOTHING — no model call, no rate-limit slot', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  let realFetch, urls;
  beforeEach(() => { realFetch = globalThis.fetch; urls = []; globalThis.fetch = async (u) => { urls.push(String(u)); return new Response('{}', { status: 200 }); }; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('fifty saves make ZERO requests to the Anthropic endpoint', async () => {
    const s = fakeStorage();
    const remote = {};
    // The real save path, fifty times, exactly as a writer typing would drive it.
    for (let i = 0; i < 50; i++) {
      const drafts = { d0: buildDraft({ title: 'T', body: `revision ${i}` }, { now: NOW + i, deviceId: 'dev1', rev: i + 1 }) };
      writeLocal(UID, drafts, s);
      const p = planSync(drafts, remote, readSyncedRevs(UID, s));
      for (const slot of p.pushed) remote[slot] = p.merged[slot];
      writeSyncedRevs(UID, p.revs, s);
    }
    assert.equal(readLocal(UID, s).d0.body, 'revision 49', 'the saves really happened');

    const anthropic = urls.filter((u) => u.includes('api.anthropic.com'));
    const moderate = urls.filter((u) => u.includes('/api/open-pages/moderate'));
    const rate = urls.filter((u) => u.includes('open_pages_rate'));
    assert.deepEqual(anthropic, [], 'A DRAFT IS NEVER SCREENED — screening happens at publish');
    assert.deepEqual(moderate, [], 'and the moderation endpoint is never called');
    assert.deepEqual(rate, [], "and R36's rate counter is never touched, so no slot is spent");
    assert.deepEqual(urls, [], 'in fact the save path makes no network request of its own at all');
  });

  test('the draft store IMPORTS nothing that could screen', async () => {
    // A structural guard on the import graph, which is where moderation would have to
    // arrive from. Reading the prose would not work — the file's own comments name the
    // Anthropic endpoint precisely to say it is never called.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/lib/openPagesDraftStore.js', 'utf8');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['./openPagesDrafts.js'],
      'the save path may depend on the contract and on nothing else — not the moderation function, not firebase, not the rate limiter');

    // And the code, with its explanatory comments removed, mentions none of them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    for (const forbidden of [/anthropic/i, /open_pages_rate/, /\/api\/open-pages/]) {
      assert.equal(forbidden.test(code), false, `${forbidden} must not appear in the save path`);
    }
  });
});
