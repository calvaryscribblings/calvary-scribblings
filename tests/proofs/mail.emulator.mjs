// PROOFS-R3 — the writer emails, against the RTDB emulator, with every email captured and none sent.
//
//   npm run test:proofs:emulator      (this file runs with the other *.emulator.mjs)
//
// Invented writers, stories and addresses only (example.test). No founder account: the founder is a
// stand-in uid injected into the handler, as in the rest of the Proofs suite.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, loadRules, wipe, get, set, request, context, tokenFor, founders, STAND_IN_FOUNDER, sent, ACCOUNTS, resendFails } from './harness.mjs';
import { handleWriters } from '../../functions/api/proofs/writers.js';
import { handleTick } from '../../functions/api/proofs/mail-tick.js';
import { handleProofs } from '../../functions/api/proofs/index.js';
import { londonWhen } from '../../app/lib/proofs.js';
import { REMINDER_LEAD_MS, proofUrl, SAMPLE_PREFIX, PROOF_MAIL_COPY } from '../../app/lib/proofMail.js';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const H = 3_600_000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const W1 = 'mailWriterOne', W2 = 'mailWriterTwo', W3 = 'mailWriterThree', W4 = 'mailWriterNoAddress', W5 = 'mailWriterUnticked', W6 = 'mailWriterLater';
const READER = 'mailReader';
const story = (uid, at, extra = {}) => ({ title: `Invented ${uid} ${at}`, author: 'Invented', authorUid: uid, category: 'short', published: false, publishAt: iso(at), ...extra });
const STORIES = {
  'pm-one-a': story(W1, NOW + 5 * D),
  'pm-one-b': story(W1, NOW + 9 * D),
  'pm-one-live': story(W1, NOW - D, { published: true }),
  'pm-one-hidden': story(W1, NOW + 4 * D, { hiddenAt: iso(NOW - D) }),
  'pm-two-soon': story(W2, NOW + 30 * H),
  'pm-four-a': story(W4, NOW + 7 * D),
  'pm-five-a': story(W5, NOW + 6 * D),
};
STORIES['pm-one-a'].title = 'The Invented Lantern';
const USERS = Object.fromEntries([W1, W2, W3, W4, W5].map((u, i) => [u, { displayName: `Writer ${i + 1}`, isAuthor: true }]));
USERS[READER] = { displayName: 'A reader' };
const addr = (u) => `${u.toLowerCase()}@example.test`;

async function seed() {
  await wipe();
  for (const k of Object.keys(ACCOUNTS)) delete ACCOUNTS[k];
  for (const u of [W1, W2, W3, W5, W6, READER]) ACCOUNTS[u] = { email: addr(u), emailVerified: true };
  ACCOUNTS[W4] = { email: null, emailVerified: false };
  ACCOUNTS[STAND_IN_FOUNDER] = { email: 'founder@example.test', emailVerified: true };
  await set('cms_stories', STORIES);
  await set('users', USERS);
  await set('proofs_access', { open: false, changedAt: NOW - D, changedBy: STAND_IN_FOUNDER });
}

async function writers(uid, body, { now = NOW } = {}) {
  const { ctx } = context(request('/api/proofs/writers', { body, token: tokenFor(uid) }));
  const res = await handleWriters(ctx, { now, founders, pause: 0 });
  return { status: res.status, ...(await res.json()) };
}
const okOps = async () => ({ ok: true, who: 'launch-check' });
async function tick(now = NOW) {
  const { ctx } = context(request('/api/proofs/mail-tick', { body: {} }));
  const res = await handleTick(ctx, { now, authorise: okOps, pause: 0 });
  return { status: res.status, ...(await res.json()) };
}
const to = (u) => sent.filter((m) => m.to?.[0] === addr(u));
const OPEN_ALL_BUT_W5 = [W1, W2, W3, W4];
const openNow = (include = OPEN_ALL_BUT_W5, now = NOW) => writers(STAND_IN_FOUNDER, { action: 'open', include }, { now });
const ledger = (u, slug) => get(`proofs_mail/writers/${u}${slug ? `/stories/${slug}` : ''}`);

/** Console output during fn, for the "counts only" check. */
async function quiet(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } finally { console.log = log; console.error = error; }
}

before(async () => { install(); await loadRules(); });
after(uninstall);

