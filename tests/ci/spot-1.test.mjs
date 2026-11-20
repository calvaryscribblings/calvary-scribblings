// SPOT-1 (Ikenna's rulings, 20 Nov 2026) — every Spotlight is free to read, now and in future.
//
//   node --test tests/ci/spot-1.test.mjs          (npm run test:ci)
//
// A Spotlight is a News & Updates story filed under the 'Spotlight' subcategory. It is free to
// everyone, signed out included, the whole piece, at any age: the treatment poetry has. One
// predicate (isFreeByPolicy in app/lib/storyAccess.js) and every surface that shows a story locked
// or as a preview, proven here at its seam:
//
//   1. the rule: freeByPolicy / isGateable / policyGrantFor / grantFor (and the founder preview)
//   2. /api/story, the real handler with the network stubbed: full body, reason 'spotlight', and
//      no membership read for a signed-in reader
//   3. the static build: buildInlinePlan (the story page's only question), the first paint and
//      the inline lock script
//   4. the built-HTML check (scripts/check-built-gate.mjs) and the launch check's Free week row
//   5. the client: bodyOf / StoryGate's condition / NotFoundOrLiveStory / saving to My Library
//   6. the quiz endpoints carry no gate at all, so they cannot lock one
//   7. the taxonomy: the picker, /news's tab row, search, the push wording
//   8. /membership's line
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import {
  freeByPolicy, isFreeByPolicy, isSpotlight, isGateable, policyGrantFor, grantFor, GATE_ON_MS,
} from '../../app/lib/storyAccess.js';
import { buildInlinePlan, lockedForFirstPaint, lockScript, BUILD_LOOKAHEAD_MS } from '../../app/lib/storyLock.js';
import { classifyForCheck } from '../../scripts/check-built-gate.mjs';
import { judgeFreeWeek, pickFreeWeekSamples, GREEN, RED } from '../../scripts/launch-check.mjs';
import { SPOTLIGHT, SUBCATEGORIES, tabsFor, tabsPresentIn, inSubcategory } from '../../app/lib/taxonomy.js';
import { matchStories, subjectRuns } from '../../app/lib/searchIndex.js';
import { bodyOf } from '../../app/lib/story.js';
import { projectStory } from '../../app/lib/shelf.js';
import { formFor } from '../../scripts/push/forms.mjs';

const H = 3600000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-19T12:00:00Z');           // a Thursday, gate long on
const OLD = Date.parse('2025-03-01T09:00:00Z');           // archive by any measure
const THIS_WEEK = Date.parse('2026-11-17T09:00:00Z');     // Tuesday of NOW's London week
const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const story = (over = {}) => ({ category: 'news', subcategory: 'Spotlight', published: true, publishedAtMs: OLD, ...over });
const spotlight = story();
const culture = story({ subcategory: 'Culture' });
const poem = story({ category: 'poetry', subcategory: 'Love' });

