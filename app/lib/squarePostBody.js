// THE SQUARE'S POST BODY — the contract. R43.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⭑ A SQUARE POST IS A CONVERSATION, NOT A PIECE OF WRITING
// ═══════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 4 Sep 2026. It is 500 characters in a room that clears every
// 48 hours. So it gets PARAGRAPHS AND NOTHING ELSE — no bold, no italic, no
// headings, no lists, no markdown rail, no formatting bar.
//
// ⚠ "ADD FORMATTING TO THE SQUARE" IS THE OBVIOUS NEXT REQUEST AND THE ANSWER IS
// ALREADY REASONED. The Open Pages composer (app/components/ComposerRail.js) is a
// WRITING SURFACE: a piece is long, it is kept, it is read once and carefully, and
// its author is composing something. Borrowing its idiom here would be borrowing
// the wrong one. Nobody bolds a sentence they are saying out loud to a room, and
// nothing in this room lives long enough to be worth typesetting. The rail is not
// missing from the Square; it is declined.
//
// What a conversation genuinely needs is the break between one thought and the
// next, which is the one thing this surface did not have.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⭑ NO LINKS, AT ALL
// ═══════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling. Not autolinked, not rendered as anchors, not "just for
// https://". A URL a reader types STAYS PLAIN TEXT.
//
// ⚠ THE REASON IS MODERATION CAPACITY, NOT TASTE. square_posts has NO RATE LIMIT
// and NO BLOCKING — neither exists on that node. Open Pages has both (R36), which
// is why a link is survivable there and is not here. A link is a moderation
// surface: it is the cheapest way to put something the house cannot see in front
// of readers, and the room has nothing to catch it with.
//
// ⚠ AND IT HELD BY ACCIDENT BEFORE THIS FILE EXISTED. Measured 4 Sep 2026: there
// is no autolinker anywhere in the repo and 0 of 118 live posts contain a URL, so
// the ruling cost nothing retroactively. But it held because nobody had written a
// linkifier yet, not because anything forbade one — and a surface that now renders
// paragraphs looks much more like a text renderer, which is exactly the invitation.
// So it is written down here: segmentsOf() emits 'text' and 'mention' and there is
// no third kind. Adding one is a decision to reverse a ruling.
//
// A HOUSE-AUTHORED link is a different object and is not affected. The Open Pages
// announcement carries an ATTACHMENT CARD (attachmentOf below), the same machinery
// the story embed already uses — a link the house wrote, rendered as a card,
// never a URL a reader typed. See app/lib/openPagesAnnounce.js.

// ── The cap ──────────────────────────────────────────────────────────────────
//
// R33.2's ruling, restated here because THIS is now the one source. It used to
// live in three places that happened to agree: app/square/page.js, this value in
// app/lib/openPagesAnnounce.js, and the .validate in database.rules.json. Two of
// them are code and now import from here; the third is the rules file, which
// cannot import, so `tests/square/postbody.test.mjs` reads the rules and asserts
// the numbers match rather than trusting them to stay in step.
//
// 500 for a post, 300 for a reply. A limit can be loosened and never tightened.
export const MAX_POST_CHARS = 500;
export const MAX_REPLY_CHARS = 300;

/** The cap that applies to a record, decided the way the RULES decide it. */
export function capFor({ isReply }) {
  return isReply ? MAX_REPLY_CHARS : MAX_POST_CHARS;
}

// The counter appears at 80% — 400 on a post, 240 on a reply — so a writer who
// never approaches the limit never sees it, and one who does gets about a
// sentence of warning. R33.2.
export const COUNTER_AT = 0.8;
export function showCounter(len, max) {
  return len >= Math.floor(max * COUNTER_AT);
}

/**
 * Is this text postable, and if not, why — in words a writer can act on.
 *
 * ⚠ EXISTS BECAUSE THE EDIT PATH HAD NO CAP AT ALL. Composing was guarded (a
 * counter, a disabled button); editing was not, on either textarea. The rules
 * allow an edit only if it is within the cap OR no longer than what was already
 * there, so growing an over-cap edit was refused SERVER-SIDE and the writer was
 * told nothing — an unhandled rejection and an editor that simply did not close.
 * All four inputs now ask this one function.
 */
