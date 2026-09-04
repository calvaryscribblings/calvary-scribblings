// R37 — the backup liveness thresholds.
//
// Every one of these states is one the real bucket cannot be put into on demand: a
// backup that has stopped, one that is quietly shrinking, one whose archive will not
// inflate. A check whose FAILURE path has never run is the same class of object as a
// backup nobody has restored — believed, and untested.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assess, MAX_AGE_HOURS, MUST_CARRY } from '../../scripts/backup/assess.mjs';

const NOW = Date.parse('2026-09-04T09:00:00Z');
const HOUR = 3600e3, DAY = 24 * HOUR;
const MB = 1048576;

// A healthy history: daily archives at ~00:13, all about 5.7 MB.
const healthy = (count = 8, sizeMb = 5.7) =>
  Array.from({ length: count }, (_, i) => ({
    name: `2026-09-0${i}T00:13:25Z_calvary-scribblings-default-rtdb_data.json.gz`,
    size: String(Math.round(sizeMb * MB)),
    timeCreated: new Date(NOW - 9 * HOUR - i * DAY).toISOString(),
  }));

const goodProbe = { treeKeys: [...MUST_CARRY, 'series', 'square_posts'], inflateError: null, downloadStatus: 200 };

describe('R37 · backup liveness', () => {

  test('a healthy bucket raises nothing', () => {
    const { problems, ageHours } = assess(healthy(), NOW, goodProbe);
    assert.deepEqual(problems, []);
    assert.ok(ageHours < MAX_AGE_HOURS);
  });

  test('⭐ AN EMPTY BUCKET IS THE LOUDEST CASE', () => {
    const { problems } = assess([], NOW, goodProbe);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^EMPTY/);
    assert.match(problems[0], /not running/);
  });

  test('rules archives are not mistaken for data archives', () => {
    // The bucket holds a _rules.json.gz beside every _data.json.gz, and the rules one
    // is ~700 bytes. Counting those as backups would keep the check green forever on
    // a bucket that had stopped taking data, and would wreck the size median too.
    const rulesOnly = healthy().map((o) => ({ ...o, name: o.name.replace('_data.', '_rules.'), size: '700' }));
    const { problems } = assess(rulesOnly, NOW, goodProbe);
    assert.match(problems[0], /^EMPTY/);
  });

  test('⭐ A STOPPED SCHEDULE IS CAUGHT the day after it should have run', () => {
    const stale = healthy().map((o) => ({ ...o, timeCreated: new Date(Date.parse(o.timeCreated) - 2 * DAY).toISOString() }));
    const { problems } = assess(stale, NOW, goodProbe);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^STALE/);
    assert.match(problems[0], /Firebase console/, 'the message must say where to look');
  });

  test('the grace period tolerates one late run but not a missed day', () => {
    const at = (h) => healthy().map((o, i) => ({ ...o, timeCreated: new Date(NOW - h * HOUR - i * DAY).toISOString() }));
    assert.deepEqual(assess(at(29), NOW, goodProbe).problems, [], '29h — a late run must not page anyone');
    assert.match(assess(at(31), NOW, goodProbe).problems[0], /^STALE/, '31h — a whole day has been missed');
  });

  test('⭐ A SHRINKING BACKUP IS STILL GREEN TO EVERY OTHER CHECK', () => {
    // The frightening shape: the job runs, on time, forever, backing up almost nothing.
    const shrunk = healthy();
    shrunk[0] = { ...shrunk[0], size: String(Math.round(0.2 * MB)) };
    const { problems } = assess(shrunk, NOW, goodProbe);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^SHRUNK/);
    assert.match(problems[0], /4%/, 'it must quote how far it fell');
  });

  test('ordinary growth and ordinary wobble are not alarms', () => {
    const grown = healthy();
    grown[0] = { ...grown[0], size: String(Math.round(9 * MB)) };   // a big day
    assert.deepEqual(assess(grown, NOW, goodProbe).problems, [], 'growth is not a fault');
    const dipped = healthy();
    dipped[0] = { ...dipped[0], size: String(Math.round(4.0 * MB)) }; // ~70% — a real deletion
    assert.deepEqual(assess(dipped, NOW, goodProbe).problems, [], 'a genuine deletion must not page anyone');
  });

  test('an archive that will not inflate is a failure, not a pass', () => {
    const { problems } = assess(healthy(), NOW, { treeKeys: null, inflateError: 'incorrect header check', downloadStatus: 200 });
    assert.match(problems[0], /^CORRUPT/);
    assert.match(problems[0], /day it is needed/);
  });

  test('an archive that will not download is a failure', () => {
    const { problems } = assess(healthy(), NOW, { treeKeys: null, inflateError: null, downloadStatus: 403 });
    assert.match(problems[0], /^UNREADABLE/);
    assert.match(problems[0], /403/);
  });

  test('⭐ AN ARCHIVE MISSING THE NODES THAT MATTER is caught by name, not by count', () => {
    // "76 top-level nodes" stays true while the one holding the money goes missing.
    const withoutMoney = { ...goodProbe, treeKeys: MUST_CARRY.filter((n) => n !== 'bookstore_purchases' && n !== 'wallet') };
    const { problems } = assess(healthy(), NOW, withoutMoney);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^INCOMPLETE/);
    assert.match(problems[0], /bookstore_purchases/);
    assert.match(problems[0], /wallet/);
  });

  test('the money and the writing are both on the must-carry list', () => {
    // The Book Store opens 30 Sep 2026. If a later round trims this list, it should
    // have to delete a named expectation rather than quietly shrink a number.
    for (const n of ['bookstore_purchases', 'wallet', 'points', 'users', 'open_pages', 'comments']) {
      assert.ok(MUST_CARRY.includes(n), `${n} must stay on the must-carry list`);
    }
  });

  test('several faults at once are all reported, not just the first', () => {
    const bad = healthy().map((o) => ({ ...o, timeCreated: new Date(Date.parse(o.timeCreated) - 3 * DAY).toISOString() }));
    bad[0] = { ...bad[0], size: String(Math.round(0.1 * MB)) };
    const { problems } = assess(bad, NOW, { ...goodProbe, treeKeys: ['users'] });
    assert.equal(problems.length, 3, 'stale + shrunk + incomplete');
    assert.ok(problems.some((p) => p.startsWith('STALE')));
    assert.ok(problems.some((p) => p.startsWith('SHRUNK')));
    assert.ok(problems.some((p) => p.startsWith('INCOMPLETE')));
  });
});
