// W6 — the CMS tells the truth (ADM-04, 05, 06, 07, 10, 24 for app/admin/page.js).
//
// The decisions live in app/lib/storyState.js and app/lib/rebuildWatch.js and are tested as
// functions; the page's use of them is pinned by source assertions, because the page is a
// browser client with no harness of its own.
//
//   node --test tests/ci/w6-cms.test.mjs          (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  storyStatus, statusLine, scheduleRefusal, unscheduleDecision, hidePaths, unhidePlan,
  MIN_SCHEDULE_LEAD_WITHOUT_COVER_MS,
} from '../../app/lib/storyState.js';
import { buildIdOf, waitForNewBuild, rebuildLine } from '../../app/lib/rebuildWatch.js';
import { hasStaticPage } from '../../app/lib/storyAccess.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const PAST = '2026-09-10T06:30:00.000Z';
const FUTURE = '2026-09-27T06:30:00.000Z';
const COVER = 'https://x/covers-typographic/a.webp';
const page = readFileSync('app/admin/page.js', 'utf8');

describe('W6 · one status per story (ADM-07)', () => {
  test('a LIVE story with a past publishAt is live — not scheduled', () => {
    assert.equal(storyStatus({ published: true, publishAt: PAST }, NOW), 'live');
    assert.match(statusLine({ published: true, publishAt: PAST }, NOW), /^Live since /);
  });
  test('scheduled, waiting for its cover, hidden', () => {
    assert.equal(storyStatus({ published: false, publishAt: FUTURE }, NOW), 'scheduled');
    assert.equal(storyStatus({ published: false, coverHold: true }, NOW), 'waiting_cover');
    assert.equal(storyStatus({ published: false, publishAt: PAST, hiddenAt: NOW - 1 }, NOW), 'hidden');
    assert.equal(storyStatus({ published: false }, NOW), 'hidden');
  });
  test('the editor does not offer a schedule to a live story, and the list uses the one status', () => {
    assert.match(page, /const isLiveRecord = form\.recordStatus === 'live';/);
    assert.match(page, /const isScheduled = !!form\.publishAt && !isLiveRecord;/);
    assert.match(page, /const statusOf = st => storyStatus\(st\);/);
    assert.match(page, /\{st === 'live' && <>/, 'View is offered for live stories');
  });
});

describe('W6 · Hide sticks (ADM-04)', () => {
  test('Hide writes hiddenAt beside published:false, and drops the index entry', () => {
    assert.deepEqual(hidePaths('s', NOW), {
      'cms_stories/s/published': false, 'cms_stories/s/hiddenAt': NOW, 'cms_stories_index/s': null,
    });
    assert.match(page, /await update\(ref\(db\), hidePaths\(id\)\);/);
  });
  test('a hidden story keeps no static page, even with a publishAt', () => {
    assert.equal(hasStaticPage({ published: false, publishAt: PAST, hiddenAt: NOW }), false);
    assert.equal(hasStaticPage({ published: false, publishAt: FUTURE }), true, 'a scheduled one still does');
  });
  test('an edit of a hidden story leaves hiddenAt alone; a new schedule or a publish clears it', () => {
    assert.match(page, /if \(unschedule\?\.hide\) storyData\.hiddenAt = Date\.now\(\);/);
    assert.match(page, /else if \(schedulingAhead \|\| \(unschedule && unschedule\.published\) \|\| storyData\.published === true\) storyData\.hiddenAt = null;/);
    assert.match(page, /'descriptor', 'descriptorPending', 'hiddenAt'\]/);
  });
});

describe('W6 · nothing goes live coverless (ADM-05)', () => {
  test('a coverless schedule less than 30 minutes ahead is refused, with the reason', () => {
    const r = scheduleRefusal({ publishAtMs: NOW + 10 * 60000, cover: '/placeholder.jpg', now: NOW });
    assert.match(r, /no cover yet/);
    assert.match(r, /30 minutes/);
    assert.match(r, /\(London\) or later/);
  });
  test('30 minutes or more ahead, or with its cover: allowed', () => {
    assert.equal(scheduleRefusal({ publishAtMs: NOW + MIN_SCHEDULE_LEAD_WITHOUT_COVER_MS, cover: '/p.jpg', now: NOW }), null);
    assert.equal(scheduleRefusal({ publishAtMs: NOW + 5 * 60000, cover: COVER, now: NOW }), null);
  });
  test('the save asks it, before anything is written', () => {
    const i = page.indexOf('const refusal = scheduleRefusal(');
    assert.ok(i > 0 && i < page.indexOf("setSaving(true); setMsg('');", page.indexOf('const saveStory')), 'refused before the write');
  });
  test('unhiding a coverless story HOLDS it instead of publishing it', () => {
    assert.equal(unhidePlan('s', { cover: '/old.jpg' }).live, false);
    assert.equal(unhidePlan('s', { cover: '/old.jpg' }).paths['cms_stories/s/coverHold'], true);
    assert.equal(unhidePlan('s', { cover: COVER }).live, true);
    assert.equal(unhidePlan('s', { cover: COVER }).paths['cms_stories/s/hiddenAt'], null);
  });
});