describe('the opening list, and unticking', () => {
  beforeEach(seed);

  test('every account with the writer badge, each with its scheduled count; no address leaves the server', async () => {
    const r = await writers(STAND_IN_FOUNDER, { action: 'list' });
    assert.equal(r.status, 200);
    assert.equal(r.open, false);
    const by = Object.fromEntries(r.writers.map((w) => [w.uid, w]));
    assert.deepEqual(Object.keys(by).sort(), [W1, W2, W3, W4, W5].sort(), 'badge holders only: the reader is not listed');
    assert.equal(by[W1].scheduled, 2, 'live and hidden stories are not counted');
    assert.equal(by[W2].scheduled, 1);
    assert.equal(by[W3].scheduled, 0);
    assert.equal(by[W4].hasAddress, false);
    assert.equal(by[W1].hasAddress, true);
    assert.ok(r.writers.every((w) => w.state === 'new'));
    assert.ok(!JSON.stringify(r).includes('@'), 'no address in the answer');
    assert.equal(sent.length, 0, 'listing sends nothing');
  });

  test('only a founder: a writer and a reader are refused, and nothing is sent or opened', async () => {
    for (const who of [W1, READER]) {
      for (const action of ['list', 'open', 'close', 'sample']) {
        const r = await writers(who, { action, include: [] });
        assert.equal(r.status, 403, `${action} as a non-founder`);
      }
    }
    assert.equal(sent.length, 0);
    assert.equal((await get('proofs_access')).open, false);
  });

  test('confirming opens Proofs and emails each ticked writer once; the unticked writer gets nothing', async () => {
    const r = await openNow();
    assert.equal(r.status, 200);
    assert.deepEqual({ sent: r.sent, failed: r.failed, excluded: r.excluded, noAddress: r.noAddress }, { sent: 3, failed: 0, excluded: 1, noAddress: 1 });
    assert.equal((await get('proofs_access')).open, true);
    assert.equal((await get('proofs_access')).changedBy, STAND_IN_FOUNDER);
    assert.equal(sent.length, 3);
    assert.equal(to(W1).length, 1);
    assert.equal(to(W2).length, 1);
    assert.equal(to(W3).length, 1);
    assert.equal(to(W5).length, 0, 'unticked');
    assert.equal(sent.filter((m) => m.to?.[0] === null || m.to?.[0] === undefined).length, 0, 'no address: nothing sent');
    // Writers with stories: "your proofs are ready" and every story, soonest first, with London time and link.
    const one = to(W1)[0];
    assert.equal(one.subject, 'Your proofs are ready');
    assert.equal(one.from, 'Calvary Scribblings <alerts@example.test>');
    const a = one.text.indexOf('“The Invented Lantern”'), b = one.text.indexOf(`“${STORIES['pm-one-b'].title}”`);
    assert.ok(a > 0 && b > a, 'both stories, soonest first');
    assert.ok(one.text.includes(`Goes live ${londonWhen(NOW + 5 * D)}, London time`));
    assert.ok(one.text.includes(proofUrl('pm-one-a')));
    assert.ok(!one.text.includes('pm-one-live') && !one.text.includes('pm-one-hidden'), 'only proofs are listed');
    // Writers without: the explainer alone.
    assert.equal(to(W3)[0].subject, 'Proofs: read your stories before they go live');
    assert.ok(to(W3)[0].text.includes('You have no stories scheduled just now.'));
    // The ledger.
    assert.equal((await ledger(W1)).opening.sent, true);
    assert.ok((await ledger(W5)).excluded, 'unticked is recorded');
    assert.equal(await ledger(W4), null, 'no address: nothing claimed');
  });

  test('the founder can untick everyone: Proofs opens and nobody is emailed', async () => {
    const r = await openNow([]);
    assert.equal(r.sent, 0);
    assert.equal(sent.length, 0);
    assert.equal((await get('proofs_access')).open, true);
  });

  test('a uid that isn’t a uid is refused before anything is read', async () => {
    const r = await writers(STAND_IN_FOUNDER, { action: 'open', include: ['../users'] });
    assert.equal(r.status, 400);
    assert.equal((await get('proofs_access')).open, false);
  });
});

