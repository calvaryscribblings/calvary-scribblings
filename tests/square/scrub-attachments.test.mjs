// W1 / SQ-01 — the scrub's plan: which attachments change, to what, and nothing else.
//
//   node --test tests/square/scrub-attachments.test.mjs      (npm run test:square)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, plan } from '../../scripts/square/scrub-attachments.mjs';

const BODY = { id: 'alive', url: '/stories/alive', title: 'Alive', author: 'A', cover: 'c', categoryName: 'Short Story', subcategory: '', content: '<p>all of it</p>', extractedText: 'all of it', epubUrl: 'e' };
const SLIM_SORTED = { author: 'A', categoryName: 'Short Story', cover: 'c', id: 'alive', subcategory: '', title: 'Alive', url: '/stories/alive' };

test('a body-carrying attachment is planned down to the seven fields', () => {
  const [c] = plan(flatten({ square_archive: { p1: { text: 't', attachedStory: BODY } } }));
  assert.equal(c.path, 'square_archive/p1');
  assert.equal(c.body, true);
  assert.deepEqual(c.after, { title: 'Alive', author: 'A', cover: 'c', url: '/stories/alive', id: 'alive', categoryName: 'Short Story', subcategory: '' });
});

test('the slug-shaped attachment gets the id and url a card needs', () => {
  const [c] = plan(flatten({ square_archive: { p2: { attachedStory: { slug: 'purple', title: 'Purple' } } } }));
  assert.equal(c.after.url, '/stories/purple');
  assert.equal(c.after.id, 'purple');
});

test('an already-slim attachment, in RTDB\'s sorted key order, is left alone (the false positive)', () => {
  assert.deepEqual(plan(flatten({ square_archive: { p3: { attachedStory: SLIM_SORTED } } })), []);
});

test('all three nodes are walked, and records with no attachment are never touched', () => {
  const records = flatten({
    square_posts: { a: { attachedStory: BODY }, b: { text: 'none' } },
    user_square_posts: { u1: { c: { attachedStory: BODY } } },
    square_archive: { d: { attachedStory: null } },
  });
  assert.deepEqual(plan(records).map((c) => c.path), ['square_posts/a', 'user_square_posts/u1/c']);
});
