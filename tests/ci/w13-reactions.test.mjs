// W13 — THE REACTIONS: the choreography Ikenna approved (25 Sept), his palette and rulings
// (26 Sept), and the app's A14 row. What a source and a server render can hold; the motion,
// the row's measure, the count, Reduce Motion and failure are proven in real WebKit and
// Chromium by tests/reactions/proof.mjs, and on the real pages by tests/reactions/live.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Reaction, COMMENT_REACTIONS, SQUARE_REACTIONS, FAIL_COPY, REACTION_REST, REACTION_FULL,
} from '../../app/components/conversation/Reaction.js';
import { PALETTE } from '../../app/lib/reactionMotion.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const MOTION = read('app/lib/reactionMotion.js');
const PROTO = read('tests/reactions/prototype.verbatim.txt');
const STORY = read('app/stories/[slug]/page-client.js');
const READER = read('app/reader/[slug]/page-reader.js');
const SQUARE = read('app/square/page.js');
const OPEN = read('app/open-pages/[id]/page-client.js');
const REACTION = read('app/components/conversation/Reaction.js');

describe('the motion is the prototype, verbatim', () => {
  test('the block between the markers is byte-identical, bar the one W13-MASK line', () => {
    const block = MOTION.split('// ─── BEGIN PROTOTYPE (verbatim, 25 Sept) ')[1].split('\n// ─── END PROTOTYPE')[0];
    const body = block.slice(block.indexOf('\n') + 1) + '\n';
    const lines = body.split('\n');
    const masked = lines.filter((l) => l.includes('W13-MASK'));
    assert.equal(masked.length, 1, 'exactly one added line');
    assert.equal(masked[0], '  if (bg == null) return burstMasked(b, S, R, from, to, delay); // W13-MASK');
    assert.equal(lines.filter((l) => !l.includes('W13-MASK')).join('\n'), PROTO);
  });
  test('the fixture still carries every function the prototype defined', () => {
    for (const fn of ['A', 'svgEl', 'later', 'tick', 'clear', 'prepFx', 'play', 'burst', 'heartOn', 'likeOn', 'fireOn', 'off', 'setCount']) {
      assert.match(PROTO, new RegExp(`^function ${fn}\\(`, 'm'), fn);
    }
  });
  test('K is 1 in production; only setSpeed changes it', () => {
    assert.match(MOTION, /^let K = 1;$/m);
    assert.equal((MOTION.match(/\bK = /g) || []).length, 2); // the declaration and setSpeed
  });
});

describe('the palette (26 Sept)', () => {
  test('heart and fire are his picks; plum starts the burst; the rose sparks; the rest as the prototype', () => {
    assert.deepEqual({ ...PALETTE }, {
      plum: '#7B3FC4', heart: '#A92339', fire: '#B6281B', rose: 'hsl(350, 66%, 58%)',
      like: '#D4941A', tongue: '#F6B640', gold: '#D8B45A', cream: '#F1E4C8', amber: '#F59E0B',
    });
  });
  test('bg is never a constant: it is resolved behind each button at the tap', () => {
    assert.ok(!('bg' in PALETTE));
    assert.match(REACTION, /play\(b, \{ \.\.\.PALETTE, bg: resolveBg\(b\) \}\)/);
  });
});

describe('the button', () => {
  const render = (props) => renderToStaticMarkup(h(Reaction, { size: 16, count: 3, ...props }));
  test('three stacked SVGs — fx, outline, filled — with the prototype\'s origins', () => {
    for (const [kind, origin] of [['heart', '50% 55%'], ['like', '32% 80%'], ['fire', '50% 92%']]) {
      const m = render({ kind, on: false });
      assert.match(m, /<span class="rx-icon" style="width:16px;height:16px"><svg class="rx-fx"[^>]*><\/svg><svg[^>]*class="rx-off"[^>]*style="transform-origin:([^;]+);opacity:1"/);
      assert.equal(m.match(/transform-origin:([^;]+);/g).map((x) => x.slice(17, -1)).join('|'), `${origin}|${origin}`, kind);
      assert.equal(m.includes('class="tongue"'), kind === 'fire', `${kind}: tongue on fire only`);
    }
  });
  test('filled in the palette; the outline and count cream 72% at rest, full once reacted', () => {
    assert.match(render({ kind: 'heart', on: true }), /fill="#A92339"/);
    assert.match(render({ kind: 'fire', on: true }), /fill="#B6281B".*class="tongue"[^>]*fill="#F6B640"/);
    assert.match(render({ kind: 'like', on: true }), /fill="#D4941A"/);
    assert.match(render({ kind: 'heart', on: false }), new RegExp(`class="rx-count"[^>]*style="color:${REACTION_REST.replace(/[()]/g, '\\$&')}"`));
    assert.match(render({ kind: 'heart', on: true }), new RegExp(`class="rx-count"[^>]*style="color:${REACTION_FULL.replace(/[()]/g, '\\$&')}"`));
  });
  test('the count is never server-rendered: setCount owns it, so mount never slides', () => {
    assert.match(render({ kind: 'heart', on: false }), /<span class="rx-count"[^>]*><\/span><\/button>$/);
  });
  test('aria-pressed follows the state; a slot widens only from 100', () => {
    assert.match(render({ kind: 'heart', on: true }), /aria-pressed="true"/);
    assert.ok(!render({ kind: 'heart', on: false, count: 99 }).includes('data-wide=""'));
    assert.ok(render({ kind: 'heart', on: false, count: 100 }).includes('data-wide=""'));
  });
  test('the row\'s measure is in the stylesheet: 44px slot, 5px, 14px lining tabular', () => {
    assert.match(REACTION, /\.rx\{[^}]*width:44px;height:44px;[^}]*padding:0;/);
    assert.match(REACTION, /\.rx\[data-wide\]\{width:auto;min-width:44px;padding-right:10px\}/);
    assert.match(REACTION, /\.rx-count\{[^}]*margin-left:5px;[^}]*font-size:14px;[^}]*font-variant-numeric:lining-nums tabular-nums/);
    assert.doesNotMatch(REACTION, /transition:/, 'no CSS transition — Reduce Motion means at once');
  });
  test('the failure words', () => {
    assert.equal(FAIL_COPY, "Couldn't save your reaction. Try again.");
  });
});