describe('once and only once', () => {
  beforeEach(async () => { await seed(); await openNow(); sent.length = 0; });

  test('the seeding: no "scheduled" email for any story the opening email listed', async () => {
    const t = await tick();
    assert.equal(t.status, 200);
    assert.equal(sent.length, 0);
    const seeded = await ledger(W1, 'pm-one-a');
    assert.equal(seeded.kind, 'opening');
    assert.equal(seeded.goLiveMs, NOW + 5 * D);
    assert.equal((await ledger(W2, 'pm-two-soon')).remindedFor, NOW + 30 * H, 'listed inside 48h: that was its reminder');
  });

  test('close and reopen: the opening email is never sent again', async () => {
    await writers(STAND_IN_FOUNDER, { action: 'close' });
    assert.equal((await get('proofs_access')).open, false);
    const r = await openNow([W1, W2, W3]);
    assert.equal(r.already, 3);
    assert.equal(sent.length, 0);
    const list = await writers(STAND_IN_FOUNDER, { action: 'list' });
    assert.equal(list.writers.find((w) => w.uid === W1).state, 'opened', 'the list marks them already emailed');
  });

  test('a rerun of the tick sends nothing twice, and two ticks at once send each email once', async () => {
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D));
    await Promise.all([tick(), tick(), tick()]);
    assert.equal(to(W1).length, 1);
    await tick(); await tick();
    assert.equal(to(W1).length, 1);
  });

  test('scheduled: one email, at the next tick, with the story, its London time and its proof', async () => {
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D, { title: 'A Second Invented Title' }));
    const t = await tick();
    assert.equal(t.scheduled, 1);
    const m = to(W1)[0];
    assert.equal(m.subject, '“A Second Invented Title” is scheduled');
    assert.ok(m.text.includes(`It goes live ${londonWhen(NOW + 10 * D)}, London time.`));
    assert.ok(m.text.includes(proofUrl('pm-one-c')));
    const rec = await ledger(W1, 'pm-one-c');
    assert.equal(rec.kind, 'scheduled');
    assert.equal(rec.sent, true);
    assert.equal(rec.goLiveMs, NOW + 10 * D);
  });

  test('date changed: one email naming the new time and the old; once; and again for a second change', async () => {
    const G2 = NOW + 12 * D;
    await set('cms_stories/pm-one-a/publishAt', iso(G2));
    assert.equal((await tick()).changed, 1);
    assert.equal(to(W1).length, 1);
    const m = to(W1)[0];
    assert.equal(m.subject, '“The Invented Lantern” has a new go-live date');
    assert.ok(m.text.includes(`It now goes live ${londonWhen(G2)}, London time.`));
    assert.ok(m.text.includes(`Before, it was ${londonWhen(NOW + 5 * D)}.`));
    await tick();
    assert.equal(to(W1).length, 1, 'no resend');
    // Changed back to the first time: they were last told G2, so they are told again.
    await set('cms_stories/pm-one-a/publishAt', iso(NOW + 5 * D));
    assert.equal((await tick()).changed, 1);
    assert.equal(to(W1).length, 2);
    const rec = await ledger(W1, 'pm-one-a');
    assert.deepEqual(Object.values(rec.log).map((l) => l.kind), ['opening', 'changed', 'changed']);
  });

  test('48 hours: one reminder at the moment, none before, none after', async () => {
    const G = NOW + 9 * D;   // pm-one-b
    await tick(G - REMINDER_LEAD_MS - 60_000);
    assert.equal(to(W1).length, 0, 'not yet');
    assert.equal((await tick(G - REMINDER_LEAD_MS + 60_000)).reminder, 1);
    const m = to(W1)[0];
    assert.equal(m.subject, PROOF_MAIL_COPY.reminder({ title: STORIES['pm-one-b'].title, goLiveMs: G, slug: 'pm-one-b' }).subject);
    assert.ok(m.text.includes(`goes live ${londonWhen(G)}, London time.`));
    await tick(G - REMINDER_LEAD_MS + 20 * 60_000);
    await tick(G - H);
    assert.equal(to(W1).length, 1);
  });

  test('a date change after the reminder: the change email, then a reminder for the NEW time', async () => {
    const G = NOW + 9 * D, G2 = NOW + 15 * D;
    await tick(G - REMINDER_LEAD_MS + 60_000);
    await set('cms_stories/pm-one-b/publishAt', iso(G2));
    const t = await tick(G - REMINDER_LEAD_MS + 2 * H);
    assert.equal(t.changed, 1);
    await tick(G2 - REMINDER_LEAD_MS - 60_000);
    assert.equal(to(W1).length, 2);
    assert.equal((await tick(G2 - REMINDER_LEAD_MS + 60_000)).reminder, 1);
    assert.deepEqual(to(W1).map((m) => m.subject.replace(/“[^”]*”/, 'T').split(' ').slice(1, 3).join(' ')), ['goes live', 'has a', 'goes live']);
  });

  test('a failed send is recorded and not retried (a lost email beats a double one)', async () => {
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D));
    resendFails.next = 500;
    const t = await tick();
    assert.equal(t.failed, 1);
    const rec = await ledger(W1, 'pm-one-c');
    assert.equal(rec.sent, false);
    assert.equal(rec.why, 'resend_500');
    await tick();
    assert.equal(sent.length, 0);
  });
});