// ── 1 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the rule', () => {
  test('free by policy: poetry and a Spotlight, nothing else', () => {
    assert.equal(freeByPolicy(poem), 'poetry');
    assert.equal(freeByPolicy(spotlight), 'spotlight');
    assert.equal(freeByPolicy(culture), null);
    assert.equal(freeByPolicy(story({ category: 'short' })), null, "'Spotlight' outside news is nothing");
    assert.equal(freeByPolicy(story({ subcategory: 'spotlight' })), null, 'the label is matched exactly');
    assert.equal(freeByPolicy(story({ subcategory: '' })), null);
    assert.equal(freeByPolicy(null), null);
    assert.equal(isFreeByPolicy(spotlight), true);
    assert.equal(isSpotlight(spotlight), true);
    assert.equal(isSpotlight(poem), false);
  });
  test('the predicate reads the taxonomy, not a second spelling', () => {
    assert.deepEqual({ ...SPOTLIGHT }, { category: 'news', subcategory: 'Spotlight' });
    assert.equal(src('app/lib/storyAccess.js').includes("'Spotlight'"), false);
  });
  test('a Spotlight is never gateable', () => {
    assert.equal(isGateable(spotlight), false);
    assert.equal(isGateable(culture), true);
  });
  test('full/spotlight signed out, for a member, this week and years old', () => {
    for (const [tier, at] of [['free', OLD], ['gold', OLD], ['platinum', OLD], ['free', THIS_WEEK]]) {
      const g = policyGrantFor(story({ publishedAtMs: at }), { tier, now: NOW });
      assert.equal(g.access, 'full', `${tier} ${at}`);
      assert.equal(g.reason, 'spotlight', `${tier} ${at}`);
    }
    assert.equal(policyGrantFor(culture, { now: NOW }).access, 'preview');
    assert.equal(policyGrantFor(culture, { now: NOW }).reason, 'archive');
  });
  test('a Spotlight with no parseable date is still full (the archive is not where it goes)', () => {
    const g = grantFor(story({ publishedAtMs: undefined, date: 'sometime' }), { now: NOW });
    assert.deepEqual([g.access, g.reason, g.freeUntilMs], ['full', 'spotlight', null]);
  });
  test('the founder preview cannot lock one either', () => {
    const g = grantFor(spotlight, { now: GATE_ON_MS - DAY, forceGate: true });
    assert.deepEqual([g.access, g.reason], ['full', 'spotlight']);
  });
  test('before the switch it read gating_off like everything else', () => {
    assert.equal(grantFor(spotlight, { now: GATE_ON_MS - 1 }).reason, 'gating_off');
  });
  test('reader-mode still wins: a book is served at /reader', () => {
    assert.equal(grantFor(story({ readerMode: true }), { now: NOW }).access, 'reader');
  });
  test('the parity fixture carries the SPOT-1 cases, version 2', () => {
    const fx = JSON.parse(src('app/lib/storyAccess.parity.json'));
    assert.equal(fx.version, 2);
    const spot = fx.cases.filter((c) => /^SPOT-1/.test(c.name));
    assert.equal(spot.length, 6);
    for (const c of spot) {
      assert.deepEqual(grantFor(c.story, { tier: c.tier, now: c.now }), c.expect, c.name);
    }
    const reasons = spot.map((c) => `${c.story.category}/${c.story.subcategory}/${c.tier}:${c.expect.access}/${c.expect.reason}`);
    assert.ok(reasons.includes('news/Spotlight/free:full/spotlight'));
    assert.ok(reasons.includes('news/Spotlight/gold:full/spotlight'));
    assert.ok(reasons.includes('news/Culture/free:preview/archive'));
    assert.ok(reasons.includes('short/Spotlight/free:preview/archive'));
  });
});

// ── 2 ───────────────────────────────────────────────────────────────────────────────────────
// The real handler, driven end to end with the network stubbed (the W4b harness's pattern).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'sa@x',
  FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), FIREBASE_DATABASE_URL: 'https://db.test',
};
const BODY = '<p>' + Array.from({ length: 12 }, (_, i) => `Paragraph ${i} of the piece, with enough words in it to be prose.`).join('</p><p>') + '</p>';
const SLUG = 'a-spotlight-piece';

async function askStory(record, { uid = null, membership = null } = {}) {
  const reads = [];
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  Date.now = () => NOW;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const ok = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'admin', expires_in: 3600 });
    if (u.includes('identitytoolkit.googleapis.com')) return ok({ users: [{ localId: uid }] });
    const path = u.replace('https://db.test/', '').replace(/\.json.*$/, '');
    reads.push(path);
    if (path === `cms_stories/${SLUG}`) return ok(record);
    if (path === `story_bodies/${SLUG}`) return ok({ content: BODY });
    if (path === `users/${uid}/membership`) return ok(membership);
    return ok(null);
  };
  try {
    const { onRequest } = await import('../../functions/api/story.js');
    const body = { slug: SLUG, client: 'web', ...(uid ? { idToken: 'tok' } : {}) };
    const res = await onRequest({ request: new Request('https://x/api/story', { method: 'POST', body: JSON.stringify(body) }), env: ENV });
    return { status: res.status, data: await res.json(), reads };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

describe('SPOT-1 · /api/story', () => {
  test('signed out: the whole piece, full/spotlight', async () => {
    const r = await askStory(spotlight);
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.access, r.data.reason], ['full', 'spotlight']);
    assert.equal(r.data.content, BODY);
    assert.equal(r.data.preview, undefined);
  });
  test('signed in, not a member: full, and no membership is read for it', async () => {
    const r = await askStory(spotlight, { uid: 'someReaderUid' });
    assert.deepEqual([r.data.access, r.data.reason], ['full', 'spotlight']);
    assert.ok(!r.reads.some((p) => p.includes('membership')), r.reads.join(', '));
  });
  test('the control: News · Culture of the same age is the archive preview', async () => {
    const r = await askStory(culture);
    assert.deepEqual([r.data.access, r.data.reason], ['preview', 'archive']);
    assert.equal(r.data.content, undefined);
  });
});

