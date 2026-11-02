// PROOFS — the rules, both ways round, on the RTDB emulator (port 9410, demo project).
//
// NO FOUNDER ACCOUNT, EVEN HERE. The rules name the two founder uids literally. This suite loads
// database.rules.json with those two strings replaced by stand-ins, and acts as the stand-ins:
// the grants are the same expressions, and no founder identity is ever used. A test below proves
// the swap touched only those two strings.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

const RAW = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');
const FA = 'proofsStandInFounderA0000001';
const FB = 'proofsStandInFounderB0000002';
const RULES = RAW.split(FOUNDER_UIDS[0]).join(FA).split(FOUNDER_UIDS[1]).join(FB);
const port = Number(String(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9410').split(':').pop());

const WRITER = 'proofsWriter000000000000001';
const OTHER = 'proofsWriter000000000000002';
const FUTURE = '2099-01-01T00:00:00.000Z';

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-calvary-proofs', database: { rules: RULES, host: '127.0.0.1', port } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set({
      story_proof_reports: { r1: { slug: 's', reporterUid: WRITER, storyAuthorUid: WRITER, message: 'A line is wrong here.', status: 'received', createdAt: 1, statusAt: 1 } },
      cms_stories: {
        sched: { title: 'T', authorUid: WRITER, published: false, publishAt: FUTURE },
        live: { title: 'L', authorUid: WRITER, published: true, content: '<p>x</p>', extractedText: 'x' },
      },
    });
  });
});
const db = (uid) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());

test('the stand-in swap replaced exactly the two founder uids and nothing else', () => {
  assert.ok(FOUNDER_UIDS.every((u) => RAW.includes(u)));
  assert.ok(!FOUNDER_UIDS.some((u) => RULES.includes(u)));
  assert.equal(RULES.length, RAW.length);   // same-length stand-ins
  assert.deepEqual(RULES.split(FA).join('').split(FB).join(''), RAW.split(FOUNDER_UIDS[0]).join('').split(FOUNDER_UIDS[1]).join(''));
});

describe('story_proof_reports', () => {
  test('read: the report’s writer and a founder, nobody else', async () => {
    await assertSucceeds(db(WRITER).ref('story_proof_reports/r1').get());
    await assertSucceeds(db(FA).ref('story_proof_reports').get());
    await assertSucceeds(db(FB).ref('story_proof_reports/r1').get());
    await assertFails(db(OTHER).ref('story_proof_reports/r1').get());
    await assertFails(db(WRITER).ref('story_proof_reports').get(), 'not the whole queue');
    await assertFails(db(null).ref('story_proof_reports/r1').get());
  });

  test('create: no client, founders included — only the server writes a report', async () => {
    const report = { slug: 's', reporterUid: WRITER, message: 'forged report', status: 'received', createdAt: 1 };
    await assertFails(db(WRITER).ref('story_proof_reports/r2').set(report));
    await assertFails(db(FA).ref('story_proof_reports/r2').set(report));
    await assertFails(db(FA).ref('story_proof_reports/r2/status').set('received'), 'not via a status write either');
  });

  test('status: a founder may set Received, Fixed or Left as it is; nothing else, and no writer', async () => {
    for (const s of ['fixed', 'left', 'received']) await assertSucceeds(db(FA).ref('story_proof_reports/r1').update({ status: s, statusAt: Date.now(), statusBy: FA }));
    await assertFails(db(FA).ref('story_proof_reports/r1/status').set('ignored'));
    await assertFails(db(FA).ref('story_proof_reports/r1/statusBy').set(FB), 'statusBy is the writer of the change');
    await assertFails(db(FA).ref('story_proof_reports/r1/message').set('rewritten'));
    await assertFails(db(FA).ref('story_proof_reports/r1/status').remove());
    await assertFails(db(FA).ref('story_proof_reports/r1').remove());
    await assertFails(db(WRITER).ref('story_proof_reports/r1/status').set('fixed'));
    await assertFails(db(WRITER).ref('story_proof_reports/r1/message').set('changed my mind'));
  });
});

