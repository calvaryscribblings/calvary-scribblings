// PROOFS — /api/proofs and /api/proofs/report against the RTDB emulator.
//
//   npm run test:proofs:emulator
//
// The Functions run unmodified (tests/proofs/harness.mjs stands in for Google and Resend only).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, loadRules, wipe, get, set, request, context, tokenFor, founders, STAND_IN_FOUNDER, sent } from './harness.mjs';
import { NOW, STORIES, BODY, RETIRED, WRITER_A, WRITER_B, READER } from './fixture.mjs';
import { handleProofs } from '../../functions/api/proofs/index.js';
import { handleReport } from '../../functions/api/proofs/report.js';
import { raiseAlert, alertKey } from '../../functions/api/_alerts.js';
import { ENV } from './harness.mjs';
import { dayWindow, bucketKey } from '../../functions/api/_ratelimit.js';
import { PROOFS_COPY } from '../../app/lib/proofs.js';

async function proofs(uid, body, { now = NOW } = {}) {
  const { ctx } = context(request('/api/proofs', { body, token: uid ? tokenFor(uid) : undefined }));
  const res = await handleProofs(ctx, { now, founders });
  return { status: res.status, cache: res.headers.get('Cache-Control'), ...(await res.json()) };
}
async function report(uid, body, { now = NOW } = {}) {
  const { ctx, settle } = context(request('/api/proofs/report', { body, token: tokenFor(uid) }));
  const res = await handleReport(ctx, { now, founders });
  await settle();
  const j = await res.json();
  return { ...j, reportStatus: j.status, status: res.status };
}
const slugs = (r) => r.stories.map((s) => s.slug);

async function seed({ open = true } = {}) {
  await wipe();
  await set('cms_stories', STORIES);
  await set('story_bodies', Object.fromEntries(Object.keys(STORIES).map((s) => [s, BODY(s)])));
  await set('cms_stories_retired', RETIRED);
  if (open) await set('proofs_access', { open: true, changedAt: NOW, changedBy: STAND_IN_FOUNDER });
}

before(async () => { install(); await loadRules(); });
after(uninstall);