// ── 3 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the static story page', () => {
  test('the build inlines the whole piece and never locks it, at any age', () => {
    for (const at of [OLD, THIS_WEEK]) {
      assert.deepEqual(buildInlinePlan(story({ publishedAtMs: at }), NOW), { inlineFull: true, lockAtMs: null, previewLockAtMs: null });
    }
  });
  test('…even inside the lookahead of a Monday midnight, where this week\'s fiction would ship the preview', () => {
    const monday = Date.parse('2026-11-23T00:00:00Z');   // GMT: London midnight
    const buildAt = monday - BUILD_LOOKAHEAD_MS / 2;
    assert.equal(buildInlinePlan(story({ publishedAtMs: THIS_WEEK }), buildAt).inlineFull, true);
    assert.equal(buildInlinePlan(story({ subcategory: 'Culture', publishedAtMs: THIS_WEEK }), buildAt).inlineFull, false);
  });
  test('the control: an archive Culture piece ships the preview', () => {
    assert.equal(buildInlinePlan(culture, NOW).inlineFull, false);
  });
  test('the first paint keeps the whole piece, and there is no lock script to run', () => {
    const plan = buildInlinePlan(spotlight, NOW);
    const initial = { content: BODY, contentIsPreview: false, lockAtMs: plan.lockAtMs, previewLockAtMs: plan.previewLockAtMs, previewHtml: null };
    assert.equal(lockedForFirstPaint(initial, NOW + 365 * DAY, { preview: true }).content, BODY);
    assert.equal(lockScript(plan.lockAtMs, '<p>x</p>'), '', 'null is never, not the epoch');
    assert.equal(lockScript(undefined, '<p>x</p>'), '');
    assert.notEqual(lockScript(NOW, '<p>x</p>'), '', 'a real instant still locks');
    assert.match(src('app/stories/[slug]/page-client.js'), /\{initialStory\?\.lockAtMs && initialStory\?\.previewHtml != null && \(/);
  });
  test('the page builder asks buildInlinePlan and nothing else', () => {
    const page = src('app/stories/[slug]/page.js');
    assert.match(page, /const plan = buildInlinePlan\(rec\);/);
    assert.equal(/category === 'poetry'/.test(page), false);
  });
});

