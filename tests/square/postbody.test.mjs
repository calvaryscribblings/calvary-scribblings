// R43 — THE SQUARE'S POST BODY, RENDERED RATHER THAN ASSERTED ABOUT.
//
// The requirement for this round was that a post with newlines renders as separate
// paragraphs on EACH of the eight surfaces, named individually rather than as a set.
// So these tests put real markup through react-dom/server and read the <p> elements
// back, one named test per surface, rather than grepping for `pre-wrap`.
//
// Two things make that possible and both are deliberate:
//   • app/components/conversation/PostBody.js is written with React.createElement and
//     no JSX, so a node --test file can import it directly.
//   • the eight surfaces are an enumerated table (SURFACES) that the DRAW SITES key
//     into, so this file walks the table rather than a list somebody typed here —
//     which is what R33.2 (a dead Report button on one surface) and R38 (a wrong word
//     on the third of three banners) each got caught by.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PostBody from '../../app/components/conversation/PostBody.js';
import AttachmentCard from '../../app/components/conversation/AttachmentCard.js';
import {
  SURFACES, SURFACE_KEYS, MAX_POST_CHARS, MAX_REPLY_CHARS,
  paragraphsOf, segmentsOf, refusalFor, showCounter, attachmentOf, capFor,
} from '../../app/lib/squarePostBody.js';
import { buildAnnouncement, announcementText } from '../../app/lib/openPagesAnnounce.js';
import { identityOf } from '../../app/lib/squareIdentity.js';

const render = (el) => renderToStaticMarkup(el);
const paras = (html) => [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);

// A real one, near enough: this is the shape of -OuY_pBjpGIo, live in the Square,
// four lines that rendered as one run-on line on seven of these eight surfaces.
const FOUR_LINES = "Hello everyone\nHow are y'all doing\nPls can anyone explain what the group is about\nI joined today";
const BLANK_LINE = 'building the app now. day 5 of react native.\n\n#storyislandapp';

// ── ONE NAMED TEST PER SURFACE ───────────────────────────────────────────────
describe('paragraphs render on each of the eight surfaces, named', () => {
  for (const key of SURFACE_KEYS) {
    test(`${key} — ${SURFACES[key].where}`, () => {
      const html = render(createElement(PostBody, { text: FOUR_LINES, surface: key }));
      const p = paras(html);

      // The quoted card is the one surface that excerpts, so it gets fewer
      // paragraphs from the same text — but it must still get MORE THAN ONE, which
      // is the whole point, and its first line must be intact.
      if (SURFACES[key].excerpt) {
        assert.ok(p.length >= 2, `${key}: excerpt collapsed to ${p.length} paragraph(s)`);
      } else {
        assert.equal(p.length, 4, `${key}: expected 4 paragraphs, got ${p.length}`);
        assert.match(p[3], /I joined today/);
      }
      assert.match(p[0], /Hello everyone/);
      assert.ok(!/Hello everyone[\s\S]*How are/.test(p[0]), `${key}: two lines ran together in one paragraph`);
      assert.match(html, new RegExp(`data-postbody="${key}"`));
    });
  }

  test('a blank line and a single newline produce the same break', () => {
    for (const key of SURFACE_KEYS) {
      const html = render(createElement(PostBody, { text: BLANK_LINE, surface: key }));
      assert.equal(paras(html).length, 2, `${key}: blank-line post did not split`);
    }
  });

  test('a one-paragraph post still renders exactly one paragraph, flush', () => {
    const html = render(createElement(PostBody, { text: 'just one line', surface: 'feed-post' }));
    assert.equal(paras(html).length, 1);
    assert.match(html, /margin:0/);
  });

  test('an unregistered surface throws rather than drawing unformatted', () => {
    assert.throws(() => render(createElement(PostBody, { text: 'x', surface: 'nope' })), /unknown surface/);
  });
});

