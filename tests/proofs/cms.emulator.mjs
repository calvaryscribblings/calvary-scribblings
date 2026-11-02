// PROOFS-R2 — THE CMS UNDER THE NEW RULES, before they go live.
//
//   npm run test:proofs:emulator        (database emulator, port 9410)
//
// The rules deploy goes out BEFORE the code, and the one client "no text unless live" restricts is
// the founders' CMS. So every way the CMS writes cms_stories is run here, against database.rules.json
// as it will be deployed, as a stand-in founder, for BOTH versions of the CMS:
//
//   · origin/main — what is live now, and what will run under the new rules until the push;
//   · this tree   — what goes live after the push.
//
// NOT HAND-MADE FIXTURES. The CMS's handlers (app/admin/page.js: saveStory, deleteStory, hideStory,
// unhideStory; app/admin/extract-text/page.js: extractOne; app/admin/quizzes/page.js:
// handleSaveDraft, handleApprove) are cut out of each version's own source with a parser and run
// as written. Only what the browser would supply is stood in: the editor's form, the list the
// editor sees, the founder's database handle, and no-op UI setters. `await import('firebase/database')`
// is pointed at a database handle that writes AS THE STAND-IN FOUNDER, under the rules.
//
// The scheduled-publish Worker runs unmodified too; it writes with the legacy secret and bypasses
// rules, so its go-live PATCH is captured and replayed AS the stand-in founder. It must pass anyway.
//
// NO FOUNDER ACCOUNT: the two founder uids in the rules are swapped for same-length stand-ins (see
// rules.emulator.mjs, which proves the swap touches nothing else).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';
import * as storyIndex from '../../app/lib/storyIndex.js';
import * as storyAccess from '../../app/lib/storyAccess.js';
import * as htmlBlocks from '../../app/lib/htmlBlocks.js';
import * as coverDescriptor from '../../app/lib/coverDescriptor.js';
import * as storyState from '../../app/lib/storyState.js';
import * as storyText from '../../app/lib/storyText.js';
import * as storySlug from '../../app/lib/storySlug.js';
import * as retiredStories from '../../app/lib/retiredStories.js';
// LIVE-PATHS-1: the CMS's handlers call assertId() before every path they build from an id.
import * as ids from '../../app/lib/ids.js';
import { CATEGORIES } from '../../app/lib/taxonomy.js';
import { retirePaths } from '../../scripts/stories/retire.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RAW = readFileSync(join(ROOT, 'database.rules.json'), 'utf8');
const FA = 'proofsStandInFounderA0000001';
const RULES = RAW.split(FOUNDER_UIDS[0]).join(FA).split(FOUNDER_UIDS[1]).join('proofsStandInFounderB0000002');
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9410';
const PROJECT = 'demo-calvary-proofs-cms';
const WRITER = 'proofsCmsWriter00000000001';
const TYPO = 'https://firebasestorage.googleapis.com/v0/b/x/o/covers-typographic%2Fs%2Fabc%2Fcover.png';
const FUTURE = '2099-03-01T10:30';           // the form's datetime-local value
const FUTURE2 = '2099-04-02T08:15';
const PAST_ISO = '2026-10-30T06:30:00.000Z';
const TEXT = 'The first paragraph of an invented story.\n\nThe second paragraph, long enough to be a line.';

// ── slice the handlers out of a version's source ────────────────────────────────────────
const AsyncFunction = (async () => {}).constructor;
function slicer(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  const found = {};
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration' && n.id) found[n.id.name] = src.slice(n.start, n.end);
    if (n.type === 'VariableDeclarator' && n.id?.name && n.init && /Function/.test(n.init.type)) found[n.id.name] = `const ${src.slice(n.start, n.end)};`;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
    }
  })(ast.program);
  return found;
}
/** Build `name` from `fns` with `scope` as its free variables, firebase/database pointed at `fb`. */
function handler(fns, name, scope, extra = []) {
  const code = [...extra.map((n) => fns[n]), fns[name]].join('\n').split("await import('firebase/database')").join('__fb');
  assert.ok(fns[name], `${name} not found in the source`);
  const names = Object.keys(scope);
  return new AsyncFunction(...names, `${code}\nreturn ${name};`)(...names.map((n) => scope[n]));
}