describe('the rulings (26 Sept)', () => {
  test('comments under stories: heart and fire only; the Square keeps heart, like and fire', () => {
    assert.deepEqual(COMMENT_REACTIONS.map((r) => `${r.key}:${r.kind}`), ['heart:heart', 'fire:fire']);
    assert.deepEqual(SQUARE_REACTIONS.map((r) => `${r.key}:${r.kind}`), ['like:heart', 'clap:like', 'fire:fire']);
    for (const src of [STORY, READER]) assert.match(src, /reactions=\{COMMENT_REACTIONS\}/);
    assert.match(SQUARE, /reactions=\{SQUARE_REACTIONS\}/);
  });
  test('"Reply" is a word — Cormorant 500, 15px, #9062DA — and reads "Cancel" while open', () => {
    for (const [name, src] of [['story', STORY], ['reader', READER]]) {
      const css = src.match(/\.cs-reply-btn ?\{[^}]*\}/)[0];
      assert.match(css, /font-size: ?15px/, name); assert.match(css, /font-weight: ?500/, name);
      assert.match(css, /color: ?#9062DA/, name); assert.match(css, /text-transform: ?none/, name);
      assert.match(css, /Cormorant Garamond/, name);
      assert.match(src, /\{replyTo === comment\.id \? 'Cancel' : 'Reply'\}/, name);
    }
    const op = OPEN.slice(OPEN.indexOf('className="op-reply-btn"'), OPEN.indexOf("{replyOpen ? 'Cancel' : 'Reply'}") + 40);
    assert.match(op, /color: '#9062DA'/); assert.match(op, /fontFamily: SERIF/);
    assert.match(op, /fontSize: 15/); assert.match(op, /fontWeight: 500/);
    assert.doesNotMatch(op, /textTransform/);
  });
  test('the section says Responses', () => {
    for (const src of [STORY, READER]) {
      assert.match(src, /<div className="cs-title">Responses<\/div>/);
      assert.match(src, /\{comments\.length === 1 \? 'response' : 'responses'\}/);
      assert.match(src, /placeholder="Add a response…"/);
      assert.doesNotMatch(src, /Discussion|Share your thoughts|'comment' : 'comments'/);
    }
  });
});

describe('every surface is on the one button', () => {
  test('nothing of the old effect is left', () => {
    for (const [name, src] of [['story', STORY], ['reader', READER], ['square', SQUARE], ['open', OPEN], ['kit', read('app/components/conversation/ConversationKit.js')]]) {
      assert.doesNotMatch(src, /ck-burst|ck-roll|opLikePulse|buildReactions|RollingCount|<IconHeart size=\{13\}/, name);
    }
  });
  test('16px in comments and replies; the Open Pages piece keeps its 18', () => {
    for (const src of [STORY, READER]) assert.doesNotMatch(src, /iconSize=/);
    assert.doesNotMatch(SQUARE, /ReactionBar\(\{ p(: r)?, size: (?!16)/);
    assert.match(OPEN, /<Reaction kind="heart" size=\{16\}/);
    assert.match(OPEN, /<Reaction kind="heart" size=\{18\}/);
  });
  test('the Square never renders ReactionBar as a component (it would remount every button mid-burst)', () => {
    assert.doesNotMatch(SQUARE, /<ReactionBar\b/);
  });
  test('every toggle flips at once and rethrows a failed save, so the button can shake and say so', () => {
    const body = (src, head) => { const i = src.indexOf(head); return src.slice(i, src.indexOf('\n  }', i + head.length) + 4); };
    const cases = [
      ['story', body(STORY, 'const toggleCommentReaction = useCallback(')],
      ['reader', body(READER, 'const toggleCommentReaction = useCallback(')],
      ['square', body(SQUARE, 'const toggleReaction = async (postId, type) => {')],
      ['open piece', body(OPEN, 'async function toggleLike() {')],
      ['open thread', body(OPEN, 'async function toggleNodeLike(node) {')],
    ];
    for (const [name, src] of cases) {
      assert.match(src, /catch \((e|err)\) \{[\s\S]*?throw (e|err);/, `${name}: rethrows`);
      const first = src.search(/await /);
      assert.ok(/set(CommentReactions|Reactions|Likes)\(|apply\(!/.test(src.slice(0, first)), `${name}: optimistic before the first await`);
    }
  });
  test('an author\'s notification can never turn a saved reaction back off', () => {
    for (const [name, src, head] of [['story', STORY, 'const toggleCommentReaction'], ['reader', READER, 'const toggleCommentReaction'], ['square', SQUARE, 'const toggleReaction = async']]) {
      const s = src.slice(src.indexOf(head));
      const rethrow = s.search(/throw e;/), notify = s.search(/push\(ref\(db, `(library_)?notifications\//);
      assert.ok(rethrow > 0 && notify > rethrow, `${name}: the notification is sent after the save's try, in its own`);
    }
  });
});
