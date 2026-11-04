// NOTIF-B1 (A57, item 3), carried into NOTIF-B2 — a note with no sender shows the house name, fixed
// in code; a sender with no profile shows "Reader"; nothing ever draws a stored name.
//
//   node --test tests/ci/notif-b1-house-name.test.mjs      (npm run test:ci)
//
// NOTIF-B2 retired the Profile page's own panel (ruling 305/327: one list). The rows of that one
// list are drawn by app/lib/bell.js (the words) and app/components/bell/BellRow.js (the faces), so
// this pins both, with the app's read-milestone reward in its exact shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromLegacy, headline, nameOf, HOUSE_NAME, NO_PROFILE_NAME } from '../../app/lib/bell.js';

const REWARD = { type: 'reward', fromName: 'Calvary Scribblings', message: 'You earned 5 Scribbles — 10 stories read milestone!', read: false, createdAt: 1 };

test('the app\'s read-milestone reward (no fromUid) is drawn as the house, with its own words', () => {
  const r = fromLegacy('library_notifications', 'n1', REWARD);
  assert.equal(r.actor, null);
  assert.deepEqual(headline(r, {}), [{ name: 'Calvary Scribblings' }, { text: ` ${REWARD.message}` }]);
});

test('the house name is fixed in code, never the stored fromName', () => {
  assert.equal(HOUSE_NAME, 'Calvary Scribblings');
  const forged = fromLegacy('library_notifications', 'n2', { ...REWARD, fromName: 'Ikenna (official)' });
  assert.equal(headline(forged, {})[0].name, 'Calvary Scribblings');
  const reply = fromLegacy('library_notifications', 'n3', { type: 'reply', fromUid: 'u1', fromName: 'Someone Else', slug: 's', read: false, createdAt: 1 });
  assert.equal(headline(reply, { u1: { displayName: 'Ada Obi' } })[0].name, 'Ada Obi', 'live name, not the stored one');
});

test('a named sender is never blank: live name, else "Reader"', () => {
  assert.equal(NO_PROFILE_NAME, 'Reader');
  assert.equal(nameOf('u', { u: null }), 'Reader', 'no profile');
  assert.equal(nameOf('u', {}), '\u2026', 'still loading: never misnamed');
  assert.equal(nameOf('u', { u: { displayName: '  ' } }), 'Reader');
  assert.equal(nameOf('u', { u: { displayName: 'Ada' } }), 'Ada');
  assert.equal(nameOf(null, {}), 'Calvary Scribblings');
});

test('no bell surface reads a stored sender field', () => {
  for (const f of ['app/lib/bell.js', 'app/components/bell/BellRow.js', 'app/components/bell/Bell.js', 'app/notifications/page.js', 'app/profile/page.js']) {
    const code = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\.fromName\b|\.fromAvatarUrl\b|\.fromHandle\b|\.fromUsername\b/, f);
  }
});
