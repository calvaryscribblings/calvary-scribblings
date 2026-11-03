// LIMITS-1 — the parts that need no database.
//
//   node --test tests/ci/limits-1.test.mjs      (npm run test:ci)
//
// 1. POST /api/story-index/build: the scheduled publish's index record comes from the REAL builder.
// 2. The two budgeted endpoints make no outbound call around their Budget.
// 3. The bulk reset's loop (app/lib/quizResetLoop.js), driven with a scripted server.
// The emulator half, under the 50-subrequest shim, is tests/limits/limits.emulator.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost, MAX_BODY_BYTES } from '../../functions/api/story-index/build.js';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';
import { Budget, BudgetExceeded, pooled } from '../../functions/api/_budget.js';
import { planBatch, pushId } from '../../functions/api/admin/reset-attempt.js';
import { runBulkReset, BULK_RETRIES } from '../../app/lib/quizResetLoop.js';

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const post = (body, raw) => onRequestPost({ request: new Request('https://x.test/api/story-index/build', { method: 'POST', body: raw ?? JSON.stringify(body) }) });

describe('LIMITS-1 · the index builder for the scheduled publish', () => {
  const story = {
    title: 'An Invented Story', author: 'A. Writer', authorUid: 'u1', published: true, publishAt: '2026-11-03T06:30:00Z',
    content: '<p class="intro-note">Content note: invented.</p><p>The first real line of the story.</p><p>Second.</p>',
    quizMeta: { hasQuiz: true }, date: 'Nov 3, 2026',
  };

  test('answers exactly what buildIndexRecord makes, opening line included', async () => {
    const res = await post({ slug: 'an-invented-story', story });
    assert.equal(res.status, 200);
    const { record } = await res.json();
    assert.deepEqual(record, buildIndexRecord('an-invented-story', story));
    assert.equal(record.opening, 'The first real line of the story.', 'the predicate stepped over the front matter');
  });

  test('refuses a bad slug, a missing story, a non-object, malformed JSON', async () => {
    for (const [b, raw] of [[{ slug: '../x', story }], [{ slug: 'ok' }], [{ slug: 'ok', story: [1] }], [null, '{nope']]) {
      assert.equal((await post(b, raw)).status, 400);
    }
  });

  test('refuses a body over the cap', async () => {
    const big = JSON.stringify({ slug: 'ok', story: { content: 'x'.repeat(MAX_BODY_BYTES) } });
    assert.equal((await post(null, big)).status, 413);
  });

  test('pure: no import of a credential, a database or fetch', () => {
    const s = src('functions/api/story-index/build.js').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(s, /fetch\(|env\.|_lib\.js|dbBase|mintAccessToken/);
  });

  test('the Worker asks it before the flip and falls back to the mirror', () => {
    const w = src('workers-external/calvary-newsletter.worker.js');
    assert.match(w, /const INDEX_BUILDER_URL = "https:\/\/calvaryscribblings\.co\.uk\/api\/story-index\/build";/);
    assert.match(w, /const indexRecord = await indexRecordFor\(env, slug, \{ \.\.\.story, \.\.\.body, published: true \}, builder\);/);
    assert.match(w, /return mirror;\s*\}\s*\}/, 'every failure returns the mirror\'s record');
  });
});

