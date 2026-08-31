// R31 — DELETING AN INSTALMENT: the plan, the burn, and the four rulings.
//
// Companion to tests/ci/series-access.test.mjs, which covers the ENTITLEMENT decision. This
// file covers the DESTRUCTION decision, and it is a separate file for the same reason
// deletion.js is a separate module from access.js: one answers "may you read this", the other
// answers "what does removing it take with it", and nothing should be able to satisfy one by
// weakening the other.
//
// ── EVERY ASSERTION HERE CAN FAIL. THAT IS THE POINT OF THE TWINS. ──────────────────────
//
// Eighteen instances now exist across this project of tests that could not fail — assertions
// on shapes that were true by construction, or that would have passed against an empty object.
// So every claim below is paired with a MUTATION TWIN: the same assertion run against a
// deliberately broken variant, asserted to fail. A twin that passes means the original was
// vacuous, and the twin says so by name rather than by a silent green tick.
//
// The pure-function half is testable at all because deletionPlan() reads nothing and writes
// nothing — see its header on why the decision was lifted out of the writer. The half that
// talks to Firebase is covered by tests/series/instalment-admin.spec.mjs against the
// emulators, and by tests/rules/*.test.mjs against the real rules.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deletionPlan, nextFreeOrdinal, isTombstoned } from '../../app/lib/series/deletion.js';
import { epubObjectPath, INSTALMENTS_DELETED_PATH } from '../../app/lib/series/schema.js';

const ID = 'beta-princess-i3';
const SERIES = 'beta-princess';
const NOW = 1788187808396;

const plan = (over = {}) => deletionPlan({ id: ID, seriesId: SERIES, ordinal: 3, now: NOW, ...over });

/** Source with comments removed, so an assertion about CODE cannot be answered by prose. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Run `fn` and assert it FAILS. The twin harness.
 *
 * `assert.throws` is not enough on its own: most of the claims below are equality checks, not
 * throws, so the twin wraps the whole assertion and demands that it raise. A twin that does
 * not raise is reported with the claim it was supposed to disprove, so a vacuous test is named
 * in the output rather than merely absent from it.
 */
function mustFail(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert.ok(threw, `MUTATION TWIN DID NOT FAIL: "${label}" passes against a broken input, so the original assertion proves nothing`);
}

