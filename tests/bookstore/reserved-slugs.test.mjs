// W22 §7 — no book may take a room's route. /bookstore/search and /bookstore/desiderata are
// static pages beside /bookstore/{slug}; a title with either slug would be shadowed by the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { validateTitle, RESERVED_TITLE_SLUGS } from '../../app/lib/bookstore/schema.js';

const slugErrors = (slug) => validateTitle({ slug }).errors.filter((e) => /slug/.test(e));

test('W22: the two room slugs are reserved', () => {
  assert.deepEqual([...RESERVED_TITLE_SLUGS].sort(), ['desiderata', 'search']);
  for (const slug of RESERVED_TITLE_SLUGS) {
    assert.ok(slugErrors(slug).some((e) => /reserved/.test(e)), `${slug} must be refused`);
  }
});

test('W22: an ordinary slug, and one that merely contains a room word, are not refused', () => {
  for (const slug of ['search-for-home', 'the-desiderata', 'basil']) {
    assert.deepEqual(slugErrors(slug), [], slug);
  }
});

test('W22: every reserved slug is a room that actually exists in app/bookstore/', () => {
  const rooms = readdirSync(new URL('../../app/bookstore/', import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && d.name !== 'components')
    .map((d) => d.name).sort();
  assert.deepEqual(rooms, [...RESERVED_TITLE_SLUGS].sort(),
    'a new static route under /bookstore must be reserved here too, or a book can shadow it');
  for (const r of rooms) assert.ok(existsSync(new URL(`../../app/bookstore/${r}/page.js`, import.meta.url)));
});
