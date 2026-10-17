// W46 — the Readers' Notes UI suite's fixture: emulator seed, a stand-in for the endpoint, and a
// recorder for every database path the page asks for.
//
// HERMETIC. Everything is written to the Firebase emulators through the admin SDK
// (tests/series/harness.mjs), never to production. The one production touch is a signed-out,
// read-only GET of the PUBLIC `series` node to borrow one published slug, because the room is a
// static route that `next dev` only serves for slugs generateStaticParams knows (the same
// borrowing as tests/series/w40-free.spec.mjs). Every request off localhost is refused except
// fonts, and every non-GET off localhost too.
//
// THE ENDPOINT STAND-IN. functions/api/series/notes.js is a Pages Function, which `next dev`
// does not run. The stub answers POST /api/series/notes with the documented shapes
// (docs/series-notes.md) and performs the endpoint's writes on the emulator with the admin SDK,
// so the page's follow-up reads see what production would. It trusts the uid the test tells it,
// not a token.
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp, adminToken } from '../../series/harness.mjs';
import { moveTally } from '../../../app/lib/series/notes.js';

const PROD = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const READER = 'w46-ui-reader';
export const OTHERS = ['w46-ui-ada', 'w46-ui-ben', 'w46-ui-cam', 'w46-ui-dee'];
export const WRITER = 'w46-ui-writer';
export const GATED = ['series_notes', 'series_note_replies', 'series_side_tallies', 'series_questions', 'series_note_underlines', 'series_notes_held'];

/** One published slug from production, read signed out. */
export async function borrowSlug() {
  const keys = Object.keys((await (await fetch(`${PROD}/series.json?shallow=true`)).json()) || {});
  for (const k of keys) {
    const status = await (await fetch(`${PROD}/series/${encodeURIComponent(k)}/status.json`)).json();
    if (status === 'published') return k;
  }
  throw new Error('no published series slug to borrow');
}

export function ids(slug) {
  return { slug, i1: `${slug}-w46a`, i2: `${slug}-w46b`, i3: `${slug}-w46c` };
}

const QUESTIONS = {
  sit: 'What did the river take from her that she never asked to have returned?',
  side: { text: 'Was Ama right to leave the city before the trial?', options: { a: 'Freedom', b: 'Duty' } },
  line: 'Which line did you carry out of this instalment?',
};

// W48 §2 — each reader's LIVE record carries a different island badge, and every stored author
// snapshot claims Immortal (badge 1000), so a room drawing the snapshot instead of the live read
// count shows the wrong title everywhere. dee is a writer (the Square's Writer badge); the
// series' own writer is a writer too, and must show the room's WRITER mark instead.
export const BADGES = Object.freeze({
  'w46-ui-ada': { readCount: 30 },                     // Reader
  'w46-ui-ben': { readCount: 75 },                     // Island Reader
  'w46-ui-cam': { readCount: 160, displayName: 'Camilla Oyelaran-Whitfield of the Lagos Ferry' }, // Legend of the Island
  'w46-ui-dee': { readCount: 40, isAuthor: true },     // Writer
  'w46-ui-reader': { readCount: 1000 },                // Immortal of the Island
  'w46-ui-writer': { readCount: 30, isAuthor: true },  // the series' writer: WRITER mark
});
const STALE = 1000;

const LONG = Array.from({ length: 14 }, (_, i) => `This is the ${i + 1}th sentence of a long note that should fold behind Read more after six lines.`).join(' ');

