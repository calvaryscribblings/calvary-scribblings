// W43 — RIBBONS CARRY THE PIN: the shape that is pushed, and the jump decision.
//
//   node --test tests/bookstore/ribbon-pin.test.mjs        (npm run test:purchases)
//
// Same contract as the position (docs/reading-position-pin.md): epubVersion is the raw stream
// version, written only beside a cfi, and a jump trusts the cfi only through cfiIsOurs. The
// app adopts the identical rule in A32, so the table is asserted here rather than left to
// ReadingRoom.js, which node --test cannot import.
//
// MUTATIONS. The last block rewrites app/lib/bookstore/reading-position.js in memory, one
// plausible mistake at a time, re-imports it, and requires the checks below to catch every one.
// A check that no mutation can turn red is not checking anything.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as real from '../../app/lib/bookstore/reading-position.js';
import { decide, UNPLACED, PINNED_NEW } from '../../scripts/epub-repair/carry-over.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(resolve(ROOT, 'app/lib/bookstore/reading-position.js'), 'utf8');
const ROOM = readFileSync(resolve(ROOT, 'app/reader/[slug]/ReadingRoom.js'), 'utf8');

const CFI = 'epubcfi(/6/14!/4/2/8/1:0)';
const V1 = '1785243569624430';
const V2 = '1785243569624431';

/** Every rule, as named checks against a module. Returns the names that fail. */
function failures({ ribbonRecord, ribbonJump }) {
  const checks = {
    'shape: cfi, fraction, label, excerpt, createdAt + pin': () => assert.deepEqual(
      ribbonRecord({ cfi: CFI, fraction: 0.3, label: 'Seven', excerpt: 'x', createdAt: 5, pin: V1 }),
      { cfi: CFI, fraction: 0.3, label: 'Seven', excerpt: 'x', createdAt: 5, epubVersion: V1 }),
    'no pin known → no epubVersion key': () => assert.ok(!('epubVersion' in ribbonRecord({ cfi: CFI, fraction: 0.3, createdAt: 5, pin: null }))),
    'empty pin → no epubVersion key': () => assert.ok(!('epubVersion' in ribbonRecord({ cfi: CFI, fraction: 0.3, createdAt: 5, pin: '' }))),
    'no cfi → no pin, even when offered': () => assert.ok(!('epubVersion' in ribbonRecord({ cfi: '', fraction: 0.3, createdAt: 5, pin: V1 }))),
    'no fraction → key omitted, never undefined': () => assert.ok(!('fraction' in ribbonRecord({ cfi: CFI, createdAt: 5, pin: V1 }))),
    'label defaults to null, excerpt to empty': () => { const r = ribbonRecord({ cfi: CFI, fraction: 0.1, createdAt: 5 }); assert.equal(r.label, null); assert.equal(r.excerpt, ''); },
    'pin matches → cfi, with the fraction as fallback': () => assert.deepEqual(ribbonJump({ cfi: CFI, fraction: 0.3, epubVersion: V1 }, V1), { via: 'cfi', cfi: CFI, fraction: 0.3 }),
    'pin differs → fraction straight away': () => assert.deepEqual(ribbonJump({ cfi: CFI, fraction: 0.3, epubVersion: V1 }, V2), { via: 'fraction', fraction: 0.3 }),
    'pinned, our version unknown → fraction': () => assert.equal(ribbonJump({ cfi: CFI, fraction: 0.3, epubVersion: V1 }, null).via, 'fraction'),
    'unpinned → cfi (the shipped asymmetry)': () => assert.equal(ribbonJump({ cfi: CFI, fraction: 0.3 }, V2).via, 'cfi'),
    'a contents href (no pin, no fraction) → cfi': () => assert.deepEqual(ribbonJump({ cfi: 'text/ch003.xhtml' }, V1), { via: 'cfi', cfi: 'text/ch003.xhtml', fraction: null }),
    'no cfi, a fraction → fraction': () => assert.deepEqual(ribbonJump({ fraction: 0.6 }, V1), { via: 'fraction', fraction: 0.6 }),
    'not ours and no fraction → none, notOurs': () => assert.deepEqual(ribbonJump({ cfi: CFI, epubVersion: V1 }, V2), { via: 'none', notOurs: true }),
    'nothing at all → none, not notOurs': () => assert.deepEqual(ribbonJump({}, V1), { via: 'none', notOurs: false }),
    'fraction 0 is a fraction': () => assert.deepEqual(ribbonJump({ cfi: CFI, fraction: 0, epubVersion: V1 }, V2), { via: 'fraction', fraction: 0 }),
  };
  const failed = [];
  for (const [name, fn] of Object.entries(checks)) { try { fn(); } catch { failed.push(name); } }
  return { failed, total: Object.keys(checks).length };
}

