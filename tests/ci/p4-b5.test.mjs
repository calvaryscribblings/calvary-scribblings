// P4-B5 — ruling 373 (every recipient's push at once): the pure parts of the queue wake-up. The
// behaviour, against the emulator with a stand-in queue, is tests/notify/p4-queue.emulator.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAKE_MESSAGE, WAKE_ATTEMPTS, WAKE_RETRY_S, wakeQueue, wakesDrain } from '../../app/lib/pushP4.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('373: the wake-up', () => {
  test('carries nothing about anyone: one fixed word', () => {
    assert.equal(WAKE_MESSAGE, 'drain');
  });
  test('is sent only when the instant pass left entries behind', () => {
    assert.equal(wakesDrain({ sent: 1, more: false }), false, 'it took everything');
    assert.equal(wakesDrain({ skipped: 'unconfigured' }), false);
    assert.equal(wakesDrain(undefined), false);
    assert.equal(wakesDrain({ skipped: 'budget' }), true);
    assert.equal(wakesDrain({ skipped: 'busy' }), true);
    assert.equal(wakesDrain({ more: true }), true);
    assert.equal(wakesDrain({ failed: true }), true);
  });
  test('needs a queue binding; without one (preview, tests, before the queue exists) there is none', () => {
    assert.equal(wakeQueue({}), null);
    assert.equal(wakeQueue(undefined), null);
    assert.equal(wakeQueue({ PUSH_WAKE: {} }), null);
    const q = { send() {} };
    assert.equal(wakeQueue({ PUSH_WAKE: q }), q);
  });
  test('three tries inside the minute, then the cron', () => {
    assert.equal(WAKE_ATTEMPTS, 3);
    assert.ok(WAKE_RETRY_S > 0 && WAKE_RETRY_S * (WAKE_ATTEMPTS - 1) < 60);
  });
});

describe('373: where it is sent and who answers it', () => {
  test('notify sends it after its own instant pass, from the budget it kept back', () => {
    const n = src('functions/api/notify.js');
    const kept = n.indexOf('if (wake) budget.take(1);');
    const pass = n.indexOf('await drainNow(db, env,');
    const send = n.indexOf('await wake.send(WAKE_MESSAGE)');
    assert.ok(kept > 0 && pass > kept && send > pass, 'kept back, then the pass, then the send');
    assert.match(n, /if \(!wake \|\| !wakesDrain\(out\)\) return;/);
  });
  test('push-drain-ping: queue() runs the cron\'s loop marked ?via=wake, with pushP4\'s numbers, and holds no secret', () => {
    const w = src('workers-external/push-drain-ping.worker.js');
    assert.match(w, /async scheduled\(event, env\)[\s\S]*await drainLoop\(env, DRAIN\);/);
    assert.match(w, /async queue\(batch, env\)[\s\S]*drainLoop\(env, `\$\{DRAIN\}\?via=wake`\)/);
    assert.equal(Number(/const WAKE_ATTEMPTS = (\d+);/.exec(w)?.[1]), WAKE_ATTEMPTS);
    assert.equal(Number(/const WAKE_RETRY_S = (\d+);/.exec(w)?.[1]), WAKE_RETRY_S);
    assert.match(w, /const DRAIN = 'https:\/\/calvaryscribblings\.co\.uk\/api\/push\/drain';/);
    assert.ok(!/PUSH_DRAIN_SECRET\s*=/.test(w));
  });
  test('the drain: a wake-driven call writes lastWake, never the cron\'s heartbeat', () => {
    const d = src('functions/api/push/drain.js');
    assert.match(d, /url\.searchParams\.get\('via'\) === 'wake' \? 'wake' : 'cron'/);
    assert.match(d, /else if \(via === 'wake'\) o\[`\$\{DRAIN_OPS\}\/lastWake`\] = last;/);
  });
});