// ── 4 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the built-HTML check and the launch check', () => {
  test('check-built-gate skips a Spotlight (its page carries the whole piece by rule) and checks Culture', () => {
    assert.equal(classifyForCheck(spotlight, NOW), 'skip');
    assert.equal(classifyForCheck(poem, NOW), 'skip');
    assert.equal(classifyForCheck(culture, NOW), 'archive');
    assert.equal(classifyForCheck(story({ category: 'short', subcategory: 'Drama', publishedAtMs: THIS_WEEK }), NOW), 'free');
  });

  const res = (access, reason) => ({ status: 200, access, reason });
  const base = { archive: { slug: 'a', res: res('preview', 'archive') }, thisWeek: null, poem: { slug: 'p', res: res('full', 'poetry') } };
  test('Free week: a Spotlight answering full/spotlight is green', () => {
    const r = judgeFreeWeek({ ...base, spotlight: { slug: 's', res: res('full', 'spotlight') } }, NOW);
    assert.equal(r.status, GREEN);
    assert.match(r.evidence, /spotlight "s" → 200 full\/spotlight/);
  });
  test('Free week: a Spotlight answering anything else is red', () => {
    for (const bad of [res('preview', 'archive'), res('full', 'free_week'), { status: 502 }]) {
      assert.equal(judgeFreeWeek({ ...base, spotlight: { slug: 's', res: bad } }, NOW).status, RED, JSON.stringify(bad));
    }
  });
  test('Free week: no Spotlight filed yet says so and is not red', () => {
    const r = judgeFreeWeek({ ...base, spotlight: null }, NOW);
    assert.equal(r.status, GREEN);
    assert.match(r.evidence, /no story is filed as a Spotlight yet/);
    assert.equal(judgeFreeWeek(base, NOW).status, GREEN, 'a caller that never passes one');
  });
  test('the samples: the archive and this-week picks are never a Spotlight or a poem', () => {
    const index = {
      spot: story({ publishedAtMs: NOW - 2 * DAY }),
      spotOld: story({ publishedAtMs: OLD + DAY }),
      poem: { ...poem, publishedAtMs: NOW - 3 * DAY },
      fic: { category: 'short', subcategory: 'Drama', published: true, publishedAtMs: OLD },
      ficNew: { category: 'short', subcategory: 'Drama', published: true, publishedAtMs: THIS_WEEK },
    };
    const s = pickFreeWeekSamples(index, NOW);
    assert.equal(s.archiveRec.slug, 'fic');
    assert.equal(s.weekRec.slug, 'ficNew');
    assert.equal(s.poemRec.slug, 'poem');
    assert.equal(s.spotRec.slug, 'spot');
    // with only Spotlights in the archive, there is no archive sample rather than a Spotlight one
    assert.equal(pickFreeWeekSamples({ spotOld: index.spotOld }, NOW).archiveRec, null);
    // SPOT-1.1: only a LIVE Spotlight is ever the sample: never a scheduled one, even if indexed
    const future = { spotSoon: story({ publishedAtMs: NOW + DAY, publishAt: new Date(NOW + DAY).toISOString() }) };
    assert.equal(pickFreeWeekSamples({ ...index, ...future }, NOW).spotRec.slug, 'spot');
    assert.equal(pickFreeWeekSamples({ x: story({ publishedAtMs: NOW - DAY, publishAt: new Date(NOW + DAY).toISOString() }) }, NOW).spotRec, null);
    assert.equal(pickFreeWeekSamples({ x: story({ published: false, publishedAtMs: NOW - DAY }) }, NOW).spotRec, null);
    // the key wins over a stored slug field
    assert.equal(pickFreeWeekSamples({ fic: { ...index.fic, slug: 'other' } }, NOW).archiveRec.slug, 'fic');
  });
});

// ── 5 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the client', () => {
  const answer = { access: 'full', reason: 'spotlight', content: BODY };
  test('the story page and the 404 fallback take the whole body from a full/spotlight answer', () => {
    assert.equal(bodyOf(answer), BODY);
    // NotFoundOrLiveStory and page-client both mark a preview ONLY on access 'preview'
    assert.match(src('app/components/NotFoundOrLiveStory.js'), /contentIsPreview: data\.access === 'preview'/);
    assert.match(src('app/stories/[slug]/page-client.js'), /contentIsPreview: data\.access === 'preview'/);
  });
  test('the lock panel draws only for a preview, so a Spotlight never shows it', () => {
    assert.match(src('app/components/StoryGate.js'), /if \(!gate \|\| gate\.access !== 'preview'\) return null;/);
  });
  test('saving to My Library keeps the whole piece', () => {
    const rec = projectStory(SLUG, { ...spotlight, title: 't', content: BODY }, 'uid', {});
    assert.equal(rec.content, BODY);
    assert.equal(rec.subcategory, 'Spotlight');
  });
});

// ── 6 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the quiz endpoints carry no gate', () => {
  test('neither asks the access policy, so neither can lock a Spotlight', () => {
    for (const f of ['functions/api/generate-quiz.js', 'functions/api/evaluate-quiz.js', 'functions/api/_story-body.js', 'functions/api/record-attempt.js']) {
      const s = src(f);
      assert.equal(/grantFor|policyGrantFor|isGateable|freeByPolicy|freeUntilFor|tierAtLeast/.test(s), false, `${f} asks the access policy`);
      assert.equal(/category === 'poetry'/.test(s), false, `${f} keys on poetry`);
    }
  });
});

