// W22 §6 — the Book Store's search, as data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchShelves } from '../../app/lib/bookstore/shelfSearch.js';

const genres = { 'literary-fiction': 'Literary Fiction', historical: 'Historical' };
const labelFor = (s) => genres[s] || s;
const titles = [
  { id: '1', title: 'After the Fact', author: 'Ayşe Özdemir', genre: 'literary-fiction' },
  { id: '2', title: 'Rogues of the East', author: 'Okeh Ide', authorName: 'Okeh Ide', genre: 'historical' },
  { id: '3', title: 'Deportee', author: 'Okeh Ide', genre: 'literary-fiction' },
];

test('empty query: nothing', () => {
  assert.deepEqual(searchShelves(titles, labelFor, '  '), { authors: [], genres: [], titles: [] });
});

test('an author: one AUTHOR row per distinct name, and every title under it', () => {
  const r = searchShelves(titles, labelFor, 'okeh');
  assert.deepEqual(r.authors, ['Okeh Ide']);
  assert.deepEqual(r.titles.map((t) => t.id), ['3', '2']);
});

test('accents fold: "ozdemir" finds Özdemir, and case never matters', () => {
  assert.deepEqual(searchShelves(titles, labelFor, 'OZDEMIR').authors, ['Ayşe Özdemir']);
});

test('a genre label matches as a GENRE row and brings its titles', () => {
  const r = searchShelves(titles, labelFor, 'histor');
  assert.deepEqual(r.genres, ['Historical']);
  assert.deepEqual(r.titles.map((t) => t.id), ['2']);
});

test('a title matches on its own words', () => {
  const r = searchShelves(titles, labelFor, 'fact');
  assert.deepEqual(r.titles.map((t) => t.id), ['1']);
  assert.deepEqual(r.authors, []);
});

test('no results is three empty groups', () => {
  assert.deepEqual(searchShelves(titles, labelFor, 'zzqx'), { authors: [], genres: [], titles: [] });
});
