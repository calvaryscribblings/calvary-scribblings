// W6 (C) — THE VOICES ADMIN REPORTS WHAT HAPPENED. Audit ADM-10.
//
//   node --test tests/ci/w6-voices.test.mjs                  (part of npm run test:ci)
//
// Every action awaited fireRebuild() — a 10s settle, then the request — before saying anything,
// then said "✓ Voice saved and published" whatever the verdict. Now the write's result shows at
// once, the rebuild's verdict arrives after, the success line needs both, and a rebuild that did
// not start says so with "Retry the rebuild". A failed load draws the house failure panel.
//
// There is no follower notification on /admin/voices; "N notified / N failed" is the story
// CMS's half of ADM-10 (app/admin/page.js), which is not this file's.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { voiceNotice, voiceRebuildNeeded, rebuildEffect, rebuildReason } from '../../app/lib/voicesOutcome.js';
import { REBUILD_FALLBACK } from '../../app/lib/rebuild.js';

const OK = { ok: true };
const waiting = (effect) => ({ phase: 'waiting', effect });
const done = (effect, verdict) => ({ phase: 'done', effect, verdict });
const STARTED = { ok: true, status: 202, message: 'Rebuild started — the pages will exist in about two minutes.' };
const REFUSED = { ok: false, status: 502, message: `The rebuild request failed (502). The record is published either way. ${REBUILD_FALLBACK}` };

describe('the notice', () => {
  test('a failed write says nothing changed and no rebuild was asked for', () => {
    const n = voiceNotice({ action: 'save', published: true, write: { ok: false, error: 'PERMISSION_DENIED' }, rebuild: null });
    assert.deepEqual(n, { tone: 'bad', text: 'The voice was not saved: PERMISSION_DENIED. Nothing was changed, and no rebuild was asked for.', canRetryRebuild: false });
  });

  test('WHILE THE REBUILD IS WAITING there is no success line', () => {
    const n = voiceNotice({ action: 'save', slug: 'ada', published: true, write: OK, rebuild: waiting('/voices/ada is live') });
    assert.equal(n.tone, 'pending');
    assert.equal(n.text, 'Voice saved and published. Asking for a rebuild — the live site does not show this yet.');
    assert.doesNotMatch(n.text, /Rebuild started/);
  });

  test('the success line needs the write AND an accepted rebuild', () => {
    const n = voiceNotice({ action: 'save', slug: 'ada', published: true, write: OK, rebuild: done('/voices/ada is live', STARTED) });
    assert.deepEqual(n, { tone: 'ok', text: 'Voice saved and published. Rebuild started — /voices/ada is live in about two minutes.', canRetryRebuild: false });
  });

  test('a rebuild that did not start says so, offers the retry, and never claims "published either way" for a delete', () => {
    const n = voiceNotice({ action: 'delete', slug: 'ada', published: false, write: OK, rebuild: done('/voices/ada comes down', REFUSED) });
    assert.equal(n.tone, 'bad');
    assert.equal(n.canRetryRebuild, true);
    assert.equal(n.text, `Voice deleted. But the site was not rebuilt, so the live site does not show it yet. The rebuild request failed (502). ${REBUILD_FALLBACK}`);
    assert.doesNotMatch(n.text, /published either way/);
    const unknown = voiceNotice({ action: 'reorder', write: OK, rebuild: done('x', undefined) });
    assert.equal(unknown.tone, 'bad', 'no verdict at all is not a success');
  });

  test('a draft that stays a draft owes no rebuild and says where it is', () => {
    assert.equal(voiceRebuildNeeded(false, false), false);
    assert.equal(voiceRebuildNeeded(true, false), true);
    assert.equal(voiceRebuildNeeded(false, true), true);
    assert.equal(voiceRebuildNeeded(true, true), true, 'an edit to a live page changes the page');
    assert.deepEqual(voiceNotice({ action: 'save', published: false, write: OK, rebuild: null }),
      { tone: 'ok', text: 'Voice saved as a draft. It stays off /voices until you publish it.', canRetryRebuild: false });
  });

  test('the effect is per action', () => {
    assert.equal(rebuildEffect('delete', { slug: 'ada' }), '/voices/ada comes down');
    assert.equal(rebuildEffect('unpublish', { slug: 'ada' }), 'the card leaves /voices');
    assert.equal(rebuildEffect('reorder', {}), '/voices shows the new order');
    assert.equal(rebuildEffect('save', { slug: 'ada', published: false }), 'the card leaves /voices');
    assert.equal(rebuildReason('A. The record is published either way. B.'), 'A. B.');
  });
});

describe('the page', () => {
  const page = readFileSync('app/admin/voices/page.js', 'utf8');
  const code = page.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

  test('NO ACTION AWAITS THE REBUILD — the save shows its own result without the 10s settle', () => {
    assert.doesNotMatch(code, /await\s+fireRebuild\(/);
    assert.doesNotMatch(code, /await\s+fireDeployHook\(/);
    const save = code.slice(code.indexOf('async function saveVoice'), code.indexOf('async function togglePublished'));
    assert.ok(save.indexOf('setSaving(false);\n    report(') > 0, 'saving ends before the report, and the report does not wait');
  });

  test('every action reports its write, both ways', () => {
    for (const fn of ['saveVoice', 'togglePublished', 'deleteVoice', 'move']) {
      const body = code.slice(code.indexOf(`async function ${fn}`), code.indexOf('\n  }\n', code.indexOf(`async function ${fn}`)));
      assert.match(body, /report\(\{[^}]*write: \{ ok: false, error: e\.message \}/, `${fn} failure`);
      assert.match(body, /report\(\{[^}]*write: \{ ok: true \}/, `${fn} success`);
      assert.doesNotMatch(body, /setMsg\('Error/, `${fn} still reports through the old success-coloured box`);
    }
  });

  test('the verdict is read, and "Retry the rebuild" asks again at once', () => {
    assert.match(code, /setOutcome\(\(o\) => \(o && o\.seq === seq \? \{ \.\.\.o, rebuild: \{ phase: 'done', effect, verdict \} \} : o\)\)/);
    const retry = code.slice(code.indexOf('function retryRebuild'), code.indexOf('async function', code.indexOf('function retryRebuild')));
    assert.match(retry, /requestRebuild\(\{ hook: HOOKS\.CMS/);
    assert.match(page, /'Retry the rebuild'/);
    assert.match(page, /n\.canRetryRebuild &&/);
  });

  test('a failed first load draws Unavailable, never "No voices yet"', () => {
    assert.match(code, /readWithDeadline\(\(\) => Promise\.all\(/);
    assert.match(code, /setLoadFailure\(classifyFailure\(e\)\)/);
    const i = code.indexOf('<Unavailable kind={loadFailure} onRetry={load}');
    assert.ok(i > 0 && i < code.indexOf('No voices yet.'));
    assert.doesNotMatch(code, /Error loading: /);
  });

  test('no check-mark dingbat in the copy (house rule: no emoji)', () => {
    assert.doesNotMatch(code, /✓/);
  });
});
