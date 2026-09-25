// W6 (B) — THE BOOK STORE FILE CLEAN-UP REPORTS WHAT IT DID.
//
//   node --test tests/ci/w6-bookstore-cleanup.test.mjs       (part of npm run test:ci)
//
// deleteTitle removes the record and then the title's Storage objects (sample, cover rungs, author
// photograph, and — when nobody holds the book — the master and cover). Before W6 the panel said
// "Title deleted" whatever that loop did; a file that would not go reached the console only, and a
// 404 was skipped without a word. Now every result is counted, the notice says how many went,
// which were already gone, which were kept for holders and which failed, and the failed ones get a
// retry — which cannot be talked into deleting a held master.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyRemoval, summariseFileRemoval, retryablePaths, masterPathFor, OBJECT_NOT_FOUND,
} from '../../app/lib/bookstore/withdrawal.js';

const src = (p) => readFileSync(p, 'utf8');
const SAMPLE = 'bookstore_epubs/t/sample.epub';
const RUNG = 'bookstore_covers/t_w360.webp';
const PHOTO = 'bookstore_covers/t_author.jpg';

describe('each removal is classified', () => {
  test('removed, already gone (a 404), or failed', () => {
    assert.equal(classifyRemoval(null), 'removed');
    assert.equal(classifyRemoval({ code: OBJECT_NOT_FOUND }), 'gone');
    assert.equal(classifyRemoval({ code: 'storage/unauthorized' }), 'failed');
    assert.equal(classifyRemoval(new Error('network')), 'failed');
  });
});

describe('the sentence', () => {
  test('all removed: the success line, with the count', () => {
    const r = summariseFileRemoval({ removed: [SAMPLE, RUNG, PHOTO] });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'Title deleted. 3 files removed.');
  });

  test('a 404 counts as removed, and says so', () => {
    const r = summariseFileRemoval({ removed: [RUNG], gone: [SAMPLE] });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'Title deleted. 2 files removed (1 was already gone).');
  });

  test('held files are named as kept on purpose', () => {
    const r = summariseFileRemoval({ removed: [SAMPLE], held: ['bookstore_epubs/t/master.epub'] });
    assert.match(r.text, /1 file kept on purpose, because people hold this book: bookstore_epubs\/t\/master\.epub\./);
  });

  test('A FAILURE IS NEVER A BLANKET SUCCESS: it names the failed files and offers a retry', () => {
    const r = summariseFileRemoval({ removed: [RUNG], gone: [PHOTO], failed: [SAMPLE] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.failed, [SAMPLE]);
    assert.equal(
      r.text,
      `Title deleted, but 1 of its 3 files could not be removed: ${SAMPLE}. 2 files removed (1 was already gone). `
      + 'The shop is correct either way; these are leftover files in Storage. Retry to remove them.',
    );
    assert.equal(/^Title deleted\.(\s|$)/.test(r.text), false);
  });

  test('the retry pass has its own wording, both ways', () => {
    assert.deepEqual(summariseFileRemoval({ removed: [SAMPLE], phase: 'retry' }), { ok: true, failed: [], text: 'The leftover files are cleared. 1 file removed.' });
    const still = summariseFileRemoval({ failed: [SAMPLE, RUNG], phase: 'retry' });
    assert.equal(still.ok, false);
    assert.match(still.text, /^2 of 2 files still could not be removed: /);
  });
});

describe('the retry cannot delete a held master', () => {
  const tomb = (ownersAtDeletion) => ({ titleId: 't', ownersAtDeletion, coverUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/bookstore_covers%2Ft.jpg?alt=media' });
  const asked = [masterPathFor('t'), 'bookstore_covers/t.jpg', SAMPLE];

  test('held at deletion (or unknown): the master and the shelf cover are dropped from the list', () => {
    assert.deepEqual(retryablePaths({ titleId: 't', paths: asked, tombstone: tomb(1) }), [SAMPLE]);
    assert.deepEqual(retryablePaths({ titleId: 't', paths: asked, tombstone: tomb(null) }), [SAMPLE]);
  });

  test('no tombstone: nothing is retried', () => {
    assert.deepEqual(retryablePaths({ titleId: 't', paths: asked, tombstone: null }), []);
  });

  test('nobody held it: the failed list is retried as given', () => {
    assert.deepEqual(retryablePaths({ titleId: 't', paths: asked, tombstone: tomb(0) }), asked);
  });
});

describe('the wiring', () => {
  const admin = src('app/lib/bookstore/admin-writes.js');
  const page = src('app/admin/bookstore/page.js');

  test('deleteTitle returns removed, gone and failed; the retry re-checks the tombstone', () => {
    const del = admin.slice(admin.indexOf('export async function deleteTitle'), admin.indexOf('async function removeObjects'));
    assert.match(del, /filesGone: files\.gone/);
    assert.match(del, /filesFailed: files\.failed/);
    const retry = admin.slice(admin.indexOf('export async function retryFileRemoval'));
    assert.match(retry, /retryablePaths\(\{ titleId, paths, tombstone \}\)/);
    assert.match(retry, /removeObjects\(allowed\)/);
  });

  test('the panel reports through the summariser, never a bare "Title deleted" toast', () => {
    const confirm = page.slice(page.indexOf('async function confirmDelete'), page.indexOf('async function handleQuickStatus'));
    assert.doesNotMatch(confirm, /showToast\('Title deleted'\)/);
    assert.match(confirm, /summariseFileRemoval\(\{/);
    assert.match(confirm, /retry: summary\.ok \? null : \{ kind: 'files', titleId: title\.id, paths: summary\.failed \}/);
    assert.match(confirm, /retryFileRemoval\(r\.titleId, r\.paths\)/);
    assert.match(page, /'Retry the failed files'/);
  });
});
