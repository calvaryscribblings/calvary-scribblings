// W2 — the designed-states helper: a deadline turns a hang into a failure, a failure has a kind,
// and content once drawn is never replaced by a failure.
//
//   node --test tests/ci/reliable-read.test.mjs      (npm run test:ci)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_DEADLINE_MS, BACKOFF_MS, backoffFor, ReadFailure, classifyFailure, readWithDeadline,
  firstValueWithDeadline, initialState, nextState,
} from '../../app/lib/reliableRead.js';
import { UNAVAILABLE_COPY, copyFor, leadFor } from '../../app/lib/unavailableCopy.js';

test('the deadline is 12s and is written down as chosen (2.5× the slowest healthy read measured)', () => {
  assert.equal(READ_DEADLINE_MS, 12000);
});

test('a read that NEVER settles becomes a "slow" failure at the deadline — the PL-12 shape', async () => {
  const hang = () => new Promise(() => {});
  const t0 = Date.now();
  await assert.rejects(readWithDeadline(hang, { deadlineMs: 60 }), (e) => e instanceof ReadFailure && e.kind === 'slow');
  assert.ok(Date.now() - t0 < 1000);
});

test('a read that resolves in time passes its value straight through — an empty answer is a SUCCESS', async () => {
  assert.deepEqual(await readWithDeadline(async () => [], { deadlineMs: 500 }), []);
  assert.equal(await readWithDeadline(async () => null, { deadlineMs: 500 }), null);
});

test('failures are classified: offline, slow, or ours — never "empty"', () => {
  assert.equal(classifyFailure(new Error('Client is offline.'), { offline: false }), 'offline');
  assert.equal(classifyFailure(new Error('anything'), { offline: true }), 'offline');
  assert.equal(classifyFailure(new Error('deadline exceeded after 12000ms'), { offline: false }), 'slow');
  assert.equal(classifyFailure(new Error('PERMISSION_DENIED: Permission denied'), { offline: false }), 'ours');
  assert.equal(classifyFailure(new ReadFailure('slow'), { offline: true }), 'slow');
});

test('a rejected read keeps its kind through readWithDeadline', async () => {
  await assert.rejects(readWithDeadline(async () => { throw new Error('permission_denied'); }, { deadlineMs: 500 }),
    (e) => e.kind === 'ours' && /permission_denied/.test(e.cause.message));
});

test('a listener that never fires times out ONCE, stays attached, and a late value still lands', async () => {
  const events = [];
  let deliver;
  const stop = firstValueWithDeadline((onValue) => { deliver = onValue; return () => events.push('detached'); }, {
    deadlineMs: 40,
    onValue: (v) => events.push(['value', v]),
    onError: () => events.push('error'),
    onTimeout: (kind) => events.push(['timeout', kind]),
  });
  await new Promise((r) => setTimeout(r, 80));
  deliver('late');
  stop();
  assert.equal(events[0][0], 'timeout');
  assert.deepEqual(events[1], ['value', 'late']);
  assert.equal(events[2], 'detached');
});

test('a listener that answers in time never times out', async () => {
  const events = [];
  const stop = firstValueWithDeadline((onValue) => { onValue(1); return () => {}; }, {
    deadlineMs: 30, onValue: (v) => events.push(v), onError: () => {}, onTimeout: () => events.push('timeout'),
  });
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.deepEqual(events, [1]);
});

test('THE RULE: once content is drawn, a failure never replaces it', () => {
  let s = nextState(initialState, { type: 'success', data: ['a story'] });
  s = nextState(s, { type: 'start' });
  assert.equal(s.refreshing, true);
  s = nextState(s, { type: 'failure', kind: 'offline' });
  assert.equal(s.phase, 'ready');
  assert.deepEqual(s.data, ['a story']);
  assert.equal(s.failure, null);
  assert.equal(s.quietFailures, 1);
});

test('only the FIRST load may fail into the failure state, and a later success clears it', () => {
  let s = nextState(initialState, { type: 'failure', kind: 'slow' });
  assert.equal(s.phase, 'failed');
  assert.equal(s.failure, 'slow');
  s = nextState(s, { type: 'start' });
  assert.equal(s.phase, 'failed', 'Retry keeps the failure drawn until an answer arrives');
  assert.equal(s.refreshing, true);
  s = nextState(s, { type: 'success', data: [] });
  assert.equal(s.phase, 'ready');
  assert.deepEqual(s.data, []);
});

test('a change of subject resets to a first load', () => {
  const s = nextState({ ...initialState, phase: 'ready', data: [1] }, { type: 'reset' });
  assert.deepEqual(s, initialState);
});

test('quiet retries back off 5s → 60s and stay at 60s', () => {
  assert.deepEqual(BACKOFF_MS, [5000, 10000, 20000, 40000, 60000]);
  assert.equal(backoffFor(0), 5000);
  assert.equal(backoffFor(9), 60000);
});

test('every failure kind has words that say what happened and what to do', () => {
  for (const kind of ['offline', 'slow', 'ours']) {
    const c = copyFor(kind);
    assert.ok(c.title && c.body, kind);
    assert.match(c.body, /try again|check your connection/i, `${kind} must say what to do next`);
  }
  assert.equal(copyFor('nonsense'), UNAVAILABLE_COPY.kinds.ours);
  assert.equal(leadFor('your books'), 'We couldn’t reach your books.');
  assert.equal(UNAVAILABLE_COPY.retry, 'Try again');
});
