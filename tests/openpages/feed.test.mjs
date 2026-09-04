// R40 — the feed. The decision the whole design rests on is that every entry shows
// the WRITING, so most of this file is about where that writing comes from.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  openingOf, readingTime, markdownBlocks, blockFromMarkdown, plainLine,
  VERSE_MIN_LINES, VERSE_MAX_AVG,
} from '../../app/lib/openPagesOpening.js';
import { walkToProse } from '../../app/lib/prosePredicate.js';

const feed = readFileSync('app/open-pages/page.jsx', 'utf8');
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// The live bodies, in shape, measured 4 Sep 2026. Verbatim openings so the classifier
// is tested against what writers actually wrote rather than against invented fixtures.
const LIVE = [
  { title: 'welcome to ‘open pages’', genre: 'General', want: 'prose',
    body: 'i’m opening my ‘open pages’ account with a throw back of my letter to the community two months ago.\n\n=================\n\nmore words here.' },
  { title: 'i chose stories', genre: 'General', want: 'prose',
    body: 'the first thing i am going to say is, this is not a defence.\n\ni recently came across a substack post.' },
  { title: 'The Outliers’ Mind', genre: 'Poetry', want: 'verse',
    body: 'Somewhere between belonging and becoming, \nI disappeared \nfrom amongst the crowd.\n\nI wandered—\nlike a single river' },
  { title: 'THE SHAPE I BECAME', genre: 'Poetry', want: 'verse',
    body: '**I. UNREAD**🌱\n\nI was on my bed, phone in hand,\nmoving between chats and other lives\n\nmore stanza' },
];

