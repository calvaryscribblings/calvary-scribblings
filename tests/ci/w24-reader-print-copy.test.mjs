// W24 — printing and copying in the Reading Room (ruling 93): the rule in app/lib/readerCopy.js,
// and the two places the reader frame repeats it because it cannot import it.
//
//   node --test tests/ci/w24-reader-print-copy.test.mjs          (npm run test:ci)
// The browsers' half (Chromium + WebKit) is npm run test:print-copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRINT_LINE, COPY_MAX_WORDS, copyText, creditLine } from '../../app/lib/readerCopy.js';

const host = readFileSync(new URL('../../public/reading-room.html', import.meta.url), 'utf8');

test('fifty words, ruled', () => assert.equal(COPY_MAX_WORDS, 50));

test('the frame prints the same line as the page', () => {
  assert.ok(host.includes(`content:${JSON.stringify(PRINT_LINE)}`), 'public/reading-room.html print CSS must carry PRINT_LINE verbatim');
});

test('the frame\'s copyText is readerCopy.js\'s copyText, line for line', () => {
  const body = (src) => src.slice(src.indexOf('const text'), src.indexOf('return ') ).replace(/[;\s]/g, '');
  const lib = readFileSync(new URL('../../app/lib/readerCopy.js', import.meta.url), 'utf8');
  const libFn = lib.slice(lib.indexOf('export function copyText'));
  const hostFn = host.slice(host.indexOf('function copyText'));
  assert.equal(body(hostFn), body(libFn));
});

test('the credit line', () => {
  assert.equal(creditLine({ title: 'The Awakening', author: 'Kate Chopin' }), '— from The Awakening by Kate Chopin · Calvary Scribblings');
  assert.equal(creditLine({ title: 'After the Fact' }), '— from After the Fact · Calvary Scribblings');
  assert.equal(creditLine({}), '— from Calvary Scribblings');
});

test('copyText: short passes whole, long is cut after the fiftieth word, credit on its own line', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
  assert.equal(copyText('one two\nthree', 'C'), 'one two\nthree\nC');
  assert.equal(copyText(words(50), 'C'), `${words(50)}\nC`);
  assert.equal(copyText(words(51), 'C'), `${words(50)}\nC`);
  assert.equal(copyText(`  ${words(80)}  `, 'C'), `${words(50)}\nC`);
  assert.equal(copyText('   ', 'C'), '');
  assert.equal(copyText(null, 'C'), '');
});

// Ruling 89: the five W22 drafts are ruled, so the Desiderata copy carries no DRAFT mark any more —
// and the two lines W24 adds are marked DRAFT until Ikenna rules them.
test('the Desiderata copy is ruled; the Reading Room\'s two new lines are drafts', () => {
  const des = readFileSync(new URL('../../app/lib/bookstore/desiderata.js', import.meta.url), 'utf8');
  assert.doesNotMatch(des, /DRAFT/);
  const rc = readFileSync(new URL('../../app/lib/readerCopy.js', import.meta.url), 'utf8');
  assert.equal((rc.match(/DRAFT/g) || []).length, 2);
});