const VERSIONS = {
  'origin/main': (p) => execFileSync('git', ['show', `origin/main:${p}`], { cwd: ROOT, encoding: 'utf8' }),
  'proofs-r2': (p) => readFileSync(join(ROOT, p), 'utf8'),
};

let env;
before(async () => {
  const [h, port] = HOST.split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT, database: { rules: RULES, host: h, port: Number(port) } });
});
after(async () => { await env?.cleanup(); });

const founderDb = () => env.authenticatedContext(FA).database();
const adminWrite = (paths) => env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref().update(paths); });
const read = async (path) => { let v; await env.withSecurityRulesDisabled(async (ctx) => { v = (await ctx.database().ref(path).get()).val(); }); return v; };

/** The founder's database handle, as the CMS's `ref/get/update/set/push` see it. Every write is logged. */
function fbFor(db, log) {
  const at = (r) => (r.path ? db.ref(r.path) : db.ref());
  return {
    ref: (_db, path = '') => ({ path }),
    get: (r) => at(r).get(),
    update: async (r, v) => { try { await at(r).update(v); log.push({ ok: true, keys: Object.keys(v) }); } catch (e) { log.push({ ok: false, keys: Object.keys(v), error: e.message }); throw e; } },
    set: async (r, v) => { await at(r).set(v); log.push({ ok: true, keys: [r.path] }); },
    push: (r, v) => at(r).push(v),
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
  };
}

/** Ruling 255, read back: not live ⇒ no text on the record; live ⇒ the text there. */
async function assertPlaced(slug) {
  const rec = await read(`cms_stories/${slug}`);
  const body = await read(`story_bodies/${slug}`);
  if (!rec) return 'deleted';
  if (rec.published === false) {
    assert.ok(!rec.content && !rec.extractedText, `${slug}: an unpublished record carries text`);
    assert.ok(typeof body?.content === 'string' && body.content.length > 0, `${slug}: its text is not in story_bodies`);
    return rec.hiddenAt ? 'hidden' : rec.coverHold ? 'held' : 'scheduled';
  }
  assert.ok(rec.content && rec.content === body?.content, `${slug}: a live record's text is not story_bodies'`);
  return 'live';
}

const FORM = {
  title: 'An Invented Story', selectedAuthor: `uid:${WRITER}`, category: 'short', subcategory: '', date: 'Oct 30, 2026',
  coverFilename: TYPO, coverPreview: null, coverHash: '', coverSizes: null, content: TEXT, publishAt: '', epubUrl: '',
  epubUpdatedAt: null, readerMode: false, bookReader: false, prosePoetry: false, featuredPin: false, extractedText: '',
  authorHandle: '', handleInput: '', resolvedHandle: null, handleError: '', trailerQuote: '', descriptor: '',
  published: true, coverHold: false, recordStatus: null, recordStatusLine: '', unscheduleAs: null, slug: '',
};

