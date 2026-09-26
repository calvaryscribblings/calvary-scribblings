// W12 — NO SCHEDULED JOB PRINTS ANYTHING THAT NAMES A READER.
//
//   node --test tests/ci/w12-log-privacy.test.mjs      (part of npm run test:ci)
//
// The repository is public and so are its Actions logs. Three layers are held here:
//   1. the guard (scripts/ops/redact.mjs + log-guard.mjs) recognises an account ID, a push token
//      and an email, and passes the house's ordinary output untouched;
//   2. every scheduled workflow step that runs a script against live data pipes through the
//      guard, under `shell: bash` so the script's own failure still fails the step;
//   3. the scripts themselves, driven with identifier-shaped fixtures, print none of them — the
//      account scrub, the push announcer and the launch check, the three that used to.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { findIdentifiers, mask, LOG_REF_RE } from '../../scripts/ops/redact.mjs';
import { runScrub } from '../../scripts/account/scrub.mjs';
import { runAnnouncer, errorTally } from '../../scripts/push/run.mjs';
import { judgeSignals } from '../../scripts/launch-check.mjs';

// Shaped like the real thing, and not anyone's.
const UID_A = 'Zq3Lm8Rt2Vb6Nc1Xy4Kp7Hs9Dw0F';
const UID_B = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9b';
const TOKEN_A = 'ExponentPushToken[Qx7-bR2mP9aLk4Zt8Vn3Wc]';
const TOKEN_B = 'ExpoPushToken[Hy6-tE1uI0oPa5Sd2Fg7Jk]';
const FCM = 'dT0kQw3Ar9E:APA91bHun4MxP8Rz7Tq2Vs6Wy1Xa3Bc5De7Fg9Hi0Jk2Lm4No6Pq8Rs0Tu2Vw4';
const EMAIL = 'reader.name@example.com';

const clean = (lines, label) => {
  const text = lines.join('\n');
  const hits = findIdentifiers(text);
  assert.deepEqual(hits, [], `${label} printed ${hits.map((h) => h.kind).join(', ')}:\n${mask(text)}`);
  for (const secret of [UID_A, UID_B, TOKEN_A, TOKEN_B, 'sub_1Qx', 'SUB_paystack', 'k-token-a', 'ticket-']) {
    assert.ok(!text.includes(secret), `${label} printed ${secret}`);
  }
  return text;
};

// ── an admin-SDK-shaped database over a plain object ─────────────────────────────────────
function memoryDb(initial) {
  const root = structuredClone(initial);
  const walk = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
  const setPath = (p, v) => {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    for (const k of parts.slice(0, -1)) node = node[k] ??= {};
    if (v === null || v === undefined) delete node[parts.at(-1)]; else node[parts.at(-1)] = structuredClone(v);
  };
  const ref = (p = '') => ({
    key: p.split('/').filter(Boolean).at(-1) ?? null,
    get: async () => ({ val: () => structuredClone(walk(p) ?? null), exists: () => walk(p) != null }),
    once: async () => ({ val: () => structuredClone(walk(p) ?? null) }),
    set: async (v) => setPath(p, v),
    remove: async () => setPath(p, null),
    update: async (u) => { for (const [k, v] of Object.entries(u)) setPath(p ? `${p}/${k}` : k, v); },
    transaction: async (fn) => {
      const next = fn(structuredClone(walk(p) ?? null));
      if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(walk(p) ?? null) } };
      setPath(p, next);
      return { committed: true, snapshot: { val: () => structuredClone(next) } };
    },
  });
  return { root, ref };
}