export function refusalFor(text, { isReply = false, previousLength = null } = {}) {
  const max = capFor({ isReply });
  // .length, matching the rules' newData.val().length exactly — the same UTF-16
  // code units the server counts, not grapheme clusters. A client that counted
  // differently would refuse things the server allows, or worse, the reverse.
  const len = String(text ?? '').length;
  if (!String(text ?? '').trim()) return { ok: false, reason: 'empty', message: 'Nothing to post.' };
  if (len <= max) return { ok: true, reason: null, message: null };
  // The rules' second clause: an existing record may stay over the cap as long as
  // an edit does not make it longer. Mirrored so the client refuses exactly what
  // the server would, rather than a near-enough approximation of it.
  if (previousLength !== null && len <= previousLength) return { ok: true, reason: null, message: null };
  return {
    ok: false,
    reason: 'too-long',
    message: `${len - max} character${len - max === 1 ? '' : 's'} over. The Square holds ${max}.`,
  };
}

// ── Paragraphs ───────────────────────────────────────────────────────────────

/**
 * Split stored text into paragraphs.
 *
 * ⚠ ONE NEWLINE AND TWO ARE THE SAME BREAK, DELIBERATELY. Measured on the 118
 * live records: 17 carry a newline and 6 of those carry a blank line, and both
 * groups mean the same thing — "new thought". A reader typing Enter once and a
 * reader typing it twice are not making a typographic distinction in a 500
 * character message, so carrying one would render two posts differently for no
 * reason either author intended. Runs collapse; empty paragraphs never appear.
 *
 * The newlines were always STORED — nothing ever stripped them. They were simply
 * never rendered, on seven of the eight surfaces that draw a post. So this
 * function is what recovers the 17 records that are already correct.
 */
export function paragraphsOf(text) {
  return String(text ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Shorten for the quoted card, on a word boundary, before paragraphing. */
export function excerptOf(text, limit) {
  const s = String(text ?? '').trim();
  if (s.length <= limit) return s;
  return `${s.slice(0, limit).trimEnd()}…`;
}

// ── Mentions, and nothing else ───────────────────────────────────────────────
//
// The same expression renderMentions() has always used, moved here so every
// surface matches character for character rather than approximately.
export const MENTION_RE = /(^|\s)@([a-z0-9_]{3,20})\b/gi;

/** Where a mention points. The only href this module will ever produce. */
export function mentionHref(handle) {
  return `/user?handle=${handle}`;
}

/**
 * Cut one paragraph into drawable pieces.
 *
 * ⚠ THERE ARE EXACTLY TWO KINDS AND THAT IS THE NO-LINKS RULING IN CODE. 'text'
 * is drawn as text and 'mention' is drawn as an anchor to a reader's profile. A
 * URL inside a paragraph comes back as ordinary 'text' — it is never detected,
 * never marked, never turned into an anchor.
 */
export function segmentsOf(paragraph) {
  const text = String(paragraph ?? '');
  const out = [];
  const re = new RegExp(MENTION_RE.source, 'gi');
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, pre, handle] = m;
    const start = m.index + pre.length;
    const end = start + 1 + handle.length;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'mention', value: `@${handle}`, handle });
    last = end;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** The whole body, ready to draw: paragraphs of segments. */
export function bodyOf(text, { excerpt = null } = {}) {
  const source = excerpt ? excerptOf(text, excerpt) : text;
  return paragraphsOf(source).map(segmentsOf);
}

// ── The eight surfaces ───────────────────────────────────────────────────────
//
// ⚠ NAMED, NOT COUNTED. R33.2 found the Report button dead on one surface while
// the menu looked right, and R38 found a phase word wrong on the third of three
// banners a two-item census had missed. So the surfaces are an enumerated table
// with a key each, every draw site passes its key, and the test walks THIS OBJECT
// rather than a list somebody typed into a test file. A ninth surface that
// forgets to appear here cannot be drawn, because PostBody refuses a key it does
// not know.
//
// They differ in size and colour and in nothing else. One font, one paragraph
// rule, one mention rule, no links, everywhere.
export const BODY_FONT = 'Cormorant Garamond, Georgia, serif';

// ⚠ THE TOMBSTONE IS PART OF THE RENDERER, NOT OF EACH SITE. R33.2's docblock in
// app/square/page.js claimed "a withdrawn post renders as a tombstone" — and
// `withdrawn` was written there and read ZERO times, so the feed drew an avatar
// above an empty div. Only the permalink, written later, had the branch. Putting
// the branch in eight places again is how that happens twice, so it lives here:
// every surface gets it, in the same words, or none does.
const NOTE_POST  = 'The author withdrew this post. The replies below are not theirs to remove.';
const NOTE_SHORT = 'The author withdrew this post.';