describe('who sees what', () => {
  beforeEach(() => seed());

  test('a writer sees only their own scheduled stories — not live, hidden, held or retired ones', async () => {
    const r = await proofs(WRITER_A, { action: 'list' });
    assert.equal(r.status, 200);
    assert.deepEqual(slugs(r), ['pf-a-one', 'pf-a-two']);
    assert.equal(r.founder, false);
    assert.equal(r.groups, undefined);
    assert.equal(r.cache, 'private, no-store');
    for (const s of r.stories) assert.equal(s.content, undefined, 'the list never carries text');
  });

  test('a writer opens their own proof, with the text from story_bodies (never the record’s copy)', async () => {
    const r = await proofs(WRITER_A, { action: 'proof', slug: 'pf-a-one' });
    assert.equal(r.status, 200);
    assert.equal(r.story.content, BODY('pf-a-one').content);
    assert.equal(r.story.extractedText, undefined);
    assert.equal(r.goLiveMs, Date.parse(STORIES['pf-a-one'].publishAt));
    assert.equal(r.cache, 'private, no-store');
  });

  test('another writer’s proof is refused, exactly as a slug that never existed', async () => {
    const theirs = await proofs(WRITER_B, { action: 'proof', slug: 'pf-a-one' });
    const never = await proofs(WRITER_B, { action: 'proof', slug: 'pf-never-existed' });
    assert.equal(theirs.status, 404);
    assert.deepEqual({ ...theirs, cache: null }, { ...never, cache: null });
    assert.deepEqual(slugs(await proofs(WRITER_B, { action: 'list' })), ['pf-b-one']);
  });

  test('a reader with no stories sees nothing', async () => {
    const r = await proofs(READER, { action: 'list' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.stories, []);
    assert.deepEqual(r.reports, []);
  });

  test('a founder (stand-in) sees every scheduled story, grouped by writer, including one with no authorUid', async () => {
    const r = await proofs(STAND_IN_FOUNDER, { action: 'list' });
    assert.equal(r.founder, true);
    assert.deepEqual(slugs(r).sort(), ['pf-a-one', 'pf-a-two', 'pf-b-one', 'pf-nobody']);
    assert.deepEqual(r.groups.map((g) => g.authorUid), [WRITER_A, WRITER_B, null]);
    assert.equal((await proofs(STAND_IN_FOUNDER, { action: 'proof', slug: 'pf-b-one' })).status, 200);
  });

  test('signed out, or a token that does not verify: 401', async () => {
    assert.equal((await proofs(null, { action: 'list' })).status, 401);
    const { ctx } = context(request('/api/proofs', { body: { action: 'list' }, token: 'forged' }));
    assert.equal((await handleProofs(ctx, { now: NOW, founders })).status, 401);
  });
});

describe('the switch (ruling 258)', () => {
  test('closed: a writer gets the same nothing as a reader with no stories; a proof and a report are 404', async () => {
    await seed({ open: false });
    const writer = await proofs(WRITER_A, { action: 'list' });
    const reader = await proofs(READER, { action: 'list' });
    assert.deepEqual(writer, reader);
    assert.equal((await proofs(WRITER_A, { action: 'proof', slug: 'pf-a-one' })).status, 404);
    assert.equal((await report(WRITER_A, { slug: 'pf-a-one', message: 'A word is wrong in the second line.' })).status, 404);
    assert.equal(await get('story_proof_reports'), null);
  });

  test('closed: the founder still sees everything', async () => {
    await seed({ open: false });
    assert.equal((await proofs(STAND_IN_FOUNDER, { action: 'list' })).stories.length, 4);
  });

  test('a switch that is not exactly true is closed', async () => {
    await seed({ open: false });
    await set('proofs_access', { open: 'true', changedAt: NOW, changedBy: STAND_IN_FOUNDER });
    assert.deepEqual((await proofs(WRITER_A, { action: 'list' })).stories, []);
  });
});

describe('a story leaves Proofs the moment it goes live', () => {
  beforeEach(() => seed());

  test('flipped live: gone from the list, and its proof answers 404', async () => {
    await set('cms_stories/pf-a-one/published', true);
    assert.deepEqual(slugs(await proofs(WRITER_A, { action: 'list' })), ['pf-a-two']);
    assert.equal((await proofs(WRITER_A, { action: 'proof', slug: 'pf-a-one' })).status, 404);
  });

  test('past its go-live time but not yet flipped: not a proof either', async () => {
    const later = Date.parse(STORIES['pf-a-one'].publishAt) + 1;
    assert.deepEqual(slugs(await proofs(WRITER_A, { action: 'list' }, { now: later })), ['pf-a-two']);
  });
});

describe('reports', () => {
  beforeEach(async () => {
    await seed();
    // Keep the four calls inside one minute window of the limiter (which reads the real clock).
    const into = Date.now() % 60_000;
    if (into > 50_000) await new Promise((r) => setTimeout(r, 60_000 - into + 200));
  });

  test('a report is validated, written server-side as Received, and emails the editors once', async () => {
    assert.equal((await report(WRITER_A, { slug: 'pf-a-one', message: 'short' })).code, 'too_short');
    assert.equal((await report(WRITER_A, { slug: 'pf-a-one', message: 'x'.repeat(2001) })).code, 'too_long');
    assert.equal(sent.length, 0);

    const r = await report(WRITER_A, { slug: 'pf-a-one', message: '  The second paragraph lost its italics.  ' });
    assert.equal(r.status, 200);
    assert.equal(r.reportStatus, 'received');
    const rec = await get(`story_proof_reports/${r.id}`);
    assert.equal(rec.slug, 'pf-a-one');
    assert.equal(rec.reporterUid, WRITER_A);
    assert.equal(rec.storyAuthorUid, WRITER_A);
    assert.equal(rec.message, 'The second paragraph lost its italics.');
    assert.equal(rec.status, 'received');
    assert.equal(typeof rec.createdAt, 'number');

    assert.equal(sent.length, 1, 'one email');
    assert.match(sent[0].subject, /^\[alert\] /);
    assert.ok(sent[0].text.includes('pf-a-one') && sent[0].text.includes(r.id));
    assert.ok(!sent[0].text.includes('italics'), 'the writer’s words are not in the email');
    // Raised again for the same report (a retry, a replay): nothing more is sent.
    const again = await raiseAlert(ENV, { kind: 'proof_report', key: await alertKey('proof_report', r.id), subject: 'x', lines: ['x'] });
    assert.equal(again.sent, false);
    assert.equal(sent.length, 1);

    // The story is untouched: a report never holds it back.
    assert.deepEqual(await get('cms_stories/pf-a-one'), STORIES['pf-a-one']);

    // The writer sees it, with its status, in the proof and in the list.
    const p = await proofs(WRITER_A, { action: 'proof', slug: 'pf-a-one' });
    assert.deepEqual(p.reports.map((x) => [x.id, x.status]), [[r.id, 'received']]);
    await set(`story_proof_reports/${r.id}/status`, 'fixed');
    assert.equal((await proofs(WRITER_A, { action: 'list' })).reports[0].status, 'fixed');
    // …and nobody else's list carries it.
    assert.deepEqual((await proofs(WRITER_B, { action: 'list' })).reports, []);
  });

  test('a writer cannot report on another writer’s proof, or a live story', async () => {
    assert.equal((await report(WRITER_B, { slug: 'pf-a-one', message: 'Reporting on a story that is not mine.' })).status, 404);
    assert.equal((await report(WRITER_A, { slug: 'pf-a-live', message: 'Reporting on a story that is live now.' })).status, 404);
    assert.equal(await get('story_proof_reports'), null);
    assert.equal(sent.length, 0);
  });

  test('rate-limited: the fourth report in a minute is refused, and nothing is written for it', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await report(WRITER_A, { slug: 'pf-a-two', message: `Report number ${i} about a line.` }));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 429]);
    assert.equal(results[3].code, 'rate_limited');
    assert.equal(Object.keys(await get('story_proof_reports')).length, 3);
    assert.equal(sent.length, 3, 'one email per report');
  });

  test('ruling 276: the writer’s daily cap has its own line; the site-wide cap reads as a failure to send', async () => {
    const day = `rate_limits/proofrep/day/${dayWindow()}`;
    await set(`${day}/${bucketKey(WRITER_A)}`, 20);
    const daily = await report(WRITER_A, { slug: 'pf-a-one', message: 'One more report than a day allows.' });
    assert.deepEqual([daily.status, daily.code, daily.error], [429, 'daily_limit', PROOFS_COPY.reportDailyLimit]);
    await set(`${day}/_all`, 300);
    const site = await report(WRITER_B, { slug: 'pf-b-one', message: 'The whole site has reached its cap.' });
    assert.deepEqual([site.code, site.error], ['unavailable', PROOFS_COPY.reportFailed]);
    assert.equal(await get('story_proof_reports'), null);
    assert.equal(sent.length, 0);
  });
});