// ── NO LINKS ─────────────────────────────────────────────────────────────────
describe('a URL is text and never an anchor', () => {
  const WITH_URL = 'read this https://example.com/thing and also www.example.com now';

  for (const key of SURFACE_KEYS) {
    test(`${key} renders no anchor for a URL`, () => {
      const html = render(createElement(PostBody, { text: WITH_URL, surface: key }));
      assert.ok(!/<a[^>]*href="http/i.test(html), `${key}: autolinked an http URL`);
      assert.ok(!/<a[^>]*href="[^"]*example\.com/i.test(html), `${key}: linked example.com`);
      assert.match(html, /example\.com/, `${key}: dropped the URL text entirely`);
    });
  }

  test('segmentsOf emits exactly two kinds, and a URL is the text kind', () => {
    const kinds = new Set(segmentsOf(WITH_URL).map((s) => s.type));
    assert.deepEqual([...kinds], ['text']);
    for (const seg of segmentsOf('hi @ada see https://example.com')) {
      assert.ok(seg.type === 'text' || seg.type === 'mention', `a third segment kind appeared: ${seg.type}`);
    }
  });

  test('a mention IS an anchor, and points at the reader', () => {
    const html = render(createElement(PostBody, { text: 'thanks @ada\nand @byokpara', surface: 'feed-post' }));
    assert.match(html, /href="\/user\?handle=ada"/);
    assert.match(html, /href="\/user\?handle=byokpara"/);
    assert.equal(paras(html).length, 2);
  });

  test('a mention renders on the permalink and the DM too — they had none before', () => {
    for (const key of ['permalink', 'dm-bubble']) {
      assert.match(render(createElement(PostBody, { text: 'hi @ada', surface: key })), /href="\/user\?handle=ada"/);
    }
  });

  test('an email address and a bare domain are not linked either', () => {
    const html = render(createElement(PostBody, { text: 'mail me at ada@example.com or calvaryscribblings.co.uk', surface: 'feed-post' }));
    assert.ok(!/<a /.test(html), 'something in a bare address became an anchor');
  });
});

