// APPLE-W1 — Sign in with Apple on the website, the unit half: the name Apple shares once, the
// words, and the production path (the pop-up, and nothing else). The browser half is apple.spec.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appleNameFrom, APPLE_COPY, APPLE_PROVIDER_ID, APPLE_SCOPES } from '../../app/lib/appleSignIn.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('the name Apple shares on a first sign-in', () => {
  test('from wherever the result carries it, in order; trimmed; empty when there is none', () => {
    assert.equal(appleNameFrom({ _tokenResponse: { fullName: '  Ada   Appleseed ' } }), 'Ada Appleseed');
    assert.equal(appleNameFrom({ _tokenResponse: { displayName: 'Ada Appleseed' } }), 'Ada Appleseed');
    assert.equal(appleNameFrom({ _tokenResponse: { firstName: 'Ada', lastName: 'Appleseed' } }), 'Ada Appleseed');
    assert.equal(appleNameFrom({ _tokenResponse: { firstName: 'Ada' } }), 'Ada');
    assert.equal(appleNameFrom({}, { profile: { name: { firstName: 'Ada', lastName: 'Appleseed' } } }), 'Ada Appleseed');
    assert.equal(appleNameFrom({ user: { displayName: 'Ada Appleseed' } }), 'Ada Appleseed');
    assert.equal(appleNameFrom({ _tokenResponse: { fullName: 'From Token' }, user: { displayName: 'From User' } }), 'From Token');
    for (const r of [null, undefined, {}, { _tokenResponse: { fullName: '   ' } }, { user: { displayName: null } }, { _tokenResponse: { firstName: 5 } }]) {
      assert.equal(appleNameFrom(r, null), '');
    }
  });
});

describe('the button and its handler', () => {
  const modal = read('app/components/AuthModal.js');

  test('the words: one of Apple\'s three allowed titles, and Google\'s failure line with Apple\'s name', () => {
    assert.equal(APPLE_COPY.button, 'Continue with Apple');
    assert.ok(['Sign in with Apple', 'Sign up with Apple', 'Continue with Apple'].includes(APPLE_COPY.button));
    assert.match(modal, /setError\('Google sign-in failed\. Please try again\.'\)/);
    assert.equal(APPLE_COPY.failed, 'Apple sign-in failed. Please try again.');
    assert.equal(APPLE_PROVIDER_ID, 'apple.com');
    assert.deepEqual([...APPLE_SCOPES], ['email', 'name']);
  });

  test('every sign-in on the site offers it: the button sits in AuthModal, right after Google\'s, in every mode but "forgot"', () => {
    const g = modal.indexOf('Continue with Google');
    const a = modal.indexOf('data-auth-apple');
    assert.ok(g > 0 && a > g);
    const block = modal.slice(modal.lastIndexOf("{mode !== 'forgot' && (", g), modal.indexOf('<div className="auth-or">', a));
    assert.ok(block.includes('data-auth-apple'), 'inside the same block as Google\'s');
    assert.equal((modal.match(/data-auth-apple/g) || []).length, 1);
  });

  test('the same pop-up route as Google: popupSignIn, which in production is signInWithPopup and nothing else', () => {
    assert.match(modal, /new OAuthProvider\(APPLE_PROVIDER_ID\)/);
    assert.match(modal, /const result = await popupSignIn\(provider\);/);
    assert.match(modal, /await popupSignIn\(provider\);\n\s+onClose\(\);\n\s+\} catch \(e\) \{\n\s+setError\('Google sign-in failed/);
    const fn = modal.slice(modal.indexOf('function popupSignIn('), modal.indexOf('export default function AuthModal'));
    assert.match(fn, /process\.env\.NEXT_PUBLIC_FB_EMULATOR === '1' && typeof window !== 'undefined' && typeof window\.__FB_EMULATOR_POPUP__ === 'function'/);
    assert.match(fn, /return signInWithPopup\(auth, provider\);/);
    assert.doesNotMatch(modal, /signInWithRedirect/, 'a redirect would leave the tab: the pop-up keeps the reader in it');
  });

  test('a first sign-in\'s name reaches the completion step: the step waits for it (markSignupInFlight)', () => {
    const h = modal.slice(modal.indexOf('const handleApple'), modal.indexOf('const handleResend'));
    assert.match(h, /const settle = markSignupInFlight\(\);/);
    assert.match(h, /if \(name && !result\.user\.displayName\) await updateProfile\(result\.user, \{ displayName: name \}\)/);
    assert.match(h, /\} finally \{\n\s+settle\(\);/);
    assert.match(read('app/components/ProfileCompletion.js'), /await signupSettled\(\);[\s\S]*setName\(user\.displayName \|\| ''\)/);
  });

  test('the emulator stand-in lives only inside the emulator fence in app/lib/firebase.js', () => {
    const fb = read('app/lib/firebase.js');
    const fence = fb.slice(fb.indexOf("process.env.NEXT_PUBLIC_FB_EMULATOR === '1'"), fb.indexOf('export default app;'));
    assert.match(fence, /window\.__FB_EMULATOR_IDP__ = \(providerId, claims\) =>/);
    assert.equal((fb.match(/window\.__FB_EMULATOR_IDP__ =/g) || []).length, 1, 'defined once, in the fence');
    assert.doesNotMatch(fb.slice(0, fb.indexOf("process.env.NEXT_PUBLIC_FB_EMULATOR === '1'")), /window\.__FB_EMULATOR_IDP__ =/);
  });

  test("Apple's button rules: white, black logo and title, a system font; the box is Google's", () => {
    assert.match(modal, /className="auth-google auth-apple"/, 'the same class as Google\'s, so the box cannot drift');
    assert.match(modal, /\.auth-google, \.auth-apple \{ height: 44px; box-sizing: border-box; \}/);
    assert.match(modal, /\.auth-google\.auth-apple \{ color: #000; font-family: -apple-system, BlinkMacSystemFont/);
    assert.match(modal, /<path fill="#000" d="M788\.1 340\.9/, 'Apple\'s logo, in black');
  });

  test('the switch: on in production since the web setup was done (27 Nov 2026); an emulator build shows it too', async () => {
    const { APPLE_WEB_READY } = await import('../../app/lib/appleSignIn.js');
    assert.equal(APPLE_WEB_READY, true, 'on: docs/APPLE-WEB-SETUP.md steps 1-4 done by Ikenna, 27 Nov 2026');
    assert.match(modal, /\{\(APPLE_WEB_READY \|\| process\.env\.NEXT_PUBLIC_FB_EMULATOR === '1'\) && \(\n\s+<button className="auth-google auth-apple"/);
  });
});
