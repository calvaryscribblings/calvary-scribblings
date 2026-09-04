// R42 — the Open Pages home row. R40 rebuilt the FEED; R38 only moved this row, so it
// kept the pre-R40 card. This is the row catching up, with one ruling that DIFFERS from
// the feed's and therefore needs its own guard.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openingOf } from '../../app/lib/openPagesOpening.js';

const lib = readFileSync('app/public-library/page.js', 'utf8');
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const entry = () => {
  const i = lib.indexOf('function OpenPagesEntry(');
  assert.notEqual(i, -1, 'the row entry must exist');
  return lib.slice(i, lib.indexOf('function OpenPagesRow('));
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('R42 · ⭐ THE ROW IS TEXT ONLY', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ NO IMAGE OF ANY KIND — not the cover, not the avatar', () => {
    // The ruling differs from the feed's ON PURPOSE. On the feed a cover is a plate,
    // with room to breathe, and it rewards a writer who made art. HERE the row sits
    // between the house's own cover-led rows, where a community thumbnail makes
    // community writing compete with the catalogue on the catalogue's terms and lose.
    const e = entry();
    assert.equal(/<img/.test(e), false, 'the row entry must contain no <img>');
    assert.equal(/coverImage/.test(e), false, 'not even where a cover exists');
    assert.equal(/avatar/i.test(codeOf(e)), false, 'and not the 28px author avatar either');
    // The old card's empty-cover placeholder is gone with it — a feather in a grey box
    // is a picture of an absence.
    assert.equal(/linear-gradient\(135deg, #1a1326/.test(lib), false);
  });

  test('the pre-R40 card is gone, not left beside the new entry', () => {
    assert.equal(/function OpenPagesCard\(/.test(lib), false);
    // Two entry components in one file is how a later round renders the wrong one.
    assert.equal((lib.match(/function OpenPagesEntry\(/g) || []).length, 1);
  });

  test('⭐ THE OPENING COMES FROM THE SHARED MODULE, not a second rule', () => {
    // Two copies of "what is the opening" is how the two surfaces start disagreeing.
    // And a character substring is measurably wrong — R40 proved it shows a reader the
    // section marker and nothing else.
    assert.match(lib, /import \{ openingOf, readingTime \} from '\.\.\/lib\/openPagesOpening'/);
    assert.match(entry(), /openingOf\(post\.body, \{ maxLines: 3, maxChars: 150 \}\)/);
    // The row asks the module for a smaller budget through its OWN options rather than
    // cutting the result, which is what would fork the rule.
    assert.equal(/\.slice\(0, \d+\)[^)]*…/.test(entry()), false, 'no local truncation');
    assert.equal(/stripMarkdown/.test(codeOf(entry())), false);
  });

  test('the module really does give the row a shorter opening', () => {
    const long = 'It took a while to notice. '.repeat(40);
    const full = openingOf(long).lines[0];
    const row = openingOf(long, { maxLines: 3, maxChars: 150 }).lines[0];
    assert.ok(row.length < full.length, 'the row budget must actually be smaller');
    assert.ok(row.length <= 152);
    assert.ok(row.endsWith('…'));
  });

  test('⭐ READ COUNT STAYS OUT, and its reads went with it', () => {
    const e = entry();
    assert.equal(/readCount/.test(e), false, "the piece's read count must not come back");
    assert.equal(/likeCount|commentCount|reactionCount/.test(e), false);
    assert.match(e, /min read/, 'reading time is what changes whether someone taps');
    // Two extra reads per post for numbers nothing renders is twelve requests a
    // homepage load. The row's counts fetch is gone.
    const row = lib.slice(lib.indexOf('function OpenPagesRow('));
    assert.equal(/open_pages_reactions/.test(codeOf(row)), false);
    assert.equal(/get\(ref\(db, `comments\//.test(codeOf(row)), false);
    assert.equal(/setCounts/.test(row), false);
  });

  test('it carries the feed’s grammar: kicker, title, opening, writer, time', () => {
    const e = entry();
    assert.match(e, /OP_CINZEL[^}]*textTransform: 'uppercase'[^}]*color: OP_GOLD/, 'a Cinzel kicker in gold');
    assert.match(e, /normalizeGenre\(post\.genre\)/);
    assert.match(e, /fontFamily: OP_SERIF[^}]*fontWeight: 600/, 'the title in Cormorant');
    assert.match(e, /data-op-row-opening/);
    assert.match(e, /\{mins\} min read/);
    // A kicker, not the old pill.
    assert.equal(/borderRadius: 999/.test(e), false, 'the genre pill is a kicker now');
  });

  test('identity resolves at render; the snapshot is the fallback', () => {
    assert.match(entry(), /author\?\.displayName \|\| post\.authorName/);
    assert.match(lib, /return \[uid, s\.exists\(\) \? s\.val\(\) : null\];/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R42 · ⭐ VERSE AT ROW WIDTH', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ EACH VERSE LINE IS ITS OWN BLOCK — that is what makes the indent HANG', () => {
    // The first attempt set the stanza as ONE block with `white-space: pre-line` and a
    // text-indent. text-indent applies to the first line of a block and the padding to
    // all of them, so lines 2 and 3 of every stanza came out indented and line 1 did
    // not — a misprint of the poem, visible only in the screenshot.
    const e = entry();
    assert.match(e, /opening\.lines\.map\(\(line, i\) => \(/);
    assert.match(e, /display: 'block', paddingLeft: 12, textIndent: -12/);
    assert.equal(/whiteSpace: 'pre-line'/.test(e), false, 'the one-block version must not come back');
  });

  test('prose does not get the verse treatment', () => {
    const e = entry();
    assert.match(e, /opening\.kind === 'verse'/);
    assert.match(e, /: opening\.lines\[0\] \|\| ''/, 'prose renders as one running line');
  });

  test('the width is the measured one, and the reason is recorded', () => {
    // At 300px "The Outliers' Mind" set 3 written lines as 4 — the opening line turned,
    // and the hanging indent's own 12px was what pushed it over. 330 is where both live
    // poems set honestly. Measured with a Range, then confirmed per line box.
    assert.match(lib, /const OP_ROW_W = 330;/);
    assert.match(lib, /const OP_ROW_H = 190;/);
  });

  test('the detection is R40’s, on the writer’s own line breaks', () => {
    // Not the genre label. A poem filed as General still sets as verse.
    assert.equal(openingOf('Somewhere between belonging,\nI disappeared\nfrom the crowd.').kind, 'verse');
    assert.equal(openingOf('One long sentence of ordinary prose that simply keeps going without any breaks.').kind, 'prose');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R42 · it is still a ROW', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('six entries — it must not become a second feed', () => {
    const row = lib.slice(lib.indexOf('function OpenPagesRow('));
    assert.match(row, /\.slice\(0, 6\)/);
  });

  test('entries are a fixed size, because a ragged row reads as broken', () => {
    // Without a cover there is no image to set the height, so the clamps do it.
    const e = entry();
    assert.match(e, /width: OP_ROW_W, minWidth: OP_ROW_W, height: OP_ROW_H/);
    assert.match(e, /WebkitLineClamp: 2/, 'the title clamps');
    assert.match(e, /WebkitLineClamp: 3/, 'the opening clamps');
    assert.match(e, /flexShrink: 0/);
  });

  test('a hairline, not a box — the feed’s rule laid on its side', () => {
    const e = entry();
    assert.match(e, /borderLeft: `1px solid/);
    assert.equal(/borderRadius: 10/.test(e), false, 'the card’s corners are gone');
    assert.match(e, /background: 'transparent'/);
  });

  test('⭐ R38.1’s PLACEMENT IS NOT REOPENED', () => {
    // Below every genre row, below The Series, above the signup. Asserted here too so a
    // restyle cannot quietly move it.
    const at = (n) => { const i = lib.indexOf(n); assert.notEqual(i, -1, n); return i; };
    const row = at('<OpenPagesRow />');
    for (const g of ['Flash Fiction', 'Short Stories', 'Poetry', 'News & Updates', 'Inspiring Stories']) {
      assert.ok(row > at(`title="${g}"`), `${g} stays above the row`);
    }
    assert.ok(row > at('<SeriesRow />'));
    assert.ok(row < at('id="subscribe"'), 'and it stays above the signup');
  });

  test('no emoji in the row', () => {
    for (const [i, line] of codeOf(entry()).split('\n').entries()) {
      for (const ch of line) {
        const o = ch.codePointAt(0);
        const picto = (o >= 0x1F000 && o <= 0x1FAFF) || (o >= 0x2700 && o <= 0x27BF) || (o >= 0x2600 && o <= 0x26FF) || (o >= 0x2B00 && o <= 0x2BFF);
        assert.equal(picto, false, `row:${i + 1} ships U+${o.toString(16)}`);
      }
    }
  });
});