// ── THE CAP ──────────────────────────────────────────────────────────────────
describe('the cap equals the rules, on all four inputs', () => {
  const rules = JSON.parse(readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8'));
  const textRule = rules.rules.square_posts.$postId.text['.validate'];

  test('the rules file still expresses the caps this module hardcodes', () => {
    // The rules cannot import, so the numbers are read back out of the expression
    // rather than trusted to stay in step. R43: they were in three places.
    const found = [...textRule.matchAll(/\b(\d{3})\b/g)].map((m) => Number(m[1]));
    assert.ok(found.includes(MAX_POST_CHARS), `rules do not mention ${MAX_POST_CHARS}`);
    assert.ok(found.includes(MAX_REPLY_CHARS), `rules do not mention ${MAX_REPLY_CHARS}`);
    assert.match(textRule, /parentId/, 'the rules no longer split post vs reply by parentId');
  });

  test('capFor picks the same branch the rules do', () => {
    assert.equal(capFor({ isReply: false }), 500);
    assert.equal(capFor({ isReply: true }), 300);
  });

  test('compose: at the cap passes, one over is refused with a number', () => {
    assert.equal(refusalFor('a'.repeat(500)).ok, true);
    const no = refusalFor('a'.repeat(501));
    assert.equal(no.ok, false);
    assert.match(no.message, /1 character over/);
    assert.match(no.message, /500/);
  });

  test('reply: 300 is the cap, and the message says 300', () => {
    assert.equal(refusalFor('a'.repeat(300), { isReply: true }).ok, true);
    assert.match(refusalFor('a'.repeat(302), { isReply: true }).message, /2 characters over. The Square holds 300\./);
  });

  test('EDIT: an over-cap record may be shortened but never grown — the rules\' second clause', () => {
    // This is the exact case that used to fail silently: the client let it through,
    // the server refused it, and nothing was shown.
    const stored = 'a'.repeat(600);
    assert.equal(refusalFor('a'.repeat(590), { previousLength: stored.length }).ok, true, 'shortening an over-cap post must be allowed');
    assert.equal(refusalFor('a'.repeat(601), { previousLength: stored.length }).ok, false, 'growing an over-cap post must be refused');
    assert.equal(refusalFor('a'.repeat(600), { previousLength: stored.length }).ok, true, 'an unchanged over-cap post must be allowed');
  });

  test('an empty edit is refused, and says so rather than returning silently', () => {
    const no = refusalFor('   ');
    assert.equal(no.ok, false);
    assert.equal(no.reason, 'empty');
    assert.ok(no.message);
  });

  test('the counter arrives at 80% and not before', () => {
    assert.equal(showCounter(399, 500), false);
    assert.equal(showCounter(400, 500), true);
    assert.equal(showCounter(239, 300), false);
    assert.equal(showCounter(240, 300), true);
  });
});

// ── THE QUOTED CARD'S IDENTITY ───────────────────────────────────────────────
describe('the quoted card reads the live record, not the stored copy', () => {
  const quoted = {
    authorUid: 'u1', authorName: 'Old Name', authorHandle: 'oldhandle',
    authorReadCount: 4, authorAvatarUrl: null, isAuthor: false, text: 'quoted words',
  };

  test('the badge number changes when the LIVE record changes', () => {
    const before = identityOf(quoted, { displayName: 'Ada Okonkwo', username: 'ada', readCount: 124 });
    const after  = identityOf(quoted, { displayName: 'Ada Okonkwo', username: 'ada', readCount: 190 });
    assert.equal(before.readCount, 124);
    assert.equal(after.readCount, 190);
    assert.notEqual(before.readCount, quoted.authorReadCount);
  });

  test('and does NOT change when the stored copy changes', () => {
    const live = { displayName: 'Ada Okonkwo', username: 'ada', readCount: 190 };
    const a = identityOf({ ...quoted, authorReadCount: 4 }, live);
    const b = identityOf({ ...quoted, authorReadCount: 999 }, live);
    assert.equal(a.readCount, b.readCount, 'the stored copy is still leaking into the badge');
    assert.equal(a.readCount, 190);
  });

  test('the name and handle come from the live record too', () => {
    const id = identityOf(quoted, { displayName: 'Ada Okonkwo', username: 'ada', readCount: 190 });
    assert.equal(id.displayName, 'Ada Okonkwo');
    assert.equal(id.handle, 'ada');
  });

  test('and fall back to the stored copy when the reader is gone', () => {
    const id = identityOf(quoted, null);
    assert.equal(id.displayName, 'Old Name');
    assert.equal(id.readCount, 4);
    assert.equal(id.stale, true);
  });
});

// ── THE TOMBSTONE ────────────────────────────────────────────────────────────
describe('a withdrawn post draws a tombstone, on every surface', () => {
  for (const key of SURFACE_KEYS) {
    test(`${key} draws the tombstone rather than an empty div`, () => {
      const html = render(createElement(PostBody, { text: '', surface: key, withdrawn: true }));
      assert.match(html, /data-withdrawn="true"/, `${key}: no tombstone marker`);
      assert.match(html, /withdr/i, `${key}: tombstone had no words in it`);
      assert.ok(html.replace(/<[^>]*>/g, '').trim().length > 10, `${key}: tombstone rendered empty`);
    });
  }

  test('the feed says the replies are not the withdrawer\'s to remove', () => {
    const html = render(createElement(PostBody, { text: '', surface: 'feed-post', withdrawn: true }));
    assert.match(html, /replies below are not theirs to remove/);
  });

  test('a withdrawn record does not leak its old text', () => {
    const html = render(createElement(PostBody, { text: 'the words that were withdrawn', surface: 'feed-post', withdrawn: true }));
    assert.ok(!html.includes('the words that were withdrawn'));
  });
});

// ── THE ANNOUNCEMENT CARD ────────────────────────────────────────────────────
describe('the Open Pages announcement is a card, not a link', () => {
  const snapshot = { authorUid: 'u9', authorName: 'Ada Okonkwo', authorHandle: 'ada', authorAvatarUrl: null };
  const profile = { readCount: 190, isAuthor: true };
  const built = buildAnnouncement(snapshot, profile, { title: 'The long walk home', postId: '-OpenPg123', now: 1_700_000_000_000 });

  test('the body carries NO URL at all', () => {
    assert.ok(!/https?:\/\//.test(built.text), `announcement body still contains a URL: ${built.text}`);
    assert.ok(!/calvaryscribblings/.test(built.text));
    assert.match(built.text, /New on Open Pages/);
    assert.match(built.text, /The long walk home/);
  });

  test('and the destination is an attachment instead', () => {
    assert.equal(built.attachedOpenPage.id, '-OpenPg123');
    assert.equal(built.attachedOpenPage.title, 'The long walk home');
    assert.equal(built.attachedOpenPage.author, 'Ada Okonkwo');
  });

  test('the card RENDERS for a piece — which is not shaped like a story', () => {
    const att = attachmentOf(built);
    assert.equal(att.kind, 'open-page');
    const html = render(createElement(AttachmentCard, { attachment: att }));
    assert.match(html, /data-attachment="open-page"/);
    assert.match(html, /href="\/open-pages\/-OpenPg123"/);
    assert.match(html, /The long walk home/);
    assert.match(html, /by Ada Okonkwo/);
    assert.match(html, /Open Pages/);           // the eyebrow, since a piece has no category
  });

  test('and still renders for a story, which has a cover and a category', () => {
    const att = attachmentOf({ attachedStory: { id: 'safety-net', title: 'Safety Net', author: 'A. Chikere', categoryName: 'Fiction', cover: '/c.webp' } });
    assert.equal(att.kind, 'story');
    const html = render(createElement(AttachmentCard, { attachment: att }));
    assert.match(html, /href="\/stories\/safety-net"/);
    assert.match(html, /Fiction/);
    assert.match(html, /src="\/c\.webp"/);
  });

  test('a post with no attachment renders nothing at all', () => {
    assert.equal(attachmentOf({ text: 'hi' }), null);
    assert.equal(render(createElement(AttachmentCard, { attachment: null })), '');
  });

  test('the announcement still fits the Square, title truncation included', () => {
    const long = buildAnnouncement(snapshot, profile, { title: 'x'.repeat(400), postId: '-p', now: 1 });
    assert.ok(long.text.length <= MAX_POST_CHARS, `announcement is ${long.text.length} chars`);
    assert.equal(refusalFor(long.text).ok, true);
  });

  test('announcementText takes the title alone now — the postId is the card\'s', () => {
    assert.ok(!announcementText('A title').includes('http'));
  });

  test('an announcement is never pinned — it cannot grant itself permanence', () => {
    assert.equal(built.pinned, false);
  });
});

// ── THE CENSUS ITSELF ────────────────────────────────────────────────────────
describe('every surface has a draw site and every draw site has a surface', () => {
  const FILES = [
    'app/square/page.js',
    'app/square/p/page.js',
    'app/profile/page.js',
    'app/user/page.js',
  ];
  const source = FILES.map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');

  test('there are exactly eight registered surfaces', () => {
    assert.equal(SURFACE_KEYS.length, 8, `the table has ${SURFACE_KEYS.length} surfaces, not 8`);
  });

  for (const key of SURFACE_KEYS) {
    test(`${key} is actually drawn somewhere`, () => {
      assert.match(source, new RegExp(`surface="${key}"`), `${key} is registered but nothing draws it`);
    });
  }

  test('no draw site names a surface the table does not know', () => {
    for (const m of source.matchAll(/surface="([a-z-]+)"/g)) {
      assert.ok(SURFACE_KEYS.includes(m[1]), `a draw site uses unregistered surface "${m[1]}"`);
    }
  });

  test('no Square surface still hand-rolls a body with pre-wrap or renderMentions', () => {
    assert.ok(!/whiteSpace: 'pre-wrap'[\s\S]{0,80}\.text\}/.test(source), 'a hand-rolled pre-wrap body survived');
    assert.ok(!/renderMentions\(/.test(source), 'a surface still calls renderMentions directly instead of PostBody');
  });

  test('the dead cleanup route is gone', () => {
    assert.throws(() => readFileSync(new URL('../../app/api/square-cleanup/route.js', import.meta.url)), /ENOENT/);
  });
});

// ── THE CONTRACT, WITHOUT REACT ──────────────────────────────────────────────
describe('paragraphsOf', () => {
  test('collapses runs and never yields an empty paragraph', () => {
    assert.deepEqual(paragraphsOf('a\n\n\n\nb'), ['a', 'b']);
    assert.deepEqual(paragraphsOf('\n\na\n'), ['a']);
    assert.deepEqual(paragraphsOf('   '), []);
    assert.deepEqual(paragraphsOf(null), []);
  });

  test('handles CRLF, which a paste from Windows brings in', () => {
    assert.deepEqual(paragraphsOf('a\r\nb\rc'), ['a', 'b', 'c']);
  });

  test('the 17 live newline records all gain at least one break', () => {
    // Shapes taken from the live census on 4 Sep 2026.
    for (const t of [FOUR_LINES, BLANK_LINE, 'Heloooooo\nI\'m new', '"small permissions"\nMehn, I can\'t even talk.']) {
      assert.ok(paragraphsOf(t).length >= 2, `did not split: ${JSON.stringify(t)}`);
    }
  });
});