/** Wipe and seed. `reader` is one of 'none' | 'sealed' | 'finished' | 'member'. */
export async function seed(app, slug, { reader = 'none' } = {}) {
  const db = getDatabase(app);
  const now = Date.now();
  const { i1, i2, i3 } = ids(slug);
  for (const node of ['series', 'series_instalments', 'series_instalments_detail', 'series_notes_summary', 'series_questions',
    'series_questions_public', 'series_notes', 'series_note_replies', 'series_note_underlines', 'series_side_tallies',
    'series_room_members', 'series_sides', 'series_finished', 'series_reading_progress', 'series_notes_held', 'series_margin', 'series_reads']) {
    await db.ref(node).set(null);
  }
  const user = (uid, name, handle) => ({
    [`users/${uid}/displayName`]: name, [`users/${uid}/username`]: handle, [`usernames/${handle}`]: uid, [`users/${uid}/readCount`]: 30,
  });
  const series = (id, title, extra = {}) => ({
    [`series/${id}`]: { schemaVersion: 1, slug: id, title, synopsis: 'A fixture, not a book.', coverUrl: '/logo-header.jpg', status: 'published', addedAt: now, updatedAt: now,
      author: 'Fixture Writer', authorUid: WRITER, authorHandle: 'fixturewriter', ...extra },
  });
  const inst = (id, seriesId, ordinal, releaseAtMs) => ({
    [`series_instalments/${id}`]: { schemaVersion: 1, seriesId, ordinal, releaseAtMs, freeForGold: true, status: 'published', addedAt: now, updatedAt: now },
    [`series_instalments_detail/${id}`]: { schemaVersion: 1, title: `Fixture Instalment ${ordinal}`, synopsis: null, logline: null, author: 'Fixture Writer',
      authorUid: WRITER, authorHandle: 'fixturewriter', coverUrl: null, epubPath: null, sponsorName: null, sponsorLogoUrl: null, wordCount: null, updatedAt: now },
  });
  const note = (uid, kind, text, createdAt, extra = {}) => ({ uid, kind, text, createdAt, author: { name: uid.replace('w46-ui-', '').toUpperCase(), handle: uid.replace('w46-ui-', ''), badge: STALE }, ...extra });
  const line = { text: 'The river keeps what the city forgets.', cfi: 'epubcfi(/6/4!/4/2/1:0)', epubVersion: '17' };
  const notes = {
    nw: note(WRITER, 'sit', 'I wrote this chapter in a week of rain. She never wanted it back.', now - 5 * HOUR, { writer: true, author: { name: 'Fixture Writer', handle: 'fixturewriter', badge: STALE } }),
    n1: note(OTHERS[0], 'sit', 'Her name. She gave it to the water on purpose.', now - 4 * HOUR),
    n2: note(OTHERS[1], 'side', 'Staying would have meant testifying against her brother.', now - 3 * HOUR, { side: 'a' }),
    n3: note(OTHERS[2], 'side', 'A trial is the only room where the city listens.', now - 2 * HOUR, { side: 'b' }),
    n4: note(OTHERS[0], 'line', 'I read it three times on the bus.', now - 90 * 60_000, { line }),
    n5: note(OTHERS[3], 'line', 'Same line. It is the whole book in a sentence.', now - 80 * 60_000, { line }),
    n6: note(OTHERS[1], 'line', 'This one, quieter.', now - 70 * 60_000, { line: { ...line, text: 'Nobody drowns in a river they named.' } }),
    n7: note(OTHERS[2], 'else', LONG, now - 60 * 60_000),
  };
  const replies = {
    n1: {
      r1: { uid: OTHERS[1], text: 'Yes, and the ferryman knew.', createdAt: now - 3.5 * HOUR, author: { name: 'BEN', handle: 'ben', badge: STALE } },
      r2: { uid: OTHERS[2], text: 'I took it the other way.', createdAt: now - 3.4 * HOUR, author: { name: 'CAM', handle: 'cam', badge: STALE }, replyTo: 'r1' },
      r3: { uid: OTHERS[3], text: '', createdAt: now - 3.3 * HOUR, author: { name: 'DEE', handle: 'dee', badge: STALE }, removed: true },
      r4: { uid: OTHERS[0], text: 'Fair.', createdAt: now - 3.2 * HOUR, author: { name: 'ADA', handle: 'ada', badge: STALE } },
    },
  };
  const underlines = { n1: { [OTHERS[1]]: true, [OTHERS[2]]: true, [OTHERS[3]]: true }, n4: { [OTHERS[1]]: true } };
  const B = 'notes-w46-soft', Cc = 'notes-w46-faint', D = 'notes-w46-closed';
  await db.ref().update({
    ...user(READER, 'Fixture Reader', 'w46reader'),
    ...Object.fromEntries(OTHERS.flatMap((u) => Object.entries(user(u, u.replace('w46-ui-', '').toUpperCase(), u.replace('w46-ui-', ''))))),
    ...user(WRITER, 'Fixture Writer', 'fixturewriter'),
    ...Object.fromEntries(Object.entries(BADGES).flatMap(([uid, rec]) => Object.entries(rec).map(([k, v]) => [`users/${uid}/${k}`, v]))),
    ...series(slug, 'Notes Fixture Series'),
    ...inst(i1, slug, 1, now - 9 * DAY),
    ...inst(i2, slug, 2, now - DAY),
    ...inst(i3, slug, 3, now + 3 * DAY),
    ...series(B, 'Soft Light Series'),
    ...inst(`${B}-i1`, B, 1, now - 5 * DAY),
    ...series(Cc, 'Faint Light Series'),
    ...inst(`${Cc}-i1`, Cc, 1, now - 5 * DAY),
    ...series(D, 'Closed Door Series'),
    ...inst(`${D}-i1`, D, 1, now + 3 * DAY),
    [`series_questions/${i1}`]: { ...QUESTIONS, publishedAt: now - 9 * DAY },
    [`series_questions/${i2}`]: { ...QUESTIONS, publishedAt: now - DAY },
    [`series_questions_public/${i1}`]: { sit: 'An older question.', publishedAt: now - 9 * DAY },
    [`series_questions_public/${i2}`]: { sit: QUESTIONS.sit, publishedAt: now - DAY },
    [`series_questions_public/${B}-i1`]: { sit: 'What did the lamp see?', publishedAt: now - 5 * DAY },
    // W49, ruling 177 — the instalments' reads: "1,203 reads" + "1 read" = "1,204 reads" in the hero.
    [`series_reads/${i1}`]: 1203,
    [`series_reads/${i2}`]: 1,
    [`series_notes/${i2}`]: notes,
    [`series_note_replies/${i2}`]: replies,
    [`series_note_underlines/${i2}`]: underlines,
    [`series_side_tallies/${i2}`]: { a: 7, b: 5 },
    [`series_notes_summary/${slug}`]: {
      inst: i2, ordinal: 2, sit: QUESTIONS.sit, sitAnswers: 2, notes: 8, readers: 6, lastAt: now - 30 * 60_000,
      latestNotes: [now - 30 * 60_000, now - 60 * 60_000, now - 2 * HOUR, now - 30 * DAY],
      faces: [{ initials: 'AD' }, { initials: 'BE' }, { initials: 'CA' }, { initials: 'DE' }],
      byInst: {
        [i1]: { ordinal: 1, notes: 3, readers: 3, kinds: { side: 2, sit: 1, line: 1, else: 0 }, lastAt: now - 8 * DAY },
        [i2]: { ordinal: 2, notes: 8, readers: 6, kinds: { side: 12, sit: 2, line: 3, else: 1 }, lastAt: now - 30 * 60_000 },
      },
    },
    [`series_notes_summary/${B}`]: { inst: `${B}-i1`, ordinal: 1, notes: 2, readers: 2, lastAt: now - 24 * HOUR, faces: [{ initials: 'AB' }],
      byInst: { [`${B}-i1`]: { ordinal: 1, notes: 2, readers: 2, kinds: { side: 1, sit: 1, line: 0, else: 0 }, lastAt: now - 24 * HOUR } } },
    [`series_notes_summary/${Cc}`]: { inst: `${Cc}-i1`, ordinal: 1, notes: 4, readers: 3, lastAt: now - 4 * DAY,
      byInst: { [`${Cc}-i1`]: { ordinal: 1, notes: 4, readers: 3, kinds: { side: 0, sit: 0, line: 0, else: 4 }, lastAt: now - 4 * DAY } } },
  });
  if (reader === 'sealed') {
    await db.ref(`series_reading_progress/${READER}/${i2}`).set({ fraction: 0.42, updatedAt: now - HOUR });
  }
  if (reader === 'finished' || reader === 'member') {
    await db.ref(`series_finished/${READER}/${i2}`).set(now - 10 * 60_000);
  }
  if (reader === 'member') {
    await db.ref().update({
      [`series_room_members/${i2}/${READER}`]: now - 9 * 60_000,
      [`series_sides/${i2}/${READER}`]: 'a',
      [`series_side_tallies/${i2}`]: { a: 8, b: 5 },
      [`series_note_underlines/${i2}/n4/${READER}`]: true,
      [`series_margin/${READER}/${i2}`]: { ...line, savedAt: now - 20 * 60_000 },
      [`series_notes_held/${i2}/h1`]: note(READER, 'else', 'A held thought of mine.', now - 5 * 60_000, { reason: 'other' }),
    });
  }
}

