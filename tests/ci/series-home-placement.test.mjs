// SERIES-MOVE (ruling 233, 27 Oct 2026): "On Home, The Series sits directly under Just
// Added, on web and in the app."
//
// A position in a page is exactly the kind of decision a later round changes without
// noticing — this guards it the way tests/openpages/distribution.test.mjs guards Open Pages.
// The height half (the skeleton holds the row's space) is a browser measurement and lives in
// tests/series/home-placement.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/public-library/page.js', import.meta.url), 'utf8');
// The page's JSX starts at the component's return; everything before it is definitions.
const body = src.slice(src.indexOf('export default function'));
const at = (needle) => {
  const i = body.indexOf(needle);
  assert.ok(i >= 0, `${needle} not found in the page body`);
  assert.equal(body.indexOf(needle, i + 1), -1, `${needle} appears more than once`);
  return i;
};

const series = () => at('<SeriesRow />');
// The Just Added block ends where its finished section ends: the last thing it draws.
const justAddedEnd = () => body.indexOf(')}', at('<JustAddedCard key='));

test('The Series comes after the Just Added block', () => {
  assert.ok(series() > justAddedEnd(), 'The Series must sit below Just Added');
});

test('…and directly under it: nothing is drawn between them', () => {
  const between = body.slice(justAddedEnd() + 2, series()).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.equal(/<[A-Za-z]/.test(between), false, `something is drawn between Just Added and The Series:\n${between.trim()}`);
});

test('…and before the Summer banner, Top Readers and the Top 10', () => {
  assert.ok(series() < at('<SummerProgramBanner />'), 'above the Summer banner');
  assert.ok(series() < at('<TopReadersStrip />'), 'above Top Readers');
  assert.ok(series() < at('<Top10Skeleton />'), 'above the Top 10');
  assert.ok(series() < at('<Top10Card '), 'above the Top 10');
});

test('the Summer banner still sits directly above Top Readers', () => {
  const between = body.slice(at('<SummerProgramBanner />'), at('<TopReadersStrip />'))
    .replace('<SummerProgramBanner />', '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.equal(/<[A-Za-z]/.test(between), false);
});
