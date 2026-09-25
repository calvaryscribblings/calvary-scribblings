// W6 · ADM-24 — THE ADMIN TELLS THE TRUTH. Every admin read that fails draws the house failure
// panel with a Retry, never the empty list.
//
//   node --test tests/ci/w6-admin-loads.test.mjs      (npm run test:ci)
//
// TWO HALVES. The render half draws app/components/AdminLoad.js — the one drawn order every
// converted page goes through — with react-dom/server, in each phase, and proves a failure draws
// <Unavailable> and never the empty copy. The source half proves each page actually goes through
// it (or through <Unavailable> directly): its read no longer swallows, it has a deadline, and its
// empty copy is reachable only from a read that came back. No page is rendered whole — they need
// Firebase and a signed-in founder — so the per-page proof is structural, as in designed-states.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The body of `const NAME = useReliableLoad(` up to its deps array. */
function loadBody(s, name) {
  const start = s.indexOf(`const ${name} = useReliableLoad(`);
  assert.notEqual(start, -1, `no useReliableLoad named ${name}`);
  const end = s.indexOf('\n  }, [', start);
  assert.notEqual(end, -1, `${name}: no deps array`);
  return s.slice(start, end);
}

/** A named function's body, to the next top-level declaration. */
function fnBody(s, header) {
  const start = s.indexOf(header);
  assert.notEqual(start, -1, `missing: ${header}`);
  const rest = s.slice(start + header.length);
  const next = rest.search(/\n(?:export |async function |function |const [A-Z_]+ = )/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Every occurrence of `text` sits inside an <AdminLoad load={loadName} …>…</AdminLoad> element,
 * i.e. it is an `empty=`/`loading=` prop or children of one — the only places AdminLoad draws
 * from a read that came back. At least one occurrence must exist.
 */
function onlyInsideAdminLoad(s, loadName, text) {
  const spans = [];
  const open = new RegExp(`<AdminLoad\\s+load=\\{${loadName}\\}`, 'g');
  let m;
  while ((m = open.exec(s))) spans.push([m.index, s.indexOf('</AdminLoad>', m.index)]);
  assert.ok(spans.length, `no <AdminLoad load={${loadName}}>`);
  let at = s.indexOf(text), seen = 0;
  while (at !== -1) {
    seen++;
    assert.ok(spans.some(([a, b]) => at > a && at < b), `"${text}" is drawn outside <AdminLoad load={${loadName}}> — reachable without a read that came back`);
    at = s.indexOf(text, at + 1);
  }
  assert.ok(seen > 0, `"${text}" is gone — the empty state must still exist for a read that is genuinely empty`);
}

// ── The render half ─────────────────────────────────────────────────────────────────────────
// The three files AdminLoad draws with, transpiled by the repo's own TypeScript (JSX only) into a
// temp dir with their relative imports pointed at each other. Nothing else is loaded.
let AdminLoad;
let tmp;
before(async () => {
  const ts = require('typescript');
  tmp = mkdtempSync(join(tmpdir(), 'w6-admin-'));
  const files = [
    ['app/lib/unavailableCopy.js', 'unavailableCopy.mjs'],
    ['app/components/Unavailable.js', 'Unavailable.mjs'],
    ['app/components/AdminLoad.js', 'AdminLoad.mjs'],
  ];
  for (const [from, to] of files) {
    const out = ts.transpileModule(src(from), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
      .replace("from '../lib/unavailableCopy'", "from './unavailableCopy.mjs'")
      .replace("from './Unavailable'", "from './Unavailable.mjs'")
      .replace('"react/jsx-runtime"', `"${pathToFileURL(require.resolve('react/jsx-runtime')).href}"`);
    writeFileSync(join(tmp, to), out);
  }
  AdminLoad = (await import(pathToFileURL(join(tmp, 'AdminLoad.mjs')).href)).default;
});
after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

const draw = (load, extra = {}) => renderToStaticMarkup(h(AdminLoad, {
  load: { retry() {}, refreshing: false, failure: null, data: undefined, ...load },
  subject: 'the submissions',
  loading: h('p', null, 'LOADING'),
  empty: h('p', null, 'No essay submissions pending review.'),
  ...extra,
}, (rows) => h('ul', null, rows.map((r) => h('li', { key: r }, r)))));

describe('AdminLoad draws a failure as a failure (render)', () => {
  test('failed → the house panel with a Retry, and NOT the empty copy', () => {
    for (const kind of ['offline', 'slow', 'ours']) {
      const html = draw({ phase: 'failed', failure: kind });
      assert.match(html, new RegExp(`data-unavailable="${kind}"`));
      assert.match(html, /We couldn’t reach the submissions\./);
      assert.match(html, /<button[^>]*>Try again<\/button>/);
      assert.doesNotMatch(html, /No essay submissions/);
      assert.doesNotMatch(html, /LOADING/);
    }
  });

  test('a Retry in flight says so and cannot be pressed twice', () => {
    const html = draw({ phase: 'failed', failure: 'slow', refreshing: true });
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Trying…<\/button>/);
  });

  test('compact is the in-section form: no eyebrow, same Retry', () => {
    const html = draw({ phase: 'failed', failure: 'ours' }, { compact: true });
    assert.doesNotMatch(html, /CAN’T REACH THE ISLAND/);
    assert.match(html, />Try again</);
    assert.equal(/CAN’T REACH THE ISLAND/.test(draw({ phase: 'failed', failure: 'ours' })), true);
  });

  test('tone follows the ground: ink by default, cream when asked', () => {
    assert.match(draw({ phase: 'failed', failure: 'ours' }), /color:#f5f0e8/);
    assert.match(draw({ phase: 'failed', failure: 'ours' }, { tone: 'cream' }), /color:#1c1428/);
  });

  test('loading → the loading state, never empty — and null (not asked yet) is loading too', () => {
    assert.equal(draw({ phase: 'loading' }), '<p>LOADING</p>');
    assert.equal(draw({ phase: 'ready', data: null }), '<p>LOADING</p>');
  });

  test('ready with no rows → the empty copy, which is the only way to reach it', () => {
    assert.equal(draw({ phase: 'ready', data: [] }), '<p>No essay submissions pending review.</p>');
  });

  test('ready with rows → the rows; a custom isEmpty is honoured', () => {
    assert.equal(draw({ phase: 'ready', data: ['a', 'b'] }), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(draw({ phase: 'ready', data: { list: [] } }, { isEmpty: (d) => d.list.length === 0 }),
      '<p>No essay submissions pending review.</p>');
  });

  test('content already drawn stays when a re-read fails (the hook keeps phase ready)', () => {
    // useReliableLoad never moves ready → failed (reliableRead.js nextState); AdminLoad draws
    // what the phase says, so a failed refresh after a write keeps the list on screen.
    assert.equal(draw({ phase: 'ready', data: ['a'], refreshing: true }), '<ul><li>a</li></ul>');
  });
});

// ── The source half ─────────────────────────────────────────────────────────────────────────

describe('the hook: reload is the same guarded read, without the reconnect', () => {
  test('useReliableLoad returns reload: run (deadline + content-stays), retry still reconnects', () => {
    const s = code('app/lib/useReliable.js');
    assert.match(s, /return \{ \.\.\.state, retry, reload: run \};/);
    assert.match(s, /const retry = useCallback\(async \(\) => \{ await reconnectDatabase\(\); run\(\); \}/);
  });
});

describe('every admin page: a failed read draws the panel, never the empty list', () => {
  test('publishers — its own throwing read, not the loader that answers []', () => {
    const s = code('app/admin/publishers/page.js');
    assert.doesNotMatch(s, /getAllPublishers/, 'getAllPublishers() catches and answers [] — "No publishers yet." for a failed read');
    assert.match(s, /const pubs = useReliableLoad\(\(\) => \(isAdmin \? readPublishers\(\) : null\), \[isAdmin\]\);/);
    assert.doesNotMatch(fnBody(s, 'async function readPublishers()'), /catch/);
    assert.match(s, /<AdminLoad\s+load=\{pubs\}\s+subject="the publishers"/);
    assert.match(s, /empty=\{<PublisherEmpty onNew=\{openNew\} \/>\}/);
    assert.equal(s.match(/<PublisherEmpty\b/g).length, 1, 'PublisherEmpty is drawn somewhere other than AdminLoad\'s empty slot');
    assert.match(fnBody(s, 'function PublisherEmpty('), /No publishers yet\./);
    assert.doesNotMatch(fnBody(s, 'function PublisherList('), /No publishers yet|Loading publishers/);
    assert.doesNotMatch(s, />\{publishers\.length\} on file</, 'the count says "0 on file" for a read that failed');
  });

  test('publishers — the edit form never opens with its private fields blank-because-failed', () => {
    const s = code('app/admin/publishers/page.js');
    assert.doesNotMatch(s, /\bgetPublisher\(/);
    assert.match(s, /merged = \(await readWithDeadline\(\(\) => readPublisherForEdit\(pub\.slug\)\)\) \|\| pub;/);
    assert.match(fnBody(s, '  async function openEdit(pub) {'), /catch \(e\) \{[\s\S]*?return;\s*\}/);
    assert.doesNotMatch(fnBody(s, 'async function readPublisherForEdit('), /catch/);
  });

  test('series — the loaders throw for the admin, and the list goes through AdminLoad', () => {
    const loader = code('app/lib/series/loader.js');
    for (const fn of ['getAllSeries(opts)', 'getAllInstalments(seriesId, opts)', 'getDeletedInstalments(seriesId, opts)']) {
      assert.match(fnBody(loader, `export async function ${fn} {`), /catch \(err\) \{[\s\S]*?rethrowIf\(opts, err\);[\s\S]*?return \[\];/, `${fn} swallows even when asked to throw`);
    }
    const s = code('app/admin/series/page.js');
    const body = loadBody(s, 'seriesLoad');
    assert.match(body, /const opts = \{ throwOnError: true \};/);
    assert.match(body, /getAllSeries\(opts\)/);
    assert.match(body, /getAllInstalments\(x\.id, opts\)/);
    assert.match(body, /getDeletedInstalments\(x\.id, opts\)/);
    assert.doesNotMatch(body, /catch/);
    assert.doesNotMatch(s, /setList\(/);
    assert.match(s, /const refresh = seriesLoad\.reload;/);
    onlyInsideAdminLoad(s, 'seriesLoad', 'No series yet.');
  });

  test('square — three sections, each with its own compact panel; nothing is .catch(() => {})', () => {
    const s = code('app/admin/square/page.js');
    assert.doesNotMatch(s, /\.catch\(\(\) => \{\}\)/);
    for (const name of ['holdersLoad', 'reportsLoad', 'horizonLoad']) {
      assert.doesNotMatch(loadBody(s, name), /catch/, `${name} swallows`);
      assert.match(s, new RegExp(`<AdminLoad load=\\{${name}\\} subject="[^"]+" compact`), `${name} has no compact panel`);
    }
    onlyInsideAdminLoad(s, 'holdersLoad', 'Nobody yet.');
    onlyInsideAdminLoad(s, 'reportsLoad', 'Nothing reported.');
    onlyInsideAdminLoad(s, 'horizonLoad', 'Never run.');
    // "Never run" is a real answer (no heartbeat), so it must not look like null (not read yet).
    assert.match(loadBody(s, 'horizonLoad'), /return \{\s*h,/);
  });

  for (const page of ['submissions', 'exercises']) {
    test(`${page} — the read throws, and "No essay submissions" needs a read that came back`, () => {
      const s = code(`app/admin/${page}/page.js`);
      assert.doesNotMatch(s, /catch \(e\) \{ console\.error\(e\); \}/);
      assert.doesNotMatch(loadBody(s, 'subsLoad'), /catch/);
      assert.match(s, /<AdminLoad\s+load=\{subsLoad\}\s+subject="the submissions"/);
      onlyInsideAdminLoad(s, 'subsLoad', 'No essay submissions pending review.');
    });
  }

  test('reports — a failed switch check is a failure, not "this queue is for moderators"', () => {
    const s = code('app/admin/reports/page.js');
    assert.doesNotMatch(s, /setAllowed\(false\)/);
    const body = loadBody(s, 'queue');
    assert.doesNotMatch(body, /catch/);
    assert.match(body, /if \(sw\.val\(\) !== true\) return \{ allowed: false \};/);
    // readQueue may soften a NAME (a uid still identifies the person) but never the queue read.
    const rq = fnBody(s, 'async function readQueue() {');
    assert.match(rq, /^\s*const snap = await get\(ref\(db, 'content_reports'\)\);/);
    assert.equal(rq.match(/catch/g).length, 1);
    assert.match(rq, /catch \{ return \[uid, \{ name: null, handle: null \}\]; \}/);
    onlyInsideAdminLoad(s, 'queue', 'Nothing reported');
  });

  test('authors — two sections, two compact panels; a failed author is counted, not dropped', () => {
    const s = code('app/admin/authors/page.js');
    assert.doesNotMatch(s, /Error loading: /);
    assert.doesNotMatch(loadBody(s, 'guestsLoad'), /catch/);
    const a = loadBody(s, 'authorsLoad');
    assert.equal(a.match(/catch/g).length, 1, 'only the per-uid read may be caught');
    assert.match(a, /catch \(e\) \{\s*unread \+= 1;/);
    assert.match(s, /<AdminLoad\s+load=\{authorsLoad\}\s+subject="the registered authors"\s+compact/);
    assert.match(s, /<AdminLoad\s+load=\{guestsLoad\}\s+subject="the guest authors"\s+compact/);
    assert.match(s, /isEmpty=\{\(d\) => d\.list\.length === 0 && d\.unread === 0\}/);
    assert.match(s, /could not be read and/);
    onlyInsideAdminLoad(s, 'authorsLoad', 'No stories with an authorUid yet.');
    onlyInsideAdminLoad(s, 'guestsLoad', 'No guest authors yet.');
  });

  test('quizzes — a failed index read draws the panel, not "0 of 0" and "No stories match."', () => {
    const s = code('app/admin/quizzes/page.js');
    assert.match(s, /const snap = await readWithDeadline\(\(\) => get\(ref\(db, INDEX_PATH\)\)\);/);
    assert.match(s, /setDataFailure\(e\?\.kind \|\| 'ours'\);/);
    assert.doesNotMatch(s, /Failed to load stories: /);
    assert.match(s, /\{dataFailure && \(\s*<Unavailable kind=\{dataFailure\} subject="the story list" compact/);
    assert.match(s, /\{!loadingData && !dataFailure && \(\s*<div style=\{s\.listBox\}>/);
    assert.match(s, /dataFailure \? 'Stories not loaded' :/);
    // The two shallow reads stay non-fatal by design, but they may not HANG the picker.
    assert.equal(s.match(/readWithDeadline\(\(\) => fetch\(`\$\{DB_URL\}\/cms_(quizzes|stories)\.json\?shallow=true`\)\)/g).length, 2);
  });

  test('quizzes — "No quiz yet" only after the quiz read came back empty', () => {
    const s = code('app/admin/quizzes/page.js');
    assert.match(s, /const snap = await readWithDeadline\(\(\) => get\(ref\(db, `cms_quizzes\/\$\{slug\}`\)\)\);/);
    assert.match(s, /setQuizRead\(e\?\.kind \|\| 'ours'\);/);
    assert.match(s, /quizRead !== 'ready' && quizRead !== 'loading' && \(\s*<Unavailable kind=\{quizRead\}/);
    const at = s.indexOf('No quiz yet for this story.');
    assert.ok(at > 0);
    assert.match(s.slice(s.lastIndexOf('{!quiz', at), at), /quizRead === 'ready'/);
  });

  test('analytics — every path has a deadline, a failed card draws the panel, and activity counts fail with their sources', () => {
    const s = code('app/admin/analytics/page.js');
    const fp = s.slice(s.indexOf('const fetchPath = async (path) =>'), s.indexOf('const keys = ['));
    assert.match(fp, /await readWithDeadline\(\(\) => get\(ref\(db, path\)\)\)/);
    assert.match(fp, /return \{ ok: false, error: e\?\.kind \|\| 'ours' \};/);
    assert.match(fnBody(s, 'function CardError('), /return <Unavailable kind=\{msg\} onRetry=\{retry\} refreshing=\{refreshing\} compact/);
    assert.match(s, /<RetryContext\.Provider value=\{\{ retry: async \(\) => \{ await reconnectDatabase\(\); fetchAll\(\); \}, refreshing: fetching \}\}>/);
    for (const title of ['Weekly / Monthly active', 'Daily active · last 30 days']) {
      assert.match(s, new RegExp(`<Card title="${title}" coverage=\\{COVERAGE\\.\\w+\\} err=\\{activityErr\\}`), `${title} would under-count silently`);
    }
    assert.match(s, /<Card title="Anonymous reader retention" coverage=\{COVERAGE\.cohortAnon\} err=\{errors\.storyReads\}/);
    assert.match(s, /<Card title="Social activity · in range" coverage=\{COVERAGE\.breadth\} err=\{errors\.comments \|\| errors\.squarePosts\}/);
  });

  test('forum — the queue goes through AdminLoad; "Flagged (0)" needs a read that came back', () => {
    const s = code('app/admin/forum/page.jsx');
    assert.doesNotMatch(s, /Failed to load the queue: /);
    assert.doesNotMatch(loadBody(s, 'queue'), /catch/);
    assert.doesNotMatch(s, /setFlagged\(|setReported\(/);
    assert.match(s, /Flagged\{loaded \? ` \(\$\{flagged\.length\}\)` : ''\}/);
    onlyInsideAdminLoad(s, 'queue', 'No flagged posts awaiting review.');
    onlyInsideAdminLoad(s, 'queue', 'No reported posts right now.');
  });

  test('quiz-resets — the story picker read is not "non-fatal" any more', () => {
    const s = code('app/admin/quiz-resets/page.js');
    assert.doesNotMatch(s, /catch \{\s*\}/, 'the picker read is caught into nothing again');
    assert.doesNotMatch(loadBody(s, 'storiesLoad'), /catch/);
    assert.match(s, /<AdminLoad\s+load=\{storiesLoad\}\s+subject="the stories"\s+compact/);
    onlyInsideAdminLoad(s, 'storiesLoad', 'Select a story…');
    assert.match(s, /const \{ res, data \} = await readWithDeadline\(async \(\) => \{/);
  });

  test('extract-text — no all-clear from a read that failed', () => {
    const s = code('app/admin/extract-text/page.js');
    assert.doesNotMatch(s, /alert\('Failed to load stories: /);
    assert.doesNotMatch(loadBody(s, 'storiesLoad'), /catch/);
    assert.match(s, /\{storiesLoad\.phase === 'failed' && \(\s*<Unavailable kind=\{storiesLoad\.failure\} onRetry=\{storiesLoad\.retry\}/);
    // The counts and "All EPUBs have extracted text" sit after the failed guard, and only draw
    // once the read is ready (loading = phase !== 'ready').
    const guard = s.indexOf("{storiesLoad.phase !== 'failed' && <>");
    assert.ok(guard > 0);
    for (const t of ['need${missingCount === 1', '✓ All EPUBs have extracted text.']) assert.ok(s.indexOf(t) > guard, `${t} is drawn before the failure guard`);
    assert.match(s, /const loading = storiesLoad\.phase !== 'ready' \|\| !storiesLoad\.data;/);
    assert.match(s, /\{!loading && visible\.length === 0 && \(/);
  });

  test('migrate has no read to fail — its one request already reports its own error', () => {
    const s = code('app/admin/migrate/page.js');
    assert.doesNotMatch(s, /\bget\(/);
    assert.match(s, /catch \(e\) \{\s*setError\(e\.message\);/);
  });
});
