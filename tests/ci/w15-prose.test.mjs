// W15 — THE PROSE RULINGS OF 26 SEP 2026, pinned.
//
//   node --test tests/ci/w15-prose.test.mjs      (part of npm run test:ci)
//
// Ruling 22: the opening paragraph, and the first paragraph after a scene break or a heading,
// are flush left, with or without a drop cap. Scene break = the CMS's section-break, a bare
// "***", "* * *" or "— ✦ —" paragraph, and <hr>. Heading = h1–h6 and a poem's numeral. Every
// other paragraph is indented, including after a list, a blockquote or a figure. An inline
// indent in the body still wins.
// Ruling 21: a Series instalment's indented paragraphs are set at 1.5em, not the files' 0.5cm;
// the files still decide which paragraphs are indented.
// Centred lines: never indented, even with an inline indent; a tracked one gives back its
// trailing letter-space.
// Ruling 35: the inline-purple ornaments stay #6B2FAD on cream.
//
// What these rules moved on the build is measured by tests/typography/prose-census.mjs; see
// docs/W15-PROSE.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyParagraphs, tagParagraphs, FLUSH_CLASS } from '../../app/lib/paragraphTag.js';
import { tagSubheads } from '../../app/lib/subheadTag.js';
import { proseCSS } from '../../app/lib/proseCSS.js';

const src = (p) => readFileSync(p, 'utf8');
const flushOf = (html) => classifyParagraphs(html).map((p) => [p.text, p.why]);
const P = (t, attrs = '') => `<p${attrs}>${t}</p>`;
const body = 'A paragraph long enough to read as the story itself, not front matter.';

describe('ruling 22: which paragraphs are flush', () => {
  test('the opener is flush, the next paragraph is not', () => {
    assert.deepEqual(flushOf(P(body) + P('Second.')), [[body, 'opening'], ['Second.', null]]);
  });
  test('the opener after front matter is flush, with or without a drop cap', () => {
    const html = P('Content note: grief.', ' class="intro-note"') + P('“Quoted opener that the drop cap withholds, long enough to be prose.”') + P('Next.');
    const r = classifyParagraphs(html);
    assert.equal(r[1].why, 'opening');
    assert.equal(r[2].flush, false);
  });
  for (const [name, brk] of [
    ['a section-break paragraph', P('— ✦ —', ' class="section-break"')],
    ['a bare "***"', P('***')],
    ['a bare "* * *"', P('* * *')],
    ['a bare "— ✦ —"', P('— ✦ —')],
    ['a centred "***"', P('***', ' style="text-align:center;"')],
    ['an <hr>', '<hr>'],
    ['an <hr />', '<hr />'],
  ]) {
    test(`the first paragraph after ${name} is flush`, () => {
      const r = classifyParagraphs(P(body) + P('Middle.') + brk + P('After.') + P('Then.'));
      const after = r.find((p) => p.text === 'After.');
      assert.equal(after.why, 'after a scene break');
      assert.equal(r.find((p) => p.text === 'Then.').flush, false);
    });
  }
  for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    test(`the first paragraph after an ${h} is flush`, () => {
      const r = classifyParagraphs(P(body) + `<${h}>Title</${h}>` + P('After.'));
      assert.equal(r.find((p) => p.text === 'After.').why, 'after a heading');
    });
  }
  test("the first paragraph after a poem's numeral is flush", () => {
    const r = classifyParagraphs(P(body) + P('II', ' class="poem-numeral"') + P('After.'));
    assert.equal(r.find((p) => p.text === 'After.').why, 'after a heading');
  });
  for (const [name, el] of [
    ['a list', '<ul><li>one</li></ul>'],
    ['an ordered list', '<ol><li>one</li></ol>'],
    ['a blockquote', '<blockquote><p>quoted</p></blockquote>'],
    ['a figure', '<figure><img src="x.jpg"><figcaption>c</figcaption></figure>'],
    ['a bold-paragraph subheading (not a heading by the ruling)', P('<strong>The Bottom Line</strong>')],
  ]) {
    test(`a paragraph after ${name} is not flush`, () => {
      const r = classifyParagraphs(tagSubheads(P(body) + P('Middle.') + el + P('After.')));
      assert.equal(r.find((p) => p.text === 'After.').flush, false);
    });
  }
  test('an empty spacer paragraph is not what came before', () => {
    const r = classifyParagraphs(P(body) + '<h3>T</h3>' + P('&nbsp;') + P('') + P('After.'));
    assert.equal(r.find((p) => p.text === 'After.').why, 'after a heading');
  });
  test('only top-level paragraphs: a quotation keeps its own rule', () => {
    const r = classifyParagraphs(P(body) + '<hr><blockquote><p>a</p><p>b</p></blockquote>');
    assert.deepEqual(r.map((p) => p.text), [body]);
  });
});

