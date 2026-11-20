// CLOCK-5 — the launch check's Covers row counts every run that WROTE over the library, not only
// GitHub's schedule. On fixtures only: no production read, no Actions call.
//
//   node --test tests/ci/clock-5.test.mjs          (npm run test:ci)
//
// 1. covers.yml's run-name, EVALUATED for each kind of run (the workflow's own expression, run
//    here under GitHub's semantics), against COVERS_WRITE_TITLE.
// 2. reconcileWrote: schedule, the clock's dispatch and a manual apply count; a dry run, a
//    one-title run, a push, a PR and a pre-CLOCK-5 dispatch titled "covers" do not.
// 3. lastReconcileOkFrom over a runs list: the newest qualifying run whose reconcile job succeeded,
//    a dry run skipped even when it is newer, a failed reconcile skipped, NaN when nothing counts.
// 4. The row's evidence stays a time and a count.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import {
  COVERS_WRITE_TITLE, reconcileWrote, lastReconcileOkFrom, judgeCovers, GREEN, RED,
} from '../../scripts/launch-check.mjs';
import { SCHEDULES } from '../../workers-external/calvary-clock/clock.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-11-19T08:05:00Z');
const iso = (mins) => new Date(NOW + mins * MIN).toISOString();
const src = readFileSync(new URL('../../.github/workflows/covers.yml', import.meta.url), 'utf8');
const doc = YAML.parse(src);

// ── GitHub's expression language, as much of it as the run-name uses ─────────────────────────
// `&&` and `||` return an operand (as in JS); `==` / `!=` compare strings case-insensitively and
// coerce null to '' for this comparison; format() substitutes {n}. Anything else in the
// expression makes this throw, so the run-name cannot grow a construct this does not model.
function evalRunName(expr, github) {
  const m = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expr.trim());
  assert.ok(m, 'run-name is one ${{ }} expression');
  const body = m[1];
  const leftover = body
    .replace(/'(?:[^']|'')*'/g, '')
    .replace(/github\.event_name|github\.event\.inputs\.(apply|slug)/g, '')
    .replace(/format|==|!=|&&|\|\||[(),\s]/g, '');
  assert.equal(leftover, '', `run-name uses something this evaluator does not model: ${leftover}`);
  const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  const format = (f, ...a) => f.replace(/\{(\d+)\}/g, (_, i) => String(a[+i]));
  const js = body
    .replace(/'((?:[^']|'')*)'/g, (_, s) => JSON.stringify(s.replace(/''/g, "'")))
    .replace(/github\.event\.inputs\.(apply|slug)/g, (_, k) => `inputs.${k}`)
    .replace(/github\.event_name/g, 'event_name');
  // turn `a == b` / `a != b` into eq() calls; operands here are simple tokens
  const tok = String.raw`(inputs\.\w+|event_name|"(?:[^"\\]|\\.)*")`;
  const withEq = js
    .replace(new RegExp(`${tok}\\s*==\\s*${tok}`, 'g'), 'eq($1, $2)')
    .replace(new RegExp(`${tok}\\s*!=\\s*${tok}`, 'g'), '!eq($1, $2)');
  // eslint-disable-next-line no-new-func
  return new Function('eq', 'format', 'event_name', 'inputs', `return (${withEq});`)(
    eq, format, github.event_name, github.inputs || {},
  );
}
const titleFor = (event_name, inputs) => evalRunName(doc['run-name'], { event_name, inputs });

