// W4b — the founder preview, made to hold on Ikenna's iPad.
//
// W4 kept the preview in one browser's localStorage and the story page's pre-paint lock read only
// the clock. So a story page painted the whole body and waited on a round-trip to take it back,
// and any page whose storage was not the /admin page's (a Home Screen copy of the site, another
// browser, another device) never locked at all. Now: the flag lives on the account and the
// endpoints read it themselves; the pre-paint lock also locks from the end of the story's week
// when the local copy is set; and the preview is the NON-MEMBER view.
//
//   node --test tests/ci/w4b-preview.test.mjs          (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import vm from 'node:vm';

import { GATE_ON_MS } from '../../app/lib/storyAccess.js';
import { buildInlinePlan, lockedForFirstPaint, lockScript, GATE_PREVIEW_STORAGE_KEY } from '../../app/lib/storyLock.js';
import { GATE_PREVIEW_KEY } from '../../app/lib/gatePreview.js';
import { previewInForce, founderPreviewPath } from '../../app/lib/gatePreviewPolicy.js';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

const at = (iso) => Date.parse(iso);
const NOW = at('2026-09-25T10:00:00Z');                  // the day Ikenna walked it
const FOUNDER = FOUNDER_UIDS[0];
const prose = (publishedIso, over = {}) => ({ category: 'short', published: true, publishedAtMs: at(publishedIso), content: '<p>one</p>', ...over });
const TROUBLE = prose('2026-09-18T09:00:00Z');           // trouble-shooting: last week → archive
const TILL = prose('2026-09-22T09:00:00Z');              // till-debt-do-us-part: this week → free

describe('W4b · the policy — founders only, either flag, and nothing after the switch', () => {
  test('the account flag alone turns it on (the page\'s browser need not know)', () => {
    assert.equal(previewInForce({ uid: FOUNDER, requested: false, accountFlag: true, now: NOW }), true);
  });
  test('the request flag alone still turns it on', () => {
    assert.equal(previewInForce({ uid: FOUNDER, requested: true, accountFlag: null, now: NOW }), true);
  });
  test('neither: off', () => {
    assert.equal(previewInForce({ uid: FOUNDER, requested: false, accountFlag: null, now: NOW }), false);
  });
  test('never for anyone but a founder, whatever they send or store', () => {
    for (const uid of ['someReaderUid', null, undefined, '']) {
      assert.equal(previewInForce({ uid, requested: true, accountFlag: true, now: NOW }), false, String(uid));
    }
  });
  test('after the switch there is nothing to preview', () => {
    assert.equal(previewInForce({ uid: FOUNDER, requested: true, accountFlag: true, now: GATE_ON_MS }), false);
  });
  test('the account path', () => {
    assert.equal(founderPreviewPath(FOUNDER), `founder_preview/${FOUNDER}`);
  });
});

describe('W4b · the build — a full page carries the end of its own week', () => {
  test('trouble-shooting: locks for the preview at Mon 21 Sept 00:00 London', () => {
    const p = buildInlinePlan(TROUBLE, NOW);
    assert.equal(p.inlineFull, true);
    assert.equal(p.lockAtMs, GATE_ON_MS, 'the real lock is still the switch');
    assert.equal(new Date(p.previewLockAtMs).toISOString(), '2026-09-20T23:00:00.000Z');
  });
  test('till-debt-do-us-part: locks for the preview at Mon 28 Sept 00:00 London', () => {
    assert.equal(new Date(buildInlinePlan(TILL, NOW).previewLockAtMs).toISOString(), '2026-09-27T23:00:00.000Z');
  });
  test('poetry never locks, under the preview or not', () => {
    assert.deepEqual(buildInlinePlan(prose('2025-01-01T09:00:00Z', { category: 'poetry' }), NOW), { inlineFull: true, lockAtMs: null, previewLockAtMs: null });
  });
  test('the page passes it through', () => {
    const page = readFileSync('app/stories/[slug]/page.js', 'utf8');
    assert.match(page, /previewLockAtMs = plan\.previewLockAtMs;/);
    assert.match(page, /lockAtMs, previewLockAtMs, previewHtml \}/);
  });
});

