// W4 — the free week and the archive: the static half, the rebuild clock, the founder preview
// and GATE-01. (The policy itself — pinned clocks and the parity fixture — is
// tests/ci/story-access.test.mjs.)
//
//   node --test tests/ci/w4-gate.test.mjs          (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { GATE_ON_MS } from '../../app/lib/storyAccess.js';
import { buildInlinePlan, lockedForFirstPaint, lockScript, scriptSafeJson, BUILD_LOOKAHEAD_MS } from '../../app/lib/storyLock.js';
import { gatePreviewActive } from '../../app/lib/gatePreview.js';
import { FOUNDER_UIDS, isFounder } from '../../app/lib/founders.js';
import { planRemoval, isWithdrawnBook, objectOfUrl } from '../../scripts/gate01-remove-legacy-copies.mjs';
import { endingOf } from '../../scripts/check-built-gate.mjs';

const H = 3600000;
const DAY = 24 * H;
const at = (iso) => Date.parse(iso);
const prose = (publishedIso, over = {}) => ({ category: 'short', published: true, publishedAtMs: at(publishedIso), content: '<p>one</p>', ...over });

describe('THE BUILD — what a static page may carry', () => {
  test('before the switch, far from it: the full body, locking at the switch', () => {
    const p = buildInlinePlan(prose('2026-09-01T09:00:00Z'), at('2026-09-25T09:00:00Z'));
    assert.equal(p.inlineFull, true);
    assert.equal(p.lockAtMs, GATE_ON_MS);   // (previewLockAtMs: tests/ci/w4b-preview.test.mjs)
  });

  test('a build within the lookahead of the switch ships the PREVIEW of an old story', () => {
    const p = buildInlinePlan(prose('2026-09-01T09:00:00Z'), GATE_ON_MS - 2 * H);
    assert.equal(p.inlineFull, false, 'it would deploy after the switch carrying an archive body');
  });

  test('after the switch: this week\'s story is full and locks at its Sunday 23:59:59.999 + 1ms', () => {
    const p = buildInlinePlan(prose('2026-09-28T09:00:00Z'), at('2026-10-01T12:00:00Z'));
    assert.equal(p.inlineFull, true);
    assert.equal(new Date(p.lockAtMs).toISOString(), '2026-10-04T23:00:00.000Z');
  });

  test('after the switch: an archive story is the preview, always', () => {
    assert.equal(buildInlinePlan(prose('2026-09-20T09:00:00Z'), at('2026-10-01T12:00:00Z')).inlineFull, false);
  });

  test('a Sunday-evening build ships this week\'s story as the PREVIEW (it would deploy into Monday)', () => {
    const sundayLate = at('2026-10-04T21:30:00Z');   // 22:30 London
    assert.equal(buildInlinePlan(prose('2026-10-04T20:00:00Z'), sundayLate).inlineFull, false);
    assert.ok(BUILD_LOOKAHEAD_MS >= 2 * H);
  });

  test('poetry is full and never locks', () => {
    assert.deepEqual(buildInlinePlan(prose('2025-01-01T09:00:00Z', { category: 'poetry' }), at('2026-10-01T12:00:00Z')), { inlineFull: true, lockAtMs: null, previewLockAtMs: null });
  });
});

