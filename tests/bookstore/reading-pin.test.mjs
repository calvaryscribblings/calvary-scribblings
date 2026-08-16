// R11.22 — THE READING-POSITION PIN, both halves.
//
//   node --test tests/bookstore/reading-pin.test.mjs        (npm run test:purchases)
//
// The behaviour under test is a CROSS-SURFACE CONTRACT (docs/reading-position-pin.md): the web
// writes `epubVersion` beside a stored CFI, the native app trusts a CFI only when its own pin
// matches, and NEITHER HALF DOES ANYTHING ALONE. A regression here does not throw, does not
// log, and does not fail a build — it silently resumes a reader in confident, wrong prose, in
// the one place where being wrong is indistinguishable from being right. So the rules are
// asserted rather than left to the reader of the code.
//
// The two functions are pure and live in app/lib/bookstore/reading-position.js for exactly
// this reason; ReadingRoom.js is a JSX client component and cannot be imported by node --test.
// A copy of these rules inlined there would be untestable, which is how the check and its
// intent drift apart.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { positionRecord, cfiIsOurs } from '../../app/lib/bookstore/reading-position.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CFI = 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)';
const V1 = '1785243569624430';   // a Cloud Storage generation: decimal, past 2^53
const V2 = '1785243569624431';   // the same object after a re-upload

describe('positionRecord — the shape that goes on the wire', () => {
  test('fraction and updatedAt are always present; a bare position carries nothing else', () => {
    const r = positionRecord({ fraction: 0.5, updatedAt: 1000 });
    assert.deepEqual(r, { fraction: 0.5, updatedAt: 1000 });
  });

  test('a cfi is carried, and its pin with it', () => {
    assert.deepEqual(
      positionRecord({ fraction: 0.5, updatedAt: 1000, cfi: CFI, pin: V1 }),
      { fraction: 0.5, updatedAt: 1000, cfi: CFI, epubVersion: V1 },
    );
  });

  test('no cfi ⇒ NO PIN, even when one was offered', () => {
    // A pin beside no position pins nothing, and `$other` is closed: writing a lone
    // epubVersion would be rejected by the validator and lose the fraction too.
    const r = positionRecord({ fraction: 0.5, updatedAt: 1000, pin: V1 });
    assert.deepEqual(r, { fraction: 0.5, updatedAt: 1000 });
  });

  test('an unknown version writes the cfi UNPINNED rather than guessing one', () => {
    // The endpoint states `version: null` when the metadata read fails, and null is a fact:
    // this session does not know which copy it holds. The position is still worth keeping —
    // it is simply not certified, which is exactly the record that shipped before R11.22.
    for (const pin of [null, undefined, '', 0, {}]) {
      const r = positionRecord({ fraction: 0.5, updatedAt: 1000, cfi: CFI, pin });
      assert.deepEqual(r, { fraction: 0.5, updatedAt: 1000, cfi: CFI }, `pin=${JSON.stringify(pin)}`);
    }
  });

  test('nulls are never emitted — an absent cfi is an absent KEY', () => {
    const r = positionRecord({ fraction: 0.5, updatedAt: 1000, cfi: null, pin: null });
    assert.equal('cfi' in r, false);
    assert.equal('epubVersion' in r, false);
  });

  test('every key it can emit is one database.rules.json validates', () => {
    // The ratchet. `$other` is closed on this record, so a key added here without a matching
    // validator is not a lint issue — it is a write that fails and a position that is lost.
    const rules = JSON.parse(readFileSync(resolve(ROOT, 'database.rules.json'), 'utf8'));
    const node = rules.rules.bookstore_reading_progress.$uid.$titleId;
    const emitted = new Set(Object.keys(positionRecord({
      fraction: 0.5, updatedAt: 1000, cfi: CFI, pin: V1,
    })));
    for (const key of emitted) {
      assert.ok(node[key], `database.rules.json has no validator for '${key}'`);
    }
    assert.equal(node.$other['.validate'], false, 'the record must stay closed');
    // And the two the validator requires must be two this function always writes.
    assert.match(node['.validate'], /hasChildren\(\['fraction', 'updatedAt'\]\)/);
  });
});

describe('cfiIsOurs — may this stored position be seeked to?', () => {
  test('matching pins ⇒ trusted', () => {
    assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: V1 }, V1), true);
  });

  test('THE CASE THIS EXISTS FOR: the file was replaced ⇒ refused', () => {
    // Same book, same title, new bytes. The CFI still resolves — that is the danger — so the
    // only thing standing between the reader and plausible wrong prose is this comparison.
    assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: V1 }, V2), false);
  });

  test('a pinned record and an unknown local version ⇒ refused', () => {
    // We cannot certify it, so we do not. Costs a fraction fallback for one open.
    for (const ours of [null, undefined, '']) {
      assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: V1 }, ours), false, `ours=${JSON.stringify(ours)}`);
    }
  });

  test('a pin from a FOREIGN namespace reads as a mismatch, not as an error', () => {
    // The rules accept any string on purpose — a rejected write loses the position outright,
    // where an unmatchable pin costs only precision. This is the reader half of that call.
    assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: 'sha256:9f2c4ab1' }, V1), false);
  });

  test('an UNPINNED record is still trusted — the deliberate asymmetry', () => {
    // Every position stored before R11.22 looks like this. Refusing them all would demote
    // every returning reader's place to an approximation, once and visibly, to guard a hazard
    // that only bites when the copies genuinely differ. Each re-pins on its next save.
    assert.equal(cfiIsOurs({ cfi: CFI }, V1), true);
    assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: '' }, V1), true);
    assert.equal(cfiIsOurs({ cfi: CFI }, null), true);
  });

  test('it survives the shapes a real read can hand it', () => {
    assert.equal(cfiIsOurs(null, V1), true);
    assert.equal(cfiIsOurs(undefined, V1), true);
    assert.equal(cfiIsOurs({ fraction: 0.3, updatedAt: 1 }, V1), true);
    // A number-typed pin is not a pin. Refusing it would be defensible; treating it as absent
    // matches the rules, which reject the write that produced it in the first place.
    assert.equal(cfiIsOurs({ cfi: CFI, epubVersion: 1785243569624430 }, V1), true);
  });

  test('round trip: what positionRecord writes, cfiIsOurs accepts for the same copy', () => {
    const written = positionRecord({ fraction: 0.5, updatedAt: 1000, cfi: CFI, pin: V1 });
    assert.equal(cfiIsOurs(written, V1), true);
    assert.equal(cfiIsOurs(written, V2), false);
  });
});