describe('the edge cases', () => {
  beforeEach(async () => { await seed(); await openNow(); sent.length = 0; });

  test('scheduled less than 48 hours ahead: the "scheduled" email only, no reminder on top', async () => {
    const G = NOW + 20 * H;
    await set('cms_stories/pm-one-soon', story(W1, G));
    assert.equal((await tick()).scheduled, 1);
    await tick(NOW + 15 * 60_000); await tick(G - H);
    assert.equal(to(W1).length, 1);
  });

  test('unscheduled or hidden after its email: nothing is sent; back at the same time, nothing; at a new time, "changed"', async () => {
    await set('cms_stories/pm-one-a/hiddenAt', iso(NOW));
    await tick();
    await set('cms_stories/pm-one-a/hiddenAt', null);
    await set('cms_stories/pm-one-b/publishAt', null);   // held with no date: not a proof
    await tick();
    assert.equal(sent.length, 0);
    await set('cms_stories/pm-one-a/hiddenAt', iso(NOW));
    await tick(NOW + 9 * D - REMINDER_LEAD_MS + 60_000);
    assert.equal(sent.length, 0, 'no reminder for a story that isn’t scheduled');
    await set('cms_stories/pm-one-a/hiddenAt', null);
    await set('cms_stories/pm-one-a/publishAt', iso(NOW + 20 * D));
    assert.equal((await tick()).changed, 1);
  });

  test('a story that goes live leaves: no email about it', async () => {
    await set('cms_stories/pm-one-a/published', true);
    await tick(NOW + 5 * D - REMINDER_LEAD_MS + 60_000);
    assert.equal(to(W1).length, 0);
  });

  test('a writer with no email address: nothing claimed; once they have one, the opening email with their stories', async () => {
    const t = await tick();
    assert.equal(t.noAddress, 1);
    assert.equal(await ledger(W4), null);
    ACCOUNTS[W4] = { email: addr(W4), emailVerified: true };
    assert.equal((await tick()).opening, 1);
    assert.equal(to(W4)[0].subject, 'Your proofs are ready');
    assert.ok(to(W4)[0].text.includes(proofUrl('pm-four-a')));
    await tick();
    assert.equal(to(W4).length, 1);
  });

  test('an unverified address counts as none', async () => {
    ACCOUNTS[W4] = { email: addr(W4), emailVerified: false };
    assert.equal((await tick()).noAddress, 1);
    assert.equal(to(W4).length, 0);
  });

  test('a writer unticked at opening: no email when a story is scheduled; "Email them" sends the opening once', async () => {
    await set('cms_stories/pm-five-b', story(W5, NOW + 8 * D));
    const t = await tick();
    assert.equal(t.excluded, 1);
    assert.equal(to(W5).length, 0);
    const r = await writers(STAND_IN_FOUNDER, { action: 'include', uid: W5 });
    assert.equal(r.result, 'sent');
    assert.equal(to(W5).length, 1);
    assert.ok(to(W5)[0].text.includes(proofUrl('pm-five-b')), 'the opening lists their stories');
    assert.equal((await ledger(W5)).excluded, undefined);
    await tick();
    assert.equal((await writers(STAND_IN_FOUNDER, { action: 'include', uid: W5 })).result, 'already');
    assert.equal(to(W5).length, 1);
  });

  test('a writer badged after the opening gets the opening email at their first scheduled story', async () => {
    await set(`users/${W6}`, { displayName: 'Writer 6', isAuthor: true });
    await tick();
    assert.equal(to(W6).length, 0, 'no story yet: nothing');
    await set('cms_stories/pm-six-a', story(W6, NOW + 6 * D));
    assert.equal((await tick()).opening, 1);
    assert.equal(to(W6)[0].subject, 'Your proofs are ready');
    await tick();
    assert.equal(to(W6).length, 1);
  });

  test('while Proofs is closed nothing is sent; reopening sends what is due then, once', async () => {
    await writers(STAND_IN_FOUNDER, { action: 'close' });
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D));
    const t = await tick();
    assert.equal(t.open, false);
    assert.equal(sent.length, 0);
    await openNow([]);
    assert.equal(sent.length, 0, 'reopening sends no opening email again');
    assert.equal((await tick()).scheduled, 1);
    await tick();
    assert.equal(to(W1).length, 1);
  });

  test('a retired story is never mailed about', async () => {
    await set('cms_stories/pm-one-ret', story(W1, NOW + 10 * D));
    await set('cms_stories_retired/pm-one-ret', { at: NOW });
    await tick();
    assert.equal(sent.length, 0);
  });

  test('the tick prints counts only: no uid, address, slug or title', async () => {
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D));
    await set(`users/${W6}`, { displayName: 'Writer 6', isAuthor: true });
    await set('cms_stories/pm-six-a', story(W6, NOW + 6 * D));
    const { lines } = await quiet(() => tick());
    const text = lines.join('\n');
    assert.ok(lines.length > 0);
    for (const bad of [W1, W6, '@', 'pm-one', 'Invented']) assert.ok(!text.includes(bad), `the log carried ${bad}`);
  });

  test('the tick endpoint refuses a caller without the ops token', async () => {
    const { ctx } = context(request('/api/proofs/mail-tick', { body: {} }));
    const res = await handleTick(ctx, { now: NOW, authorise: async () => ({ ok: false, status: 403 }), pause: 0 });
    assert.equal(res.status, 403);
    await set('cms_stories/pm-one-c', story(W1, NOW + 10 * D));
    assert.equal(sent.length, 0);
  });

  test('writers still see their proofs as before (access is the switch, not the email)', async () => {
    const { ctx } = context(request('/api/proofs', { body: { action: 'list' }, token: tokenFor(W5) }));
    const res = await handleProofs(ctx, { now: NOW, founders });
    const j = await res.json();
    assert.deepEqual(j.stories.map((s) => s.slug), ['pm-five-a'], 'an unticked writer still sees their own proof');
  });
});