describe('THE PAGE\'S OWN REFUSAL — until the rebuild lands', () => {
  const initial = { content: '<p>WHOLE</p><p>ENDING</p>', contentIsPreview: false, lockAtMs: GATE_ON_MS, previewHtml: '<p>WHOLE</p>' };

  test('first render before the lock: the body; at the lock: the preview', () => {
    assert.equal(lockedForFirstPaint(initial, GATE_ON_MS - 1).content, initial.content);
    const locked = lockedForFirstPaint(initial, GATE_ON_MS);
    assert.equal(locked.content, '<p>WHOLE</p>');
    assert.equal(locked.contentIsPreview, true);
  });

  const run = (script, now) => {
    const el = { innerHTML: '<p>WHOLE</p><p>ENDING</p>', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const ctx = { document: { getElementById: (id) => (id === 'story-content' ? el : null) }, Date: { now: () => now } };
    vm.runInNewContext(script, ctx);
    return el;
  };

  test('the inline script swaps the body for the preview once past the lock — before paint', () => {
    const script = lockScript(GATE_ON_MS, '<p>WHOLE</p>');
    assert.equal(run(script, GATE_ON_MS - 1).innerHTML, '<p>WHOLE</p><p>ENDING</p>');
    const after = run(script, GATE_ON_MS);
    assert.equal(after.innerHTML, '<p>WHOLE</p>');
    assert.equal(after.attrs['data-locked-by-clock'], '1');
  });

  test('the preview cannot break out of its <script>', () => {
    const json = scriptSafeJson('</script><script>alert(1)</script><!--');
    assert.doesNotMatch(json, /<\/script|<!--/i);
  });

  test('the page emits it, and the client\'s first render uses the same preview', () => {
    const src = readFileSync('app/stories/[slug]/page-client.js', 'utf8');
    assert.match(src, /lockScript\(initialStory\.lockAtMs, tagSubheads\(initialStory\.previewHtml\)/);
    assert.match(src, /useState\(\(\) => lockedForFirstPaint\(initialStory, Date\.now\(\)/);
    const page = readFileSync('app/stories/[slug]/page.js', 'utf8');
    assert.match(page, /const plan = buildInlinePlan\(rec\);/);
    assert.doesNotMatch(page, /GATING_ENABLED/);
  });

  test('bodies come from /api/story, never from the cms_stories read', () => {
    const src = readFileSync('app/stories/[slug]/page-client.js', 'utf8');
    assert.match(src, /const \{ content: _publicBody, extractedText: _extracted, \.\.\.meta \} = snap\.val\(\);/);
  });
});

describe('THE REBUILD — after every London midnight, from the Worker', () => {
  const src = readFileSync('workers-external/calvary-newsletter.worker.js', 'utf8');
  const fnSrc = src.slice(src.indexOf('function isFirstTickAfterLondonMidnight'), src.indexOf('\n}\n', src.indexOf('function isFirstTickAfterLondonMidnight')) + 2);
  const isFirstTick = vm.runInNewContext(`(${fnSrc.replace('function isFirstTickAfterLondonMidnight', 'function f')})`, { Intl, Number });

  test('fires on the */15 tick at 00:00 London — in BST and in GMT — and on no other', () => {
    assert.equal(isFirstTick(new Date('2026-09-29T23:00:04Z')), true, 'launch day 00:00 BST — the switch');
    assert.equal(isFirstTick(new Date('2026-10-04T23:00:02Z')), true, 'Mon 5 Oct 00:00 BST');
    assert.equal(isFirstTick(new Date('2026-10-26T00:00:03Z')), true, 'Mon 26 Oct 00:00 GMT');
    for (const t of ['2026-09-29T23:15:02Z', '2026-09-29T22:45:00Z', '2026-10-25T23:00:00Z', '2026-10-26T00:15:01Z']) {
      assert.equal(isFirstTick(new Date(t)), false, t);
    }
  });

  test('the tick fires the deploy hook', () => {
    assert.match(src, /if \(published \|\| midnight\) await fireDeployHook\(env\);/);
  });
});

describe('THE FOUNDER PREVIEW — founders only, and it can only lock', () => {
  test('active only for a founder uid who turned it on', () => {
    assert.equal(gatePreviewActive(FOUNDER_UIDS[0], true), true);
    assert.equal(gatePreviewActive(FOUNDER_UIDS[0], false), false);
    assert.equal(gatePreviewActive('someReaderUid', true), false);
    assert.equal(gatePreviewActive(null, true), false);
  });
  test('the endpoints honour it only for a verified founder uid', () => {
    const story = readFileSync('functions/api/story.js', 'utf8');
    // W4b: both decide through previewInForce(), which is founders-only (tests/ci/w4b-preview).
    assert.match(story, /const forceGate = previewInForce\(\{ uid, requested: body\?\.previewGate === true, accountFlag, now \}\);/);
    const stream = readFileSync('functions/api/series/stream.js', 'utf8');
    assert.match(stream, /forceGate = previewInForce\(\{ uid: who,/);
    assert.equal(isFounder('XaG6bTGqdDXh7VkBTw4y1H2d2s82'), true);
    assert.equal(isFounder('anybodyElse'), false);
  });
});

describe('GATE-01 — the legacy public copies', () => {
  const NOW = at('2026-09-25T09:00:00Z');
  const stories = {
    'beta-princess': { published: false, readerMode: true, category: 'novel', epubUrl: 'https://x/o/epubs%2Fbp1.epub?alt=media', extractedText: 'T' },
    'live-book': { published: true, readerMode: true, epubUrl: 'https://x/o/epubs%2Flive.epub?alt=media', extractedText: 'T' },
    'scheduled': { published: false, category: 'short', publishAt: '2026-09-29T06:30:00Z', extractedText: '' },
    'hidden-news': { published: false, category: 'news', extractedText: 'N' },
    'scheduled-book': { published: false, readerMode: true, publishAt: '2026-10-02T06:30:00Z', extractedText: 'B' },
  };
  const objects = [{ name: 'epubs/bp1.epub' }, { name: 'epubs/live.epub' }, { name: 'epubs/orphan.epub' }];

  test('deletes every legacy object no PUBLISHED story uses; keeps a live book\'s', () => {
    const p = planRemoval(stories, objects, NOW);
    assert.deepEqual(p.deleteObjects.map((o) => o.name), ['epubs/bp1.epub', 'epubs/orphan.epub']);
    assert.deepEqual(p.keptObjects.map((o) => o.name), ['epubs/live.epub']);
  });
  test('strips text from WITHDRAWN BOOKS only — not a scheduled story, not hidden news, not a live book', () => {
    const p = planRemoval(stories, objects, NOW);
    assert.deepEqual(p.strippedRecords, ['beta-princess']);
    assert.deepEqual(Object.keys(p.fieldNulls).sort(), ['cms_stories/beta-princess/epubUrl', 'cms_stories/beta-princess/extractedText']);
    assert.equal(isWithdrawnBook(stories.scheduled, NOW), false);
    assert.equal(isWithdrawnBook(stories['scheduled-book'], NOW), false, 'a book scheduled to publish is not withdrawn');
  });
  test('reads an object path out of a download URL', () => {
    assert.equal(objectOfUrl('https://firebasestorage.googleapis.com/v0/b/b/o/epubs%2Fa%20b.epub?alt=media&token=t'), 'epubs/a b.epub');
  });
});

describe('the built-HTML scanner samples the BODY, not what is public on purpose', () => {
  test('an ending that is also the trailer quote is not sampled; a later-only run is', () => {
    const body = `<p>${'Opening words that start the story here. '.repeat(20)}</p><p>Middle part of the story goes on and on here.</p><p>He had simply never told her she would not be the bride</p>`;
    const e = endingOf(body, { trailerQuote: 'He had simply never told her she would not be the bride' });
    assert.ok(e && !'He had simply never told her she would not be the bride'.includes(e));
  });
});
