// W43 — THE CARRY-OVER'S WRITE MODE, against the RTDB emulator.
//
//   npm run test:carry-over:emulator
//
// An invented book (tests/fixtures/epub-repair-fixtures.mjs: three chapters folded into one),
// its repair, and invented saved places on every branch of scripts/epub-repair/carry-over.mjs:
// pinned new, pinned old (kept / mapped / landed), pinned to something else, unpinned from each
// file, unpinned from neither, fraction-only. Then the safety half: --apply refuses on the wrong
// live generation; a reader's save between the read and the write wins; a second run changes
// nothing, and a third picks up a record a session still on the old file wrote since.
//
// REST against the emulator with a demo- namespace: nothing here can reach production. Needs
// Chromium (the mapping resolves CFIs with the vendored foliate) and a JDK (the emulator).

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carryOver, restDb } from '../../scripts/epub-repair/carry-over.mjs';
import { mapPositions } from '../../scripts/epub-repair/map-positions.mjs';
import { readEntries, writeEntries, applyPlan } from '../../scripts/epub-repair/lib.mjs';
import { foldedBook, SPLIT_PLAN } from '../fixtures/epub-repair-fixtures.mjs';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = 'demo-calvary-carry-default-rtdb';
const URL = `http://${HOST}`;
assert.match(URL, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'refusing to run anywhere but the emulator');
const db = restDb({ url: URL, ns: NS });
const raw = async (method, path, body) => {
  const r = await fetch(`${URL}/${path}.json?ns=${NS}`, { method, headers: { Authorization: 'Bearer owner' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(r.ok, `${method} ${path}: ${r.status}`);
  return r.json();
};

const OLD = '1700000000000001';
const NEW = '1700000000000002';
const OTHER = '1699999999999999';
const TITLE = 'tide-book';
const SLUG = 'tide-book';
const oldBytes = foldedBook();
const newBytes = writeEntries(applyPlan(readEntries(oldBytes), SPLIT_PLAN()).entries);
// Section child `child` of spine item `spine` (the W42 test's addressing).
const at = (spine, child, off = '/1:3') => `epubcfi(/6/${(spine + 1) * 2}!/4/2/${(child + 1) * 2}${off})`;

const CFI = {
  kept: at(2, 3),                 // Two, an untouched file
  inCut: at(3, 10),               // folded Four's second paragraph
  heading: at(3, 8, '/1:2'),      // the "CHAPTER FOUR" line itself
  inCut2: at(3, 16),              // folded Five
  newOnly: at(5, 3),              // spine 5 exists only in the repair (Five)
};
let est;                          // each CFI's fraction estimate in each file

const place = (cfi, fraction, pin, extra = {}) => ({ cfi, fraction, ...(pin ? { epubVersion: pin } : {}), ...extra });
const pos = (v) => ({ ...v, updatedAt: 1000 });
const rib = (v, label = 'Three') => ({ ...v, label, excerpt: 'invented', createdAt: 2000 });

async function seed() {
  await raw('PUT', '', {
    bookstore_reading_progress: {
      'reader-a': { [TITLE]: pos(place(CFI.kept, est.kept.old, OLD)), 'other-book': pos(place(CFI.kept, 0.5, OLD)) },
      'reader-b': { [TITLE]: pos(place(CFI.inCut, est.inCut.old, OLD)) },
      'reader-c': { [TITLE]: { fraction: 0.4, updatedAt: 1000 } },
    },
    readerBookmarks: {
      'reader-a': { [SLUG]: {
        r1: rib(place(CFI.heading, est.heading.old, OLD)),
        r2: rib(place(CFI.newOnly, est.newOnly.new, NEW), 'Five'),
        r3: rib(place(CFI.kept, est.kept.old, OTHER), 'Two'),
      } },
      'reader-d': { [SLUG]: {
        r4: rib(place(CFI.inCut2, est.inCut2.old, null)),
        r5: rib(place(CFI.newOnly, est.newOnly.new, null), 'Five'),
        r6: rib(place(CFI.inCut2, 0.99, null)),
      }, 'other-book': { r7: rib(place(CFI.kept, 0.2, OLD)) } },
    },
  });
}

const run = (o = {}) => carryOver({ db, oldBytes, newBytes, titleId: TITLE, slug: SLUG, oldGen: OLD, newGen: NEW, liveGeneration: async () => NEW, ...o });
const byPath = (out) => Object.fromEntries(out.rows.map((r) => [r.path.split('/').slice(-1)[0] === TITLE ? r.path.split('/')[1] : r.path.split('/').at(-1), r]));

before(async () => {
  const keys = Object.keys(CFI);
  const { records } = await mapPositions({ oldBytes, newBytes, records: keys.map((k) => ({ key: k, kind: 'position', cfi: CFI[k] })) });
  est = Object.fromEntries(records.map((r) => [r.key, { old: r.probe.old.fraction ?? null, new: r.probe.new.fraction ?? null }]));
  assert.equal(est.newOnly.old, null, 'the new-only CFI does not resolve in the old file');
  assert.equal(typeof est.inCut.old, 'number');
});
beforeEach(seed);

describe('carry-over · every branch (dry run)', () => {
  test('decisions, and nothing written', async () => {
    const before = await raw('GET', '');
    const out = await run();
    assert.equal(out.applied, false);
    const r = byPath(out);
    assert.equal(r['reader-a'].decision.why, 'kept');
    assert.equal(r['reader-a'].decision.from, 'pinned old');
    assert.equal(r['reader-b'].decision.why, 'mapped');
    assert.equal(r['reader-c'].decision.why, 'no cfi');
    assert.equal(r.r1.decision.why, 'landed');
    assert.equal(r.r2.decision.why, 'pinned new');
    assert.equal(r.r3.decision.why, 'pinned other');
    assert.equal(r.r4.decision.from, 'unpinned, read in the old file');
    assert.equal(r.r4.decision.action, 'write');
    assert.equal(r.r5.decision.why, 'unpinned, read in the new file');
    assert.equal(r.r6.decision.why, 'unpinned, no file agrees');
    assert.equal(out.rows.length, 9, 'other titles are never gathered');
    assert.deepEqual(await raw('GET', ''), before, 'a dry run writes nothing');
  });
});

describe('carry-over · --apply', () => {
  test('refuses unless the live master is the new generation', async () => {
    await assert.rejects(run({ apply: true, backupDir: await mkdtemp(join(tmpdir(), 'carry-')), liveGeneration: async () => OLD }), /refused: the live master is generation/);
    await assert.rejects(run({ apply: true, backupDir: await mkdtemp(join(tmpdir(), 'carry-')), newGen: null }), /needs the new generation/);
  });

  test('writes kept / mapped / landed / unpinned-old with the new pin; leaves the rest; backs up first', async () => {
    const before = await raw('GET', '');
    const out = await run({ apply: true, backupDir: await mkdtemp(join(tmpdir(), 'carry-')) });
    assert.deepEqual({ w: out.summary.written, v: out.summary.verified, c: out.summary.conflicts, m: out.summary.mismatched }, { w: 4, v: 4, c: 0, m: 0 });
    const after = await raw('GET', '');
    const pa = after.bookstore_reading_progress['reader-a'][TITLE];
    assert.equal(pa.cfi, CFI.kept, 'kept: the cfi is unchanged');
    assert.equal(pa.epubVersion, NEW);
    assert.equal(pa.updatedAt, 1000, 'updatedAt is the reader\'s, not the migration\'s');
    const pb = after.bookstore_reading_progress['reader-b'][TITLE];
    const mb = byPath(out)['reader-b'].mapped;
    assert.notEqual(pb.cfi, CFI.inCut);
    assert.equal(mb.newFile, 'EPUB/text/ch006.xhtml');
    assert.ok(Math.abs(pb.fraction - (est.inCut.old + (mb.newFraction - mb.oldFractionComputed))) < 1e-5, 'fraction shifted by the mapping\'s own delta');
    const r1 = after.readerBookmarks['reader-a'][SLUG].r1;
    assert.equal(r1.label, 'Four', 'a ribbon that changes chapter takes the new contents label');
    assert.equal(r1.epubVersion, NEW);
    assert.equal(after.readerBookmarks['reader-d'][SLUG].r4.epubVersion, NEW, 'unpinned, read in the old file → carried');
    // Left exactly as they were.
    for (const p of [['readerBookmarks', 'reader-a', SLUG, 'r2'], ['readerBookmarks', 'reader-a', SLUG, 'r3'], ['readerBookmarks', 'reader-d', SLUG, 'r5'], ['readerBookmarks', 'reader-d', SLUG, 'r6'],
      ['bookstore_reading_progress', 'reader-c', TITLE], ['bookstore_reading_progress', 'reader-a', 'other-book'], ['readerBookmarks', 'reader-d', 'other-book']]) {
      assert.deepEqual(p.reduce((o, k) => o[k], after), p.reduce((o, k) => o[k], before), p.join('/'));
    }
    const backup = JSON.parse(await readFile(out.summary.backup, 'utf8'));
    assert.equal(backup.records.length, 4);
    for (const b of backup.records) assert.deepEqual(b.before, b.path.split('/').reduce((o, k) => o[k], before), 'the backup holds the pre-write value');
  });

  test('a reader\'s save between the read and the write wins, and is reported', async () => {
    const theirs = pos(place(CFI.inCut, 0.61, OLD));
    const out = await run({
      apply: true, backupDir: await mkdtemp(join(tmpdir(), 'carry-')),
      beforeWrite: async (r) => { if (r.path.includes('reader-b')) await raw('PUT', r.path, theirs); },
    });
    assert.equal(out.summary.conflicts, 1);
    assert.equal(byPath(out)['reader-b'].outcome, 'reader save won');
    assert.deepEqual(await raw('GET', `bookstore_reading_progress/reader-b/${TITLE}`), theirs);
    // The next run carries their new save.
    const again = await run({ apply: true, backupDir: await mkdtemp(join(tmpdir(), 'carry-')) });
    assert.equal(again.summary.written, 1);
    assert.equal((await raw('GET', `bookstore_reading_progress/reader-b/${TITLE}`)).epubVersion, NEW);
  });

  test('idempotent; a later run picks up a session still on the old file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carry-'));
    await run({ apply: true, backupDir: dir });
    const settled = await raw('GET', '');
    const second = await run({ apply: true, backupDir: dir });
    assert.equal(second.summary.write, 0);
    assert.deepEqual(await raw('GET', ''), settled, 'the second run changes nothing');
    await raw('PUT', `readerBookmarks/reader-e/${SLUG}/r8`, rib(place(CFI.inCut2, est.inCut2.old, OLD)));
    const third = await run({ apply: true, backupDir: dir });
    assert.equal(third.summary.written, 1);
    assert.equal((await raw('GET', `readerBookmarks/reader-e/${SLUG}/r8`)).epubVersion, NEW);
  });

  test('the backup folder may not be inside the repo', async () => {
    await assert.rejects(run({ apply: true, backupDir: 'tests/fixtures' }), /refusing the backup folder inside the repo/);
  });
});
