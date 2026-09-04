// R38 — distribution: the row's position, the copy's promise, and the announcement.
//
// Three of these guard a decision rather than a function, which is the point: a
// position in a page and a sentence in a footer are exactly the things a later round
// changes without noticing it has changed them.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDEX_INVITATION, COMPOSER_NOTE, PUBLISHED_FOOTER, OUTCOME_WORDS } from '../../app/lib/openPagesCopy.js';
import { announcementText, buildAnnouncement, SQUARE_MAX, ANNOUNCE_TITLE_MAX } from '../../app/lib/openPagesAnnounce.js';

const read = (p) => readFileSync(p, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════
describe('R38 · the copy promises ATTENTION, not outcome', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  const ALL = [INDEX_INVITATION.line1, INDEX_INVITATION.line2, COMPOSER_NOTE, PUBLISHED_FOOTER];

  test('the three approved lines are exactly what Ikenna approved', () => {
    assert.equal(INDEX_INVITATION.line1, 'Anyone can write here. We read everything.');
    assert.equal(INDEX_INVITATION.line2, 'When a piece belongs in the house, we come and ask — that is how most of our contributors were found.');
    assert.equal(COMPOSER_NOTE, 'Published pieces are read by the editors.');
    assert.equal(PUBLISHED_FOOTER, 'Thank you for writing on the island. We read everything published here.');
  });

  test('⭐ NO LINE PROMISES AN OUTCOME — that is the whole distinction', () => {
    // "We read everything" is a commitment the house can keep every week forever.
    // "We might commission you" is a lottery ticket. If an "improvement" turns one
    // into the other, it fails here.
    for (const line of ALL) {
      for (const w of OUTCOME_WORDS) {
        assert.equal(line.toLowerCase().includes(w), false,
          `"${line}" contains "${w}" — that is a promise about outcome, not attention`);
      }
    }
  });

  test('the one outcome claim is in the PAST TENSE and about other people', () => {
    // "that is how most of our contributors WERE FOUND" is a fact about the island's
    // history, not an offer to the reader. Present tense would make it an offer.
    assert.match(INDEX_INVITATION.line2, /were found/);
    assert.equal(/will be found|you will|you could/i.test(INDEX_INVITATION.line2), false);
  });

  test('⭐ IT SAYS NOTHING ABOUT MONEY — Issue #6 patronage is not this round', () => {
    for (const line of ALL) {
      assert.equal(/£|\$|paid|payment|money|fee|earn|patron|salary|royalt/i.test(line), false,
        `"${line}" mentions money; the patronage promise is unresolved and not part of this copy`);
    }
  });

  test('each line is actually placed on its surface', () => {
    const index = read('app/open-pages/page.jsx');
    const composer = read('app/open-pages/new/page.js');
    const piece = read('app/open-pages/[id]/page-client.js');
    assert.ok(index.includes('INDEX_INVITATION'), 'the index must render the invitation');
    assert.ok(index.includes('data-op-invitation'));
    assert.ok(composer.includes('COMPOSER_NOTE'), 'the composer must render the note');
    assert.ok(composer.includes('data-op-composer-note'));
    assert.ok(piece.includes('PUBLISHED_FOOTER'), 'the piece footer must render the thank-you');
    assert.ok(piece.includes('data-op-footer-note'));
    // All three import from the ONE module, so the reasoning cannot be edited away in
    // one place and left standing in another.
    for (const [name, src] of [['index', index], ['composer', composer], ['piece', piece]]) {
      assert.match(src, /openPagesCopy/, `${name} must import the shared copy, not retype it`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R38 · ⭐ THE ROW SITS BELOW THE CATALOGUE AND ABOVE THE FURNITURE', () => {
// ═══════════════════════════════════════════════════════════════════════════════
//
// Asserted in BOTH directions, because the row has now been wrong in both.
//
// It was at the FOOT: measured live at 4,295px of 5,106px — 84.1% down, twelve
// headings above and none below, BELOW THE SUBSCRIBE BLOCK. A row a reader only
// reaches after passing the newsletter signup is not a row.
//
// R38 then over-corrected it ABOVE the genre rows, on the reading that Flash, Short
// and Poetry are filters over the catalogue rather than curation. Ikenna's ruling:
// those rows ARE the house's catalogue — the work it commissioned, edited and
// published — and Open Pages above them tells a reader the island values community
// writing more than its own published work. The 2026 ruling protects the house's
// published work, ALL of it.
//
// The settled position is between the two: below everything the house published,
// above the furniture. Not because Open Pages is lesser, but because it is the road
// INTO the house — which is the whole reasoning behind this round's copy.

  const src = read('app/public-library/page.js');
  const at = (needle) => { const i = src.indexOf(needle); assert.notEqual(i, -1, `not found: ${needle}`); return i; };
  const row = () => at('<OpenPagesRow />');

  test('⭐ BELOW every genre row — the house\'s catalogue outranks it', () => {
    for (const genre of ['Flash Fiction', 'Short Stories', 'Poetry', 'News & Updates', 'Inspiring Stories']) {
      assert.ok(row() > at(`title="${genre}"`), `${genre} is house-published work and must stay above Open Pages`);
    }
  });

  test('⭐ BELOW The Series and the Book Reader collection — also house-published', () => {
    assert.ok(row() > at('<SeriesRow />'), 'The Series is commissioned work');
    assert.ok(row() > at('title="Book Reader"'), 'the Collection is house-published');
  });

  test('⭐ ABOVE THE SUBSCRIBE BLOCK — this is the defect that started the round', () => {
    // At 84.1% it sat BELOW this. Everything else here is hierarchy; this one line is
    // the difference between a row and no row.
    assert.ok(row() < at('id="subscribe"'),
      'below the newsletter signup a reader never reaches it — that is how three months produced seven pieces');
  });

  test('and above the footer, so it is the last CONTENT rather than the last thing', () => {
    assert.ok(row() < at('{/* Footer */}'));
  });

  test('it is rendered exactly once', () => {
    assert.equal(src.split('<OpenPagesRow />').length - 1, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R38 · the Square announcement', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  const snap = { authorUid: 'u1', authorName: 'Akuma Chikere', authorHandle: 'akuma', authorAvatarUrl: 'https://x/a.jpg' };
  const NOW = 1_800_000_000_000;

  test('it names the piece and links to it', () => {
    const t = announcementText('The Outliers’ Mind', '-Oz6');
    assert.match(t, /New on Open Pages/);
    assert.match(t, /The Outliers/);
    assert.match(t, /calvaryscribblings\.co\.uk\/open-pages\/-Oz6/);
  });

  test('⭐ A 200-CHARACTER TITLE CANNOT PUSH THE POST PAST THE SQUARE CAP', () => {
    // 200 is the publish limit for a title, and 500 is the Square's rule-enforced cap
    // for a top-level post. Without truncation a legal title would produce an illegal
    // post, and the publish PATCH would be refused at the moment of going live.
    const t = announcementText('x'.repeat(200), '-OabcdefghijklmnopqrstuvwX');
    assert.ok(t.length <= SQUARE_MAX, `${t.length} > ${SQUARE_MAX}`);
    assert.ok(t.includes('…'), 'the title is truncated, and visibly');
    assert.equal(announcementText('short', '-Oabc').includes('…'), false, 'a short title is untouched');
  });

  test('it is not written in the first person — those are words the writer did not type', () => {
    const t = announcementText('A piece', '-Oabc');
    assert.equal(/\bI[' ]|\bI've\b|\bmy\b/i.test(t), false,
      'the writer did not type this; putting it in their mouth is what must not happen');
  });

  test('the record matches what a human post looks like, and is NEVER pinned', () => {
    const a = buildAnnouncement(snap, { readCount: 124, isAuthor: true }, { title: 'Enough', postId: '-Oy5', now: NOW });
    assert.equal(a.authorUid, 'u1');
    assert.equal(a.authorName, 'Akuma Chikere');
    assert.equal(a.authorInitials, 'AC');
    assert.equal(a.authorHandle, 'akuma');
    assert.equal(a.authorReadCount, 124);
    assert.equal(a.isAuthor, true);
    assert.equal(a.parentId, null);
    assert.equal(a.likeCount, 0);
    assert.equal(a.createdAt, NOW);
    // Under the horizon a pin confers permanence (R33.2). An automated post must never
    // be able to grant itself that.
    assert.equal(a.pinned, false);
    assert.equal(a.unpinnedAt, null);
  });

  test('a missing profile degrades rather than throwing', () => {
    const a = buildAnnouncement({ authorUid: 'u2', authorName: 'Reader' }, null, { title: 'T', postId: 'p', now: NOW });
    assert.equal(a.authorReadCount, 0);
    assert.equal(a.isAuthor, false);
    assert.equal(a.authorInitials, 'R');
    assert.equal(a.authorHandle, '');
  });

  test('the title cap leaves real room for the URL', () => {
    assert.ok(ANNOUNCE_TITLE_MAX < SQUARE_MAX - 100, 'the frame and the URL must always fit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R38 · ⭐ NOTHING UNSCREENED IS EVER DISTRIBUTED', () => {
// ═══════════════════════════════════════════════════════════════════════════════
//
// The round's hard constraint, driven through the REAL Pages Function with fetch
// stubbed — R36's pattern. A flagged or blocked submission must produce no Square post
// at all, and a published one must produce it in the SAME patch as the piece.

  let realFetch, state;
  const FB = 'https://db.example';
  const UID = 'writer-uid-1';

  function router(decision) {
    return async (url, opts = {}) => {
      const u = String(url), method = opts.method || 'GET';
      if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      if (u.includes('identitytoolkit.googleapis.com')) return new Response(JSON.stringify({ users: [{ localId: UID }] }), { status: 200 });
      if (u.includes('api.anthropic.com')) {
        return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'moderate_post', input: { decision, categories: [], reason: 'r' } }] }), { status: 200 });
      }
      if (u.startsWith(`${FB}/open_pages_rate/`)) {
        if (method === 'GET') return new Response(JSON.stringify([]), { status: 200, headers: { ETag: 'e' } });
        return new Response('{}', { status: 200 });
      }
      if (u.startsWith(`${FB}/users/`)) return new Response(JSON.stringify({ displayName: 'A Writer', username: 'aw', readCount: 7 }), { status: 200 });
      if (u.startsWith(`${FB}/open_pages/`)) return new Response(JSON.stringify(state.existing), { status: 200 });
      if (u === `${FB}/.json` && method === 'PATCH') { state.patches.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); }
      throw new Error(`unrouted: ${method} ${u}`);
    };
  }
  const post = async (body) => {
    const { onRequestPost } = await import('../../functions/api/open-pages/moderate.js');
    const { generateKeyPairSync } = await import('node:crypto');
    if (!state.key) state.key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
    return onRequestPost({
      env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'a@b.c', FIREBASE_PRIVATE_KEY: state.key, FIREBASE_DATABASE_URL: FB, ANTHROPIC_API_KEY: 'sk' },
      request: new Request('https://site/api/open-pages/moderate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body) }),
    });
  };
  const squareWrites = () => state.patches.flatMap((p) => Object.keys(p)).filter((k) => k.startsWith('square_posts/'));

  beforeEach(() => { realFetch = globalThis.fetch; state = { patches: [], existing: null, key: null }; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('⭐ A FLAGGED PIECE NEVER REACHES THE SQUARE', async () => {
    globalThis.fetch = router('flag');
    const res = await post({ title: 'Held', body: 'Something explicit.' });
    assert.equal((await res.json()).status, 'pending');
    assert.deepEqual(squareWrites(), [], 'a piece awaiting human review must not be announced');
    assert.ok(state.patches.every((p) => !Object.keys(p).some((k) => k.startsWith('open_pages/'))), 'and it is not on the public feed either');
  });

  test('⭐ A BLOCKED PIECE IS STORED NOWHERE AND ANNOUNCED NOWHERE', async () => {
    globalThis.fetch = router('block');
    const res = await post({ title: 'No', body: 'Harmful.' });
    assert.equal((await res.json()).status, 'rejected');
    assert.deepEqual(state.patches, [], 'nothing is written at all');
  });

  test('⭐ A PUBLISHED PIECE IS ANNOUNCED IN THE SAME PATCH AS THE PIECE', async () => {
    globalThis.fetch = router('pass');
    const res = await post({ title: 'Enough', body: 'Real writing.' });
    const data = await res.json();
    assert.equal(data.status, 'published');

    const patch = state.patches.find((p) => Object.keys(p).some((k) => k.startsWith('open_pages/')));
    assert.ok(patch, 'the piece was published');
    const sq = Object.keys(patch).filter((k) => k.startsWith('square_posts/'));
    assert.equal(sq.length, 1, 'exactly one announcement');
    // THE CONSTRAINT: same patch means the announcement cannot precede the piece.
    assert.ok(Object.keys(patch).some((k) => k === `open_pages/${data.postId}`),
      'the announcement and the piece are in ONE atomic write, so ordering cannot go wrong');
    const announcement = patch[sq[0]];
    assert.match(announcement.text, /Enough/);
    assert.match(announcement.text, new RegExp(data.postId.replace(/[-[\]]/g, '\\$&')));
    assert.equal(announcement.authorUid, UID, 'attributed to the verified uid, never a body-supplied one');
    assert.equal(announcement.pinned, false);
    assert.ok(announcement.text.length <= SQUARE_MAX);
    // And the per-author mirror is written with the same record the client writes.
    assert.ok(Object.keys(patch).some((k) => k.startsWith(`user_square_posts/${UID}/`)));
  });

  test('⭐ AN EDIT IS NOT ANNOUNCED — the room is told once, not per typo', async () => {
    globalThis.fetch = router('pass');
    state.existing = { authorUid: UID, title: 'Old', body: 'Old body.', createdAt: 1, status: 'live', moderation: { decision: 'pass', checkedAt: 1 } };
    const res = await post({ title: 'New', body: 'A rewritten body.', postId: '-Oabc' });
    assert.equal((await res.json()).status, 'published');
    assert.deepEqual(squareWrites(), [], 'R37 made editing cheap; an announcement per save would make the room a changelog');
  });

  test('the newsletter picker only ever offers LIVE pieces', () => {
    const src = read('app/admin/newsletter/page.js');
    assert.match(src, /p\.status === "live"/, 'a flagged piece must not be selectable for the digest');
    assert.match(src, /open_pages/, 'and Open Pages must actually be in the pool');
  });

  test('the digest links a piece to its own page, not to /stories/', () => {
    const digest = read('emails/WeeklyDigest.jsx');
    assert.match(digest, /block\.href \|\| `\/stories\/\$\{block\.slug\}`/, 'href with a backwards-compatible default');
    // Every rendered link goes through `href` now; the old hardcoded form is gone from
    // the JSX (the only remaining mention is the comment that explains the change).
    const jsxOnly = digest.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.equal(/siteUrl\}\/stories\//.test(jsxOnly), false, 'no hardcoded story path survives in the markup');
  });
});
