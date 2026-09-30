// W30 — launch-night rulings with a source half. (Descriptions: tests/build/doors-open.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ruling 51: the Reading Room\'s dictionary miss has no full stop, as the app draws it', () => {
  const rr = readFileSync(new URL('../../app/reader/[slug]/ReadingRoom.js', import.meta.url), 'utf8');
  assert.match(rr, /No definition found for &ldquo;\{word\}&rdquo;<\/div>/);
  assert.doesNotMatch(rr, /No definition found for &ldquo;\{word\}&rdquo;\./);
});