// ═══════════════════════════════════════════════════════════════════════════════
describe('R40 · ⭐ THE OPENING COMES FROM THE SHARED PREDICATE', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ A SECTION MARKER IS SKIPPED — the old rule spent the whole excerpt on it', () => {
    // "THE SHAPE I BECAME" opens with `**I. UNREAD**`. A character count shows the
    // reader that and nothing else. This is the exact failure prosePredicate exists
    // to prevent, and the reason this is a third adapter and not a second rule.
    const o = openingOf(LIVE[3].body);
    assert.equal(o.skipped, 1, 'the marker block must be walked past');
    assert.equal(o.lines[0], 'I was on my bed, phone in hand,');
    assert.equal(/UNREAD/.test(o.lines.join(' ')), false, 'the marker must not reach the reader');
  });

  test('⭐ IT IS NOT A CHARACTER COUNT — the same body cut at N chars is different', () => {
    const naive = LIVE[3].body.replace(/[#*_>`]/g, '').slice(0, 60).trim();
    const real = openingOf(LIVE[3].body).lines.join(' ');
    assert.notEqual(real.slice(0, 30), naive.slice(0, 30));
    assert.match(naive, /UNREAD/, 'the naive cut really does start with the marker');
  });

  test('it delegates to walkToProse rather than reimplementing it', () => {
    // If a later round inlines the walk, the two copies drift and the one nobody looks
    // at is the one that goes stale. The import is the contract.
    const src = readFileSync('app/lib/openPagesOpening.js', 'utf8');
    assert.match(src, /import \{ walkToProse \} from '\.\/prosePredicate\.js'/);
    assert.equal(typeof walkToProse, 'function');
    assert.equal(/isFrontmatterBlock|isMarkerish|EXCLUDED_TAGS/.test(codeOf(src)), false,
      'the rules live in prosePredicate; this file only adapts markdown to its block shape');
  });

  test('the markdown adapter supplies every field the block shape requires', () => {
    // prosePredicate's own note: an adapter that cannot supply one is an adapter that
    // will disagree with the other adapters.
    for (const raw of ['plain words', '> an epigraph', '# A heading', '- a list item', '*wholly italic*', '![alt](u)']) {
      const b = blockFromMarkdown(raw);
      for (const k of ['tag', 'classes', 'text', 'hasImg', 'ancestors', 'soleChild']) {
        assert.ok(k in b, `${JSON.stringify(raw)} is missing ${k}`);
      }
    }
    assert.equal(blockFromMarkdown('> quoted').tag, 'blockquote');
    assert.equal(blockFromMarkdown('# Head').tag, 'h2');
    assert.equal(blockFromMarkdown('- item').tag, 'li');
    assert.equal(blockFromMarkdown('![a](u)').hasImg, true);
    assert.deepEqual(blockFromMarkdown('*epigraph*').soleChild, { tag: 'em', textLength: 8 });
  });

  test('markdown furniture is stripped but the writer’s own words are not', () => {
    assert.equal(plainLine('## A heading'), 'A heading');
    assert.equal(plainLine('**bold** and *soft*'), 'bold and soft');
    assert.equal(plainLine('[the link](https://x)'), 'the link');
    // ⚠ A WRITER'S OWN EMOJI IS THEIR WRITING. Today's no-emoji rule is about the
    // house's chrome, not what someone puts in their poem.
    assert.equal(plainLine('THE SHAPE I BECAME🌺'), 'THE SHAPE I BECAME🌺');
  });

  test('a piece that is nothing but markers still shows something', () => {
    const o = openingOf('**I.**\n\n**II.**');
    assert.ok(o.lines.length > 0, 'an empty entry is worse than a marker');
  });

  test('junk never throws into a render', () => {
    for (const v of [null, undefined, '', '   ', '\n\n\n']) {
      const o = openingOf(v);
      assert.ok(Array.isArray(o.lines));
      assert.ok(o.kind === 'prose' || o.kind === 'verse');
    }
    assert.deepEqual(markdownBlocks(null), []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R40 · ⭐ THE PIECE’S SHAPE SETS THE ENTRY’S SHAPE', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ A POEM RENDERS AS VERSE AND PROSE DOES NOT', () => {
    for (const p of LIVE) {
      assert.equal(openingOf(p.body).kind, p.want, `${p.title} should be ${p.want}`);
    }
  });

  test('verse keeps its line breaks; prose runs as one line', () => {
    const poem = openingOf(LIVE[2].body);
    assert.equal(poem.kind, 'verse');
    assert.deepEqual(poem.lines, ['Somewhere between belonging and becoming,', 'I disappeared', 'from amongst the crowd.']);
    const prose = openingOf(LIVE[1].body);
    assert.equal(prose.lines.length, 1, 'prose is one running line, not a stack');
  });

  test('it reads the SHAPE, not the genre field', () => {
    // The genre is a label picked from a menu; the line breaks are what the writer
    // actually typed. A poem filed as General still reads as a poem.
    const misfiled = openingOf('Somewhere between belonging,\nI disappeared\nfrom the crowd.');
    assert.equal(misfiled.kind, 'verse');
    // And a prose piece filed as Poetry still reads as prose.
    const alsoMisfiled = openingOf('This is one long sentence of ordinary prose that simply keeps going and going without any line breaks at all.');
    assert.equal(alsoMisfiled.kind, 'prose');
  });

  test('the thresholds are the measured ones, and one line is never verse', () => {
    assert.equal(VERSE_MIN_LINES, 2);
    assert.equal(VERSE_MAX_AVG, 60);
    // Live poems average 26 and 34 characters a line; live prose blocks average 60,
    // 106, 416, 546 and 1,828. The gap is what makes a crude threshold safe.
    assert.equal(openingOf('A short line.').kind, 'prose', 'a single line is a sentence, however short');
  });

  test('prose is cut on a word boundary, and only when there is more to come', () => {
    const short = openingOf('Four words exactly here.');
    assert.equal(short.lines[0], 'Four words exactly here.');
    assert.equal(/…$/.test(short.lines[0]), false, 'an ellipsis on a complete opening lies about the length');
    const long = openingOf('word '.repeat(200));
    assert.ok(long.lines[0].endsWith('…'));
    assert.ok(long.lines[0].length <= 262);
  });

  test('reading time is whole minutes, floored at one', () => {
    assert.equal(readingTime('word '.repeat(200)), 1);
    assert.equal(readingTime('word '.repeat(1800)), 9);
    assert.equal(readingTime(''), 1, 'never zero minutes');
    assert.equal(readingTime(null), 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R40 · the entry, the plate, and what came off it', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ AN ENTRY WITH NO COVER IS COMPLETE, NOT BROKEN', () => {
    // The cover is the ONLY conditional thing in the entry, and nothing below it
    // changes when it is absent — no placeholder, no reserved band, no feather in a
    // grey box. Most pieces will never have one.
    const entry = feed.slice(feed.indexOf('function Entry('), feed.indexOf('function Avatar('));
    assert.match(entry, /\{post\.coverImage \? \(/);
    assert.match(entry, /\) : null\}/, 'no cover means NOTHING, not a placeholder');
    assert.equal(/aspectRatio: '16 \/ 9'.*linear-gradient/s.test(entry), false, 'the old empty-cover gradient is gone');
    // Everything a reader needs is outside that conditional.
    const afterPlate = entry.slice(entry.indexOf(') : null}'));
    for (const needed of ['genre', 'post.title', 'opening.kind', 'min read']) {
      assert.match(afterPlate, new RegExp(needed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('⭐ READING TIME IS IN, READ COUNT IS OUT', () => {
    // A read count on a young platform is a low number on every piece, so it
    // discourages the tap it exists to encourage. Reading time genuinely changes
    // whether someone taps.
    const entry = feed.slice(feed.indexOf('function Entry('), feed.indexOf('function Avatar('));
    assert.match(entry, /min read/);
    // ⚠ THE PIECE's read count, not the AUTHOR's. author.readCount is the writer's
    // island standing and feeds the badge — a different number with a different job,
    // and an assertion that cannot tell them apart fails on correct code.
    assert.equal(/post\.readCount/.test(entry), false, "the piece's read count must not come back");
    assert.equal(/likeCount|commentCount/.test(entry), false, 'nor the likes and comments');
    assert.match(entry, /getBadge\(author\?\.readCount/, "the author's standing is a different number and stays");
    // And the reads that fed those counts are gone too — not left running for nothing.
    assert.equal(/open_pages_reactions|get\(ref\(db, `comments\//.test(codeOf(feed)), false,
      'two reads per post for numbers nothing renders is fourteen requests a load');
  });

  test('the entry is a journal entry, not a card', () => {
    const entry = feed.slice(feed.indexOf('function Entry('), feed.indexOf('function Avatar('));
    assert.match(entry, /borderTop: first \? 'none' : '1px solid rgba\(245,240,232,0\.08\)'/, 'hairline separators');
    assert.equal(/borderRadius: 14|background: SURFACE\b/.test(entry), false, 'no card chrome');
    assert.match(entry, /fontFamily: CINZEL[^}]*textTransform: 'uppercase'[^}]*color: GOLD/, 'a Cinzel kicker in gold');
  });

  test("R36's edit mark is on the entry and reads updatedAt", () => {
    const entry = feed.slice(feed.indexOf('function Entry('), feed.indexOf('function Avatar('));
    assert.match(entry, /isEdited\(post\)/);
    assert.match(entry, /data-op-edited/);
    assert.match(entry, /marginLeft: 'auto'/, 'quietly at the right of the footer');
  });

  test('⭐ IDENTITY RESOLVES AT RENDER — the snapshot is the fallback', () => {
    const entry = feed.slice(feed.indexOf('function Entry('), feed.indexOf('function Avatar('));
    assert.match(entry, /author\?\.displayName \|\| post\.authorName/);
    assert.match(entry, /author\?\.username \|\| post\.authorHandle/);
    assert.match(feed, /s\.exists\(\) \? s\.val\(\) : null/, 'the whole user record is kept, not just the photo');
  });

  test('⭐ A PENDING PIECE NEVER APPEARS', () => {
    assert.match(feed, /p\.status === 'live'/);
    // And blocking never filters a piece — it is comment-only, by ruling.
    assert.equal(/blocked/i.test(codeOf(feed)), false, 'the feed must not know about blocking at all');
  });

  test('⭐ NO EMOJI IN THE TREE — the old feed shipped a 💬', () => {
    const ALLOWED = new Set(['❦', '✦', '︎']);
    for (const [i, line] of codeOf(feed).split('\n').entries()) {
      for (const ch of line) {
        const o = ch.codePointAt(0);
        const picto = (o >= 0x1F000 && o <= 0x1FAFF) || (o >= 0x2700 && o <= 0x27BF)
          || (o >= 0x2600 && o <= 0x26FF) || (o >= 0x2B00 && o <= 0x2BFF);
        if (picto && !ALLOWED.has(ch)) assert.fail(`feed:${i + 1} ships U+${o.toString(16).toUpperCase()}\n    ${line.trim().slice(0, 80)}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R40 · the standfirst and the empty state', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ THE STANDFIRST IS THE FIRST LINE ONLY', () => {
    const header = feed.slice(feed.indexOf('data-op-invitation'), feed.indexOf('data-op-invitation') + 700);
    assert.match(header, /INDEX_INVITATION\.line1/);
    assert.equal(/INDEX_INVITATION\.line2/.test(header), false,
      'the commissioning sentence comes off the feed — a weekly reader would meet it until it became wallpaper');
  });

  test('and the commissioning sentence moved TO the composer', () => {
    // The promise stays; the explanation moves to where it does work.
    const composer = readFileSync('app/open-pages/new/page.js', 'utf8');
    assert.match(composer, /INDEX_INVITATION\.line2/);
    assert.match(composer, /data-op-commissioning/);
  });

  test('⭐ THE EMPTY STATE MAKES THE ABSENCE THE OFFER', () => {
    const empty = feed.slice(feed.indexOf('function EmptyState('), feed.indexOf('function SkeletonGrid('));
    assert.match(empty, /Yours would be the first/);
    assert.match(empty, /We read everything published here/, 'the commitment survives an empty platform');
    assert.match(empty, /Write the first piece/);
    // "No stories yet" is a sentence whose whole content is an absence.
    assert.equal(/No stories yet/.test(empty), false);
    // ⚠ And it still promises attention, not outcome — a lottery ticket sold to
    // someone who can see the room is empty is the worst version of that mistake.
    for (const w of ['might', 'could', 'chance', 'commission', 'paid', 'money']) {
      assert.equal(new RegExp(w, 'i').test(empty.replace(/\/\/.*$/gm, '')), false, `the empty state must not say "${w}"`);
    }
  });

  test('the loading skeleton is a column of entries, not a grid of cards', () => {
    // A loading state that resolves into a different shape is a flash of the wrong
    // design — the thing a reader sees first is a lie about what is coming.
    const sk = feed.slice(feed.indexOf('function SkeletonGrid('));
    assert.equal(/cardGrid|gridTemplateColumns/.test(sk), false);
    assert.match(sk, /maxWidth: 720/);
    assert.match(sk, /prefers-reduced-motion/, 'the shimmer must stop for reduce motion');
  });

  test('the old card excerpt rule is gone, not left beside the new one', () => {
    // Two excerpt rules in one file is how a later round reaches for the wrong one.
    assert.equal(/function excerpt\(/.test(feed), false);
    assert.equal(/EXCERPT_LEN/.test(feed), false);
    assert.equal(/stripMarkdown/.test(codeOf(feed)), false);
  });
});
