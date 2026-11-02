// LIVE-PATHS-2 — the source-level half of the round. The emulator halves are in
// tests/rules/live-paths-2.test.mjs (rules, the admin queue, quiz approval),
// tests/live-paths/live-paths-2.emulator.test.mjs (moderate.js, record-attempt) and
// tests/safety/guard.emulator.test.mjs (the guard's empty segments).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { approvalRefusal, approvedRecord, rejectPending } from '../../app/lib/openPagesApprove.js';
import { QUIZ_APPROVAL_FIELDS, quizApprovalMetaPaths } from '../../app/lib/quizApproval.js';
import { sameApartFromReads } from '../../functions/api/open-pages/moderate.js';
import { checkRefArg, GuardRefusal } from '../../scripts/safety/guard.mjs';

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('LIVE-PATHS-2 #1 · the admin queue', () => {
  const live = { authorUid: 'A', title: 't' };
  test('approvalRefusal: new piece on an empty key is fine; every collision is named', () => {
    assert.equal(approvalRefusal(null, { authorUid: 'A' }), null);
    assert.equal(approvalRefusal(live, { authorUid: 'A', revision: true }), null);
    assert.match(approvalRefusal(live, { authorUid: 'B' }), /Another author/);
    assert.match(approvalRefusal(live, { authorUid: 'B', revision: true }), /Another author/);
    assert.match(approvalRefusal(live, { authorUid: 'A' }), /not an edit/);
    assert.match(approvalRefusal(null, { authorUid: 'A', revision: true }), /no longer live/);
    assert.match(approvalRefusal(null, {}), /no author/);
  });
  test('approvedRecord: the queue marker and any stored id are dropped; a revision keeps the live count', () => {
    const r = approvedRecord({ authorUid: 'A', revision: true, id: 'x', readCount: 3 }, { authorUid: 'A', readCount: 9 }, 'F', 5);
    assert.deepEqual(r, { authorUid: 'A', readCount: 9, status: 'live', approvedBy: 'F', approvedAt: 5 });
  });
  test('rejectPending writes the pending path and nothing else', async () => {
    const sent = [];
    await rejectPending({ db: {}, fb: { ref: () => 'root', update: async (_r, v) => { sent.push(v); } }, id: '-Nabc' });
    assert.deepEqual(sent, [{ 'open_pages_pending/-Nabc': null }]);
    await assert.rejects(rejectPending({ db: {}, fb: { ref: () => 'root', update: async () => {} }, id: '../open_pages' }), /Not a post id/);
  });
  test('the forum page uses them: Approve through the transaction, Remove on a flagged row through rejectPending', () => {
    const s = src('app/admin/forum/page.jsx');
    assert.match(s, /approvePending\(\{ db, fb: \{ ref, runTransaction, update \}/);
    assert.match(s, /<FlaggedCard[^\n]*onRemove=\{\(\) => rejectFlagged\(p\)\}/);
    assert.match(s, /\.map\(\(\[id, p\]\) => \(\{ \.\.\.p, id \}\)\)/, 'the key wins over a stored id');
    const approve = s.slice(s.indexOf('async function approve('), s.indexOf('async function rejectFlagged('));
    assert.doesNotMatch(approve, /`open_pages\/\$\{id\}`\]:/, 'approve no longer writes open_pages/<id> blind');
  });
});

describe('LIVE-PATHS-2 #4 · quiz approval, and the retired migration', () => {
  test('approval owns three quizMeta fields, and never a counter or a claim', () => {
    assert.deepEqual([...QUIZ_APPROVAL_FIELDS], ['hasQuiz', 'scribblesReward', 'publishedAt']);
    const paths = quizApprovalMetaPaths('a-story', { scribblesReward: 50, approvedAt: 1 });
    assert.deepEqual(Object.keys(paths), QUIZ_APPROVAL_FIELDS.map((f) => `cms_stories/a-story/quizMeta/${f}`));
    assert.throws(() => quizApprovalMetaPaths('../x', { scribblesReward: 50, approvedAt: 1 }));
  });
  test('the quiz admin writes those paths, and never the quizMeta block whole', () => {
    const s = src('app/admin/quizzes/page.js');
    assert.match(s, /\.\.\.quizApprovalMetaPaths\(selectedSlug, /);
    assert.doesNotMatch(s, /`cms_stories\/\$\{selectedSlug\}\/quizMeta`\]/);
    assert.doesNotMatch(s, /existing\?\.attemptCount/);
  });
  test('migrate-quiz-meta and /admin/migrate are gone, and nothing points at them', () => {
    assert.equal(existsSync(new URL('functions/admin/migrate-quiz-meta.js', ROOT)), false);
    assert.equal(existsSync(new URL('app/admin/migrate/page.js', ROOT)), false);
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-l', '-e', 'migrate-quiz-meta', '-e', "admin/migrate'", '-e', 'admin/migrate"', '--', 'app', 'functions', 'public', 'scripts'], { cwd: new URL('.', ROOT), encoding: 'utf8' }).trim();
    } catch (e) {
      if (e.status !== 1) throw e; // 1 = no match
    }
    assert.equal(hits, '');
  });
});