for (const [version, source] of Object.entries(VERSIONS)) {
  describe(`the CMS on ${version}, under the rules that will be deployed`, () => {
    const admin = slicer(source('app/admin/page.js'));
    const extract = slicer(source('app/admin/extract-text/page.js'));
    const quizzes = slicer(source('app/admin/quizzes/page.js'));

    /** Run one CMS handler as the stand-in founder; returns { msgs, writes }. */
    async function run(name, args, { form = FORM, editingId = null, stories = [], from = admin, scope: more = {} } = {}) {
      const msgs = []; const writes = [];
      const db = founderDb();
      const scope = {
        __fb: fbFor(db, writes), db,
        ...storyIndex, ...storyAccess, ...htmlBlocks, ...coverDescriptor, ...storyState, ...storyText, ...storySlug, ...retiredStories, ...ids, CATEGORIES,
        editingId, stories, form, retired: {}, roster: [{ uid: WRITER, displayName: 'Invented Writer', username: 'invented' }], guestList: [],
        setMsg: (m) => msgs.push(String(m)), setSaving: () => {}, setForm: () => {}, setEditingId: () => {}, setView: () => {},
        loadStories: () => {}, rebuildAfter: () => {}, emptyForm: FORM, confirm: () => true, user: { uid: FA },
        ...more,
      };
      const fn = await handler(from, name, scope, from === admin ? ['convertToHTML'] : []);
      await fn(...args);
      return { msgs, writes };
    }
    const ok = (r, what) => {
      const failed = r.writes.filter((w) => !w.ok);
      assert.deepEqual(failed, [], `${what}: a write was refused`);
      assert.ok(r.writes.length > 0, `${what}: nothing was written (${r.msgs.join(' | ')})`);
      assert.ok(!r.msgs.some((m) => /^(✗|Error saving)/.test(m)), `${what}: ${r.msgs.join(' | ')}`);
    };
    const save = (o = {}) => run('saveStory', [], o);
    const listed = async (slug) => ({ id: slug, ...(await read(`cms_stories/${slug}`)) });
    const editForm = async (slug, patch = {}) => {
      const rec = await read(`cms_stories/${slug}`);
      return { ...FORM, ...rec, content: TEXT, coverFilename: rec.cover, publishAt: rec.publishAt ? rec.publishAt.slice(0, 16) : '', published: rec.published !== false, coverHold: rec.coverHold === true, recordStatus: storyState.storyStatus(rec), ...patch };
    };
    /** A story put into place by the CMS itself (a new-story save). */
    const created = async (title, form) => {
      await env.clearDatabase();
      await adminWrite({ [`users/${WRITER}`]: { displayName: 'Invented Writer', username: 'invented' } });
      const r = await save({ form: { ...form, title } });
      ok(r, `create ${title}`);
      return storySlug.slugify(title);
    };

    test('new draft (no cover yet): saved and held for its cover, text in story_bodies only', async () => {
      const slug = await created('A New Draft', { ...FORM, coverFilename: 'covers/a.jpg' });
      assert.equal(await assertPlaced(slug), 'held');
    });
    test('edit a draft: still held, text still off the record', async () => {
      const slug = await created('A Draft To Edit', { ...FORM, coverFilename: 'covers/a.jpg' });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { content: `${TEXT}\n\nA third paragraph.`, coverFilename: 'covers/a.jpg' }) });
      ok(r, 'edit draft');
      assert.equal(await assertPlaced(slug), 'held');
    });
    test('new and scheduled', async () => {
      const slug = await created('A New Scheduled Story', { ...FORM, publishAt: FUTURE });
      assert.equal(await assertPlaced(slug), 'scheduled');
    });
    test('schedule an existing draft', async () => {
      const slug = await created('A Draft To Schedule', { ...FORM, coverFilename: 'covers/a.jpg' });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { publishAt: FUTURE, coverFilename: TYPO }) });
      ok(r, 'schedule');
      assert.equal(await assertPlaced(slug), 'scheduled');
    });
    test('reschedule a scheduled story', async () => {
      const slug = await created('A Story To Reschedule', { ...FORM, publishAt: FUTURE });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { publishAt: FUTURE2 }) });
      ok(r, 'reschedule');
      assert.equal(await assertPlaced(slug), 'scheduled');
      assert.equal((await read(`cms_stories/${slug}/publishAt`)).slice(0, 10), '2099-04-02');
    });
    test('edit a scheduled story’s text: the new text goes to story_bodies only', async () => {
      const slug = await created('A Scheduled Story To Edit', { ...FORM, publishAt: FUTURE });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { content: 'Rewritten opening paragraph.\n\nAnd a new second one.' }) });
      ok(r, 'edit scheduled text');
      assert.equal(await assertPlaced(slug), 'scheduled');
      assert.match(await read(`story_bodies/${slug}/content`), /Rewritten opening/);
    });
    test('publish a scheduled story now (unschedule → publish)', async () => {
      const slug = await created('A Story To Publish Now', { ...FORM, publishAt: FUTURE });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { publishAt: '', unscheduleAs: 'publish' }) });
      ok(r, 'publish now');
      assert.equal(await assertPlaced(slug), 'live');
    });
    test('unschedule and keep it hidden', async () => {
      const slug = await created('A Story To Unschedule', { ...FORM, publishAt: FUTURE });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { publishAt: '', unscheduleAs: 'hide' }) });
      ok(r, 'unschedule hide');
      assert.equal(await assertPlaced(slug), 'hidden');
    });
    test('new, published at once', async () => {
      const slug = await created('A Story Published At Once', { ...FORM });
      assert.equal(await assertPlaced(slug), 'live');
    });
    test('edit a live story', async () => {
      const slug = await created('A Live Story To Edit', { ...FORM });
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { content: 'An edited live opening.\n\nStill live.' }) });
      ok(r, 'edit live');
      assert.equal(await assertPlaced(slug), 'live');
      assert.match(await read(`cms_stories/${slug}/content`), /edited live opening/);
    });
    test('hide a live story, then unhide it (generated cover: live again)', async () => {
      const slug = await created('A Story To Hide', { ...FORM });
      ok(await run('hideStory', [slug]), 'hide');
      assert.equal(await assertPlaced(slug), 'hidden');
      ok(await run('unhideStory', [slug]), 'unhide');
      assert.equal(await assertPlaced(slug), 'live');
    });
    test('hide a scheduled story; unhide a story with no generated cover (held)', async () => {
      const slug = await created('A Scheduled Story To Hide', { ...FORM, publishAt: FUTURE });
      ok(await run('hideStory', [slug]), 'hide scheduled');
      assert.equal(await assertPlaced(slug), 'hidden');
      const draft = await created('A Hidden Draft', { ...FORM, coverFilename: 'covers/a.jpg' });
      ok(await run('hideStory', [draft]), 'hide draft');
      ok(await run('unhideStory', [draft]), 'unhide coverless');
      assert.equal(await assertPlaced(draft), 'held');
    });
    test('edit a hidden story: it stays hidden, text off the record', async () => {
      const slug = await created('A Hidden Story To Edit', { ...FORM });
      ok(await run('hideStory', [slug]), 'hide');
      const r = await save({ editingId: slug, stories: [await listed(slug)], form: await editForm(slug, { content: 'Edited while hidden.\n\nStill hidden.' }) });
      ok(r, 'edit hidden');
      assert.equal(await assertPlaced(slug), 'hidden');
    });
    test('delete', async () => {
      const slug = await created('A Story To Delete', { ...FORM, publishAt: FUTURE });
      ok(await run('deleteStory', [slug]), 'delete');
      assert.equal(await read(`cms_stories/${slug}`), null);
    });
    test('Extract Text, on a live story and on a scheduled one', async () => {
      for (const [title, form, want] of [['A Live Book Story', FORM, 'live'], ['A Scheduled Book Story', { ...FORM, publishAt: FUTURE }, 'scheduled']]) {
        const slug = await created(title, { ...form, epubUrl: 'https://example.test/book.epub' });
        const r = await run('extractOne', [slug], {
          from: extract,
          scope: { stories: [{ slug, epubUrl: 'https://example.test/book.epub' }], extractEpubFromUrl: async () => 'Extracted plain text of the invented book.', setStatuses: () => {} },
        });
        ok(r, `extract ${want}`);
        assert.equal(await assertPlaced(slug), want);
        assert.equal(await read(`story_bodies/${slug}/extractedText`), 'Extracted plain text of the invented book.');
      }
    });
    test('quizzes: save a draft and approve, on a scheduled story', async () => {
      const slug = await created('A Scheduled Story With A Quiz', { ...FORM, publishAt: FUTURE });
      const scope = {
        selectedSlug: slug, quiz: { questions: [], maxPoints: 50 }, allRows: [{ slug, indexed: false }],
        setError: () => {}, showMsg: () => {}, setQuizSlugs: () => {}, setAdvertisedSlugs: () => {}, LS_KEY: 'k',
        localStorage: { removeItem: () => {} }, buildQuizSummary: storyIndex.buildQuizSummary,
      };
      ok(await run('handleSaveDraft', [], { from: quizzes, scope }), 'quiz draft');
      ok(await run('handleApprove', [], { from: quizzes, scope }), 'quiz approve');
      assert.equal(await read(`cms_stories/${slug}/quizMeta/hasQuiz`), true);
      assert.equal(await assertPlaced(slug), 'scheduled');
    });
    test('THE FORBIDDEN SHAPE is still refused: text left on (or put on) a record that isn’t live', async () => {
      const slug = await created('A Live Story', { ...FORM });
      const db = founderDb();
      await assertFails(db.ref(`cms_stories/${slug}/published`).set(false));
      await assertFails(db.ref().update(storyState.hidePaths(slug)), 'a bare Hide that leaves the text (the pre-255 shape)');
      const sched = await created('A Scheduled Story', { ...FORM, publishAt: FUTURE });
      await assertFails(founderDb().ref(`cms_stories/${sched}/content`).set('<p>early</p>'));
    });
  });
}