describe('ruling 22: the transform', () => {
  test('adds para-flush to a bare tag, a class, and a single-quoted class', () => {
    const out = tagParagraphs(P(body) + '<h3>T</h3>' + P('a', ' class="x"') + '<hr>' + P('b', " class='y'") + '<hr>' + P('c', ' style="text-indent:1.5em"'));
    assert.match(out, /^<p class="para-flush">A paragraph/);
    assert.match(out, /<p class="para-flush x">a/);
    assert.match(out, /<p class='para-flush y'>b/);
    assert.match(out, /<p class="para-flush" style="text-indent:1.5em">c/, 'the inline indent is kept, and wins in the cascade');
  });
  test('is idempotent', () => {
    const once = tagParagraphs(P(body) + '<h3>T</h3>' + P('a'));
    assert.equal(tagParagraphs(once), once);
    assert.equal((once.match(/para-flush/g) || []).length, 2);
  });
  test('an unbalanced body comes back unchanged', () => {
    const bad = P(body) + '<h3>T' + P('a');
    assert.equal(tagParagraphs(bad), bad);
  });
  test('runs after tagSubheads, which only recognises a bare <p>', () => {
    const html = tagParagraphs(tagSubheads('<h3>T</h3><p><strong>Section</strong></p><p>x</p>'));
    assert.match(html, /<p class="para-flush prose-subhead"><strong>Section/);
  });
  test('the stored words are untouched: only the class attribute differs', () => {
    const html = P(body) + '<hr>' + P('a <em>b</em> c') + '<ul><li>x</li></ul>' + P('d');
    assert.equal(tagParagraphs(html).replace(/ class="para-flush"/g, ''), html);
  });
});

describe('ruling 22 and the centred lines: the stylesheet', () => {
  const css = proseCSS('#6b46c1');
  test('the old paragraph-after-a-paragraph rule is kept', () => {
    assert.ok(css.includes('.prose:not(.is-verse) p + p { text-indent: 1.5em; }'));
  });
  test('a paragraph after a list, a blockquote or a figure is indented', () => {
    assert.ok(css.includes('.prose:not(.is-verse) > :is(ul, ol, blockquote, figure, div, img, table, pre, section, aside) + p { text-indent: 1.5em; }'));
  });
  test('para-flush is 0, and not !important, so an inline indent still wins', () => {
    assert.ok(css.includes('.prose:not(.is-verse) > p.para-flush { text-indent: 0; }'));
  });
  test('a centred line is never indented and gives back its 0.3em tracking', () => {
    assert.ok(css.includes(".prose p[style*='text-align:center'], .prose p[style*='text-align: center'], .prose p.section-break, .prose p.poem-numeral { text-indent: 0 !important; padding-left: 0.3em; }"));
    // The give-back equals the tracking every one of those lines carries.
    for (const sel of [".prose p[style*='text-align:center']", '.prose .section-break', '.prose .poem-numeral']) {
      const rules = css.split(sel).slice(1).map((r) => r.split('}')[0]);
      assert.ok(rules.some((r) => /letter-spacing: 0\.3em/.test(r)), sel);
    }
  });
  test('ruling 35: nothing in the stylesheet can repaint an inline colour', () => {
    assert.doesNotMatch(css, /color:[^;]*!important/);
  });
});

describe('ruling 22: every surface that renders a story body runs the transform', () => {
  test('the story page: the body and the lock preview', () => {
    const s = src('app/stories/[slug]/page-client.js');
    assert.ok(s.includes("__html: tagParagraphs(tagSubheads(story.content || '<p>Content coming soon.</p>')) }}"));
    assert.ok(s.includes('lockScript(initialStory.lockAtMs, tagParagraphs(tagSubheads(initialStory.previewHtml)),'));
    assert.equal((s.match(/tagSubheads\(/g) || []).length, (s.match(/tagParagraphs\(tagSubheads\(/g) || []).length);
  });
  test('the offline shelf reader', () => {
    const s = src('app/my-library/read/page.js');
    assert.ok(s.includes("__html: tagParagraphs(tagSubheads(record.content || '<p>This saved copy has no text.</p>')) }}"));
  });
  test('FLUSH_CLASS is the class the stylesheet names', () => {
    assert.equal(FLUSH_CLASS, 'para-flush');
  });
});

describe('ruling 21: the Series indent', () => {
  test('the Series reader asks for it; a book does not get it', () => {
    // ReadingRoom.js is JSX, so its one src builder is read from source.
    const rr = src('app/reader/[slug]/ReadingRoom.js');
    assert.ok(rr.includes("export function readingRoomSrc(epubUrl, p, { indent = null } = {}) {"));
    assert.ok(rr.includes("  if (indent === 'series') qs.set('indent', 'series');"));
    assert.ok(rr.includes('readingRoomSrc(epubSource, prefsInit.current, { indent })'));
    assert.match(src('app/series/read/[instalmentId]/page-reader.js'), /register="book"\s*\/\/[^\n]*\n\s*indent="series"/);
    for (const f of ['app/reader/[slug]/page-reader.js', 'app/reader/[slug]/book-reader.js']) {
      assert.doesNotMatch(src(f), /indent=/, `${f} is a story or a book, set as its file sets it`);
    }
  });
  test('the room rewrites exactly the 0.5cm rules, at their own priority, on every section load', () => {
    const s = src('public/reading-room.html');
    assert.ok(s.includes("const SERIES_INDENT = params.get('indent') === 'series'"));
    assert.ok(s.includes("r.style.getPropertyValue('text-indent').trim() === '0.5cm'"));
    assert.ok(s.includes("r.style.setProperty('text-indent', '1.5em', r.style.getPropertyPriority('text-indent'))"));
    assert.match(s, /seriesIndent\(detail\.doc\)\s*\n\s*respectAuthorAlignment\(detail\.doc\)/);
  });
});