describe('proofs_access (the switch)', () => {
  // PROOFS-R3 (ruling 290): opening sends the opening emails, so the switch is written by the
  // server only (/api/proofs/writers). A founder reads it; nobody writes it from a client.
  test('a founder reads it but can no longer write it: Open goes through the server', async () => {
    await assertSucceeds(db(FA).ref('proofs_access').get());
    await assertFails(db(FA).ref('proofs_access').set({ open: true, changedAt: Date.now(), changedBy: FA }));
    await assertFails(db(FB).ref('proofs_access').set({ open: false, changedAt: Date.now(), changedBy: FB }));
    await assertFails(db(FA).ref('proofs_access/open').set(true));
  });
  test('nobody else reads or writes it', async () => {
    await assertFails(db(WRITER).ref('proofs_access').set({ open: true, changedAt: Date.now(), changedBy: WRITER }));
    await assertFails(db(WRITER).ref('proofs_access').get());
    await assertFails(db(null).ref('proofs_access').get());
  });
});

describe('proofs_mail (the writer-email ledger, PROOFS-R3)', () => {
  test('server-only: no client reads or writes it, founders included', async () => {
    for (const who of [FA, FB, WRITER, null]) {
      await assertFails(db(who).ref('proofs_mail').get());
      await assertFails(db(who).ref(`proofs_mail/writers/${WRITER}`).get());
      await assertFails(db(who).ref(`proofs_mail/writers/${WRITER}/opening`).set({ at: 1 }));
    }
  });
  test('users is indexed on isAuthor (the opening list is one indexed query)', () => {
    assert.ok(JSON.parse(RAW).rules.users['.indexOn'].includes('isAuthor'));
  });
});

describe('cms_stories: no text unless live', () => {
  test('refused: text into a story that isn’t live, or taking a story down while its text stays', async () => {
    await assertFails(db(FA).ref('cms_stories/sched/content').set('<p>early</p>'));
    await assertFails(db(FA).ref('cms_stories/sched/extractedText').set('early'));
    await assertFails(db(FA).ref('cms_stories/new').set({ title: 'N', published: false, publishAt: FUTURE, content: '<p>x</p>' }));
    await assertFails(db(FA).ref('cms_stories/live/published').set(false), 'unpublishing must take the text off in the same write');
    await assertFails(db(FA).ref('cms_stories/live').update({ published: false, content: null }), 'extractedText still there');
  });
  test('allowed: text on a live story, a scheduled story without text, and a take-down that removes the text', async () => {
    await assertSucceeds(db(FA).ref('cms_stories/live/content').set('<p>edited</p>'));
    await assertSucceeds(db(FA).ref('cms_stories/sched').update({ title: 'Retitled', publishAt: FUTURE }));
    await assertSucceeds(db(FA).ref('cms_stories/new').set({ title: 'N', published: false, publishAt: FUTURE }));
    await assertSucceeds(db(FA).ref('cms_stories/live').update({ published: false, content: null, extractedText: null }));
    await assertSucceeds(db(FA).ref('cms_stories/sched').update({ published: true, content: '<p>live now</p>', extractedText: 'live now' }), 'going live with its text, in one write');
  });
  test('an EMPTY string is not text: a retired record’s empty extractedText doesn’t block its Hide', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref('cms_stories/retired').set({ title: 'R', published: false, hiddenAt: 1, extractedText: '' }); });
    await assertSucceeds(db(FA).ref('cms_stories/retired').update({ published: false, hiddenAt: 2 }));
    await assertSucceeds(db(FA).ref('cms_stories/sched/content').set(''));
    await assertFails(db(FA).ref('cms_stories/sched/content').set(' '), 'a space is text');
  });
  test('a reader can’t write any of it (cms_stories is founders-only, as before)', async () => {
    await assertFails(db(WRITER).ref('cms_stories/sched/content').set('<p>x</p>'));
    await assertFails(db(WRITER).ref('cms_stories/live/content').set('<p>x</p>'));
  });
  test('the node is indexed on published and authorUid (the server’s two queries)', async () => {
    await assertSucceeds(db(null).ref('cms_stories').orderByChild('published').equalTo(false).get());
    const snap = await env.withSecurityRulesDisabled(async (ctx) => (await ctx.database().ref('cms_stories').orderByChild('authorUid').equalTo(WRITER).get()).val());
    void snap;
    assert.deepEqual(JSON.parse(RAW).rules.cms_stories['.indexOn'], ['authorUid', 'author', 'published']);
  });
});
