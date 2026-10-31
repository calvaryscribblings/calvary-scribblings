// PROOFS — the pure rules of app/lib/proofs.js. No network, no emulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProof, maySee, groupByWriter, londonWhen, reportFault, goLiveMs, PROOFS_COPY, REPORT_STATUSES } from '../../app/lib/proofs.js';
import { impersonalityFault } from '../../functions/api/_alerts.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const at = (ms) => new Date(ms).toISOString();

test('a proof is exactly a scheduled story', () => {
  assert.equal(isProof({ published: false, publishAt: at(NOW + 1) }, NOW), true);
  assert.equal(isProof({ published: true, publishAt: at(NOW + 1) }, NOW), false, 'live');
  assert.equal(isProof({ publishAt: at(NOW + 1) }, NOW), false, 'published absent = live');
  assert.equal(isProof({ published: false, publishAt: at(NOW - 1) }, NOW), false, 'time passed');
  assert.equal(isProof({ published: false, publishAt: at(NOW + 1), hiddenAt: at(NOW) }, NOW), false, 'hidden');
  assert.equal(isProof({ published: false, coverHold: true }, NOW), false, 'held, no date');
  assert.equal(isProof({ published: false }, NOW), false, 'draft');
  assert.equal(isProof(null, NOW), false);
});

test('who may see a proof: its writer by uid, or a founder', () => {
  assert.equal(maySee({ authorUid: 'w' }, 'w'), true);
  assert.equal(maySee({ authorUid: 'w' }, 'x'), false);
  assert.equal(maySee({ authorUid: '' }, ''), false);
  assert.equal(maySee({}, 'x'), false, 'no authorUid: no writer can see it');
  assert.equal(maySee({}, 'x', { founder: true }), true);
  assert.equal(maySee({ authorUid: 'w' }, null, { founder: true }), false, 'no uid, nothing');
});

test('founders’ groups: by writer, soonest first', () => {
  const g = groupByWriter([
    { slug: 'b2', authorUid: 'b', goLiveMs: 5 }, { slug: 'a1', authorUid: 'a', goLiveMs: 3 },
    { slug: 'b1', authorUid: 'b', goLiveMs: 1 }, { slug: 'n', authorUid: null, goLiveMs: 9 },
  ]);
  assert.deepEqual(g.map((x) => [x.authorUid, x.stories.map((s) => s.slug)]), [['b', ['b1', 'b2']], ['a', ['a1']], [null, ['n']]]);
});

test('London time, across the clock change', () => {
  assert.equal(londonWhen(Date.parse('2026-11-01T06:30:00Z')), 'Sunday 1 November at 06:30');      // GMT
  assert.equal(londonWhen(Date.parse('2026-10-24T06:30:00Z')), 'Saturday 24 October at 07:30');    // BST
  assert.equal(PROOFS_COPY.goesLive(londonWhen(Date.parse('2026-11-01T06:30:00Z'))), 'Goes live Sunday 1 November at 06:30, London time');
  assert.equal(goLiveMs({ publishAt: 'nonsense' }), null);
});

test('a report: 10 to 2000 characters after trimming, on a real slug', () => {
  assert.equal(reportFault({ slug: 'a-b', message: '   short   ' }), 'too_short');
  assert.equal(reportFault({ slug: 'a-b', message: 'x'.repeat(2001) }), 'too_long');
  assert.equal(reportFault({ slug: 'a/b', message: 'long enough message' }), 'bad_request');
  assert.equal(reportFault({ slug: 'a-b', message: 42 }), 'too_short');
  assert.equal(reportFault({ slug: 'a-b', message: 'long enough message' }), null);
  assert.deepEqual([...REPORT_STATUSES], ['received', 'fixed', 'left']);
  assert.deepEqual(Object.keys(PROOFS_COPY.status), ['received', 'fixed', 'left']);
});

test('the editors’ email passes the alert service’s own check, and carries no message text', () => {
  const lines = PROOFS_COPY.emailLines({ slug: 'some-story', when: 'Sunday 1 November at 06:30', reportId: '-Nabc' });
  assert.equal(impersonalityFault(`${PROOFS_COPY.emailSubject}\n${lines.join('\n')}`), null);
});