describe('R31 · deletionPlan — what a delete removes', () => {
  test('the row and the detail are both removed, and in one list', () => {
    const p = plan();
    assert.deepEqual(p.dbPaths, [
      `series_instalments/${ID}`,
      `series_instalments_detail/${ID}`,
    ]);

    // TWIN — a plan that dropped the detail node would leave content in the database with no
    // row, which is the exact half-deleted state createInstalment()'s atomicity note forbids.
    mustFail('both nodes are listed', () => {
      assert.deepEqual([`series_instalments/${ID}`], p.dbPaths);
    });
  });

  test('the EPUB path comes from epubObjectPath(), not from the record', () => {
    const p = plan();
    assert.equal(p.epubPath, epubObjectPath(ID));
    assert.equal(p.epubPath, `series_epubs/${ID}/master.epub`);

    // ⚠ THE POINT OF THE SECOND ASSERTION. detail.epubPath is RECORDED, never authoritative —
    // the schema says so and the stream endpoint derives its own. A plan that trusted the
    // record would miss the file exactly when the record and the bucket had drifted, which is
    // the one moment a delete is most needed. deletionPlan() is not even handed the detail, so
    // it cannot read it; this asserts the derived value is the one that comes out.
    mustFail('the epub path is derived', () => {
      assert.equal(p.epubPath, 'series_epubs/some-other-id/master.epub');
    });
  });

  test('the cover and sponsor prefixes are folders to enumerate, not guessed object names', () => {
    const p = plan();
    assert.deepEqual(p.storagePrefixes, [
      `series_covers/${ID}/cover`,
      `series_covers/${ID}/sponsor`,
    ]);

    // uploadSeriesImage() writes `{key}/{Date.now()}-{file.name}`, so no object name is
    // derivable. A prefix that carried a filename would delete nothing and report success.
    for (const prefix of p.storagePrefixes) {
      assert.ok(!/\.(png|jpe?g|webp|svg)$/i.test(prefix), `${prefix} looks like an object, not a prefix`);
    }

    mustFail('both prefixes are present', () => {
      assert.deepEqual([`series_covers/${ID}/cover`], p.storagePrefixes);
    });
  });

  test('the tombstone burns the id, and carries the ordinal that was retired', () => {
    const p = plan();
    assert.equal(p.tombstonePath, `${INSTALMENTS_DELETED_PATH}/${ID}`);
    assert.deepEqual(p.tombstone, { seriesId: SERIES, ordinal: 3, deletedAt: NOW });

    mustFail('the tombstone records the ordinal', () => {
      assert.deepEqual(p.tombstone, { seriesId: SERIES, deletedAt: NOW });
    });
  });

  test("⚠ THE READER'S SAVED POSITION IS SPARED, AND THE PLAN NAMES IT RATHER THAN OMITTING IT", () => {
    const p = plan();

    // The negative claim, asserted directly: nothing in any delete list touches the progress
    // node. It could not be deleted anyway — series_reading_progress/{uid} is
    // `auth.uid == $uid` for read AND write, so an admin has no permission to anyone else's
    // record — but "the code happens not to try" and "the plan states that it does not" are
    // different guarantees, and only the second one survives someone adding a path later.
    const everyPath = [...p.dbPaths, p.tombstonePath, p.epubPath, ...p.storagePrefixes];
    for (const path of everyPath) {
      assert.ok(!path.includes('series_reading_progress'), `${path} would touch a reader's position`);
    }
    assert.ok(p.spared.some((x) => x.includes('series_reading_progress')));

    mustFail('no delete path touches reading progress', () => {
      const broken = [...everyPath, `series_reading_progress/some-uid/${ID}`];
      for (const path of broken) {
        assert.ok(!path.includes('series_reading_progress'), `${path} would touch a reader's position`);
      }
    });
  });

  test('the parent series record is spared — only its updatedAt is touched, by the writer', () => {
    const p = plan();
    assert.ok(p.spared.includes(`series/${SERIES}`));
    for (const path of p.dbPaths) {
      assert.ok(!path.startsWith('series/'), `${path} would delete the parent`);
    }

    mustFail('the parent is never in dbPaths', () => {
      for (const path of [...p.dbPaths, `series/${SERIES}`]) {
        assert.ok(!path.startsWith('series/'), `${path} would delete the parent`);
      }
    });
  });

  test('a plan cannot be built without an id, a seriesId and a real ordinal', () => {
    assert.throws(() => deletionPlan({ seriesId: SERIES, ordinal: 3 }), /id is required/);
    assert.throws(() => deletionPlan({ id: ID, ordinal: 3 }), /seriesId is required/);
    assert.throws(() => deletionPlan({ id: ID, seriesId: SERIES }), /ordinal/);
    assert.throws(() => deletionPlan({ id: ID, seriesId: SERIES, ordinal: 0 }), /ordinal/);

    // Not a twin — these ARE the failure assertions. What would make them vacuous is a
    // deletionPlan that threw on everything, so one call has to succeed.
    assert.ok(deletionPlan({ id: ID, seriesId: SERIES, ordinal: 3 }));
  });
});

describe('R31 · the ordinal gap survives deletion', () => {
  const rows = [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }, { ordinal: 4 }];

  test('deleting 3 does not renumber 4 — the plan cannot touch another row at all', () => {
    const p = deletionPlan({ id: 'x-i3', seriesId: 'x', ordinal: 3 });
    // Every path the plan produces names the deleted instalment's own id. A renumbering would
    // have to write to a sibling, and there is nowhere in this shape for that to happen.
    for (const path of [...p.dbPaths, p.tombstonePath]) {
      assert.ok(path.endsWith('/x-i3'), `${path} is not the deleted instalment`);
    }

    mustFail('every path names the deleted instalment', () => {
      for (const path of [...p.dbPaths, 'series_instalments/x-i4']) {
        assert.ok(path.endsWith('/x-i3'), `${path} is not the deleted instalment`);
      }
    });
  });

  test('⚠ THE GAP IS ONLY REAL IF THE ID CANNOT BE REISSUED — deleting the TOP instalment', () => {
    // This is the case not-renumbering does not cover, and the reason the tombstone exists.
    // Delete 4 of [1,2,3,4]: max(live) + 1 is 4 again, so the next create would reissue
    // beta-princess-i4 — the very key a reader's saved position is stored under.
    const afterDeletingTop = [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }];
    const naive = Math.max(...afterDeletingTop.map((r) => r.ordinal)) + 1;
    assert.equal(naive, 4, 'the naive next-ordinal reissues the burned number — this is the bug');

    const tombstones = { 'x-i4': { seriesId: 'x', ordinal: 4, deletedAt: NOW } };
    assert.equal(nextFreeOrdinal(afterDeletingTop, tombstones), 5);

    mustFail('nextFreeOrdinal counts the dead', () => {
      assert.equal(nextFreeOrdinal(afterDeletingTop, {}), 5);
    });
  });

  test('deleting a MIDDLE instalment leaves the gap and does not reuse it either', () => {
    const afterDeletingThree = [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 4 }];
    const tombstones = { 'x-i3': { seriesId: 'x', ordinal: 3, deletedAt: NOW } };

    assert.equal(nextFreeOrdinal(afterDeletingThree, tombstones), 5, 'the next instalment is 5, not the 3-shaped hole');
    assert.ok(isTombstoned(tombstones, 'x-i3'), 'ordinal 3 is burned and a create must refuse it');
    assert.ok(!isTombstoned(tombstones, 'x-i5'));

    mustFail('a burned id is recognised', () => {
      assert.ok(isTombstoned({}, 'x-i3'));
    });
  });

  test('nextFreeOrdinal takes rows in either shape, and an empty series starts at 1', () => {
    assert.equal(nextFreeOrdinal([], {}), 1);
    assert.equal(nextFreeOrdinal({ 'x-i1': { ordinal: 1 }, 'x-i2': { ordinal: 2 } }, {}), 3);
    assert.equal(nextFreeOrdinal(rows, []), 5);

    mustFail('an empty series starts at 1', () => {
      assert.equal(nextFreeOrdinal([], {}), 2);
    });
  });
});

