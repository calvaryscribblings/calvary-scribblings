// W15 — THE COUNTS, as Ikenna ruled them on 26 Sept (W13's questions 2 and 3):
//   Ruling 36: the 44px slot stays, with 9.25px after a two-digit count; 100+ widens.
//   Ruling 37: a count is hidden until the first reaction, so zero shows the icon alone, and
//              the slot keeps its 44px, so the first count appears without moving anything.
// What a source and a server render can hold. The painted pixels, the slides and the
// stability are proven in WebKit and Chromium by tests/reactions/proof.mjs (its `zero` section).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Reaction, REACTION_CSS } from '../../app/components/conversation/Reaction.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const REACTION = read('app/components/conversation/Reaction.js');
const KIT = read('app/components/conversation/ConversationKit.js');
const OPEN = read('app/open-pages/[id]/page-client.js');
const render = (props) => renderToStaticMarkup(h(Reaction, { kind: 'heart', size: 16, on: false, ...props }));

describe('ruling 37 (26 Sept): zero shows the icon alone', () => {
  test('a zero is hidden with visibility, never display, so its box stays in the slot', () => {
    assert.match(REACTION_CSS, /^\.rx-count>\.n\.z\{visibility:hidden\}$/m);
    assert.doesNotMatch(REACTION_CSS, /\.z\{[^}]*display:\s*none/);
    assert.doesNotMatch(REACTION_CSS, /\.rx-count\{[^}]*display:\s*none/);
  });
  test('showCount marks every "0" (arriving or at rest) and unmarks every other number', () => {
    const fn = REACTION.slice(REACTION.indexOf('export function showCount('), REACTION.indexOf('export function Reaction('));
    assert.match(fn, /^\s*setCount\(b, n\);$/m);
    assert.match(fn, /for \(const s of b\.st\.count\.querySelectorAll\('\.n'\)\) s\.classList\.toggle\('z', s\.textContent === '0'\);/);
  });
  test('every count goes through showCount: mount and every change, never setCount directly', () => {
    const body = REACTION.slice(REACTION.indexOf('export function Reaction('));
    assert.equal((body.match(/\bshowCount\(/g) || []).length, 2, 'mount + the [count] effect');
    assert.doesNotMatch(body, /\bsetCount\(/);
    assert.match(body, /showCount\(b, count\);\n\s*return \(\) => clear\(b\);/);
    assert.match(body, /showCount\(btn\.current, count\);\n\s*\}, \[count\]\);/);
  });
  test('the label names no zero; a count after the first reaction', () => {
    assert.match(render({ count: 0 }), /aria-label="Heart"/);
    assert.match(render({ count: 1 }), /aria-label="Heart, 1"/);
  });
  test('the slot is 44px whatever the count below 100: no data-wide at 0, 1 or 99', () => {
    for (const n of [0, 1, 99]) assert.ok(!render({ count: n }).includes('data-wide=""'), `${n}`);
  });
  test('every surface draws its count through the one button — none prints its own number', () => {
    assert.match(KIT, /<Reaction key=\{key\} kind=\{kind\}[\s\S]*?count=\{item\[`\$\{key\}Count`\] \|\| 0\}/);
    assert.equal((OPEN.match(/<Reaction kind="heart" size=\{(16|18)\} on=\{liked\} count=\{likeCount\}/g) || []).length, 2);
    for (const f of ['app/stories/[slug]/page-client.js', 'app/reader/[slug]/page-reader.js', 'app/square/page.js', OPEN]) {
      const src = f === OPEN ? OPEN : read(f);
      assert.doesNotMatch(src, /(?<!=)\{(\w+\.)?(heart|fire|like|clap)Count( \|\| 0)?\}/, `${f === OPEN ? 'open pages' : f}: no bare count printed beside a button`);
    }
  });
  test('the comment that described zero as open now records the ruling', () => {
    assert.match(REACTION, /RULED 26 Sept \(ruling 37\)/);
    assert.doesNotMatch(REACTION, /Reported to Ikenna in W13 as a question, not settled here/);
  });
});

describe('ruling 36 (26 Sept): the 44px slot stays, 9.25px after two digits', () => {
  test('44px slot; 100 and up widen to at least 44 with a 10px clear', () => {
    assert.match(REACTION_CSS, /\.rx\{[^}]*width:44px;height:44px;[^}]*padding:0;/);
    assert.match(REACTION_CSS, /\.rx\[data-wide\]\{width:auto;min-width:44px;padding-right:10px\}/);
    assert.ok(render({ count: 100 }).includes('data-wide=""'));
    assert.ok(!render({ count: 99 }).includes('data-wide=""'));
  });
  test('the count sits 5px after the icon at 14px lining tabular figures (13.75px a pair in Cormorant)', () => {
    assert.match(REACTION_CSS, /\.rx-count\{[^}]*margin-left:5px;[^}]*font-size:14px;[^}]*font-variant-numeric:lining-nums tabular-nums/);
  });
  test('the ruling is recorded where the arithmetic is', () => {
    assert.match(REACTION, /RULED 26 Sept \(ruling 36\): the 44px slot stays, with 9\.25px after a\n\/\/ two-digit count/);
  });
});