describe('CLOCK-5 · covers.yml names each run by what it did', () => {
  test('the clock\'s dispatch is a write over the library', () => {
    const clock = SCHEDULES.find((s) => s.workflow === 'covers.yml');
    assert.equal(titleFor('workflow_dispatch', { ...clock.inputs, slug: '' }), COVERS_WRITE_TITLE);
    // the clock sends no slug at all; GitHub fills an input with no default as empty
    assert.equal(titleFor('workflow_dispatch', { apply: clock.inputs.apply }), COVERS_WRITE_TITLE);
  });
  test('a manual dispatch with apply ticked is a write; unticked is a dry run', () => {
    assert.equal(titleFor('workflow_dispatch', { apply: 'true', slug: '' }), COVERS_WRITE_TITLE);
    assert.equal(titleFor('workflow_dispatch', { apply: 'false', slug: '' }), 'covers · dry run · library');
  });
  test('a one-title run says so, and the title never carries the slug', () => {
    const slug = 'some-unreleased-title';
    const t = titleFor('workflow_dispatch', { apply: 'true', slug });
    assert.equal(t, 'covers · apply · one title');
    assert.ok(!t.includes(slug));
    assert.equal(titleFor('workflow_dispatch', { apply: 'false', slug }), 'covers · dry run · one title');
  });
  test('schedule, push and PR runs are named by their event', () => {
    for (const e of ['schedule', 'push', 'pull_request']) assert.equal(titleFor(e, {}), `covers · ${e}`);
  });
  test('the title reads the same input the reconcile step does', () => {
    assert.match(doc['run-name'], /github\.event\.inputs\.apply == 'true'/);
    const step = doc.jobs.reconcile.steps.find((s) => s.name === 'on-publish');
    assert.equal(step.env.IN_APPLY, '${{ github.event.inputs.apply }}');
    assert.match(step.run, /\[ "\$EVENT_NAME" = "schedule" \] \|\| \[ "\$IN_APPLY" = "true" \]/);
    assert.equal(doc.jobs.reconcile.name, 'reconcile covers');
  });
});

describe('CLOCK-5 · which runs count', () => {
  const d = (display_title) => ({ event: 'workflow_dispatch', display_title });
  test('counted: GitHub\'s schedule, the clock\'s dispatch, a manual apply', () => {
    assert.equal(reconcileWrote({ event: 'schedule', display_title: 'covers · schedule' }), true);
    assert.equal(reconcileWrote({ event: 'schedule', display_title: 'covers' }), true, 'a schedule run from before CLOCK-5');
    assert.equal(reconcileWrote(d(titleFor('workflow_dispatch', { apply: 'true', clock: '*/15 * * * *' }))), true);
    assert.equal(reconcileWrote(d(titleFor('workflow_dispatch', { apply: 'true', slug: '' }))), true);
  });
  test('not counted: a dry run, a one-title run, a push, a PR, an old untitled dispatch', () => {
    assert.equal(reconcileWrote(d(titleFor('workflow_dispatch', { apply: 'false', slug: '' }))), false, 'dry run');
    assert.equal(reconcileWrote(d(titleFor('workflow_dispatch', { apply: 'true', slug: 'x' }))), false, 'one title');
    assert.equal(reconcileWrote({ event: 'push', display_title: titleFor('push', {}) }), false);
    assert.equal(reconcileWrote({ event: 'pull_request', display_title: titleFor('pull_request', {}) }), false);
    assert.equal(reconcileWrote(d('covers')), false, 'before the run-name, a dispatch cannot say whether it wrote');
    assert.equal(reconcileWrote(null), false);
  });
});