describe('R31 · the writer executes the plan, and the source says so', () => {
  const src = readFileSync(new URL('../../app/lib/series/admin-writes.js', import.meta.url), 'utf8');

  test('deleteInstalment nulls the records BEFORE it removes the files', () => {
    // Order is the one thing a pure plan cannot express, and it is load-bearing: files-first
    // would leave a published, released instalment whose record promises an EPUB the bucket no
    // longer has — a broken download rather than an absence.
    const fn = src.slice(src.indexOf('export async function deleteInstalment'));
    const dbAt = fn.indexOf('await update(ref(db), patch)');
    const storageAt = fn.indexOf('deleteObject');
    assert.ok(dbAt > 0, 'deleteInstalment does not write the records');
    assert.ok(storageAt > 0, 'deleteInstalment does not delete any object');
    assert.ok(dbAt < storageAt, 'the files are removed before the records — see the header');
  });

  test('the records, the tombstone and the parent bump are ONE multi-path update', () => {
    const fn = src.slice(src.indexOf('export async function deleteInstalment'));
    const body = fn.slice(0, fn.indexOf('const warnings'));
    assert.equal((body.match(/await update\(ref\(db\)/g) || []).length, 1,
      'the burn and the removal must not be able to come apart');
    assert.ok(/patch\[plan\.tombstonePath\] = plan\.tombstone/.test(body));
  });

  test('createInstalment refuses a tombstoned id, and checks it BEFORE the validators', () => {
    const fn = src.slice(src.indexOf('export async function createInstalment'));
    assert.ok(/INSTALMENTS_DELETED_PATH/.test(fn), 'createInstalment never consults the tombstones');
    assert.ok(fn.indexOf('INSTALMENTS_DELETED_PATH') < fn.indexOf('await update(ref(db)'),
      'the tombstone is checked after the write, which is not a check');

    // ⚠ ORDER. A retired ordinal is not something a better-filled form can fix, so it must not
    // queue behind 'title is required' — that is how an editor fills in nine fields to be told
    // the number was impossible all along. Identity first, content second.
    assert.ok(fn.indexOf('INSTALMENTS_DELETED_PATH') < fn.indexOf('validateInstalmentDetail('),
      'the tombstone is checked after the content validators — the editor fills the form first');
  });

  test('⚠ THERE IS NO instalmentCount, AND NOTHING PRETENDS TO RECOMPUTE ONE', () => {
    // The brief asked that the parent's instalmentCount be recomputed rather than decremented.
    // The field does not exist and was rejected by name — schema.js gives two reasons, the
    // sharper being that a stored integer cannot express a value whose transitions are
    // clock-driven. Removing the row IS the recount. This asserts nobody quietly adds one back
    // while servicing that request, which is the failure the brief was guarding against.
    const schema = readFileSync(new URL('../../app/lib/series/schema.js', import.meta.url), 'utf8');
    // ⚠ CODE ONLY, NOT PROSE. Both files DISCUSS instalmentCount at length — that is the whole
    // point of the schema's "NOTE WHAT IS ABSENT" block, and of deleteInstalment()'s note on
    // why removing the row is the recount. A grep over the raw source would fail on the
    // comments explaining why the field must not exist, which is the opposite of what is being
    // asserted. Strip the comments and check what actually runs.
    assert.ok(!/instalmentCount/.test(stripComments(schema)), 'a stored instalmentCount reappeared in the schema');
    assert.ok(!/instalmentCount/.test(stripComments(src)), 'the writer maintains a counter that must not exist');
    assert.ok(/releasedCount/.test(readFileSync(new URL('../../app/lib/series/access.js', import.meta.url), 'utf8')),
      'the derived count is gone, so the absence of a stored one is now a hole');
  });

  test("the parent's updatedAt IS bumped, so a delete is visible on the series record", () => {
    const fn = src.slice(src.indexOf('export async function deleteInstalment'));
    assert.ok(/SERIES_PATH\}\/\$\{row\.seriesId\}\/updatedAt/.test(fn),
      'deleting an instalment leaves the parent looking untouched');
  });
});

