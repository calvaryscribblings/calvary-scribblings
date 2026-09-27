// W19 / RULING 49 (Ikenna, 27 Sep 2026) — THE DELETION SCREEN KEEPS ITS WORDING.
//
// Nothing on the account-deletion screen changes, and this file is what stops a later copy sweep
// (rule 13, a house-style pass, a find-and-replace) from changing it by accident. Every word below
// is pinned VERBATIM, curly apostrophes and all. If this goes red, the screen's words moved: put
// them back, or bring a new ruling and change this file in the same commit as the words.
//
// The screen is four places, all drawing from app/lib/accountDeletion.js:
//   - the modal (app/components/DeleteAccountModal.js), which holds NO words of its own;
//   - its two conditional lines (membership, author);
//   - the settings danger zone that opens it (app/settings/page.js);
//   - the page after success (app/account/deleted/page.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY, CONDITIONAL_LINES, runDeleteFlow } from '../../app/lib/accountDeletion.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const PINNED_COPY = {
  title: 'Delete your account',
  intro: 'This happens straight away and can’t be undone. There’s no waiting period, and nothing we can restore afterwards.',
  goesLabel: 'What goes',
  goes: [
    'your account, profile and @handle',
    'your reading history, badges, points and places on the boards',
    'your comments and replies',
    'your Square posts and Open Pages pieces',
    'your followers and the people you follow',
    'the messages you’ve sent',
  ],
  confirmLabel: 'Type your username to confirm',
  cancel: 'Cancel',
  confirm: 'Delete account',
  working: 'Deleting…',
  reauthTitle: 'Sign in again to continue',
  reauthBody: 'For your security, please sign in once more. Your account is deleted as soon as you do.',
  reauthPassword: 'Your password',
  reauthPasswordButton: 'Sign in and delete',
  reauthGoogleButton: 'Continue with Google',
  reauthAppleButton: 'Continue with Apple',
  reauthFailed: 'We couldn’t confirm it’s you, so nothing has been deleted. Please try again.',
  failed: 'We couldn’t finish deleting your account, so you’re still signed in. Please try again — it picks up where it stopped. If it keeps failing, email contact@calvaryscribblings.co.uk.',
  signoff: 'We’re sorry to see you go.',
  settingsPanel: 'Deletion is immediate and permanent. Your account, profile and everything you’ve written here go straight away, and we can’t restore them.',
  doneKicker: 'Account deleted',
  doneTitle: 'Your account has been deleted.',
  doneBody: 'Your profile and handle are gone, and you’ve been signed out. Your comments, posts and the rest of your activity are cleared from the site within the hour.',
};

const PINNED_CONDITIONAL = {
  membership: 'Your membership ends now, and the time left on it isn’t refunded.',
  author: 'The stories you’ve published with Calvary Scribblings stay published.',
};

// The words a file draws as literal JSX text (between > and <), with its <style> block taken out.
const literalText = (src) => [...src.replace(/<style[\s\S]*?<\/style>/g, '').matchAll(/>([^<>{}=]*[A-Za-z][^<>{}=]*)</g)]
  .map((m) => m[1].trim()).filter(Boolean);

test('ruling 49: every word of the deletion copy is pinned verbatim', () => {
  assert.deepStrictEqual(COPY, PINNED_COPY);
});

test('ruling 49: the two conditional lines are pinned verbatim', () => {
  assert.deepStrictEqual(CONDITIONAL_LINES, PINNED_CONDITIONAL);
});

test('ruling 49: the limiter message keeps its ending', async () => {
  const r = await runDeleteFlow({
    getIdToken: async () => 't',
    call: async () => ({ status: 429, body: { error: 'Too many tries. Try again in a minute.' } }),
    reauthenticate: async () => {},
    signOut: async () => {},
  });
  assert.equal(r.message, 'Too many tries. Try again in a minute. You’re still signed in.');
});

test('ruling 49: the modal holds no words of its own, and draws every one of these', () => {
  const src = read('app/components/DeleteAccountModal.js');
  assert.deepStrictEqual(literalText(src), [], 'a literal sentence in the modal would dodge the pin');
  const used = [...new Set(src.match(/COPY\.[a-zA-Z]+/g))].sort();
  assert.deepStrictEqual(used, [
    'COPY.cancel', 'COPY.confirm', 'COPY.confirmLabel', 'COPY.goes', 'COPY.goesLabel', 'COPY.intro',
    'COPY.reauthAppleButton', 'COPY.reauthBody', 'COPY.reauthFailed', 'COPY.reauthGoogleButton',
    'COPY.reauthPassword', 'COPY.reauthPasswordButton', 'COPY.reauthTitle', 'COPY.signoff', 'COPY.title',
    'COPY.working',
  ]);
  assert.match(src, /conditionalLines\(/, 'the modal still shows the conditional lines');
});

test('ruling 49: the settings danger zone keeps its words', () => {
  const src = read('app/settings/page.js');
  const zone = src.slice(src.indexOf('st-section-title">delete account'), src.indexOf('<DeleteAccountModal'));
  assert.ok(zone.length > 0, 'the danger zone moved; find it and re-pin it');
  assert.deepStrictEqual(literalText(`>${zone}`), ['delete account', 'Danger zone', 'Permanent', 'Delete my account', 'Delete my account']);
  assert.match(zone, /\{DELETION_COPY\.settingsPanel\}/);
});

test('ruling 49: the page after deletion keeps its words', () => {
  const src = read('app/account/deleted/page.js');
  assert.deepStrictEqual(literalText(src), ['Calvary', 'Scribblings', 'Back to the home page']);
  for (const k of ['doneKicker', 'doneTitle', 'doneBody', 'signoff']) assert.match(src, new RegExp(`\\{COPY\\.${k}\\}`));
});