describe('LIMITS-1 · the budget', () => {
  test('take() refuses the call that would overrun, never after it', () => {
    const b = new Budget(3);
    b.take(2); assert.ok(b.fits(1)); assert.ok(!b.fits(2));
    assert.throws(() => b.take(2), BudgetExceeded);
    assert.equal(b.used, 2);
  });

  test('pooled() never has more than `width` in flight', async () => {
    let open = 0; let peak = 0;
    await pooled(Array.from({ length: 20 }, (_, i) => i), 6, async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 1)); open--; });
    assert.equal(peak, 6);
  });

  test('reset-attempt and account deletion make no outbound call around the budget', () => {
    const reset = src('functions/api/admin/reset-attempt.js').replace(/^\s*\/\/.*$/gm, '');
    assert.equal((reset.match(/(?<![.\w])fetch\(/g) || []).length, 0, 'reset-attempt: every fetch goes through budget.fetch');
    const del = src('functions/api/account/_deletion.js');
    const io = del.slice(del.indexOf('export function realIo('));
    assert.match(io, /const fetch = \(url, init\) => budget\.fetch\(url, init\);/, 'realIo charges every call');
    const route = src('functions/api/account/delete.js');
    // lookupUser, mintAccessToken and consume() fetch inside other modules: each is charged first.
    assert.match(route, /budget\.take\(1\);\s*const user = await lookupUser/);
    assert.match(route, /budget\.take\(1\);\s*token = await mintAccessToken/);
    assert.match(route, /budget\.take\(limiterCost\(caps\)\);\s*const limited = await charge/);
  });
});

describe('LIMITS-1 · the bulk reset batch plan', () => {
  const all = { c: { q: 1 }, a: { q: 1 }, b: { q: 1 }, d: { other: 1 }, e: { q: 1 } };
  test('sorted, unlogged, as many as fit', () => {
    assert.deepEqual(planBatch(all, 'q', new Set(), 2), { batch: ['a', 'b'], due: 4 });
    assert.deepEqual(planBatch(all, 'q', new Set(['a', 'b']), 10), { batch: ['c', 'e'], due: 2 });
    assert.deepEqual(planBatch(all, 'q', new Set(), 0), { batch: [], due: 4 });
    assert.deepEqual(planBatch(null, 'q', new Set(), 5), { batch: [], due: 0 });
  });
  test('push ids are 20 characters and chronological', () => {
    const a = pushId(1_700_000_000_000); const b = pushId(1_700_000_000_001);
    assert.match(a, /^[-0-9A-Za-z_]{20}$/);
    assert.ok(a.slice(0, 8) < b.slice(0, 8));
  });
});

describe('LIMITS-1 · the page\'s bulk-reset loop', () => {
  const ok = (resetCount, more, runId = 'R'.repeat(20)) => ({ ok: true, status: 200, data: { ok: true, resetCount, more, runId } });
  const boom = { ok: false, status: 500, data: { error: 'boom' } };
  const script = (answers) => { const sent = []; return { sent, call: async (b) => { sent.push(b); const a = answers.shift(); if (a instanceof Error) throw a; return a; } }; };

  test('calls until more is false, carrying the run id', async () => {
    const s = script([ok(45, true), ok(45, true), ok(10, false)]);
    const r = await runBulkReset(s.call, { slug: 'q', wait: async () => {} });
    assert.deepEqual(r, { ok: true, count: 100, calls: 3 });
    assert.deepEqual(s.sent.map((b) => b.runId), [null, 'R'.repeat(20), 'R'.repeat(20)]);
  });

  test('a failure is retried; misses reset after progress', async () => {
    const s = script([ok(45, true), boom, new TypeError('net'), ok(45, true), boom, ok(1, false)]);
    const r = await runBulkReset(s.call, { slug: 'q', wait: async () => {} });
    assert.deepEqual(r, { ok: true, count: 91, calls: 6 });
  });

  test('a persistent failure stops with the count so far', async () => {
    const s = script([ok(45, true), ...Array(BULK_RETRIES + 1).fill(boom)]);
    const r = await runBulkReset(s.call, { slug: 'q', wait: async () => {} });
    assert.equal(r.ok, false); assert.equal(r.count, 45); assert.equal(r.error, 'boom');
  });

  test('a refusal (4xx) is never retried', async () => {
    const s = script([{ ok: false, status: 401, data: { error: 'Unauthorised.' } }]);
    const r = await runBulkReset(s.call, { slug: 'q', wait: async () => {} });
    assert.equal(r.ok, false); assert.equal(s.sent.length, 1);
  });
});
