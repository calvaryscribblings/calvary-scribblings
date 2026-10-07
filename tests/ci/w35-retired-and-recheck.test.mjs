// W35 — offline halves of the round. The emulator halves are tests/rules/retired.test.mjs (the
// rules and the 30 Sep replay) and tests/series/release-recheck.spec.mjs (a page opening at
// its release minute without a reload).
//
//   node --test tests/ci/w35-retired-and-recheck.test.mjs      (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planRecheck, MAX_TIMEOUT_MS, MAX_STEP_MS, RECHECK_SLACK_MS, RETRY_BASE_MS, RETRY_CAP_MS, MAX_RETRIES,
} from '../../app/lib/series/releaseRecheck.js';
import { isRetired, retiredNotice, BOOK_READER_REASON, BOOK_READER_PULLED } from '../../app/lib/retiredStories.js';
import { storiesInScope } from '../../scripts/covers/store.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('W35 · planRecheck — when an open Series page asks again', () => {
  const NOW = 1_800_000_000_000;
  test('nothing pending, nothing armed', () => {
    assert.equal(planRecheck([], NOW), null);
    assert.equal(planRecheck([NaN, null, undefined], NOW), null);
  });
  test('a release two minutes away: one timer, at the instant plus the slack', () => {
    assert.deepEqual(planRecheck([NOW + 120_000], NOW), { delay: 120_000 + RECHECK_SLACK_MS, fire: true });
  });
  test('several pending: the EARLIEST future one', () => {
    assert.equal(planRecheck([NOW + 9e6, NOW + 60_000, NOW + 5e6], NOW).delay, 60_000 + RECHECK_SLACK_MS);
  });
  test('⛔ a release weeks away never overflows setTimeout — it is approached in day-long steps that do not reload', () => {
    for (const far of [25 * 864e5, 40 * 864e5, 365 * 864e5, 10 * 365 * 864e5]) {
      const plan = planRecheck([NOW + far], NOW);
      assert.equal(plan.fire, false, 'a step, not a reload');
      assert.equal(plan.delay, MAX_STEP_MS);
      assert.ok(plan.delay <= MAX_TIMEOUT_MS, 'within the 32-bit limit');
    }
  });
  test('past the instant but still drawn unreleased (device clock ahead): a bounded backoff', () => {
    const seen = [];
    for (let r = 0; r < MAX_RETRIES; r++) seen.push(planRecheck([NOW - 1000], NOW, r).delay);
    assert.equal(seen[0], RETRY_BASE_MS);
    assert.ok(seen.every((d, i) => i === 0 || d >= seen[i - 1]), 'never shrinks');
    assert.ok(seen.every((d) => d <= RETRY_CAP_MS), 'capped');
    assert.equal(planRecheck([NOW - 1000], NOW, MAX_RETRIES), null, 'and stops — a visible tab still re-asks');
  });
  test('an overdue retry and a near future release: whichever comes first', () => {
    assert.equal(planRecheck([NOW - 1, NOW + 2000], NOW, 0).delay, 2000 + RECHECK_SLACK_MS);
    assert.equal(planRecheck([NOW - 1, NOW + 9e6], NOW, 0).delay, RETRY_BASE_MS);
  });
});

describe('W35 · every Series surface that draws "not arrived" re-checks', () => {
  const SURFACES = [
    ['app/series/instalment/[instalmentId]/page-instalment.js', 'page.reload'],
    ['app/series/[slug]/page-detail.js', 'page.reload'],
    ['app/series/page.js', 'shelf.reload'],
    ['app/series/read/[instalmentId]/page-reader.js', 'fetchUrl'],
    ['app/public-library/page.js', 'setRecheck'],
  ];
  for (const [file, again] of SURFACES) {
    test(`${file} → useReleaseRecheck(…, ${again})`, () => {
      const src = read(file);
      assert.match(src, /import \{ useReleaseRecheck \} from '[./]+lib\/series\/releaseRecheck'/);
      const call = src.slice(src.indexOf('useReleaseRecheck('));
      assert.ok(call.slice(0, 400).includes(again), `${file} must re-run its own read`);
    });
  }
  test('the hook listens for the tab coming back', () => {
    assert.match(read('app/lib/series/releaseRecheck.js'), /addEventListener\('visibilitychange'/);
  });
});

describe('W35 · retired stories — the offline guards', () => {
  test('the list is the ten records from the R12.1 pull, by evidence', () => {
    assert.equal(BOOK_READER_PULLED.length, 10);
    for (const s of ['beta-princess', 'beta-princess-part-two', 'diary-of-a-lagos-9-5er-1', 'filtered-reality']) {
      assert.ok(BOOK_READER_PULLED.includes(s), s);
    }
  });
  test('the CMS line, verbatim', () => {
    assert.equal(retiredNotice({ reason: BOOK_READER_REASON }),
      'Retired with the Book Reader collection on 16 August. It can’t be published from here.');
    assert.ok(retiredNotice({ reason: 'later' }));
    assert.equal(retiredNotice(null), null);
  });
  test('isRetired ignores prototype keys', () => {
    assert.equal(isRetired({}, 'constructor'), false);
    assert.equal(isRetired(null, 'x'), false);
    assert.equal(isRetired({ x: { reason: 'r' } }, 'x'), true);
  });
  test('storiesInScope: retired first, held or published', () => {
    const all = {
      a: { published: true, title: 'A' },
      b: { published: false, coverHold: true, title: 'B' },
      c: { published: true, title: 'C' },
      d: { published: false, coverHold: true, title: 'D' },
      e: { published: false, title: 'E' },
    };
    const { stories, skippedRetired } = storiesInScope(all, { c: { reason: 'r' }, d: { reason: 'r' }, e: { reason: 'r' } });
    assert.deepEqual(stories.map((s) => s.slug), ['a', 'b']);
    assert.deepEqual(skippedRetired, ['c', 'd'], 'only records that would otherwise have been in scope are logged');
  });
  test('the reconciler reads the retired node and FAILS CLOSED when it cannot', () => {
    const src = read('scripts/covers/on-publish.mjs');
    assert.match(src, /storiesInScope\(all, await rr\.json\(\)\)/);
    assert.match(src, /if \(!rr\.ok\) throw new Error/);
    assert.doesNotMatch(src, /\.filter\(\(\[, s\]\) => isIndexed\(s\) \|\| s\?\.coverHold === true\)/, 'the old unguarded selection is gone');
  });
  test('the CMS refuses save, unhide and delete on a retired record, and draws it read-only', () => {
    const src = read('app/admin/page.js');
    for (const fn of ['const saveStory = async () => {', 'async function unhideStory(id) {', 'async function deleteStory(id) {']) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 200);
      assert.match(body, /isRetired\(retired, (editingId|id)\)/, `${fn} must check the retired list first`);
    }
    assert.match(src, /\{!retired && \(\s*<button style=\{\{ \.\.\.s\.btn/, 'no save button on a retired record');
    assert.match(src, /\{hidden && !retired && \(/, 'no Unhide in the editor on a retired record');
    assert.match(src, /isRetiredStory \|\| heldForCover \? null/, 'no Hide/Unhide in the list');
  });
  test('the rules carry the guard on both nodes, and the marker is unwritable', () => {
    const r = JSON.parse(read('database.rules.json')).rules;
    assert.equal(r.cms_stories_retired['.write'], false);
    assert.match(r.cms_stories.$slug['.validate'], /cms_stories_retired/);
    assert.match(r.cms_stories.$slug['.validate'], /hiddenAt/);
    assert.match(r.cms_stories_index.$slug['.validate'], /cms_stories_retired/);
  });
});