// ── 1. the guard ─────────────────────────────────────────────────────────────────────────
describe('W12 · the guard knows a reader when it sees one', () => {
  test('account IDs, push tokens and emails are found and masked, wherever they sit', () => {
    for (const [s, kind] of [
      [`users/${UID_A}`, 'account ID'], [`deleted-live-${UID_B}:`, 'account ID'], [`[scrub] ${UID_A}: done`, 'account ID'],
      [TOKEN_A, 'push token'], [`"${TOKEN_B}" is not a registered push notification recipient`, 'push token'],
      [FCM, 'push token'], [`mail ${EMAIL}.`, 'email'],
    ]) {
      assert.ok(findIdentifiers(s).some((h) => h.kind === kind), `${kind} in ${s}`);
      assert.deepEqual(findIdentifiers(mask(s)), [], `masked: ${mask(s)}`);
    }
  });
  test('the house\'s ordinary output passes untouched', () => {
    for (const s of [
      '✓ the-quick-brown-fox-jumps-over-the-lazy-dog  editorial  44px×2  3f9a1c2b4d5e',
      'sha 3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c · sha256 ' + 'ab'.repeat(32),
      '      -OabcDEFghiJKLmn…  3 replies  12.4h old', 'run 36210054500-4242-1790384253181',
      'cs-shell-v1234abcdEFGH', 'story/you: sent to 12 device(s) — 11 ok, 1 dead, 0 error(s)',
      '[scrub] del-0a1b2c3d: 42 paths, 3 counters — {"comments":2}', 'emailed: [launch] all green (4f1c2e9a-3b7d-4e8f-9a0b-1c2d3e4f5a6b)',
      'last ran 2026-09-26 01:05 London (12 min ago); stale after 45 min', '@rebel is reserved',
      '{"notificationsInOthersInboxes":0,"threadRepliesByOthers":1}',
    ]) assert.deepEqual(findIdentifiers(s), [], s);
  });
  test('log-guard.mjs masks before printing and fails the step; clean output passes and exits 0', () => {
    const dirty = spawnSync(process.execPath, ['scripts/ops/log-guard.mjs'], { input: `ok\n[scrub] ${UID_A}: done\nsent to ${TOKEN_A}\n` });
    assert.equal(dirty.status, 1);
    const out = dirty.stdout.toString();
    assert.ok(!out.includes(UID_A) && !out.includes(TOKEN_A), out);
    assert.match(out, /‹account ID›/);
    assert.match(out, /::error::\[log-guard\] masked 1 account ID, 1 push token/);
    const ok = spawnSync(process.execPath, ['scripts/ops/log-guard.mjs'], { input: 'nothing to see\n[scrub] APPLIED: {"pending":0}\n' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout.toString(), 'nothing to see\n[scrub] APPLIED: {"pending":0}\n');
  });
});

// ── 2. the wiring ────────────────────────────────────────────────────────────────────────
describe('W12 · every scheduled job speaks through the guard', () => {
  const WF = '.github/workflows';
  const scheduled = readdirSync(WF).filter((f) => f.endsWith('.yml'))
    .map((f) => [f, yaml.load(readFileSync(`${WF}/${f}`, 'utf8'))])
    .filter(([, d]) => d.on?.schedule || d[true]?.schedule);   // js-yaml reads a bare `on:` as true
  test('there are scheduled workflows to check (the list is not silently empty)', () => {
    assert.ok(scheduled.length >= 8, scheduled.map(([f]) => f).join(', '));
  });
  // The one exception, by name: the launch check's clock gate prints a cron label and a boolean,
  // reads no data, and its output is parsed by grep into $GITHUB_OUTPUT.
  const EXEMPT = /node scripts\/launch-check-gate\.mjs/;
  for (const [file, doc] of scheduled) {
    test(`${file}: every live script's output is piped through log-guard under bash`, () => {
      let guarded = 0;
      for (const job of Object.values(doc.jobs)) {
        for (const step of job.steps || []) {
          const run = String(step.run || '');
          for (const line of run.split('\n')) {
            if (!/\bnode scripts\//.test(line) || /^\s*echo\b/.test(line) || EXEMPT.test(line)) continue;
            assert.match(line, /2>&1 \| node scripts\/ops\/log-guard\.mjs/, `${file} → "${step.name}": ${line.trim()}`);
            assert.equal(step.shell, 'bash', `${file} → "${step.name}" needs shell: bash (pipefail)`);
            guarded++;
          }
        }
      }
      assert.ok(guarded > 0, `${file} runs no guarded script`);
    });
  }
});

// ── 3. the scripts ───────────────────────────────────────────────────────────────────────
describe('W12 · the scripts print counts, never a reader', () => {
  test('the account scrub: a pending deletion, one still waiting, a stub, a live subscription', async () => {
    const UID_C = 'Pw8Ty2Ui4Op6As8Df0Gh2Jk4Lz6X';
    const db = memoryDb({
      deletions: {
        [UID_A]: { uid: UID_A, requestedAt: 1, steps: { membership: 1, owned: 1, storage: 1, auth: 1 } },
        [UID_B]: { uid: UID_B, requestedAt: 2, steps: { membership: 1 } },
        [UID_C]: { uid: UID_C, requestedAt: 3, steps: { auth: 1, scrub: 1 }, completedAt: 4 },
      },
      users: { [UID_C]: { membership: { tier: 'gold' } } },
      memberships: { [UID_A]: { status: 'active', rail: 'stripe', stripeSubscriptionId: 'sub_1QxSECRETREF' } },
      comments: { 'a-story': { c1: { authorUid: UID_A, text: 'hi', userEmail: EMAIL }, c2: { authorUid: UID_B, parentId: 'c1', text: 'reply' } } },
      usernames: { rebel: UID_A },
    });
    const lines = [];
    const summary = await runScrub(db, { apply: true, now: () => 1790000000000, log: (s) => lines.push(s) });
    assert.equal(summary.scrubbed, 1);
    assert.equal(summary.stubs, 1);
    assert.equal(summary.billing, 1);
    const text = clean(lines, 'the scrub');
    assert.ok(!text.includes('sub_1QxSECRETREF'), 'no provider reference');
    // Every record it mentioned now carries a random tag, and that tag is what the log shows.
    for (const uid of [UID_A, UID_B, UID_C]) {
      const ref = db.root.deletions[uid].logRef;
      assert.match(ref, LOG_REF_RE, uid);
      assert.ok(text.includes(ref), `the log names ${ref}`);
    }
    // The tag is stable: a second run prints the same one.
    const again = [];
    db.root.users[UID_C] = { back: true };
    await runScrub(db, { apply: true, now: () => 1790000001000, log: (s) => again.push(s) });
    assert.ok(again.join('\n').includes(db.root.deletions[UID_C].logRef));
    clean(again, 'the scrub, second run');
    // The private record still holds everything a human needs.
    assert.equal(db.root.ops.money_failures[`deleted-live-${UID_A}`].ref, 'sub_1QxSECRETREF');
  });

  test('a report-only scrub has nothing to tag with, so it counts', async () => {
    const db = memoryDb({ deletions: { [UID_B]: { uid: UID_B, steps: {} } } });
    const lines = [];
    await runScrub(db, { apply: false, log: (s) => lines.push(s) });
    assert.match(clean(lines, 'the report-only scrub'), /record #1 \(untagged\)/);
    assert.equal(db.root.deletions[UID_B].logRef, undefined, 'a report-only run writes nothing');
  });

  test('the push announcer: failed tickets, failed receipts, a byline — none of it printed', async () => {
    const NOW = Date.parse('2026-09-26T12:00:00Z');
    const D = 86400000;
    const tok = (t) => ({ token: t, platform: 'ios', appVersion: '1.0.0', updatedAt: NOW - D });
    const db = memoryDb({
      ops: { push_announcer: { seededAt: NOW - 30 * D } },
      cms_stories: { 'a-new-one': { title: 'A New One', author: 'Reader Writer', category: 'short', subcategory: 'Drama', published: true, publishedAtMs: NOW - 3600000 } },
      cms_stories_index: { 'a-new-one': { title: 'A New One', author: 'Reader Writer', category: 'short', published: true, publishedAtMs: NOW - 3600000 } },
      push_tokens: { [UID_A]: { 'k-token-a': tok(TOKEN_A) }, [UID_B]: { 'k-token-b': tok(TOKEN_B) } },
      push_receipts: { 'ticket-old-1': { uid: UID_A, tokenKey: 'k-token-a', at: NOW - 2 * D } },
    });
    const expo = {
      async sendBatch(msgs) {
        return msgs.map((m) => (m.to === TOKEN_A
          ? { status: 'error', message: `"${TOKEN_A}" is not a registered push notification recipient`, details: {} }
          : { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } }));
      },
      async getReceipts(ids) {
        return Object.fromEntries(ids.map((id) => [id, { status: 'error', message: `"${TOKEN_B}" failed`, details: { error: 'MessageTooBig' } }]));
      },
    };
    const lines = [];
    await runAnnouncer(db, expo, NOW, { apply: true, runId: 'test', log: (s) => lines.push(s), pause: async () => {} });
    const text = clean(lines, 'the push announcer');
    assert.match(text, /ticket errors: .*×1/);
    assert.match(text, /receipt errors: MessageTooBig ×1/);
    assert.ok(!text.includes('Reader Writer'), 'the byline is not printed');
  });

  test('errorTally keeps codes and masks free text', () => {
    const t = errorTally([{ error: 'DeviceNotRegistered' }, { error: 'DeviceNotRegistered' }, { error: `"${TOKEN_A}" is not registered` }]);
    assert.match(t, /DeviceNotRegistered ×2/);
    assert.deepEqual(findIdentifiers(t), []);
  });

  test('the launch check\'s Signals row counts money failures and never names one', () => {
    const now = Date.parse('2026-09-30T08:05:00Z');
    const row = judgeSignals({
      moneyFailures: { [`deleted-live-${UID_A}`]: { lastAt: now }, 'webhook-sub_1QxSECRETREF': { lastAt: now } },
      publishSkips: {}, since: now - 3600000,
    });
    assert.match(row.evidence, /2 new unresolved money failure\(s\) \(see ops\/money_failures\)/);
    clean([row.evidence], 'the launch check');
  });
});
