// THE BOOK STORE'S SEARCH — the matching half of /bookstore/search (W22 §6). Pure, so
// tests/bookstore/search-room.test.mjs can drive it without a browser.
//
// The corpus is whatever the caller hands in, and the room hands in the storefront's own read.
// Matching goes through the site's ONE normaliser, norm() in app/lib/searchIndex.js, which folds
// case and accents — so "ozdemir" finds "Özdemir" here exactly as it does on the site's search.
import { norm } from '../searchIndex.js';

/**
 * The three groups for one query. Pure: titles are the storefront's, labelFor names a genre.
 */
export function searchShelves(titles, labelFor, rawQuery) {
  const q = norm(rawQuery);
  if (!q) return { authors: [], genres: [], titles: [] };
  const hit = (s) => !!s && norm(s).includes(q);
  const authors = new Map();
  const genres = new Map();
  const found = [];
  for (const t of titles || []) {
    const label = labelFor(t.genre);
    for (const name of [t.author, t.authorName]) {
      if (hit(name) && !authors.has(norm(name))) authors.set(norm(name), name);
    }
    if (hit(label) && !genres.has(norm(label))) genres.set(norm(label), label);
    if (hit(t.title) || hit(t.author) || hit(t.authorName) || hit(label)) found.push(t);
  }
  const byName = (a, b) => norm(a).localeCompare(norm(b));
  found.sort((a, b) => byName(a.title, b.title));
  return { authors: [...authors.values()].sort(byName), genres: [...genres.values()].sort(byName), titles: found };
}

