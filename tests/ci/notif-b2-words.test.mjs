// NOTIF-B2 ship — the bell's words match Ikenna's approved design wherever the design shows a line,
// and the push wording ruled 25 Sep for new stories and instalments (docs/PUSH-GO-LIVE.md).
// Bold = a { name } part (weight 600). Every WORDS entry is marked DESIGN, PUSH or DRAFT in bell.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORDS, fromInbox, fromAnnouncement, fromLegacy, headline, secondLine } from '../../app/lib/bell.js';

const users = { a: { displayName: 'Ada Obi' }, b: { displayName: 'Ben' }, w: { displayName: 'Wren Writer' } };
const md = (parts) => parts.map((p) => (p.name ? `**${p.name}**` : p.text)).join('');
const lines = (r, d = {}) => [md(headline(r, users, d)), secondLine(r, d)?.text ?? null];
const story = (title, category = 'short', subcategory = '') => ({ story: (s) => ({ title, category, subcategory, slug: s }) });

test('grouped reactions: "**{name}** and {n} others liked your response" / "on {title}"', () => {
  const r = fromInbox('x', { kind: 'reaction', subject: { slug: 's', commentId: 'c' }, count: 5, actorCount: 5, recent: ['a', 'b'], at: 1 });
  assert.deepEqual(lines(r, story('The Long Field')), ['**Ada Obi** and 4 others liked your response', 'on The Long Field']);
});

test('replies: "**{name}** replied to your response" / the quoted words', () => {
  const r = fromInbox('x', { kind: 'reply', actor: 'a', subject: { slug: 's', commentId: 'c' }, at: 1 });
  const d = { quote: () => 'I read it twice.' };
  assert.deepEqual(lines(r, d), ['**Ada Obi** replied to your response', 'I read it twice.']);
  assert.equal(secondLine(r, d).quoted, true);
});

test('a writer’s responses: "**{n} new responses** on your story" / {title}', () => {
  const r = fromInbox('x', { kind: 'response', subject: { slug: 's' }, count: 3, actorCount: 2, recent: ['a', 'b'], at: 1 });
  assert.deepEqual(lines(r, story('The Long Field')), ['**3 new responses** on your story', 'The Long Field']);
  assert.equal(secondLine(r, story('The Long Field')).quoted, false);
});

test('the Square: "**The Square is open.** Tonight’s question is waiting."', () => {
  const r = fromInbox('x', { kind: 'square_opens', at: 1 });
  assert.deepEqual(lines(r), ['**The Square is open.** Tonight’s question is waiting.', null]);
});

test('mentions: "**{name}** mentioned you in the Square" / the quoted words (and never a withdrawn post’s)', () => {
  const r = fromInbox('x', { kind: 'mention', actor: 'a', subject: { postId: 'p', threadId: 'p' }, at: 1 });
  assert.deepEqual(lines(r, { post: () => ({ text: 'What did you all make of it?' }) }), ['**Ada Obi** mentioned you in the Square', 'What did you all make of it?']);
  assert.equal(secondLine(r, { post: () => ({ text: 'gone', withdrawn: true }) }), null);
  assert.equal(secondLine(r, { post: () => ({ text: 'gone', removedBy: 'm' }) }), null);
  const old = fromLegacy('notifications', 'n', { type: 'mention', fromUid: 'a', postId: 'p', createdAt: 1 });
  assert.equal(old.needsPost, 'p');
});

test('new stories: "New {form} by **{writer}**" / {title} / "FROM A WRITER YOU FOLLOW"', () => {
  const r = fromAnnouncement('story_s', { id: 's', kind: 'story', authorUid: 'w', at: 1 }, { w: true });
  assert.deepEqual(lines(r, story('A Quiet Harbour')), ['New short story by **Wren Writer**', 'A Quiet Harbour']);
  assert.equal(r.fromFollowed, true);
  assert.equal(WORDS.from_followed, 'FROM A WRITER YOU FOLLOW');
  // the {form} is the push's, per category and subcategory (scripts/push/forms.mjs)
  assert.equal(lines(r, story('Rain', 'poetry', 'Love'))[0], 'New love poem by **Wren Writer**');
  assert.equal(lines(r, story('Rain', 'flash'))[0], 'New flash fiction by **Wren Writer**');
  // before the index record arrives: the push's own fallback form
  assert.equal(lines(r, {})[0], 'New story by **Wren Writer**');
});

test('instalments: "{part} by **{writer}**" / {series}, as the instalment push reads', () => {
  const r = fromAnnouncement('instalment_i', { id: 'i', kind: 'instalment', seriesId: 'se', authorUid: 'w', at: 1 }, {});
  const d = { instalment: () => ({ title: 'Part Three' }), series: () => ({ title: 'Beta Princess' }) };
  assert.deepEqual(lines(r, d), ['Part Three by **Wren Writer**', 'Beta Princess']);
});

test('messages: "**{name}** sent you {n} messages"', () => {
  const r = fromInbox('x', { kind: 'message', subject: {}, count: 4, actorCount: 1, recent: ['a'], at: 1 });
  assert.equal(lines(r)[0], '**Ada Obi** sent you 4 messages');
});

test('follows: "**{name}** started following you"', () => {
  assert.equal(lines(fromInbox('x', { kind: 'follow', actor: 'a', subject: {}, at: 1 }))[0], '**Ada Obi** started following you');
});

test('Open Pages: "Your piece is live in **Open Pages**" / {title}', () => {
  const r = fromInbox('x', { kind: 'open_pages_live', subject: { pieceId: 'pc' }, at: 1 });
  assert.deepEqual(lines(r, { piece: () => ({ title: 'Small Hours' }) }), ['Your piece is live in **Open Pages**', 'Small Hours']);
});

test('tier-ups: "You’re now a **{tier}**"', () => {
  assert.equal(lines(fromInbox('x', { kind: 'tier_up', subject: { tier: 'Gold' }, at: 1 }))[0], 'You’re now a **Gold**');
});

test('curly quotes and apostrophes throughout: no straight quote in any WORDS entry or the row', () => {
  for (const [k, v] of Object.entries(WORDS)) {
    const s = typeof v === 'function' ? v(2) : v;
    assert.ok(!/['"]/.test(s), `${k}: ${s}`);
  }
  const src = readFileSync(new URL('../../app/components/bell/BellRow.js', import.meta.url), 'utf8');
  assert.ok(src.includes('`“${line2.text}”`'), 'quoted words sit inside curly quotes');
});

test('every WORDS entry is marked DESIGN, PUSH or DRAFT', () => {
  const src = readFileSync(new URL('../../app/lib/bell.js', import.meta.url), 'utf8');
  const block = src.split('export const WORDS = Object.freeze({')[1].split('\n});')[0];
  const entries = block.split('\n').filter((l) => /^\s{2}[a-z_]+:/.test(l));
  assert.equal(entries.length, Object.keys(WORDS).length);
  for (const l of entries) assert.match(l, /\/\/ (DESIGN|PUSH|DRAFT)/, l);
});
