// W40 — "FREE TO READ" (rulings 146–148), its pure halves.
//
//   node --test tests/ci/w40-free-to-read.test.mjs      (part of npm run test:ci)
//
// The row validator's pair, the admin's three levels and their words, and the reader copy. The
// policy is in tests/ci/series-access.test.mjs (the exhaustive loop), the endpoint in
// tests/ci/w40-stream-free.test.mjs, the rules in tests/rules/w40-open-to-free.test.mjs, the
// screens in tests/series/w38-editor.spec.mjs and tests/series/w40-free.spec.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInstalment } from '../../app/lib/series/schema.js';
import { policyGrantForInstalment, refusalCopy } from '../../app/lib/series/access.js';
import {
  LEVELS, LEVEL_LABEL, levelOf, levelFields, tierLabel, audienceLine, levelChangeLine, needsFor,
} from '../../app/lib/series/publishing.js';
import { FREE_TO_READ } from '../../app/lib/series/format.js';
import { SERIES_FREE_LOCK_COPY } from '../../app/lib/archiveLock.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ROW = { schemaVersion: 1, seriesId: 's', ordinal: 1, releaseAtMs: 1, freeForGold: true, status: 'published', addedAt: 1, updatedAt: 1 };

describe('W40 · the row', () => {
  test('openToFree is optional, a boolean, and never without freeForGold', () => {
    assert.equal(validateInstalment(ROW).valid, true, 'every row from before W40');
    assert.equal(validateInstalment({ ...ROW, openToFree: true }).valid, true);
    assert.equal(validateInstalment({ ...ROW, openToFree: false, freeForGold: false }).valid, true);
    assert.match(validateInstalment({ ...ROW, openToFree: true, freeForGold: false }).errors.join(), /requires freeForGold: true/);
    assert.match(validateInstalment({ ...ROW, openToFree: 'yes' }).errors.join(), /boolean or absent/);
  });
  test('an app that does not know openToFree still opens a free row to Gold', () => {
    const { openToFree, ...asAnOldAppSeesIt } = { ...ROW, ...levelFields('free') };
    assert.equal(policyGrantForInstalment(asAnOldAppSeesIt, { subscriptionTier: 'gold', now: 2 }).access, 'granted');
  });
  test('the rules hold the pair from both sides', () => {
    const r = JSON.parse(src('database.rules.json')).rules.series_instalments.$instalmentId;
    assert.match(r.openToFree['.validate'], /newData\.isBoolean\(\)/);
    assert.match(r.openToFree['.validate'], /child\('freeForGold'\)\.val\(\) === true/);
    assert.match(r.freeForGold['.validate'], /child\('openToFree'\)\.val\(\) !== true/);
  });
});

describe('W40 · the admin names three levels', () => {
  test('a level is two fields, always together', () => {
    assert.deepEqual(LEVELS, ['platinum', 'gold', 'free']);
    assert.deepEqual(levelFields('platinum'), { freeForGold: false, openToFree: false });
    assert.deepEqual(levelFields('gold'), { freeForGold: true, openToFree: false });
    assert.deepEqual(levelFields('free'), { freeForGold: true, openToFree: true });
    for (const l of LEVELS) assert.equal(levelOf(levelFields(l)), l);
    assert.equal(levelOf({ freeForGold: true }), 'gold', 'a pre-W40 row has no openToFree');
  });
  test('147: "Free to read" in the rows, the Needed line and the live panel', () => {
    assert.equal(LEVEL_LABEL.free, 'Free to read');
    assert.equal(tierLabel(levelFields('free'), {}), 'Free to read');
    assert.equal(tierLabel(levelFields('free'), { choicesPending: { freeForGold: true } }), 'Not chosen', '142 stands');
    assert.equal(audienceLine(levelFields('free')), 'Free to read. Anyone signed in can read it.');
    assert.equal(audienceLine(levelFields('gold')), 'Gold and Platinum members can read it.');
    assert.equal(audienceLine(levelFields('platinum')), 'Platinum members can read it.');
    const series = { status: 'published', coverUrl: 'x', synopsis: 'y' };
    const tier = needsFor({ series, row: { ...ROW, ...levelFields('free') }, detail: {}, now: 2 }).needed.find((n) => n.key === 'tier');
    assert.equal(tier.detail, 'Free to read');
  });
  test('a live level change says plainly who gains it or loses it', () => {
    assert.equal(levelChangeLine('gold', 'gold'), null);
    assert.equal(levelChangeLine(null, 'free'), null, 'a first choice is not a change');
    assert.deepEqual(levelChangeLine('platinum', 'gold'), { loses: false, text: 'Gold members gain it when you save.' });
    assert.deepEqual(levelChangeLine('gold', 'free'), { loses: false, text: 'Everyone signed in gains it when you save, free accounts included.' });
    assert.deepEqual(levelChangeLine('platinum', 'free'), { loses: false, text: 'Everyone signed in gains it when you save, free accounts included, and Gold members.' });
    assert.deepEqual(levelChangeLine('gold', 'platinum'), { loses: true, text: 'Gold members who can read it now lose it when you save. Their saved place is kept.' });
    assert.deepEqual(levelChangeLine('free', 'gold'), { loses: true, text: 'Readers on a free account who can read it now lose it when you save. Their saved place is kept.' });
    assert.deepEqual(levelChangeLine('free', 'platinum'), { loses: true, text: 'Free accounts and Gold members who can read it now lose it when you save. Their saved place is kept.' });
  });
  test('the choices, the passes line and the colour', () => {
    const a = src('app/admin/series/page.js');
    assert.match(a, /\['free', 'Free to read', 'Anyone signed in can read this one'\]/);
    assert.match(a, /\{form\.tier !== 'free' && <div className="sa-small sa-dim">Day and week passes never count, whichever you choose\.<\/div>\}/);
    assert.match(a, /\.sa-who-free\{color:#fda4af\}/);
    for (const taken of ['#86efac', '#bfdbfe', '#d4d4d4', '#fcd34d', '#e0c068', '#d8d4f0']) assert.notEqual('#fda4af', taken);
  });
});

describe('W40 · ruling 148, the reader copy', () => {
  test('the words', () => {
    assert.equal(FREE_TO_READ, 'Free to read');
    assert.deepEqual(SERIES_FREE_LOCK_COPY, {
      eyebrow: 'Free to read', headline: 'Sign in to read this instalment.', body: 'Anyone signed in can read this one.', cta: 'Sign in',
    });
    assert.equal(refusalCopy({ reason: 'signed_out' }), 'Sign in to read this instalment.');
  });
  test('the series page row and the instalment page both say it', () => {
    assert.match(src('app/series/[slug]/page-detail.js'), /\{FREE_TO_READ\}/);
    assert.match(src('app/series/instalment/[instalmentId]/page-instalment.js'), /\{FREE_TO_READ\}/);
    assert.match(src('app/series/read/[instalmentId]/page-reader.js'), /SERIES_FREE_LOCK_COPY/);
  });
});