export const SURFACES = {
  'feed-post':      { where: 'app/square/page.js — a post in the feed',                fontSize: '0.98rem', lineHeight: 1.68, color: '#f5f0e8', withdrawnNote: NOTE_POST },
  'feed-reply':     { where: 'app/square/page.js — a reply under a post',              fontSize: '0.92rem', lineHeight: 1.68, color: '#f5f0e8', withdrawnNote: 'The author withdrew this reply.' },
  'quoted-card':    { where: 'app/square/page.js — the quoted post card',              fontSize: '0.86rem', lineHeight: 1.55, color: 'rgba(255,255,255,0.65)', italic: true, excerpt: 100, withdrawnNote: NOTE_SHORT },
  'closed-preview': { where: 'app/square/page.js — "Last night in the Square"',        fontSize: '0.88rem', lineHeight: 1.6,  color: 'rgba(232,224,212,0.5)', withdrawnNote: NOTE_SHORT },
  'dm-bubble':      { where: 'app/square/page.js — a direct message bubble',           fontSize: '0.88rem', lineHeight: 1.6,  color: 'inherit', withdrawnNote: 'This message was withdrawn.' },
  'permalink':      { where: 'app/square/p/page.js — the permalink, root and replies', fontSize: '1rem',    lineHeight: 1.6,  color: 'rgba(245,240,232,0.86)', withdrawnNote: NOTE_POST },
  'profile-own':    { where: 'app/profile/page.js — your own posts',                   fontSize: '0.92rem', lineHeight: 1.7,  color: '#f0ece6', withdrawnNote: NOTE_SHORT },
  'profile-other':  { where: 'app/user/page.js — another reader\'s posts',             fontSize: '0.92rem', lineHeight: 1.7,  color: '#f0ece6', withdrawnNote: NOTE_SHORT },
};

export const SURFACE_KEYS = Object.keys(SURFACES);

// ── Attachments ──────────────────────────────────────────────────────────────
//
// ⭑ THE OPEN PAGES ANNOUNCEMENT IS A CARD, NOT A LINK. R43, Ikenna's ruling.
//
// The announcer used to write a bare URL into the post body. Under the no-links
// ruling that URL would render as dead text, and the announcement's whole purpose
// is to send someone to the piece — so it would have posted an unreachable
// pointer into the room. It has never fired, so nothing live was damaged; the
// first approved piece would have been the first broken one.
//
// A card is a link THE HOUSE AUTHORED. attachedStory already works exactly this
// way and is on 15 of the 118 live posts, so this is existing machinery rather
// than a new affordance, and the no-links ruling holds exactly: no reader link is
// ever rendered and the room gains no moderation surface.
//
// ⚠ AN OPEN PAGES PIECE IS NOT SHAPED LIKE A STORY. A story has a cover, a
// category and a separate author name; a piece has none of those reliably — it has
// a title, whoever wrote it, and an id. So the two are normalised HERE into one
// drawable shape and the card draws that, rather than the card learning about two
// record layouts.
export function attachmentOf(post) {
  const p = post || {};
  if (p.attachedOpenPage && p.attachedOpenPage.id) {
    const a = p.attachedOpenPage;
    return {
      kind: 'open-page',
      href: `/open-pages/${a.id}`,
      eyebrow: 'Open Pages',
      title: a.title || 'Untitled',
      byline: a.author ? `by ${a.author}` : null,
      cover: a.cover || null,
    };
  }
  if (p.attachedStory && (p.attachedStory.id || p.attachedStory.url)) {
    const a = p.attachedStory;
    return {
      kind: 'story',
      href: a.url || `/stories/${a.id}`,
      eyebrow: a.categoryName || 'Story',
      title: a.title || 'Untitled',
      byline: a.author ? `by ${a.author}` : null,
      cover: a.cover || null,
    };
  }
  return null;
}

// ── Images ───────────────────────────────────────────────────────────────────
//
// 🚨 canPostImages GRANTS A CAPABILITY THAT HAS NO SURFACE. DO NOT READ THE SWITCH
// AS "IMAGES WORK".
//
// Lane A (R33.2) shipped the switch and the admin control for it. The upload path
// WAS NEVER BUILT, and Lane B did not build it either: measured 4 Sep 2026 there is
// no image control in the composer, no `imageUrl` on any of the 118 live posts, no
// `square/` prefix in storage.rules, and no Function. The variable was computed in
// app/square/page.js and then never used again.
//
// The blocker is structural, not effort: STORAGE RULES CANNOT READ RTDB, so
// "allow the upload if users/{uid}/canPostImages is true" is not expressible as a
// storage rule and needs a Function to mint the write. That is its own round.
//
// Until then images are ungated BY ABSENCE — which looks identical to working, from
// the admin page, which is why this is written down where the code is.
export const IMAGES_NOT_IMPLEMENTED = true;
