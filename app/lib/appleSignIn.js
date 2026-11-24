// APPLE-W1 — Sign in with Apple on the website (Ikenna's ruling, 24 Nov 2026: 16 of 378 accounts
// could sign in only with Apple, so the website was closed to them).
//
// Pure, so tests/account/apple-signin.test.mjs drives it. AuthModal does the pop-up.
//
// THE NAME. Apple shares the reader's name ONCE, on the first authorization of this app by that
// Apple ID, and never again (a later sign-in carries none). Firebase's web SDK does not always copy
// it onto user.displayName, so it is read from wherever the sign-in result carries it, and the
// completion step ("One last thing.") starts from it. Where there is none, the step starts empty,
// as it does for any account with no name.

// THE SWITCH. Off until Ikenna's setup exists: on 24 Nov 2026 the live apple.com provider was
// enabled for the iOS app only, with no web Services ID and no code-flow key, so a web pop-up would
// fail for every reader. docs/APPLE-WEB-SETUP.md lists the steps; once they are done, set this to
// true. An emulator build shows the button regardless, so the browser suite keeps proving it.
export const APPLE_WEB_READY = false;

export const APPLE_PROVIDER_ID = 'apple.com';
export const APPLE_SCOPES = Object.freeze(['email', 'name']);

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/**
 * The name Apple gave on this sign-in, or ''. `result` is signInWithPopup's result;
 * `additional` is getAdditionalUserInfo(result) (either may be missing).
 */
export function appleNameFrom(result, additional) {
  const tr = result?._tokenResponse || {};
  const profile = additional?.profile || {};
  const pn = profile.name && typeof profile.name === 'object' ? profile.name : {};
  const candidates = [
    clean(tr.fullName),
    clean(tr.displayName),
    clean([tr.firstName, tr.lastName].filter((x) => typeof x === 'string').join(' ')),
    clean([pn.firstName, pn.lastName].filter((x) => typeof x === 'string').join(' ')),
    clean(result?.user?.displayName),
  ];
  return candidates.find(Boolean) || '';
}

// The words. "Continue with Apple" is one of the three titles Apple's rules allow for the button
// ("Sign in with Apple", "Sign up with Apple", "Continue with Apple"), and the one that pairs with
// "Continue with Google". The failure line is Google's, word for word, with Apple's name.
export const APPLE_COPY = Object.freeze({
  button: 'Continue with Apple',
  failed: 'Apple sign-in failed. Please try again.',
});
