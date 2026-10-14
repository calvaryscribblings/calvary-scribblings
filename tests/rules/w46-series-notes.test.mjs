// W46 — READERS' NOTES FOR THE SERIES, AGAINST THE REAL RULES (emulator). Rulings 157–166.
//
// The claim this suite exists to prove (ruling 160, and the brief's first experience standard):
// nothing from a sealed instalment reaches a reader who hasn't finished it, and that is enforced
// by the RULES, not only by the screens. Every node in docs/series-notes.md is exercised in both
// directions:
//   · a non-finisher reads no questions, notes, replies, underlines or tallies;
//   · a finisher who hasn't joined reads the questions but no notes, replies or tallies;
//   · a finished member reads all of them;
//   · held notes are visible only to their author and the admins;
//   · nobody but the endpoint (an Admin SDK, which the rules do not judge) writes notes,
//     replies, sides, tallies, members or the summary — founders included;
//   · series_finished is the reader's own, a past-or-present time, on a published, released
//     instalment only.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, OTHER, FOUNDER_A } from './helpers.mjs';

const T0 = 1_760_000_000_000;
const PAST = Date.now() - 86_400_000;
const FUTURE = Date.now() + 30 * 86_400_000;
const INST = 'probe-series-i1';
const LATER = 'probe-series-i2';
const ROW = (over = {}) => ({ schemaVersion: 1, seriesId: 'probe-series', ordinal: 1, releaseAtMs: PAST, freeForGold: false, status: 'published', addedAt: T0, updatedAt: T0, ...over });
const QUESTIONS = { sit: 'What did the house keep?', side: { text: 'Was she right to leave?', options: { a: 'Yes', b: 'No' } }, line: 'Which line stayed?', publishedAt: T0 };
const NOTE = (uid, over = {}) => ({ uid, kind: 'sit', text: 'A note.', author: { name: 'Reader' }, createdAt: T0, ...over });

// The world every test starts from:
//   OWNER    — finished INST and joined its room (a finished member).
//   STRANGER — finished INST, has not joined.
//   OTHER    — has not finished INST.
const WORLD = () => ({
  'series_instalments/probe-series-i1': ROW(),
  'series_instalments/probe-series-i2': ROW({ ordinal: 2, releaseAtMs: FUTURE }),
  [`series_finished/${OWNER}/${INST}`]: PAST,
  [`series_finished/${STRANGER}/${INST}`]: PAST,
  [`series_room_members/${INST}/${OWNER}`]: PAST,
  [`series_questions/${INST}`]: QUESTIONS,
  [`series_questions_public/${INST}`]: { sit: QUESTIONS.sit, publishedAt: T0 },
  [`series_question_drafts/${INST}`]: { sit: 'draft', updatedAt: T0 },
  [`series_sides/${INST}/${OWNER}`]: 'a',
  [`series_side_tallies/${INST}`]: { a: 1 },
  [`series_notes/${INST}/n1`]: NOTE(OWNER),
  [`series_notes/${INST}/n2`]: NOTE(OTHER),
  [`series_notes_held/${INST}/h1`]: { ...NOTE(OWNER), reason: 'abuse' },
  [`series_notes_held/${INST}/h2`]: { ...NOTE(STRANGER), reason: 'spam' },
  [`series_note_replies/${INST}/n1/r1`]: { uid: OWNER, text: 'A reply.', author: { name: 'Reader' }, createdAt: T0 },
  [`series_note_underlines/${INST}/n1/${OWNER}`]: true,
  [`series_note_reports/${INST}/n2/${OWNER}`]: { at: T0 },
  [`series_notes_summary/probe-series`]: { inst: INST, ordinal: 1, notes: 2, readers: 1, lastAt: T0 },
});

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
beforeEach(async () => { await env.clearDatabase(); await seed(env, WORLD()); });

const GATED = [
  ['questions', `series_questions/${INST}`],
  ['tallies', `series_side_tallies/${INST}`],
  ['notes', `series_notes/${INST}`],
  ['one note', `series_notes/${INST}/n1`],
  ['replies', `series_note_replies/${INST}`],
  ['underlines', `series_note_underlines/${INST}`],
];