describe('R31 · the rules that make the delete possible', () => {
  const storage = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
  const database = JSON.parse(readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8'));

  // ⚠ R21's LESSON, PAID FOR TWICE. A single `allow write` guarded on request.resource.size
  // denies EVERY delete, founders included, because request.resource is null on a delete. Both
  // Series prefixes shipped that way. If this test goes red, deleteInstalment() still removes
  // the records and silently orphans every file.
  for (const prefix of ['series_epubs/{instalmentId}/master.epub', 'series_covers/{allPaths=**}']) {
    test(`${prefix} splits create/update from delete`, () => {
      const block = storage.slice(storage.indexOf(`match /${prefix} {`));
      const body = block.slice(0, block.indexOf('\n    }'));
      assert.ok(/allow create, update:/.test(body), `${prefix} still uses a combined allow write`);
      assert.ok(/allow delete:/.test(body), `${prefix} has no delete rule`);

      // The delete rule must carry the identity and NOT the resource guards.
      const del = body.slice(body.indexOf('allow delete:'));
      assert.ok(/request\.auth\.uid ==/.test(del), 'the delete rule does not check identity');
      assert.ok(!/request\.resource/.test(del),
        'the delete rule guards on request.resource, which is null on a delete — this denies every delete');
    });
  }

  test('the tombstone node is admin-only, both ways', () => {
    const node = database.rules.series_instalments_deleted;
    assert.ok(node, 'series_instalments_deleted is not in the rules');
    for (const op of ['.read', '.write']) {
      assert.ok(/auth != null/.test(node[op]), `${op} does not require auth`);
      assert.ok(/XaG6bTGqdDXh7VkBTw4y1H2d2s82/.test(node[op]), `${op} is not restricted to the founders`);
    }
    // It is NOT public. The gap itself is visible in the rows; that a specific instalment once
    // existed, and when it went, is not something a reader was told.
    assert.notEqual(node['.read'], true);
    assert.ok(/hasChildren\(\['seriesId', 'ordinal', 'deletedAt'\]\)/.test(node.$instalmentId['.validate']));
  });

  test('reading progress is still unreachable to an admin — the reason the position survives', () => {
    const node = database.rules.series_reading_progress.$uid;
    assert.equal(node['.read'], 'auth != null && auth.uid == $uid');
    assert.equal(node['.write'], 'auth != null && auth.uid == $uid');
    assert.ok(!/XaG6bTGqdDXh7VkBTw4y1H2d2s82/.test(JSON.stringify(node)),
      'an admin carve-out appeared on the progress node — deletion.js ruling 3 assumes there is none');
  });
});

describe('R31 · the tier gate is still off, and the copy still follows it', () => {
  test('SERIES_TIER_GATE_ENABLED is false, and adding a tier control did not flip it', async () => {
    const { SERIES_TIER_GATE_ENABLED } = await import('../../app/lib/series/access.js');
    // Deliberately duplicated from series-access.test.mjs. That file guards the FLAG; this one
    // guards it against the round that added an editor-facing control over the value it gates,
    // which is exactly the round most likely to turn it on to see the control work.
    assert.equal(SERIES_TIER_GATE_ENABLED, false,
      'memberships are not on sale — a tier gate against a tier nobody can buy refuses every reader');
  });

  test('the /series meta description no longer contradicts the flag', () => {
    const layout = readFileSync(new URL('../../app/series/layout.js', import.meta.url), 'utf8');
    assert.ok(/SERIES_TIER_GATE_ENABLED/.test(layout),
      'the meta description is hardcoded again — it promised Platinum over a free page');
  });

  test('the admin tier control repeats the day-pass exclusion where an editor will read it', () => {
    const admin = readFileSync(new URL('../../app/admin/series/page.js', import.meta.url), 'utf8');
    const tier = admin.slice(admin.indexOf('function InstalmentTier'));
    const body = tier.slice(0, tier.indexOf('\nfunction '));
    assert.ok(/Day and week passes never qualify/.test(body),
      'the tier control does not say passes are excluded — the one distinction a second control makes easy to lose');
  });

  test('the admin nav links to /admin/series', () => {
    const nav = readFileSync(new URL('../../app/admin/page.js', import.meta.url), 'utf8');
    assert.ok(/href="\/admin\/series"/.test(nav), '/admin/series is reachable only by typing the URL');
  });
});