describe('LIVE-PATHS-2 #8 · moderate.js', () => {
  test('sameApartFromReads: only readCount may differ', () => {
    assert.equal(sameApartFromReads({ a: 1, b: { c: 2 }, readCount: 1 }, { b: { c: 2 }, a: 1, readCount: 9 }), true);
    assert.equal(sameApartFromReads({ a: 1, readCount: 1 }, { a: 2, readCount: 1 }), false);
    assert.equal(sameApartFromReads(null, { a: 1 }), false);
  });
  test('an edit writes open_pages/<id> only through the conditional PUT', () => {
    const s = src('functions/api/open-pages/moderate.js');
    assert.equal((s.match(/putOverRead\(fbDb, accessToken, `\$\{OPEN_PAGES_NODE\}\/\$\{postId\}`, existingRead, record\)/g) || []).length, 2);
    assert.match(s, /delete paths\[`\$\{OPEN_PAGES_NODE\}\/\$\{postId\}`\];/);
    assert.match(s, /'X-Firebase-ETag': 'true'/);
  });
});

describe('LIVE-PATHS-2 #7 · record-attempt', () => {
  test('the approval and story checks come before the counting write', () => {
    const s = src('functions/api/record-attempt.js');
    const check = s.indexOf('cms_quizzes/${slug}/approvedAt.json');
    const write = s.indexOf("[`cms_stories/${slug}/quizMeta/attemptCount`]");
    assert.ok(check > 0 && write > check);
    // Ruling 293: a retired story's quiz is refused too.
    assert.ok(s.indexOf('cms_stories_retired/${slug}.json') > 0 && s.indexOf('cms_stories_retired/${slug}.json') < write);
    assert.match(s, /if \(!approvedAt \|\| story === null \|\| retired !== null\)/);
  });
});

describe('LIVE-PATHS-2 · the guard sees the path string', () => {
  test('checkRefArg refuses every empty segment but a leading slash', () => {
    for (const bad of ['users/', 'users//x', 'a/b/', '/users/']) assert.throws(() => checkRefArg(bad), GuardRefusal, bad);
    for (const ok of [undefined, '', '/', 'users', '/users/x', 'a/b/c']) assert.doesNotThrow(() => checkRefArg(ok), String(ok));
    assert.throws(() => checkRefArg(5), GuardRefusal);
  });
});

describe('LIVE-PATHS-2 · a dispatch input reaches a shell only as a boolean', () => {
  // Text-level: no YAML parser is a dependency here. Inputs are read from each workflow's
  // workflow_dispatch block; `run:` blocks are the lines indented under a `run: |`.
  const dir = new URL('.github/workflows/', ROOT);
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const inputsOf = (text) => {
    const out = {};
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^\s*workflow_dispatch:\s*$/.test(l));
    if (start < 0) return out;
    const iIn = lines.findIndex((l, i) => i > start && /^\s*inputs:\s*$/.test(l));
    if (iIn < 0) return out;
    const base = lines[iIn].search(/\S/);
    let name = null;
    for (let i = iIn + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const ind = l.search(/\S/);
      if (ind <= base) break;
      const m = l.match(/^\s*([A-Za-z0-9_-]+):\s*$/);
      if (m && ind === base + 2) { name = m[1]; out[name] = 'string'; continue; }
      const t = l.match(/^\s*type:\s*([a-z]+)/);
      if (t && name) out[name] = t[1];
    }
    return out;
  };
  const runBlocks = (text) => {
    const blocks = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
      if (!m) continue;
      if (m[2] && m[2] !== '|' && m[2] !== '>') { blocks.push(m[2]); continue; }
      const ind = lines[i].search(/\S/);
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && lines[j].search(/\S/) <= ind) break;
        body.push(lines[j]);
      }
      blocks.push(body.join('\n'));
    }
    return blocks;
  };
  for (const f of files) {
    test(f, () => {
      const text = readFileSync(new URL(f, dir), 'utf8');
      const types = inputsOf(text);
      for (const b of runBlocks(text)) {
        for (const m of b.matchAll(/\$\{\{[^}]*?\b(?:github\.event\.)?inputs\.([A-Za-z0-9_-]+)[^}]*\}\}/g)) {
          assert.equal(types[m[1]], 'boolean', `${f}: input "${m[1]}" (${types[m[1]] || 'undeclared'}) is pasted into a run: block`);
        }
      }
    });
  }
  test('the two that took a slug check its shape before using it', () => {
    for (const f of ['covers.yml', 'index-reconcile.yml']) {
      const t = readFileSync(new URL(f, dir), 'utf8');
      assert.match(t, /IN_SLUG: \$\{\{ (github\.event\.)?inputs\.slug \}\}/, f);
      assert.match(t, /\[\[ "\$IN_SLUG" =~ \^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$ \]\]/, f);
      assert.match(t, /args\+=\(--slug "\$IN_SLUG"\)/, f);
    }
  });
});

describe('LIVE-PATHS-2 #9 · CLAUDE.md', () => {
  test('no attack-shaped requests to production, and why', () => {
    const s = src('CLAUDE.md');
    assert.match(s, /NO ATTACK-SHAPED REQUESTS TO PRODUCTION, NOT EVEN TO CHECK THEY'RE REFUSED/);
    assert.match(s, /If the fix isn't live yet,\s+the check is the attack/);
  });
});