describe('W46 · a negative control: these rules are loaded', () => {
  test('an unauthenticated write to an admin-only node is refused', async () => {
    await assertFails(anon.ref(`series_question_drafts/${INST}`).set({ sit: 'x' }));
  });
});

describe('W46 · a reader who has not finished reads nothing sealed (ruling 160)', () => {
  for (const [what, path] of GATED) {
    test(`not-finished: ${what} refused`, async () => { await assertFails(other.ref(path).get()); });
    test(`signed out: ${what} refused`, async () => { await assertFails(anon.ref(path).get()); });
  }
  test('but the Sit with this question is public (ruling 162), and so is the summary', async () => {
    await assertSucceeds(anon.ref(`series_questions_public/${INST}`).get());
    await assertSucceeds(anon.ref('series_notes_summary/probe-series').get());
    await assertSucceeds(other.ref(`series_questions_public/${INST}`).get());
  });
});

describe('W46 · a finisher who has not joined reads the questions, and no notes', () => {
  test('questions: allowed', async () => { await assertSucceeds(stranger.ref(`series_questions/${INST}`).get()); });
  for (const [what, path] of GATED.filter(([w]) => w !== 'questions')) {
    test(`not joined: ${what} refused`, async () => { await assertFails(stranger.ref(path).get()); });
  }
});

describe('W46 · a finished member reads the room', () => {
  for (const [what, path] of GATED) {
    test(`member: ${what} allowed`, async () => { await assertSucceeds(owner.ref(path).get()); });
  }
  test('membership of one instalment opens only that one', async () => {
    await seed(env, { [`series_notes/${LATER}/n9`]: NOTE(OTHER) });
    await assertFails(owner.ref(`series_notes/${LATER}`).get());
  });
  test('the admins read every room', async () => {
    for (const [, path] of GATED) await assertSucceeds(founder.ref(path).get());
  });
});

describe('W46 · held notes: their author and the admins only', () => {
  test('the author reads their own held note', async () => {
    await assertSucceeds(owner.ref(`series_notes_held/${INST}/h1`).get());
  });
  test('the author lists their own held notes by uid query', async () => {
    await assertSucceeds(owner.ref(`series_notes_held/${INST}`).orderByChild('uid').equalTo(OWNER).get());
  });
  test('a member cannot read somebody else’s held note, nor list them', async () => {
    await assertFails(owner.ref(`series_notes_held/${INST}/h2`).get());
    await assertFails(owner.ref(`series_notes_held/${INST}`).get());
    await assertFails(owner.ref(`series_notes_held/${INST}`).orderByChild('uid').equalTo(STRANGER).get());
  });
  test('signed out: refused', async () => { await assertFails(anon.ref(`series_notes_held/${INST}/h1`).get()); });
  test('the admins read them all', async () => { await assertSucceeds(founder.ref(`series_notes_held/${INST}`).get()); });
});

describe('W46 · nobody but the endpoint writes', () => {
  const ENDPOINT_ONLY = [
    ['a note', `series_notes/${INST}/x`, NOTE(OWNER)],
    ['a held note', `series_notes_held/${INST}/x`, { ...NOTE(OWNER), reason: 'x' }],
    ['a reply', `series_note_replies/${INST}/n1/x`, { uid: OWNER, text: 'x', createdAt: T0 }],
    ['a side', `series_sides/${INST}/${OWNER}`, 'b'],
    ['a tally', `series_side_tallies/${INST}/a`, 99],
    ['membership', `series_room_members/${INST}/${STRANGER}`, T0],
    ['the summary', 'series_notes_summary/probe-series', { notes: 999 }],
  ];
  for (const [what, path, value] of ENDPOINT_ONLY) {
    test(`${what}: refused to its owner, to a stranger and to a founder`, async () => {
      await assertFails(owner.ref(path).set(value));
      await assertFails(stranger.ref(path).set(value));
      await assertFails(founder.ref(path).set(value));
    });
  }
  test('nor can anyone delete a note', async () => {
    await assertFails(owner.ref(`series_notes/${INST}/n1`).remove());
    await assertFails(founder.ref(`series_notes/${INST}/n1`).remove());
  });
});

