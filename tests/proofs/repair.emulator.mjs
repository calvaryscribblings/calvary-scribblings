// PROOFS-R3.1 — scripts/proofs/repair-failed-open.mjs against a COPY of the failed state, on the
// database and storage emulators (the SAFETY-1 guard backs up to the storage emulator here).
//
// The copy has production's shape and counts, with invented ids: 4 openings and 17 story entries,
// all written by one call at one instant inside 2 Nov 2026 21:58:29 UTC, exactly as the R3 build's
// claimOpening wrote them (create-only { at, by, stories, sent:false } and seedRecord()).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// No install(): the guard talks to the database and storage emulators directly, which the harness's
// fetch stand-in would refuse. get/set/loadRules use the emulator directly too.
import { loadRules, wipe, get, set, NS } from './harness.mjs';
import { planRepair, runRepair, FAILED_SECOND } from '../../scripts/proofs/repair-failed-open.mjs';
import { seedRecord } from '../../app/lib/proofMail.js';

process.env.GUARD_DB_NAMESPACE = NS;
const T = Date.parse(FAILED_SECOND) + 412;   // one instant inside the failed second
const D = 864e5;
const W = ['repairWriterA', 'repairWriterB', 'repairWriterC', 'repairWriterD'];
const PER = [7, 6, 4, 0];                    // 17 seeded; the fourth writer had no stories
const FOUNDER = 'repairStandInFounder';

function failedState() {
  const writers = {};
  W.forEach((uid, i) => {
    const stories = {};
    for (let j = 0; j < PER[i]; j++) stories[`rp-${i}-${j}`] = seedRecord({ slug: `rp-${i}-${j}`, goLiveMs: T + (j + 3) * D }, T);
    writers[uid] = { opening: { at: T, by: FOUNDER, stories: PER[i] + (i === 2 ? 2 : 0), sent: false }, ...(PER[i] ? { stories } : {}) };
  });
  return writers;
}
const quiet = () => { const lines = []; return { lines, log: (s) => lines.push(s) }; };

before(async () => { await loadRules(); });

describe('the repair of the failed Open', () => {
  beforeEach(async () => {
    await wipe();
    await set('proofs_mail/writers', failedState());
    await set('proofs_access', { open: false, changedAt: T - D, changedBy: FOUNDER });
    await set('cms_stories/rp-0-0', { title: 'Untouched', published: false });
  });

  test('the plan, on the failed state: exactly 21 paths (4 openings, 17 story entries), no refusal', async () => {
    const p = planRepair({ writers: await get('proofs_mail/writers') }, await get('proofs_access'));
    assert.deepEqual(p.refusals, []);
    assert.equal(p.paths.length, 21);
    assert.equal(p.paths.filter((x) => x.endsWith('/opening')).length, 4);
  });

  test('the dry run writes nothing and says so, in counts only', async () => {
    const before = JSON.stringify(await get(''));
    const { lines, log } = quiet();
    const r = await runRepair({ argv: ['node', 'x'], log });
    assert.equal(r.ok, true);
    assert.equal(r.applied, false);
    assert.equal(r.paths, 21);
    assert.equal(JSON.stringify(await get('')), before, 'nothing changed');
    const text = lines.join('\n');
    assert.match(text, /openings=4 storyEntries=17 → 21 paths/);
    for (const bad of [...W, 'rp-0', FOUNDER, '@']) assert.ok(!text.includes(bad), `the log carried ${bad}`);
  });

  test('it refuses, writing nothing, on a send, a failure reason, a status, another timestamp, an open switch, a queue, or a wrong count', async () => {
    const cases = [
      ['a sent opening', (s) => { s[W[0]].opening.sent = true; }],
      ['an emailId', (s) => { s[W[1]].opening.emailId = 'x'; }],
      ['a failure reason', (s) => { s[W[1]].opening.why = 'resend_500'; }],
      ['an R3.1 status', (s) => { s[W[0]].opening.status = 'sending'; }],
      ['another timestamp', (s) => { s[W[3]].opening.at = T + 2000; }],
      ['a story told at another instant', (s) => { s[W[0]].stories['rp-0-1'].toldAt = T + 1; s[W[0]].stories['rp-0-1'].log.e1.at = T + 1; }],
      ['a story email that went', (s) => { s[W[0]].stories['rp-0-2'].kind = 'scheduled'; }],
      ['a fifth opening', (s) => { s.repairWriterE = { opening: { at: T, by: FOUNDER, stories: 0, sent: false } }; }],
      ['an excluded writer', (s) => { s.repairWriterF = { excluded: { at: T, by: FOUNDER } }; }],
    ];
    for (const [label, change] of cases) {
      const s = failedState(); change(s);
      await set('proofs_mail/writers', s);
      const before = JSON.stringify(await get(''));
      const { lines, log } = quiet();
      const r = await runRepair({ argv: ['node', 'x', '--apply'], log });
      assert.equal(r.ok, false, `${label}: should refuse`);
      assert.ok(lines.some((l) => l.includes('REFUSED')), label);
      assert.equal(JSON.stringify(await get('')), before, `${label}: nothing written`);
    }
    await set('proofs_mail/writers', failedState());
    await set('proofs_access/open', true);
    assert.equal((await runRepair({ argv: ['node', 'x', '--apply'], log: () => {} })).ok, false, 'Proofs open');
    await set('proofs_access/open', false);
    await set('proofs_mail/queue/repairWriterA', { at: T, by: FOUNDER });
    assert.equal((await runRepair({ argv: ['node', 'x', '--apply'], log: () => {} })).ok, false, 'a queue');
  });

  test('--apply (emulator): backs up, deletes exactly the 21, verifies; everything else is untouched', async () => {
    await set('proofs_mail/writers/repairWriterD/notes', { keep: true });   // something the run did NOT write
    const { lines, log } = quiet();
    const r = await runRepair({ argv: ['node', 'x', '--apply'], log });
    assert.equal(r.ok, true, lines.join('\n'));
    assert.equal(r.applied, true);
    const after = await get('proofs_mail/writers');
    assert.deepEqual(after, { repairWriterD: { notes: { keep: true } } }, 'only what the failed run wrote is gone');
    assert.deepEqual(await get('cms_stories/rp-0-0'), { title: 'Untouched', published: false });
    assert.ok(lines.some((l) => /verify: 21\/21 deleted, rest of proofs_mail unchanged/.test(l)));
    assert.ok(lines.some((l) => /backup|gs:\/\//i.test(l)), 'the guard reported its backup');
  });
});