// ── 7 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · the taxonomy', () => {
  test("'Spotlight' is in News & Updates, straight after Culture, and nowhere else", () => {
    const news = SUBCATEGORIES.news;
    assert.equal(news[news.indexOf('Culture') + 1], 'Spotlight');
    for (const [cat, list] of Object.entries(SUBCATEGORIES)) if (cat !== 'news') assert.equal(list.includes('Spotlight'), false, cat);
  });
  test('the CMS picker offers it', () => {
    assert.ok(tabsFor('news').some((t) => t.value === 'Spotlight'));
    assert.match(src('app/admin/page.js'), /SUBCATEGORIES as SUBCATEGORY_MAP/);
  });
  test('/news draws its tab once a story is filed there, and not before', () => {
    assert.equal(tabsPresentIn('news', [culture]).some((t) => t.value === 'Spotlight'), false);
    assert.ok(tabsPresentIn('news', [culture, spotlight]).some((t) => t.value === 'Spotlight'));
    assert.equal(inSubcategory(spotlight, 'Spotlight'), true);
    assert.match(src('app/news/page.js'), /tabsPresentIn/);
  });
  test('search finds it by the word, and counts it as a subject', () => {
    const shelf = [{ title: 'unrelated', author: '', categoryName: '', subcategory: 'Spotlight', date: '' }, { title: 'x', author: '', categoryName: '', subcategory: '', date: '' }];
    assert.equal(matchStories(shelf, 'spotlight').length, 1);
    assert.ok(subjectRuns([spotlight]).some((r) => r.label === 'Spotlight'));
  });
  test('a push names it "New Spotlight by …" (ruled 20 Nov 2026, capital S: the column\'s name)', () => {
    assert.equal(formFor('news', 'Spotlight'), 'Spotlight');
  });
});

// ── 8 ───────────────────────────────────────────────────────────────────────────────────────
describe('SPOT-1 · /membership', () => {
  test("'What stays free' carries the line directly under the poetry one", () => {
    const page = src('app/membership/page.js');
    const poetry = page.indexOf('<p>All poetry is free. Always, and to everyone.</p>');
    const spot = page.indexOf('<p>Every Spotlight is free. Always, and to everyone.</p>');
    assert.ok(poetry > 0 && spot > poetry, 'both lines, poetry first');
    assert.match(page.slice(poetry, spot), /^<p>All poetry is free\. Always, and to everyone\.<\/p>\s*$/);
  });
});

// ── 9 ───────────────────────────────────────────────────────────────────────────────────────
// CLOCK-5's find: Actions logs are public, so nothing that runs there names a story that is not
// live. covers.yml echoed a hand-run's slug; on-publish.mjs listed held stories by slug.
describe('SPOT-1 · no unreleased slug in a public log', () => {
  test('logName: a live story by slug; held, scheduled, hidden or missing as "(not yet live)"', async () => {
    const { logName } = await import('../../scripts/covers/store.mjs');
    const now = Date.parse('2026-11-20T12:00:00Z');
    assert.equal(logName('live-one', { published: true }, now), 'live-one');
    assert.equal(logName('live-past', { published: true, publishAt: '2026-11-01T08:00:00Z' }, now), 'live-past');
    assert.equal(logName('held-one', { published: false, coverHold: true }, now), '(not yet live)');
    assert.equal(logName('scheduled', { published: true, publishAt: '2026-12-01T08:00:00Z' }, now), '(not yet live)');
    assert.equal(logName('gone', null, now), '(not yet live)');
  });
  test('on-publish.mjs prints no raw slug except for a story it has just found live', () => {
    const s = src('scripts/covers/on-publish.mjs');
    const raw = [...s.matchAll(/console\.(?:log|error)\(`[^`]*\$\{(?:a|entry)\.slug\}[^`]*`\)/g)].map((m) => m[0]);
    assert.deepEqual(raw.map((l) => /is live and correct/.test(l)), raw.map(() => true), `raw slug in: ${raw.join(' | ')}`);
    assert.equal(/\$\{only\}/.test(s), false, 'the hand-entered slug is echoed');
    assert.match(s, /skipped \(retired\): \$\{skippedRetired\.length\}/);
  });
  test('covers.yml never echoes the slug input', () => {
    const doc = src('.github/workflows/covers.yml');
    for (const line of doc.split('\n').filter((l) => /^\s*echo /.test(l))) {
      assert.equal(/\$IN_SLUG\b(?!:\+)|\$\{IN_SLUG\}|\$\{args\[\*\]\}|inputs\.slug/.test(line), false, line.trim());
    }
  });
  test('no workflow echoes a dispatch input that can carry a slug or a name', () => {
    const dir = new URL('../../.github/workflows/', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
      for (const line of readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => /^\s*echo /.test(l))) {
        assert.equal(/inputs\.(slug|name|title|uid|email)|\$IN_SLUG\b(?!:\+)|\$\{IN_SLUG\}/.test(line), false, `${f}: ${line.trim()}`);
      }
    }
  });
});