describe('W46 · series_finished: the reader’s own, on a released instalment', () => {
  test('the reader writes their own, at the server’s now', async () => {
    await assertSucceeds(other.ref(`series_finished/${OTHER}/${INST}`).set({ '.sv': 'timestamp' }));
  });
  test('a past time is accepted, a future one refused', async () => {
    await assertSucceeds(other.ref(`series_finished/${OTHER}/${INST}`).set(PAST));
    await assertFails(other.ref(`series_finished/${OTHER}/${INST}`).set(FUTURE));
  });
  test('not for somebody else', async () => {
    await assertFails(other.ref(`series_finished/${STRANGER}/${INST}`).set(PAST));
  });
  test('not for an unreleased instalment', async () => {
    await assertFails(other.ref(`series_finished/${OTHER}/${LATER}`).set(PAST));
  });
  test('not for an unpublished one', async () => {
    await seed(env, { [`series_instalments/${INST}/status`]: 'unpublished' });
    await assertFails(other.ref(`series_finished/${OTHER}/${INST}`).set(PAST));
  });
  test('not a string, not zero', async () => {
    await assertFails(other.ref(`series_finished/${OTHER}/${INST}`).set('yes'));
    await assertFails(other.ref(`series_finished/${OTHER}/${INST}`).set(0));
  });
  test('owner read only', async () => {
    await assertSucceeds(owner.ref(`series_finished/${OWNER}`).get());
    await assertFails(stranger.ref(`series_finished/${OWNER}`).get());
    await assertFails(anon.ref(`series_finished/${OWNER}`).get());
  });
  test('writing finished does not by itself open the notes (membership is the endpoint’s)', async () => {
    await assertSucceeds(other.ref(`series_finished/${OTHER}/${INST}`).set(PAST));
    await assertSucceeds(other.ref(`series_questions/${INST}`).get());
    await assertFails(other.ref(`series_notes/${INST}`).get());
  });
});

describe('W46 · questions and drafts', () => {
  test('a founder publishes; a reader cannot', async () => {
    await assertSucceeds(founder.ref(`series_questions/${INST}`).set(QUESTIONS));
    await assertSucceeds(founder.ref(`series_questions_public/${INST}`).set({ sit: QUESTIONS.sit, publishedAt: T0 }));
    await assertFails(owner.ref(`series_questions/${INST}`).set(QUESTIONS));
    await assertFails(owner.ref(`series_questions_public/${INST}`).set({ sit: 'x', publishedAt: T0 }));
  });
  test('a side needs two options, at most four, keyed a–d', async () => {
    await assertFails(founder.ref(`series_questions/${INST}`).set({ ...QUESTIONS, side: { text: 'x', options: { a: 'Yes' } } }));
    await assertFails(founder.ref(`series_questions/${INST}`).set({ ...QUESTIONS, side: { text: 'x', options: { a: 'Yes', b: 'No', e: 'Maybe' } } }));
    await assertSucceeds(founder.ref(`series_questions/${INST}`).set({ ...QUESTIONS, side: { text: 'x', options: { a: '1', b: '2', c: '3', d: '4' } } }));
  });
  test('the public node carries the Sit question and nothing else', async () => {
    await assertFails(founder.ref(`series_questions_public/${INST}`).set({ sit: 'x', publishedAt: T0, line: 'leak' }));
  });
  test('drafts are the admins’ alone, in both directions', async () => {
    await assertSucceeds(founder.ref(`series_question_drafts/${INST}`).get());
    await assertSucceeds(founder.ref(`series_question_drafts/${INST}`).set({ sit: 'x' }));
    await assertFails(owner.ref(`series_question_drafts/${INST}`).get());
    await assertFails(anon.ref(`series_question_drafts/${INST}`).get());
    await assertFails(owner.ref(`series_question_drafts/${INST}`).set({ sit: 'x' }));
  });
});