const initialFor = (rec) => {
  const plan = buildInlinePlan(rec, NOW);
  return { content: '<p>WHOLE</p><p>ENDING</p>', contentIsPreview: false, lockAtMs: plan.lockAtMs, previewLockAtMs: plan.previewLockAtMs, previewHtml: '<p>WHOLE</p>' };
};

describe('W4b · the first render — the preview locks before paint, not after a round-trip', () => {
  test('preview on: an archive story renders its opening', () => {
    const s = lockedForFirstPaint(initialFor(TROUBLE), NOW, { preview: true });
    assert.equal(s.content, '<p>WHOLE</p>');
    assert.equal(s.contentIsPreview, true);
  });
  test('preview on: this week\'s story renders in full', () => {
    assert.equal(lockedForFirstPaint(initialFor(TILL), NOW, { preview: true }).content, '<p>WHOLE</p><p>ENDING</p>');
  });
  test('preview off: nothing changes', () => {
    assert.equal(lockedForFirstPaint(initialFor(TROUBLE), NOW).content, '<p>WHOLE</p><p>ENDING</p>');
    assert.equal(lockedForFirstPaint(initialFor(TROUBLE), NOW, { preview: false }).content, '<p>WHOLE</p><p>ENDING</p>');
  });
  test('the client\'s first render reads the local copy', () => {
    const src = readFileSync('app/stories/[slug]/page-client.js', 'utf8');
    assert.match(src, /useState\(\(\) => lockedForFirstPaint\(initialStory, Date\.now\(\), \{ preview: readGatePreview\(\) \}\)/);
    assert.match(src, /lockScript\(initialStory\.lockAtMs, tagSubheads\(initialStory\.previewHtml\), initialStory\.previewLockAtMs \?\? null\)/);
  });
});

describe('W4b · the inline script — reads the preview as well as the clock', () => {
  const run = (script, now, storage) => {
    const el = { innerHTML: '<p>WHOLE</p><p>ENDING</p>', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const ctx = {
      document: { getElementById: (id) => (id === 'story-content' ? el : null) },
      Date: { now: () => now },
      localStorage: storage,
    };
    vm.runInNewContext(script, ctx);
    return el;
  };
  const on = { getItem: (k) => (k === GATE_PREVIEW_KEY ? '1' : null) };
  const off = { getItem: () => null };
  const throwing = { getItem: () => { throw new Error('SecurityError'); } };
  const scriptFor = (rec) => { const i = initialFor(rec); return lockScript(i.lockAtMs, i.previewHtml, i.previewLockAtMs); };

  test('preview on, archive story: swapped for the opening before paint', () => {
    const el = run(scriptFor(TROUBLE), NOW, on);
    assert.equal(el.innerHTML, '<p>WHOLE</p>');
    assert.equal(el.attrs['data-locked-by-clock'], '1');
  });
  test('preview on, this week\'s story: untouched', () => {
    assert.equal(run(scriptFor(TILL), NOW, on).innerHTML, '<p>WHOLE</p><p>ENDING</p>');
  });
  test('preview off, or storage that throws: untouched, and no error', () => {
    assert.equal(run(scriptFor(TROUBLE), NOW, off).innerHTML, '<p>WHOLE</p><p>ENDING</p>');
    assert.equal(run(scriptFor(TROUBLE), NOW, throwing).innerHTML, '<p>WHOLE</p><p>ENDING</p>');
  });
  test('the real clock still locks with the preview off', () => {
    assert.equal(run(scriptFor(TROUBLE), GATE_ON_MS, off).innerHTML, '<p>WHOLE</p>');
  });
  test('the script and the client module name the same key', () => {
    assert.equal(GATE_PREVIEW_STORAGE_KEY, GATE_PREVIEW_KEY);
  });
});

// ── /api/story itself, with the network stubbed ────────────────────────────────────────
// The real handler, driven end to end: token mint, ID-token lookup, the RTDB reads. What the
// stub records is what the handler asked for, so "the membership was not read" is observable.

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'sa@x', FIREBASE_PRIVATE_KEY: PEM, FIREBASE_DATABASE_URL: 'https://db.test' };
const BODY = '<p>' + Array.from({ length: 12 }, (_, i) => `Paragraph ${i} of the story, with enough words in it to be prose.`).join('</p><p>') + '</p>';

async function ask({ uid, previewGate, accountFlag = null, membership = null, record = TROUBLE }) {
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
    if (path === 'cms_stories/trouble-shooting') return ok(record);
    if (path === 'story_bodies/trouble-shooting') return ok({ content: BODY });
    if (path === `founder_preview/${uid}`) return ok(accountFlag);
    if (path === `users/${uid}/membership`) return ok(membership);
    if (path === `memberships/${uid}`) return ok(null);
    return ok(null);
  };
  try {
    const { onRequest } = await import('../../functions/api/story.js');
    const body = { slug: 'trouble-shooting', client: 'web', ...(uid ? { idToken: 'tok' } : {}), ...(previewGate ? { previewGate: true } : {}) };
    const res = await onRequest({ request: new Request('https://x/api/story', { method: 'POST', body: JSON.stringify(body) }), env: ENV });
    return { status: res.status, data: await res.json(), reads };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

describe('W4b · /api/story — the account flag, read by the endpoint itself', () => {
  test('a founder whose ACCOUNT has the preview on gets the archive preview with no flag in the request', async () => {
    const r = await ask({ uid: FOUNDER, previewGate: false, accountFlag: true });
    assert.equal(r.data.access, 'preview');
    assert.equal(r.data.reason, 'archive');
    assert.equal(r.data.previewGate, true);
  });
  test('a founder with it off, on the account and in the request, reads as today', async () => {
    const r = await ask({ uid: FOUNDER, previewGate: false, accountFlag: null });
    assert.equal(r.data.access, 'full');
    assert.equal(r.data.reason, 'gating_off');
  });
  test('a reader who is not a founder: the flag is never read and never honoured', async () => {
    const r = await ask({ uid: 'someReaderUid', previewGate: true, accountFlag: true });
    assert.equal(r.data.access, 'full');
    assert.equal(r.data.reason, 'gating_off');
    assert.ok(!r.reads.some((p) => p.startsWith('founder_preview/')), 'no founder_preview read for a reader');
  });
  test('signed out: as today', async () => {
    const r = await ask({ uid: null, previewGate: true });
    assert.equal(r.data.access, 'full');
  });
  test('the preview is the NON-MEMBER view: a Gold founder still sees the locked archive, and no membership is read', async () => {
    const r = await ask({ uid: FOUNDER, previewGate: true, membership: 'gold' });
    assert.equal(r.data.access, 'preview');
    assert.ok(!r.reads.some((p) => p.includes('membership')), `membership read under the preview: ${r.reads.join(', ')}`);
  });
  test('this week\'s story stays free under the preview', async () => {
    const r = await ask({ uid: FOUNDER, accountFlag: true, record: TILL });
    assert.equal(r.data.access, 'full');
    assert.equal(r.data.reason, 'free_week');
  });
});

describe('W4b · /api/series/stream — the same account flag, the same non-member view', () => {
  const src = readFileSync('functions/api/series/stream.js', 'utf8');
  test('reads founder_preview for a verified founder and decides through previewInForce', () => {
    assert.match(src, /founderPreviewPath\(encodeURIComponent\(who\)\)/);
    assert.match(src, /forceGate = previewInForce\(\{ uid: who, requested: body\?\.previewGate === true, accountFlag, now \}\);/);
  });
  test('skips the membership read under the preview', () => {
    assert.match(src, /if \(!forceGate\) try \{/);
  });
  test('the Series pages draw the rows at the non-member tier under the preview', () => {
    const detail = readFileSync('app/series/[slug]/page-detail.js', 'utf8');
    assert.match(detail, /const subscriptionTier = gatePreview \? 'free' :/);
    assert.match(detail, /effectiveTier=\{gatePreview \? 'free' :/);
    const inst = readFileSync('app/series/instalment/[instalmentId]/page-instalment.js', 'utf8');
    assert.match(inst, /subscriptionTier: gatePreview \? 'free' :/);
    assert.match(inst, /effectiveTier: gatePreview \? 'free' :/);
  });
});
