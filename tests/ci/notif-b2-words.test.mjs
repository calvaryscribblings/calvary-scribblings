// NOTIF-B2 ship — the bell's words match Ikenna's approved design wherever the design shows a line,
// and the push wording ruled 25 Sep for new stories (docs/PUSH-GO-LIVE.md). STORY-W1 — every line
// the design didn't show is now ruled (docs/COPY-RULINGS.md, 5 Nov 2026, rulings 338–343), and
// each is pinned here. Bold = a { name } part (weight 600). Every WORDS entry is marked DESIGN, PUSH
// or RULED in bell.js, and none is DRAFT any more.

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

test('instalments (341): "New instalment by **{writer}**" / "{series}, {part}"', () => {
  const r = fromAnnouncement('instalment_i', { id: 'i', kind: 'instalment', seriesId: 'se', authorUid: 'w', at: 1 }, {});
  const d = { instalment: () => ({ title: 'Part Three' }), series: () => ({ title: 'Beta Princess' }) };
  assert.deepEqual(lines(r, d), ['New instalment by **Wren Writer**', 'Beta Princess, Part Three']);
  // before the records arrive the first line is the same; the second shows what is known
  assert.deepEqual(lines(r, {}), ['New instalment by **Wren Writer**', null]);
  assert.deepEqual(lines(r, { series: () => ({ title: 'Beta Princess' }) }), ['New instalment by **Wren Writer**', 'Beta Princess']);
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

test('two reactors are both named (340); three or more read "and {n} others"', () => {
  const two = fromInbox('x', { kind: 'reaction', subject: { slug: 's', commentId: 'c' }, count: 2, actorCount: 2, recent: ['a', 'b'], at: 1 });
  assert.deepEqual(lines(two, story('The Long Field')), ['**Ada Obi** and **Ben** liked your response', 'on The Long Field']);
  const three = fromInbox('x', { kind: 'reaction', subject: { slug: 's', commentId: 'c' }, count: 3, actorCount: 3, recent: ['a', 'b', 'w'], at: 1 });
  assert.equal(lines(three)[0], '**Ada Obi** and 2 others liked your response');
  const post = fromInbox('x', { kind: 'reaction', subject: { postId: 'p', threadId: 'p' }, count: 2, actorCount: 2, recent: ['b', 'a'], at: 1 });
  assert.equal(lines(post)[0], '**Ben** and **Ada Obi** liked your post');
  const story2 = fromInbox('x', { kind: 'story_reaction', subject: { slug: 's' }, count: 2, actorCount: 2, recent: ['a', 'b'], at: 1 });
  assert.equal(lines(story2)[0], '**Ada Obi** and **Ben** liked your story');
  assert.equal(lines(fromInbox('x', { kind: 'reaction', subject: { slug: 's' }, count: 1, actorCount: 1, recent: ['a'], at: 1 }))[0], '**Ada Obi** liked your response');
});

test('every reaction, heart, fire, quill or clap, reads "liked" (339)', () => {
  for (const type of ['heart', 'fire', 'quill', 'clap', 'like']) {
    assert.equal(lines(fromLegacy('library_notifications', 'n', { type, fromUid: 'a', slug: 's', createdAt: 1 }))[0], '**Ada Obi** liked your response', type);
    assert.equal(lines(fromLegacy('notifications', 'n', { type, fromUid: 'a', postId: 'p', createdAt: 1 }))[0], '**Ada Obi** liked your post', type);
  }
});

test('the drafts that stay as written (338)', () => {
  const one = (rec) => lines(fromInbox('x', { at: 1, ...rec }))[0];
  assert.deepEqual(lines(fromInbox('x', { kind: 'response', subject: { slug: 's' }, count: 1, actorCount: 1, recent: ['a'], at: 1 }), story('The Long Field')), ['**1 new response** on your story', 'The Long Field']);
  assert.equal(one({ kind: 'message', subject: {}, count: 1, actorCount: 1, recent: ['a'] }), '**Ada Obi** sent you a message');
  assert.equal(one({ kind: 'reply', actor: 'a', subject: { postId: 'p', threadId: 'p' } }), '**Ada Obi** replied to your post');
  assert.equal(one({ kind: 'reply', actor: 'a', subject: { postId: 'p', threadId: 't', to: 'you' } }), '**Ada Obi** replied to you');
  assert.equal(one({ kind: 'reply', actor: 'a', subject: { pieceId: 'pc' } }), '**Ada Obi** replied to you on Open Pages');
  assert.equal(one({ kind: 'mention', actor: 'a', subject: { slug: 's', commentId: 'c' } }), '**Ada Obi** mentioned you in a response');
  assert.equal(one({ kind: 'quote', actor: 'a', subject: { postId: 'p', threadId: 'p' } }), '**Ada Obi** quoted your post');
  assert.equal(one({ kind: 'tier_up', subject: {} }), 'You reached a new tier');
  // the old notes the app writes read the same
  assert.equal(lines(fromLegacy('notifications', 'n', { type: 'square_reply_to_you', fromUid: 'a', postId: 'p', createdAt: 1 }))[0], '**Ada Obi** replied to you');
  assert.equal(lines(fromLegacy('notifications', 'n', { type: 'square_quote', fromUid: 'a', postId: 'p', createdAt: 1 }))[0], '**Ada Obi** quoted your post');
  assert.equal(lines(fromLegacy('notifications', 'n', { type: 'open_pages_reply', fromUid: 'a', postId: 'pc', createdAt: 1 }))[0], '**Ada Obi** replied to you on Open Pages');
});

test('a declined Open Pages piece (342): "Your piece couldn’t go live in Open Pages" / {title}', () => {
  const r = fromInbox('x', { kind: 'open_pages_declined', subject: { pieceId: 'pc', title: 'Small Hours' }, at: 1 });
  assert.deepEqual(lines(r), ['Your piece couldn’t go live in Open Pages', 'Small Hours']);
  assert.equal(secondLine(r).quoted, false);
  assert.equal(r.needsPiece ?? null, null, 'a declined piece is stored nowhere public: never read for');
  assert.deepEqual(lines(fromInbox('x', { kind: 'open_pages_declined', subject: { pieceId: 'pc' }, at: 1 })), ['Your piece couldn’t go live in Open Pages', null]);
});

test('badges and rewards say what was earned when the note carries it (343), today’s words when not', () => {
  const ib = (rec) => lines(fromInbox('x', { at: 1, ...rec }))[0];
  assert.equal(ib({ kind: 'badge', subject: { badge: 'Night Owl' } }), 'You earned the Night Owl badge');
  assert.equal(ib({ kind: 'badge', subject: {} }), 'You earned a new badge');
  assert.equal(ib({ kind: 'badge', subject: { badge: '  ' } }), 'You earned a new badge');
  assert.equal(ib({ kind: 'reward', subject: { amount: 5 } }), 'You earned 5 Scribbles');
  assert.equal(ib({ kind: 'reward', subject: {} }), 'You earned Scribbles');
  assert.equal(ib({ kind: 'reward', subject: { amount: '5' } }), 'You earned Scribbles', 'only a number is an amount');
  // The old reward note: every writer carries what was earned in `message`, which stands; none
  // carries an amount field. A note with no message keeps today's words.
  const msg = 'You earned 5 Scribbles — 10 stories read milestone!';
  assert.equal(lines(fromLegacy('library_notifications', 'n', { type: 'reward', message: msg, createdAt: 1 }))[0], `**Calvary Scribblings** ${msg}`);
  assert.equal(lines(fromLegacy('library_notifications', 'n', { type: 'reward', createdAt: 1 }))[0], '**Calvary Scribblings** You earned Scribbles');
});

test('curly quotes and apostrophes throughout: no straight quote in any WORDS entry or the row', () => {
  for (const [k, v] of Object.entries(WORDS)) {
    const s = typeof v === 'function' ? v(2) : v;
    assert.ok(!/['"]/.test(s), `${k}: ${s}`);
  }
  const src = readFileSync(new URL('../../app/components/bell/BellRow.js', import.meta.url), 'utf8');
  assert.ok(src.includes('`“${line2.text}”`'), 'quoted words sit inside curly quotes');
});

test('every WORDS entry is marked DESIGN, PUSH or RULED, and none is DRAFT', () => {
  const src = readFileSync(new URL('../../app/lib/bell.js', import.meta.url), 'utf8');
  const block = src.split('export const WORDS = Object.freeze({')[1].split('\n});')[0];
  const entries = block.split('\n').filter((l) => /^\s{2}[a-z_]+:/.test(l));
  assert.equal(entries.length, Object.keys(WORDS).length);
  for (const l of entries) {
    assert.match(l, /\/\/ (DESIGN|PUSH|RULED \d{3})/, l);
    assert.doesNotMatch(l, /DRAFT/, l);
  }
});