describe('W46 · private records: sides, membership, the margin', () => {
  test('a side is its owner’s to read, nobody else’s', async () => {
    await assertSucceeds(owner.ref(`series_sides/${INST}/${OWNER}`).get());
    await assertFails(stranger.ref(`series_sides/${INST}/${OWNER}`).get());
    await assertFails(owner.ref(`series_sides/${INST}`).get());
  });
  test('membership: owner read, no listing', async () => {
    await assertSucceeds(owner.ref(`series_room_members/${INST}/${OWNER}`).get());
    await assertFails(owner.ref(`series_room_members/${INST}`).get());
    await assertFails(stranger.ref(`series_room_members/${INST}/${OWNER}`).get());
  });
  const MARGIN = { text: 'It was the kind of quiet that keeps.', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:20)', epubVersion: '1712', savedAt: PAST };
  test('the margin: owner only, both ways', async () => {
    await assertSucceeds(other.ref(`series_margin/${OTHER}/${INST}`).set(MARGIN));
    await assertSucceeds(other.ref(`series_margin/${OTHER}/${INST}`).get());
    await assertFails(owner.ref(`series_margin/${OTHER}/${INST}`).get());
    await assertFails(owner.ref(`series_margin/${OTHER}/${INST}`).set(MARGIN));
  });
  test('the margin’s line is at most 400 characters and carries its place', async () => {
    await assertFails(other.ref(`series_margin/${OTHER}/${INST}`).set({ ...MARGIN, text: 'x'.repeat(401) }));
    const { cfi, ...noCfi } = MARGIN;
    await assertFails(other.ref(`series_margin/${OTHER}/${INST}`).set(noCfi));
    await assertFails(other.ref(`series_margin/${OTHER}/${INST}`).set({ ...MARGIN, extra: 1 }));
  });
});

describe('W46 · Underline (ruling 165) and Report', () => {
  test('a finished member underlines a note, and takes it back', async () => {
    await assertSucceeds(owner.ref(`series_note_underlines/${INST}/n2/${OWNER}`).set(true));
    await assertSucceeds(owner.ref(`series_note_underlines/${INST}/n2/${OWNER}`).remove());
  });
  test('only as themselves, only true, only on a note that exists', async () => {
    await assertFails(owner.ref(`series_note_underlines/${INST}/n2/${STRANGER}`).set(true));
    await assertFails(owner.ref(`series_note_underlines/${INST}/n2/${OWNER}`).set(5));
    await assertFails(owner.ref(`series_note_underlines/${INST}/nope/${OWNER}`).set(true));
  });
  test('a finisher who has not joined, and a non-finisher, cannot underline', async () => {
    await assertFails(stranger.ref(`series_note_underlines/${INST}/n2/${STRANGER}`).set(true));
    await assertFails(other.ref(`series_note_underlines/${INST}/n1/${OTHER}`).set(true));
  });
  test('a member reports a note; only the admins read reports', async () => {
    await assertSucceeds(owner.ref(`series_note_reports/${INST}/n1/${OWNER}`).set({ at: Date.now(), reason: 'unkind' }));
    await assertFails(owner.ref(`series_note_reports/${INST}/n1/${OWNER}`).get());
    await assertFails(owner.ref(`series_note_reports/${INST}`).get());
    await assertSucceeds(founder.ref(`series_note_reports/${INST}`).get());
  });
  test('a report is shaped, and only by a member, as themselves', async () => {
    await assertFails(owner.ref(`series_note_reports/${INST}/n1/${OWNER}`).set({ at: Date.now(), reason: 'x'.repeat(201) }));
    await assertFails(owner.ref(`series_note_reports/${INST}/n1/${OWNER}`).set({ at: Date.now(), extra: true }));
    await assertFails(owner.ref(`series_note_reports/${INST}/n1/${STRANGER}`).set({ at: Date.now() }));
    await assertFails(stranger.ref(`series_note_reports/${INST}/n1/${STRANGER}`).set({ at: Date.now() }));
  });
});

describe('W46 · the public half holds no words a reader wrote', () => {
  test('signed out, the summary is readable and the gated nodes are not', async () => {
    const s = (await anon.ref('series_notes_summary/probe-series').get()).val();
    assert.equal(s.notes, 2);
    await assertFails(anon.ref(`series_notes/${INST}`).get());
  });
});
