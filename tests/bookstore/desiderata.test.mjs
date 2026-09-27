// W22 — Desiderata's rules, played without a browser. Rulings 75, 76, 77, 79–81 (27 Sept 2026).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DESIDERATA_PATH, DESIDERATA_COPY, markState, drawsMark, isOnSale, markLabel, titlesLabel,
  roomRows, readPending, PENDING_TTL_MS,
} from '../../app/lib/bookstore/desiderata.js';
import { holdsBook } from '../../app/lib/bookstore/purchaseSource.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('W22 — the + states', () => {
  test('a book in the library takes no + — sales and comps alike (holdsBook)', () => {
    for (const rec of [{ status: 'active' }, { status: 'active', source: 'comp' }]) {
      assert.equal(holdsBook(rec), true);
      assert.equal(markState({ owns: holdsBook(rec), marked: true }), 'owned');
    }
    // A refunded copy is not held, so the + comes back.
    assert.equal(markState({ owns: holdsBook({ status: 'revoked' }) }), 'open');
  });
  test('not on sale (withdrawn): no +', () => {
    assert.equal(isOnSale({ status: 'withdrawn' }), false);
    assert.equal(markState({ onSale: false }), 'off-sale');
    assert.equal(drawsMark('off-sale'), false);
    assert.equal(drawsMark('owned'), false);
  });
  test('open draws the ring; marked draws the disc', () => {
    assert.equal(markState({}), 'open');
    assert.equal(markState({ marked: true }), 'marked');
    assert.equal(drawsMark('open'), true);
    assert.equal(drawsMark('marked'), true);
  });
  test('the aria-labels, as ruled in the brief', () => {
    assert.equal(markLabel('Basil', false), 'Add Basil to Desiderata');
    assert.equal(markLabel('Basil', true), 'Take Basil out of Desiderata');
  });
  test('the count reads the hero’s rule', () => {
    assert.equal(titlesLabel(1), '1 title');
    assert.equal(titlesLabel(4), '4 titles');
  });
});

describe('W22 — the room’s rows', () => {
  const shelf = {
    a: { id: 'a', title: 'A', status: 'published' },
    b: { id: 'b', title: 'B', status: 'published' },
    c: { id: 'c', title: 'C', status: 'published' },
  };
  test('newest first; a held book never shows and is swept; a book off the shelves stays put', () => {
    const entries = { a: { addedAt: 10 }, b: { addedAt: 30 }, c: { addedAt: 20 }, gone: { addedAt: 40 } };
    const { rows, sweep } = roomRows(entries, shelf, new Set(['c']));
    assert.deepEqual(rows.map((r) => r.titleId), ['b', 'a']);
    assert.deepEqual(sweep, ['c']);
    // 'gone' is neither shown nor swept: its entry stays in case it comes back to the shelves.
    assert.ok(!sweep.includes('gone'));
  });
  test('an empty or missing list is empty', () => {
    assert.deepEqual(roomRows(null, shelf, new Set()), { rows: [], sweep: [] });
  });
});

describe('W22 — the waiting add (signed out → sign in → added, no second tap)', () => {
  const at = 1_000_000;
  test('a fresh tap is remembered', () => {
    assert.equal(readPending(JSON.stringify({ titleId: 'a', at }), at + 1000), 'a');
  });
  test('it expires, and junk is ignored', () => {
    assert.equal(readPending(JSON.stringify({ titleId: 'a', at }), at + PENDING_TTL_MS + 1), null);
    assert.equal(readPending('{', at), null);
    assert.equal(readPending(null, at), null);
    assert.equal(readPending(JSON.stringify({ titleId: '', at }), at), null);
  });
});

describe('W22 — the words and the wiring', () => {
  test('the ruled lines are verbatim', () => {
    assert.equal(DESIDERATA_COPY.added, 'Added to Desiderata. You’ll find it under the ribbon at the top of the shop.');
    assert.equal(DESIDERATA_COPY.name, 'Desiderata');
    assert.equal(DESIDERATA_COPY.subline, 'Books you’ve marked to come back to.');
    assert.equal(DESIDERATA_COPY.foot, 'When a book comes into your library, it leaves this list.');
    assert.equal(DESIDERATA_COPY.noResults('okeh'), 'Nothing on these shelves matches “okeh”.');
  });
  test('every line the rooms print comes from DESIDERATA_COPY, and COPY-RULINGS records each', () => {
    const log = src('docs/COPY-RULINGS.md');
    for (const k of ['added', 'subline', 'foot', 'searchHint', 'removed', 'failed', 'empty', 'signedOut']) {
      assert.ok(log.includes(DESIDERATA_COPY[k]), `docs/COPY-RULINGS.md does not record "${DESIDERATA_COPY[k]}"`);
    }
    assert.ok(log.includes('Nothing on these shelves matches'));
  });
  test('the node the store writes is the node the rules guard and deletion removes', () => {
    const rules = JSON.parse(src('database.rules.json'));
    assert.ok(rules.rules[DESIDERATA_PATH], 'database.rules.json has no desiderata block');
    assert.match(src('functions/api/account/_deletion.js'), /'desiderata'/);
    const store = src('app/lib/bookstore/desiderataStore.js');
    // One listener per reader on the list: exactly one onValue on the desiderata path.
    assert.equal((store.match(/onValue\(ref\(db, `\$\{DESIDERATA_PATH\}\//g) || []).length, 1);
    // The date is the server's, never the browser's, on an add.
    assert.match(store, /\{ addedAt: serverTimestamp\(\) \}/);
  });
});