describe('W6 · un-scheduling says what it does (ADM-06)', () => {
  test('no choice: refused; publish: published; hide: hidden', () => {
    assert.match(unscheduleDecision(null).refusal, /Choose what should happen instead/);
    assert.deepEqual(unscheduleDecision('publish'), { refusal: null, published: true, hide: false });
    assert.deepEqual(unscheduleDecision('hide'), { refusal: null, published: false, hide: true });
  });
  test('the save uses the choice, and the headline names it', () => {
    assert.match(page, /const unschedule = unscheduling \? unscheduleDecision\(form\.unscheduleAs \|\| null\) : null;/);
    assert.match(page, /published: unschedule \? unschedule\.published/);
    assert.match(page, /✓ Unscheduled, and hidden\. It will not publish until you schedule it again or unhide it\./);
    assert.doesNotMatch(page, /'✓ Story updated\.'/);
  });
});

describe('W6 · "Published" only when the site says so (ADM-10)', () => {
  test('the build id is read from the served HTML', () => {
    assert.equal(buildIdOf('…\\"b\\":\\"T3gr1bEvgEFIW4bFnQ0er\\",…'), 'T3gr1bEvgEFIW4bFnQ0er');
    assert.equal(buildIdOf('<html>no id</html>'), null);
  });
  test('waitForNewBuild: live only when a DIFFERENT id is served; a timeout otherwise', async () => {
    let served = 'OLDbuild01';
    const fetchImpl = async () => new Response(`x\\"b\\":\\"${served}\\"`);
    let t = 0;
    const opts = { fetchImpl, intervalMs: 1, timeoutMs: 5, now: () => t, sleep: async () => { t += 1; if (t === 3) served = 'NEWbuild02'; } };
    assert.deepEqual(await waitForNewBuild('OLDbuild01', opts), { live: true, buildId: 'NEWbuild02' });
    served = 'OLDbuild01'; t = 0;
    const stuck = { ...opts, sleep: async () => { t += 1; } };
    assert.deepEqual(await waitForNewBuild('OLDbuild01', stuck), { live: false, buildId: null });
  });
  test('the lines never claim "live" before it is, and a refusal is not "published either way"', () => {
    assert.match(rebuildLine('building', { done: 'Published' }), /^Published in the database\. Rebuilding/);
    assert.equal(rebuildLine('live', { done: 'Published' }), '✓ Published — and live on the site.');
    const refused = rebuildLine('refused', { done: 'Hidden', verdict: { message: 'Deploy hook not configured. The record is published either way.' } });
    assert.match(refused, /^Hidden in the database, but the site was NOT rebuilt: Deploy hook not configured\./);
    assert.doesNotMatch(refused, /published either way/);
    assert.match(rebuildLine('timeout', { done: 'Deleted' }), /no new build has gone live after 10 minutes/);
  });
  test('publish, hide, unhide and delete each ask for their rebuild, with a retry on failure', () => {
    assert.match(page, /if \(needsRebuild\) rebuildAfter\(done \|\| 'Saved'\);/);
    assert.match(page, /rebuildAfter\('Hidden'\);/);
    assert.match(page, /if \(live\) rebuildAfter\('Unhidden'\);/);
    assert.match(page, /rebuildAfter\('Deleted'\);/);
    assert.match(page, /onClick=\{\(\) => rebuildAfter\(rebuild\.done\)\}>Retry the rebuild</);
    assert.doesNotMatch(page, /'✓ Story published\.'/, 'no unconditional "published"');
  });
  test('follower notifications are counted, and only when the story goes live', () => {
    assert.match(page, /const goesLiveNow = !holdForCover && storyData\.published === true && prevStatus !== 'live';/);
    assert.match(page, /Promise\.allSettled\(followerIds\.map/);
    assert.match(page, /NOT notified/);
  });
});

describe('W6 · a failed load is drawn (ADM-24, the CMS list)', () => {
  test('the list read runs under a deadline, and a failure renders the house panel', () => {
    assert.match(page, /const snap = await readWithDeadline\(\(\) => get\(ref\(db, 'cms_stories'\)\)\);/);
    assert.match(page, /setLoadFail\(e\?\.kind \|\| classifyFailure\(e\)\);/);
    assert.match(page, /: loadFail\s*\n\s*\? <Unavailable kind=\{loadFail\} onRetry=\{loadStories\} subject="the stories" \/>/);
  });
  test('the skip alerts are shown, and a publish or delete clears them', () => {
    assert.match(page, /Not published — no cover\./);
    assert.match(page, /\[`ops\/publish_skips\/\$\{id\}`\]: null,/);
  });
});
