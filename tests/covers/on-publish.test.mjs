// THE HOOK'S SUITE — the write layer and the design lock.
//
//   npm run covers:verify
//
// scripts/covers/on-publish.mjs runs unattended against the live library, so nothing here
// touches the network or Firebase. What IS tested is everything that decides WHAT gets
// written: the shape of the atomic patch, the index re-projection, the series refusal, the
// content-addressed path, and the lock that stops an unreviewed design reaching 158 covers.
//
// The reasons these are tested rather than trusted are all incidents. A deep-path index write
// once stubbed a record and dropped a story off its author's Voices page. A cover flipped
// without its coverSizes showed the old artwork everywhere a reader actually looks. Neither
// was caught by eye.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_PREFIX, SOURCE_NODE, WIDTHS,
  assertStoryScope, coverDir, coverFlipPaths, sha, sha12, urlPointsAt,
} from '../../scripts/covers/store.mjs';
import { PROBES, checkLock } from '../../scripts/covers/design-lock.mjs';

const STORY = {
  title: 'Odeluwa', author: 'Chimamanda Adichie', authorUid: 'uid-1', authorHandle: 'chimamanda',
  category: 'short', categoryName: 'Short Story', subcategory: 'Drama',
  date: 'Mar 29, 2026', published: true, url: '/stories/odeluwa',
  cover: 'https://old/artwork.png', coverHash: 'OLDHASH', coverSizes: { w360: 'https://old/360', w720: 'https://old/720' },
  content: '<p>one two three</p>', quizMeta: { hasQuiz: true, scribblesReward: 50, attemptCount: 17 },
};
const NEW = {
  cover: 'https://new/cover.png',
  coverSizes: { w360: 'https://new/360.webp', w720: 'https://new/720.webp' },
  coverHash: 'NEWHASH',
};

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE ATOMIC UNIT — six fields across two nodes, in one patch', async (t) => {
  await t.test('all three cover fields move together, never one without the others', () => {
    const paths = coverFlipPaths('odeluwa', STORY, NEW);
    // `cover` alone is only the srcset's top rung. coverSizes is what the grid, the cards,
    // the home page and the offline shelf actually render; coverHash is the blurhash painted
    // underneath. A patch carrying a subset ships a half-migrated story.
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/cover`], NEW.cover);
    assert.deepEqual(paths[`${SOURCE_NODE}/odeluwa/coverSizes`], NEW.coverSizes);
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/coverHash`], NEW.coverHash);
    for (const w of WIDTHS) assert.ok(paths[`${SOURCE_NODE}/odeluwa/coverSizes`][`w${w}`], `w${w} missing`);
  });

  await t.test('the index entry is RE-PROJECTED WHOLE — never a deep path', () => {
    const paths = coverFlipPaths('odeluwa', STORY, NEW);
    // THE INCIDENT: a deep path (`cms_stories_index/<slug>/cover`) CREATES the parent when
    // the slug has no entry, leaving a record with a cover and no title, no authorUid and no
    // date — a member of the index carrying nothing. That is how
    // cms_stories_index/your-money-cannot-save-you lost its authorUid and dropped a story off
    // its author's Voices page.
    const deep = Object.keys(paths).filter((k) => k.startsWith('cms_stories_index/') && k.split('/').length > 2);
    assert.deepEqual(deep, [], `deep index path(s) present: ${deep.join(', ')}`);

    const rec = paths['cms_stories_index/odeluwa'];
    assert.equal(typeof rec, 'object');
    assert.equal(rec.title, 'Odeluwa');
    assert.equal(rec.authorUid, 'uid-1');
    assert.equal(rec.authorHandle, 'chimamanda');
    assert.equal(rec.cover, NEW.cover);
    assert.deepEqual(rec.coverSizes, NEW.coverSizes);
    assert.equal(rec.coverHash, NEW.coverHash);
  });

  await t.test('the mutable attempt counter is never written back', () => {
    // record-attempt increments cms_stories/<slug>/quizMeta/attemptCount server-side. Reading
    // it and writing it back across an await silently reverses any increment landed in
    // between — one admin and one reader is enough.
    const paths = coverFlipPaths('odeluwa', STORY, NEW);
    const json = JSON.stringify(paths);
    assert.ok(!json.includes('attemptCount'), 'attemptCount must not appear anywhere in the patch');
    assert.deepEqual(paths['cms_stories_index/odeluwa'].quiz, { hasQuiz: true, scribblesReward: 50 });
  });

  await t.test('the patch touches EXACTLY two nodes and nothing else', () => {
    const nodes = new Set(Object.keys(coverFlipPaths('odeluwa', STORY, NEW)).map((k) => k.split('/')[0]));
    assert.deepEqual([...nodes].sort(), ['cms_stories', 'cms_stories_index']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE FIELDS THAT MUST NOT TRAVEL WITHOUT THE COVER', async (t) => {
  await t.test('the descriptor lands in the SAME patch as the cover that shows it', () => {
    // A record claiming "duty. sacrifice. ruin." over a cover printing no such words is a
    // story lying about itself on every surface that reads the record. The words and the
    // picture are one write or they are a window.
    const paths = coverFlipPaths('odeluwa', STORY, NEW, {
      descriptor: 'duty. sacrifice. ruin.', descriptorPending: null,
    });
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/descriptor`], 'duty. sacrifice. ruin.');
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/descriptorPending`], null, 'the queue must be drained by the same patch');
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/cover`], NEW.cover, 'and the cover moves with it');
  });

  await t.test('a held story is PUBLISHED by the patch that gives it a cover', () => {
    const held = { ...STORY, published: false, coverHold: true, cover: '', coverSizes: null, coverHash: '' };
    const paths = coverFlipPaths('odeluwa', held, NEW, { published: true, coverHold: null });
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/published`], true);
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/coverHold`], null);
    // And the index entry appears in the same instant — a published story with no index
    // record is invisible on every index-fed surface.
    assert.equal(paths['cms_stories_index/odeluwa'].published, true);
    assert.equal(paths['cms_stories_index/odeluwa'].cover, NEW.cover);
    assert.equal(paths['cms_stories_index/odeluwa'].title, 'Odeluwa');
  });

  await t.test('a SCHEDULED held story gets its cover WITHOUT being published early', () => {
    // The hold is about the cover, not the clock. Releasing a scheduled story's hold must not
    // publish it — that is the external scheduled-publish Worker's job, and doing it here
    // would put a story on the site days early. By the time the Worker flips it, the cover is
    // already there.
    const paths = coverFlipPaths('odeluwa', { ...STORY, published: false }, NEW, { coverHold: null });
    assert.equal(paths[`${SOURCE_NODE}/odeluwa/coverHold`], null, 'the hold is released');
    assert.ok(!(`${SOURCE_NODE}/odeluwa/published` in paths), 'publication is left exactly alone');
    assert.equal(paths['cms_stories_index/odeluwa'], null, 'and an unpublished story has no index entry');
  });

  await t.test('without extras, publication and the descriptor are left exactly alone', () => {
    const paths = coverFlipPaths('odeluwa', STORY, NEW);
    assert.ok(!(`${SOURCE_NODE}/odeluwa/published` in paths));
    assert.ok(!(`${SOURCE_NODE}/odeluwa/descriptor` in paths));
    assert.ok(!(`${SOURCE_NODE}/odeluwa/coverHold` in paths));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('SERIES IS OUT OF SCOPE BY RULING', async (t) => {
  // 18 Aug 2026: "Let Series be the only category that will explore actual arts." The story
  // library is typographic by rule; series covers are curated artwork by rule. A sweep that
  // "fixed" the Beta Princess poster would be reverting an editorial decision. The reconciler
  // runs unattended, so this is asserted rather than assumed.
  await t.test('a record carrying seriesId, instalmentId or ordinal is REFUSED', () => {
    for (const marker of [{ seriesId: 'beta-princess' }, { instalmentId: 'x' }, { ordinal: 1 }, { ordinal: 0 }]) {
      assert.throws(
        () => assertStoryScope('cms_stories', [{ slug: 'x', story: { title: 'T', ...marker } }]),
        /series instalments/,
        `${JSON.stringify(marker)} was not refused`,
      );
    }
  });

  await t.test('a source node other than cms_stories is REFUSED', () => {
    assert.throws(() => assertStoryScope('series_instalments', []), /may only read cms_stories/);
    assert.throws(() => assertStoryScope('series', []), /may only read cms_stories/);
  });

  await t.test('ordinary story records pass', () => {
    assert.doesNotThrow(() => assertStoryScope('cms_stories', [{ slug: 'odeluwa', story: STORY }]));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('CONTENT-ADDRESSED PATHS — the immutable promise stays honest', async (t) => {
  const png = Buffer.from('pretend this is a cover');
  const other = Buffer.from('a different cover');

  await t.test('the directory is the render\'s own hash', () => {
    assert.equal(coverDir('odeluwa', png), `${NEW_PREFIX}/odeluwa/${sha12(png)}`);
    assert.equal(sha12(png), sha(png).slice(0, 12));
  });

  await t.test('different bytes can never land on the same URL', () => {
    // The objects carry `cache-control: immutable, max-age=31536000`. That promise is only
    // honest if the bytes at a URL never change — overwriting would leave readers and the
    // Cloudflare edge holding the old cover for a year.
    assert.notEqual(coverDir('odeluwa', png), coverDir('odeluwa', other));
  });

  await t.test('identical bytes land on the identical path — which is how "no change" is known', () => {
    assert.equal(coverDir('odeluwa', png), coverDir('odeluwa', Buffer.from('pretend this is a cover')));
  });

  await t.test('urlPointsAt recognises a Firebase download URL for exactly that object', () => {
    const path = `${NEW_PREFIX}/odeluwa/abc123abc123/cover.png`;
    const url = `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(path)}?alt=media&token=t`;
    assert.ok(urlPointsAt(url, path));
    assert.ok(!urlPointsAt(url, `${NEW_PREFIX}/odeluwa/def456def456/cover.png`), 'a different generation must not match');
    assert.ok(!urlPointsAt(url, `${NEW_PREFIX}/odeluwa/abc123abc123/w360.webp`), 'a different object must not match');
    assert.ok(!urlPointsAt(undefined, path));
    assert.ok(!urlPointsAt('', path));
    // A story still wearing uploaded artwork must read as stale, not as current.
    assert.ok(!urlPointsAt('https://firebasestorage.googleapis.com/v0/b/b/o/covers%2F1787043476816_I.jpg?alt=media', path));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
test('THE DESIGN LOCK — what stops a robot shipping an unreviewed design', async (t) => {
  await t.test('the renderer matches the committed lock', () => {
    // If this fails, the DESIGN changed. That is allowed — but it has to be approved by
    // committing the new lock (npm run covers:lock) alongside the change, having looked at a
    // contact sheet. Until then scripts/covers/on-publish.mjs --apply refuses to run, which
    // is the whole point: the automatic path must not be weaker than the hand-run migration's
    // sign-off gate.
    const result = checkLock();
    assert.ok(result.ok, `design lock moved: ${JSON.stringify({ moved: result.moved.map((m) => m.slug), added: result.added, removed: result.removed })}`);
  });

  await t.test('the probe set still covers every surface a design change could move', () => {
    const slugs = PROBES.map((p) => p.slug);
    // Every livery, or a livery could be recoloured unnoticed.
    for (const k of ['short', 'poetry', 'flash', 'inspiring', 'news', 'series']) {
      assert.ok(slugs.includes(`probe-${k}`), `no probe for the ${k} livery`);
    }
    // Every rung, or a ladder size could move unnoticed.
    for (const size of [186, 140, 112, 92, 78, 68]) {
      assert.ok(slugs.includes(`probe-rung-${size}`), `no probe for the ${size}px rung`);
    }
    // The descriptor present AND absent — absence is a finished design, not a gap.
    assert.ok(slugs.includes('probe-descriptor'));
    assert.ok(slugs.includes('probe-no-descriptor'));
    // All three break rules, each of which has already shipped a defect once.
    for (const k of ['midword', 'hyphen', 'widow']) {
      assert.ok(slugs.includes(`probe-break-${k}`), `no probe for the ${k} break rule`);
    }
  });

  await t.test('the probes are fully specified — a lock must not depend on live data', () => {
    // The contact sheet fetches most of its cases from cms_stories over the network, so its
    // hash moves whenever an editor fixes a typo in a title. A lock that breaks on an
    // unrelated copy-edit is a lock people learn to force.
    for (const p of PROBES) {
      assert.ok(p.slug, 'a probe with no slug');
      assert.ok(String(p.title ?? '').trim(), `${p.slug} has no title`);
      assert.ok('author' in p, `${p.slug} has no author`);
    }
  });
});
