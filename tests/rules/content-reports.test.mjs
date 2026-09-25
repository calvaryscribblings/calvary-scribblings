// W5 · content_reports/{contentKey}/{reporterUid} — the queue for comments, DMs and profiles.
//
// The record is built by app/lib/contentReports.js (buildReport, contentKeyFor), so the rules and
// the writer are asserted against each other here, not against two copies of one shape.
//
// RULED (Ikenna, 24–25 Sep): a DM report shows a moderator the reported message and the reporter's
// note, never the thread. The last describe block is that ruling, in the rules.

import { test, before, after, beforeEach, describe } from 'node:test';
import {
  makeEnv, seed, assertFails, assertSucceeds,
  OWNER, STRANGER, OTHER, FOUNDER_A, convIdFor,
} from './helpers.mjs';
import { buildReport, contentKeyFor, snapshotOf } from '../../app/lib/contentReports.js';

let env, owner, stranger, other, founder, anon;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  other = env.authenticatedContext(OTHER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const SLUG = 'a-daub-of-blue';
const CID = '-Ocomment0001';
const CONV = convIdFor(OWNER, STRANGER);
const MSG = '-Omsg0001';
const MSG_TEXT = 'The one message being reported.';

const commentReport = (reporter = OWNER, extra = {}) => buildReport({
  kind: 'comment', reason: 'harassment', reporterUid: reporter, offenderUid: STRANGER,
  contextPath: `comments/${SLUG}/${CID}`, text: 'a rude comment', now: Date.now(), ...extra,
});
const dmReport = (extra = {}) => buildReport({
  kind: 'dm', reason: 'harassment', reporterUid: OWNER, offenderUid: STRANGER,
  contextPath: `dm_messages/${CONV}/${MSG}`, text: MSG_TEXT, note: 'Unwanted messages.', now: Date.now(), ...extra,
});
const userReport = (extra = {}) => buildReport({
  kind: 'user', reason: 'impersonation', reporterUid: OWNER, offenderUid: STRANGER,
  contextPath: `users/${STRANGER}`, text: 'Display name: Ikenna', now: Date.now(), ...extra,
});
const K_COMMENT = contentKeyFor('comment', { storySlug: SLUG, commentId: CID });
const K_DM = contentKeyFor('dm', { convId: CONV });
const K_USER = contentKeyFor('user', { uid: STRANGER });

const seedThread = () => seed(env, {
  [`dm_messages/${CONV}/${MSG}`]: { text: MSG_TEXT, senderUid: STRANGER, createdAt: 1 },
  [`dm_messages/${CONV}/-Omsg0002`]: { text: 'Another message in the thread.', senderUid: STRANGER, createdAt: 2 },
  [`dm_messages/${CONV}/-Omsg0003`]: { text: 'The reporter\'s own reply.', senderUid: OWNER, createdAt: 3 },
});
const seedModerator = () => seed(env, { [`users/${OTHER}/canRemovePosts`]: true });

describe('W5 · content_reports — who may create', () => {
  test('LEGITIMATE: a reader reports a comment, a DM message and a profile, under their own uid', async () => {
    await seedThread();
    await assertSucceeds(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set(commentReport()));
    await assertSucceeds(owner.ref(`content_reports/${K_DM}/${OWNER}`).set(dmReport()));
    await assertSucceeds(owner.ref(`content_reports/${K_USER}/${OWNER}`).set(userReport()));
    // …and reads their own back.
    await assertSucceeds(owner.ref(`content_reports/${K_DM}/${OWNER}`).get());
  });

  test('REFUSED: signed out, or under someone else\'s uid, or naming someone else as reporter', async () => {
    await assertFails(anon.ref(`content_reports/${K_COMMENT}/${OWNER}`).set(commentReport()));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OTHER}`).set(commentReport(OTHER)));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), reporterUid: OTHER }));
  });

  test('REFUSED: a record whose kind does not match its key, or whose shape is off', async () => {
    await assertFails(owner.ref(`content_reports/${K_USER}/${OWNER}`).set(commentReport()));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), kind: 'post' }));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), reason: 'x'.repeat(41) }));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), snapshot: 'x'.repeat(201) }));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), createdAt: Date.now() + 400000 }));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), severity: 'max' }));
    const { offenderUid, ...noOffender } = commentReport();
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set(noOffender));
    // A reader cannot report themselves (it would put their own words in the queue as someone else's).
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), offenderUid: OWNER }));
  });

  test('REFUSED: a profile report must name the profile its key names', async () => {
    await assertFails(owner.ref(`content_reports/${K_USER}/${OWNER}`).set({ ...userReport(), offenderUid: OTHER, contextPath: `users/${OTHER}` }));
    await assertFails(owner.ref(`content_reports/${K_USER}/${OWNER}`).set({ ...userReport(), contextPath: `users/${OTHER}` }));
  });
});

describe('W5 · content_reports — never overwritten', () => {
  test('REFUSED: the reporter cannot rewrite, soften or delete their report', async () => {
    await seed(env, { [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport() });
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), reason: 'spam' }));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}/reason`).set('spam'));
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${OWNER}`).remove());
  });

  test('REFUSED: a moderator cannot rewrite or delete a report either — only resolve', async () => {
    await seedModerator();
    await seed(env, { [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport() });
    await assertFails(other.ref(`content_reports/${K_COMMENT}/${OWNER}`).set({ ...commentReport(), reason: 'spam' }));
    await assertFails(other.ref(`content_reports/${K_COMMENT}`).remove());
    await assertFails(other.ref('content_reports').remove());
  });
});

describe('W5 · content_reports — who may read and resolve', () => {
  test('LEGITIMATE: a moderator (canRemovePosts) reads the queue and resolves under their own uid', async () => {
    await seedModerator();
    await seed(env, { [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport() });
    await assertSucceeds(other.ref('content_reports').get());
    await assertSucceeds(other.ref(`content_reports/${K_COMMENT}`).update({ resolved: true, resolvedBy: OTHER, resolvedAt: Date.now() }));
  });

  test('REFUSED: resolving in someone else\'s name', async () => {
    await seedModerator();
    await seed(env, { [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport() });
    await assertFails(other.ref(`content_reports/${K_COMMENT}`).update({ resolved: true, resolvedBy: FOUNDER_A, resolvedAt: Date.now() }));
  });

  test('REFUSED: a reader cannot read the queue, another reader\'s report, or resolve their own', async () => {
    await seed(env, {
      [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport(),
      [`content_reports/${K_COMMENT}/${STRANGER}`]: { ...commentReport(STRANGER), offenderUid: OTHER },
    });
    await assertFails(owner.ref('content_reports').get());
    await assertFails(owner.ref(`content_reports/${K_COMMENT}`).get());
    await assertFails(owner.ref(`content_reports/${K_COMMENT}/${STRANGER}`).get());
    await assertFails(anon.ref(`content_reports/${K_COMMENT}/${OWNER}`).get());
    await assertFails(owner.ref(`content_reports/${K_COMMENT}`).update({ resolved: true }));
  });

  test('REFUSED: a founder session WITHOUT canRemovePosts reads nothing — the switch is the grant', async () => {
    await seed(env, { [`content_reports/${K_COMMENT}/${OWNER}`]: commentReport() });
    await assertFails(founder.ref('content_reports').get());
  });
});

describe('W5 · a DM report cannot expose the thread (RULED)', () => {
  test('the record carries one message, from the offender, in the reporter\'s own conversation', async () => {
    await seedThread();
    await assertSucceeds(owner.ref(`content_reports/${K_DM}/${OWNER}`).set(dmReport()));
  });

  test('REFUSED: a snapshot that is not that message — two messages joined, or text the offender never sent', async () => {
    await seedThread();
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), snapshot: `${MSG_TEXT} Another message in the thread.` }));
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), snapshot: 'Words nobody sent.' }));
  });

  test('REFUSED: pointing at the whole conversation, or at the reporter\'s own message', async () => {
    await seedThread();
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), contextPath: `dm_messages/${CONV}` }));
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), contextPath: `dm_messages/${CONV}/`, snapshot: '' }));
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), contextPath: `dm_messages/${CONV}/-Omsg0003`, snapshot: 'The reporter' }));
  });

  test('REFUSED: a field that could carry the thread, or a snapshot over 200', async () => {
    await seedThread();
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), thread: { a: MSG_TEXT, b: 'Another message in the thread.' } }));
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), messages: [MSG_TEXT] }));
    const long = 'y'.repeat(260);
    await seed(env, { [`dm_messages/${CONV}/-Omsglong`]: { text: long, senderUid: STRANGER, createdAt: 4 } });
    await assertFails(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), contextPath: `dm_messages/${CONV}/-Omsglong`, snapshot: long }));
    await assertSucceeds(owner.ref(`content_reports/${K_DM}/${OWNER}`).set({ ...dmReport(), contextPath: `dm_messages/${CONV}/-Omsglong`, snapshot: snapshotOf(long) }));
  });

  test('REFUSED: reporting a conversation you are not in', async () => {
    await seedThread();
    const outsider = { ...dmReport(), reporterUid: OTHER };
    await assertFails(other.ref(`content_reports/${K_DM}/${OTHER}`).set(outsider));
    const theirs = convIdFor(OTHER, STRANGER);
    await assertFails(other.ref(`content_reports/dm_${theirs}/${OTHER}`).set({ ...outsider, contextPath: `dm_messages/${CONV}/${MSG}` }));
  });

  test('a moderator who is not in the conversation cannot read the thread itself', async () => {
    await seedThread();
    await seedModerator();
    await seed(env, { [`content_reports/${K_DM}/${OWNER}`]: dmReport() });
    await assertSucceeds(other.ref(`content_reports/${K_DM}`).get());
    await assertFails(other.ref(`dm_messages/${CONV}`).get());
    await assertFails(other.ref(`dm_messages/${CONV}/-Omsg0002`).get());
  });
});