describe('ribbonRecord + ribbonJump — the rules', () => {
  const { failed, total } = failures(real);
  test(`all ${total} rules hold`, () => assert.deepEqual(failed, []));
});

describe('the Reading Room uses them', () => {
  test('saveRibbon pushes ribbonRecord with the position\'s pin', () => {
    const save = ROOM.slice(ROOM.indexOf('const saveRibbon = useCallback'), ROOM.indexOf('useEffect(() => { saveRibbonRef.current = saveRibbon'));
    assert.match(save, /push\(ref\(db, `readerBookmarks\/\$\{user\.uid\}\/\$\{slug\}`\), ribbonRecord\(\{/);
    assert.match(save, /pin: progressRef\.current\?\.pin,/);
  });
  test('jumpTo decides through ribbonJump with the same pin, before any goTo', () => {
    const jump = ROOM.slice(ROOM.indexOf('const jumpTo = useCallback'), ROOM.indexOf('// ── Search (debounced)'));
    const at = jump.indexOf('ribbonJump(rec, progressRef.current?.pin)');
    assert.ok(at > 0, 'ribbonJump(rec, progressRef.current?.pin) is called');
    assert.ok(at < jump.indexOf("postToFrame({ type: 'goTo'"), 'and decides before the first goTo');
    assert.match(jump, /const cfi = route\.via === 'cfi' \? route\.cfi : null;/);
  });
  test('the Series reader shares the Reading Room and passes its pin as progress.pin', () => {
    const series = readFileSync(resolve(ROOT, 'app/series/read/[instalmentId]/page-reader.js'), 'utf8');
    assert.match(series, /ribbons=\{!!user\}/);
    assert.match(series, /progress=\{\{ path: \(uid\) => positionPath\(uid, instalmentId\), pin: epubVersion \}\}/);
  });
});

// W44 — what the carry-over writes for a place it cannot put exactly, read back by the web.
// decide() is the carry-over's own pure decision; its output goes straight into the web's
// cfiIsOurs (positions, ReadingRoom.js) and ribbonJump (ribbons) with the NEW file open.
describe('the carry-over\'s unplaced and re-pinned records, as the web reads them (W44)', () => {
  const OLD = V1;
  const NEW = V2;
  const gens = { oldGen: OLD, newGen: NEW };
  const disagrees = { probe: { old: { resolves: true, fraction: 0.2 }, new: { resolves: true, fraction: 0.25 } } };
  const textDiffers = { result: 'mapped', roundTrip: true, textMatches: false, probe: { old: { resolves: true, fraction: 0.5 }, new: { resolves: false } } };
  const newFile = { probe: { old: { resolves: false }, new: { resolves: true, fraction: 0.5 } } };
  const position = (o) => ({ kind: 'position', value: { fraction: 0.5, updatedAt: 1000, cfi: CFI, ...o } });
  const ribbon = (o) => ({ kind: 'ribbon', value: { cfi: CFI, fraction: 0.5, label: 'Seven', excerpt: 'x', createdAt: 5, ...o } });

  for (const [name, mapped] of [['no file agrees', disagrees], ['mapped text differs', textDiffers]]) {
    test(`unpinned, ${name} → pinned old, and the web goes to the fraction`, () => {
      const p = decide(position(), mapped, gens);
      assert.equal(p.why, UNPLACED);
      assert.deepEqual(p.next, { fraction: 0.5, updatedAt: 1000, cfi: CFI, epubVersion: OLD }, 'a position keeps its shape and its updatedAt');
      assert.equal(real.cfiIsOurs(p.next, NEW), false, 'the Reading Room will not seek a pinned-old cfi in the new file');
      const r = decide(ribbon(), mapped, gens);
      assert.equal(r.why, UNPLACED);
      assert.deepEqual(r.next, { cfi: CFI, fraction: 0.5, label: 'Seven', excerpt: 'x', createdAt: 5, epubVersion: OLD });
      assert.deepEqual(real.ribbonJump(r.next, NEW), { via: 'fraction', fraction: 0.5 });
    });
  }
  test('unpinned, read in the new file → pinned new: trusted now, not after a later replacement', () => {
    const r = decide(ribbon(), newFile, gens);
    assert.equal(r.why, PINNED_NEW);
    assert.deepEqual(r.next, { ...ribbon().value, epubVersion: NEW });
    assert.equal(real.ribbonJump(r.next, NEW).via, 'cfi');
    assert.equal(real.ribbonJump(r.next, '1785243569624432').via, 'fraction');
  });
  test('pinned old and unplaceable → left as it is (it already reads by fraction)', () => {
    const d = decide(position({ epubVersion: OLD }), textDiffers, gens);
    assert.equal(d.action, 'leave');
    assert.equal(real.cfiIsOurs(position({ epubVersion: OLD }).value, NEW), false);
  });
});

describe('mutations: each plausible mistake turns the rules red', () => {
  const MUTANTS = {
    'pin written without a cfi': ["if (typeof cfi === 'string' && cfi && typeof pin === 'string' && pin) record.epubVersion = pin;", "if (typeof pin === 'string' && pin) record.epubVersion = pin;"],
    'pin written when unknown': ["if (typeof cfi === 'string' && cfi && typeof pin === 'string' && pin) record.epubVersion = pin;", 'record.epubVersion = pin;'],
    'fraction written undefined': ["if (typeof fraction === 'number') record.fraction = fraction;", 'record.fraction = fraction;'],
    'jump ignores the pin': ['if (cfi && cfiIsOurs(record, ourPin)) return { via: \'cfi\', cfi, fraction };', "if (cfi) return { via: 'cfi', cfi, fraction };"],
    'unpinned treated as foreign': ['if (cfi && cfiIsOurs(record, ourPin)) return { via: \'cfi\', cfi, fraction };', "if (cfi && record?.epubVersion === ourPin) return { via: 'cfi', cfi, fraction };"],
    'falsy fraction dropped': ['if (fraction != null) return { via: \'fraction\', fraction };', "if (fraction) return { via: 'fraction', fraction };"],
    'notOurs lost': ['return { via: \'none\', notOurs: !!cfi };', "return { via: 'none', notOurs: false };"],
    'not-ours keeps the cfi': ['if (fraction != null) return { via: \'fraction\', fraction };', "if (fraction != null) return cfi ? { via: 'cfi', cfi, fraction } : { via: 'fraction', fraction };"],
  };
  for (const [name, [from, to]] of Object.entries(MUTANTS)) {
    test(name, async () => {
      assert.ok(SRC.includes(from), `mutation anchor still present: ${from}`);
      const mutated = SRC.replace(from, to);
      const mod = await import(`data:text/javascript;base64,${Buffer.from(mutated).toString('base64')}`);
      assert.ok(failures(mod).failed.length > 0, 'the rules must catch this mutant');
    });
  }
});