describe('server-side writers replayed as a founder (they bypass rules; they must pass anyway)', () => {
  test('retire.mjs (an admin-key script)', async () => {
    await env.clearDatabase();
    await adminWrite({ 'cms_stories/r': { title: 'R', published: true, content: '<p>x</p>', extractedText: 'x', publishAt: PAST_ISO }, 'story_bodies/r': { content: '<p>x</p>', extractedText: 'x' } });
    const rec = await read('cms_stories/r');
    const paths = retirePaths('r', rec, { reason: 'test', now: Date.now(), body: { content: '<p>x</p>', extractedText: 'x' } });
    // cms_stories_retired is .write:false to every client by design (W35); the script writes it with
    // the admin key. Everything else in its update must pass the rules.
    const clientPart = Object.fromEntries(Object.entries(paths).filter(([k]) => !k.startsWith('cms_stories_retired/')));
    await assertSucceeds(founderDb().ref().update(clientPart));
  });

  test('the scheduled-publish Worker’s go-live PATCH (run unmodified, then replayed)', async () => {
    await env.clearDatabase();
    const NS = PROJECT;
    const EMU = `http://${HOST}`;
    const FAKE = 'https://proofs-cms.test';
    const record = { title: 'Due', author: 'Invented Writer', authorUid: WRITER, category: 'short', categoryName: 'Short Story', date: 'Oct 30, 2026', url: '/stories/due', cover: TYPO, published: false, publishAt: PAST_ISO };
    const body = { content: '<p>Invented due text.</p><p>A second paragraph long enough to open with.</p>', extractedText: 'Invented due text.' };
    const seedDue = () => adminWrite({ 'cms_stories/due': record, 'story_bodies/due': body });
    await seedDue();
    const realFetch = globalThis.fetch;
    const patches = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init);
      if (url.startsWith(FAKE)) {
        const u = new URL(url); u.searchParams.delete('auth');
        const q = u.searchParams.toString();
        if ((init.method || 'GET') === 'PATCH') patches.push(JSON.parse(init.body));
        const { signal: _s, ...rest } = init;
        return realFetch(`${EMU}${u.pathname}?ns=${NS}${q ? `&${q}` : ''}`, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
      }
      return new Response('{}', { status: 200 });   // deploy hook, alerts: answered, never sent
    };
    const dir = await mkdtemp(join(tmpdir(), 'proofs-cms-'));
    try {
      await writeFile(join(dir, 'worker.mjs'), await readFile(join(ROOT, 'workers-external/calvary-newsletter.worker.js'), 'utf8'));
      const worker = (await import(`file://${join(dir, 'worker.mjs')}`)).default;
      const pending = [];
      await worker.scheduled({}, { FIREBASE_DATABASE_URL: FAKE, FIREBASE_SECRET: 'owner' }, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
    } finally { globalThis.fetch = realFetch; await rm(dir, { recursive: true, force: true }); }
    const flip = patches.find((p) => p['cms_stories/due/published'] === true);
    assert.ok(flip, 'the Worker flipped the due story in one PATCH');
    assert.equal(flip['cms_stories/due/content'], body.content, 'with its text in the same write');
    // Replay the very same PATCH, on the pre-flip state, as the stand-in founder, under the rules.
    await env.clearDatabase();
    await seedDue();
    await assertSucceeds(founderDb().ref().update(flip));
    assert.equal(await read('cms_stories/due/content'), body.content);
  });
});