/**
 * The fence plus the endpoint stand-in. `endpoint.mode`: 'ok' | 'held' | 'fail' for notes and
 * replies. Returns the list of endpoint calls made.
 */
export async function fence(page, app, { endpoint = { mode: 'ok' } } = {}) {
  const calls = [];
  const db = getDatabase(app);
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* */ } });
  await page.route('**/*', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (local && u.pathname === '/api/series/notes') {
      const body = JSON.parse(req.postData() || '{}');
      calls.push(body);
      const send = (status, data) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      const uid = READER;
      const now = Date.now();
      if (body.action === 'side') {
        const prev = (await db.ref(`series_sides/${body.inst}/${uid}`).get()).val();
        const tally = moveTally((await db.ref(`series_side_tallies/${body.inst}`).get()).val() || {}, prev, body.option);
        await db.ref().update({ [`series_sides/${body.inst}/${uid}`]: body.option, [`series_side_tallies/${body.inst}`]: tally, [`series_room_members/${body.inst}/${uid}`]: now });
        return send(200, { ok: true, side: body.option, tally });
      }
      if (body.action === 'note' || body.action === 'reply') {
        if (endpoint.mode === 'fail') return send(503, { ok: false, code: 'unavailable', error: 'We couldn’t reach the room just now. Try again in a moment.' });
        const held = endpoint.mode === 'held';
        const author = { name: 'Fixture Reader', handle: 'w46reader' };
        if (body.action === 'note') {
          const noteId = `p${now}`;
          const side = body.kind === 'side' ? (await db.ref(`series_sides/${body.inst}/${uid}`).get()).val() : undefined;
          const note = { uid, kind: body.kind, text: body.text, createdAt: now, author, ...(side ? { side } : {}), ...(body.line ? { line: body.line } : {}) };
          await db.ref().update({ [`${held ? 'series_notes_held' : 'series_notes'}/${body.inst}/${noteId}`]: held ? { ...note, reason: 'other' } : note, [`series_room_members/${body.inst}/${uid}`]: now });
          return send(200, { ok: true, noteId, status: held ? 'held' : 'live', note });
        }
        const replyId = `q${now}`;
        const reply = { uid, text: body.text, createdAt: now, author, ...(body.replyTo ? { replyTo: body.replyTo } : {}) };
        await db.ref(`series_note_replies/${body.inst}/${body.noteId}/${replyId}`).set(reply);
        return send(200, { ok: true, replyId, status: held ? 'held' : 'live', reply });
      }
      if (body.action === 'remove') {
        await db.ref(body.replyId ? `series_note_replies/${body.inst}/${body.noteId}/${body.replyId}/removed` : `series_notes/${body.inst}/${body.noteId}`).set(body.replyId ? true : null);
        return send(200, { ok: true });
      }
      return send(400, { ok: false, code: 'bad_request', error: 'bad' });
    }
    if (!local && !/fonts\.(googleapis|gstatic)/.test(u.hostname)) return r.abort();
    if (!local && req.method() !== 'GET') return r.abort();
    return r.continue();
  });
  return calls;
}

/** Every database path the page asks the emulator for (listens and one-shot gets). */
export function recordPaths(page) {
  const paths = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : f.payload.toString();
      try {
        const m = JSON.parse(text);
        const p = m?.d?.b?.p;
        if (typeof p === 'string' && ['q', 'g', 'n'].includes(m?.d?.a)) paths.push(p.replace(/^\/+/, ''));
      } catch { /* a control frame */ }
    });
  });
  return paths;
}

/** The paths among `paths` that fall under a gated node (segment-exact). */
export const gatedOf = (paths) => paths.filter((p) => GATED.includes(p.split('/')[0]));

export async function signIn(page, app, uid = READER) {
  const token = await adminToken(app, uid);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 90000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
}

export { adminApp, closeApp };
