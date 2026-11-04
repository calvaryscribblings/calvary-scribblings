// NOTIF-B1 (A57, item 3) — a note with no sender shows the house name, fixed in code.
//
//   node --test tests/ci/notif-b1-house-name.test.mjs      (npm run test:ci)
//
// The app's read-milestone reward lands in the reader's own inbox with no fromUid. The Profile panel
// must show "Calvary Scribblings" for it: never the stored fromName (the writer chose it) and never a
// blank. A sender who IS named is drawn from their live record, falling back to "Reader".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identityOf } from '../../app/lib/squareIdentity.js';

const src = readFileSync(new URL('../../app/profile/page.js', import.meta.url), 'utf8');
const panel = src.slice(src.indexOf('libNotifs.map(n =>'), src.indexOf('libNotifs.map(n =>') + 4000);

test('the Profile panel names a sender-less note "Calvary Scribblings", in code', () => {
  assert.ok(panel.length > 100, 'the panel was found');
  assert.match(panel, /const w = n\.fromUid \? identityOf\(\{ authorUid: n\.fromUid \}, notifUsers\[n\.fromUid\]\) : null;/);
  assert.match(panel, /const senderName = w \? w\.displayName : 'Calvary Scribblings';/);
});

test('the panel never draws the stored copy of the sender', () => {
  const code = panel.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /n\.fromName|n\.fromAvatarUrl|n\.fromHandle|n\.fromUsername/);
});

test('a named sender is never blank: live name, else "Reader"', () => {
  assert.equal(identityOf({ authorUid: 'u' }, undefined).displayName, 'Reader');
  assert.equal(identityOf({ authorUid: 'u' }, { displayName: '' }).displayName, 'Reader');
  assert.equal(identityOf({ authorUid: 'u' }, { displayName: 'Ada' }).displayName, 'Ada');
});