describe('CLOCK-5 · the newest run that reconciled', () => {
  const ok = (mins) => [{ name: 'verify', conclusion: 'success' }, { name: 'reconcile covers', conclusion: 'success', completed_at: iso(mins) }];
  const failed = (mins) => [{ name: 'reconcile covers', conclusion: 'failure', completed_at: iso(mins) }];
  const run = (id, event, display_title, mins) => ({ id, event, display_title, updated_at: iso(mins) });
  const lookup = (table) => { const seen = []; return { seen, jobsOf: async (r) => { seen.push(r.id); return table[r.id]; } }; };

  test('the clock\'s dispatch counts: the 18–19 Nov case reads fresh', async () => {
    const runs = [
      run(3, 'workflow_dispatch', COVERS_WRITE_TITLE, -4),
      run(2, 'workflow_dispatch', COVERS_WRITE_TITLE, -19),
      run(1, 'schedule', 'covers', -415),
    ];
    const { jobsOf, seen } = lookup({ 3: ok(-4), 2: ok(-19), 1: ok(-415) });
    const at = await lastReconcileOkFrom(runs, jobsOf);
    assert.equal(at, NOW - 4 * MIN);
    assert.deepEqual(seen, [3], 'stops at the first that counts');
    assert.equal(judgeCovers({ lastReconcileOkAt: at, held: { count: 0 } }, NOW).status, GREEN);
  });
  test('a manual DRY RUN, even the newest, is passed over without a lookup', async () => {
    const runs = [
      run(4, 'workflow_dispatch', 'covers · dry run · library', -1),
      run(3, 'push', 'covers · push', -2),
      run(2, 'workflow_dispatch', 'covers · apply · one title', -3),
      run(1, 'workflow_dispatch', COVERS_WRITE_TITLE, -30),
    ];
    const { jobsOf, seen } = lookup({ 4: ok(-1), 3: ok(-2), 2: ok(-3), 1: ok(-30) });
    assert.equal(await lastReconcileOkFrom(runs, jobsOf), NOW - 30 * MIN);
    assert.deepEqual(seen, [1]);
  });
  test('a manual apply counts, and so does GitHub\'s schedule', async () => {
    const manual = [run(1, 'workflow_dispatch', titleFor('workflow_dispatch', { apply: 'true', slug: '' }), -7)];
    assert.equal(await lastReconcileOkFrom(manual, lookup({ 1: ok(-7) }).jobsOf), NOW - 7 * MIN);
    const sched = [run(1, 'schedule', 'covers · schedule', -12)];
    assert.equal(await lastReconcileOkFrom(sched, lookup({ 1: ok(-12) }).jobsOf), NOW - 12 * MIN);
  });
  test('a failed reconcile is skipped for the one before it', async () => {
    const runs = [run(2, 'workflow_dispatch', COVERS_WRITE_TITLE, -3), run(1, 'schedule', 'covers', -20)];
    assert.equal(await lastReconcileOkFrom(runs, lookup({ 2: failed(-3), 1: ok(-20) }).jobsOf), NOW - 20 * MIN);
  });
  test('only dry runs, or nothing at all: NaN, and the row is red', async () => {
    const runs = [run(1, 'workflow_dispatch', 'covers · dry run · library', -1)];
    const at = await lastReconcileOkFrom(runs, lookup({ 1: ok(-1) }).jobsOf);
    assert.ok(Number.isNaN(at));
    assert.ok(Number.isNaN(await lastReconcileOkFrom([], async () => [])));
    assert.ok(Number.isNaN(await lastReconcileOkFrom(null, async () => [])));
    assert.equal(judgeCovers({ lastReconcileOkAt: at, held: { count: 0 } }, NOW).status, RED);
  });
  test('lookups are bounded', async () => {
    const runs = Array.from({ length: 40 }, (_, i) => run(i, 'workflow_dispatch', COVERS_WRITE_TITLE, -i));
    const table = Object.fromEntries(runs.map((r) => [r.id, failed(0)]));
    const { jobsOf, seen } = lookup(table);
    assert.ok(Number.isNaN(await lastReconcileOkFrom(runs, jobsOf, { maxLookups: 5 })));
    assert.equal(seen.length, 5);
  });
  test('a job with no completed_at falls back to the run\'s time', async () => {
    const runs = [run(1, 'schedule', 'covers', -9)];
    assert.equal(await lastReconcileOkFrom(runs, async () => [{ name: 'reconcile covers', conclusion: 'success' }]), NOW - 9 * MIN);
  });
});

describe('CLOCK-5 · the evidence is a time and a count', () => {
  test('nothing but a timestamp, minutes, and a held count', () => {
    const r = judgeCovers({ lastReconcileOkAt: NOW - 4 * MIN, held: { count: 0 } }, NOW);
    assert.equal(r.evidence.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/, 'T').replace(/\d+/g, 'N'),
      'last successful reconcile T (N min ago); none held for a cover within N h');
  });
});