describe('Send me a sample', () => {
  beforeEach(seed);

  test('every email, with invented stories, to the signed-in founder’s own address only', async () => {
    const r = await writers(STAND_IN_FOUNDER, { action: 'sample', to: addr(W1), include: [W1] });
    assert.equal(r.status, 200);
    assert.equal(r.sent, 5);
    assert.equal(sent.length, 5);
    assert.ok(sent.every((m) => m.to.length === 1 && m.to[0] === 'founder@example.test'), 'only the founder, whatever the body says');
    assert.ok(sent.every((m) => m.subject.startsWith(SAMPLE_PREFIX)));
    assert.deepEqual(sent.map((m) => m.subject.slice(SAMPLE_PREFIX.length).replace(/“[^”]*”/, 'T')).map((s) => s.split(' ').slice(0, 3).join(' ')),
      ['Your proofs are', 'Proofs: read your', 'T is scheduled', 'T has a', 'T goes live']);
    for (const m of sent) for (const slug of Object.keys(STORIES)) assert.ok(!m.text.includes(slug), 'no real story in a sample');
    assert.equal(await get('proofs_mail'), null, 'a sample writes no ledger');
    assert.equal((await get('proofs_access')).open, false, 'and opens nothing');
  });

  test('a founder with no verified address gets a refusal, and nothing is sent', async () => {
    ACCOUNTS[STAND_IN_FOUNDER] = { email: 'founder@example.test', emailVerified: false };
    const r = await writers(STAND_IN_FOUNDER, { action: 'sample' });
    assert.equal(r.status, 409);
    assert.equal(sent.length, 0);
  });
});
