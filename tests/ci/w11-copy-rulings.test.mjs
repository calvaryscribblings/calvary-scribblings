// W11 — THE RULED READER COPY, pinned word for word.
//
//   node --test tests/ci/w11-copy-rulings.test.mjs      (part of npm run test:ci)
//
// Ikenna, 26 Sep 2026, 01:53 (docs/COPY-RULINGS.md): the W2/W5 drafts are approved as they stand,
// apart from the house style of ruling 13 — short forms throughout; a heading that is a full
// sentence ends with a full stop; eyebrows, labels, buttons, field names and short status
// fragments don't. Changing any line below needs a new ruling. The lock words are pinned in
// tests/ci/w9-lock-bar.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGE_COPY } from '../../app/lib/age.js';
import { HANDLE_COPY, handleProblem } from '../../app/lib/handle.js';
import { COMPLETION_COPY } from '../../app/lib/profileCompletion.js';
import { SAVE_TOAST_COPY } from '../../app/lib/saveToast.js';
import { DOB_COPY } from '../../app/lib/dobCheck.js';
import { UNAVAILABLE_COPY, leadFor } from '../../app/lib/unavailableCopy.js';
import { STORY_LOCK_COPY, SERIES_LOCK_COPY, DEGRADED_LOCK_COPY } from '../../app/lib/archiveLock.js';

const src = (p) => readFileSync(p, 'utf8');
// NotFoundPage.js is JSX; its copy object is read out of the source rather than imported.
const NOT_FOUND = (() => {
  const s = src('app/components/NotFoundPage.js');
  const block = s.slice(s.indexOf('export const NOT_FOUND_COPY = {'), s.indexOf('};', s.indexOf('export const NOT_FOUND_COPY')));
  return Object.fromEntries([...block.matchAll(/^\s*(\w+): '([^']*)',$/gm)].map((m) => [m[1], m[2]]));
})();

const RULED_FILES = [
  'app/components/NotFoundPage.js', 'app/lib/age.js', 'app/lib/profileCompletion.js', 'app/lib/handle.js',
  'app/lib/dobCheck.js', 'app/lib/saveToast.js', 'app/lib/unavailableCopy.js', 'app/lib/archiveLock.js',
];

describe('W11 · no DRAFT mark comes back', () => {
  for (const p of RULED_FILES) test(p, () => assert.doesNotMatch(src(p), /DRAFT/, `${p} is ruled copy`));
  test('each ruled copy file cites the ruling', () => {
    for (const p of RULED_FILES) assert.match(src(p), /RULED \(Ikenna, 26 Sep 2026/, p);
  });
});

describe('W11 · the approved words', () => {
  test('404 (NotFoundPage.js)', () => {
    assert.deepEqual(NOT_FOUND, {
      eyebrow: 'NOT ON THE ISLAND',
      title: 'There’s nothing at this address.',
      body: 'The link may be mistyped, or the page may have moved. Everything on the island starts from the library.',
      home: 'Go to the library',
      search: 'Search',
    });
  });
  test('age.js', () => {
    assert.deepEqual(AGE_COPY, {
      label: 'Date of birth',
      hint: 'Story Island is for readers aged 18 and over.',
      under: 'Story Island is for readers aged 18 and over, so we can’t open an account for you.',
      underSignedIn: 'Story Island is for readers aged 18 and over, so we can’t finish setting up your account. We’ll sign you out now.',
      missing: 'Please enter your date of birth.',
      unreadable: 'Please check your date of birth.',
    });
  });
  test('profileCompletion.js', () => {
    assert.deepEqual(COMPLETION_COPY, {
      title: 'One last thing.',
      subtitle: 'Choose how the island knows you. This takes a moment, and you only do it once.',
      nameLabel: 'Full name',
      submit: 'Continue',
      signOut: 'Sign out instead',
      failed: 'We couldn’t save your details, so nothing was changed. Please try again.',
    });
  });
  test('handle.js — the field', () => {
    const h = 'rebel';
    assert.equal(HANDLE_COPY.label, 'Handle');
    assert.equal(HANDLE_COPY.helper, 'How other readers find you and mention you on the island. 3 to 20 characters: lowercase letters, numbers and underscores.');
    assert.equal(HANDLE_COPY.checking, 'Checking…');
    assert.equal(HANDLE_COPY.available(h), '@rebel is yours if you want it.');
    assert.equal(HANDLE_COPY.taken(h), '@rebel already belongs to another reader. Try another.');
    assert.equal(HANDLE_COPY.unknown, 'We couldn’t check that handle just now. It’ll be checked again when you continue.');
    assert.equal(HANDLE_COPY.reserved(h), '@rebel is reserved for the island\'s own use. Choose another.');
    assert.equal(HANDLE_COPY.renameLost(h), 'Another reader claimed @rebel a moment ago, so nothing was changed. Choose another handle.');
    assert.equal(HANDLE_COPY.required, 'Your handle can be changed, but not removed.');
    assert.equal(HANDLE_COPY.raceLost(h), 'Another reader claimed @rebel a moment ago, so nothing was saved. Choose another handle and try again.');
  });
  test('handle.js — the format errors: a sentence keeps its stop, a fragment has none', () => {
    assert.equal(handleProblem(''), 'Choose a handle.');
    assert.equal(handleProblem('no spaces'), 'Letters, numbers and underscores only');
    assert.equal(handleProblem('ab'), 'At least 3 characters');
    assert.equal(handleProblem('a'.repeat(21)), 'No more than 20 characters');
  });
  test('dobCheck.js', () => {
    const { underBody, ...rest } = DOB_COPY;
    assert.deepEqual(rest, {
      title: 'Please confirm your date of birth.',
      body: 'Story Island is for readers aged 18 and over. The date of birth on your account needs checking, so please enter it again.',
      label: 'Date of birth',
      confirm: 'Confirm',
      signOut: 'Sign out',
      missing: 'Please enter your date of birth.',
      unreadable: 'Please check your date of birth.',
      failed: 'We couldn’t save that. Please try again.',
      underTitle: 'Story Island is for readers aged 18 and over.',
      underDelete: 'Delete my account',
      underBack: 'I entered the wrong date',
      working: 'Deleting…',
      reauthTitle: 'Sign in again to continue.',
      reauthBody: 'For your security, please sign in once more. Your account is deleted as soon as you do.',
    });
    assert.equal(underBody('3 March 2010'), 'You’ve told us you were born on 3 March 2010. That means we can’t keep an account for you, so it’ll be deleted now, with everything in it. This can’t be undone.');
  });
  test('saveToast.js — approved as it stands', () => {
    assert.deepEqual(SAVE_TOAST_COPY, {
      saved: 'Saved to My Library',
      view: 'View',
      removed: 'Removed from My Library',
      undo: 'Undo',
      undoFailed: 'Couldn’t put that back. Save it again from the story.',
    });
  });
  test('unavailableCopy.js — the offline line stays (ruling 11: the website keeps saved stories readable offline)', () => {
    assert.deepEqual(UNAVAILABLE_COPY, {
      eyebrow: 'CAN’T REACH THE ISLAND',
      retry: 'Try again',
      retrying: 'Trying…',
      kinds: {
        offline: { title: 'You’re offline.', body: 'Check your connection, then try again. Anything you saved for offline reading is still in My Library.' },
        slow: { title: 'The island is slow to answer.', body: 'Nothing has come back yet. It’s usually the connection, so try again in a moment.' },
        ours: { title: 'This part didn’t load.', body: 'Something went wrong on our side, not yours. Try again in a moment.' },
      },
    });
    assert.equal(leadFor('your books'), 'We couldn’t reach your books.');
  });
  test('Unavailable.js runs the title into the body without doubling the stop', () => {
    const s = src('app/components/Unavailable.js');
    assert.match(s, /\{lead \? `\$\{copy\.title\} \$\{copy\.body\}` : copy\.body\}/);
    assert.doesNotMatch(s, /\$\{copy\.title\}\./);
  });
});

// ── RULE 13, CHECKED MECHANICALLY over every ruled string ────────────────────────────────
const LONG_FORMS = /\b(cannot|can not|could not|do not|does not|did not|will not|we will|you will|you are|we are|it will|it is|is not|are not|was not|were not|has not|have not|had not|would not|should not|that is|there is|you have|we have|let us)\b/i;
const sample = (v) => (typeof v === 'function' ? v('rebel') : v);
const strings = (o) => Object.values(o).flatMap((v) => (v && typeof v === 'object' && !Array.isArray(v) ? strings(v) : [].concat(sample(v))));

describe('W11 · rule 13 holds across the ruled copy and both locks', () => {
  const all = [
    ...strings(NOT_FOUND), ...strings(AGE_COPY), ...strings(HANDLE_COPY), ...strings(COMPLETION_COPY),
    ...strings(SAVE_TOAST_COPY), ...strings(DOB_COPY), ...strings(UNAVAILABLE_COPY),
    ...strings(STORY_LOCK_COPY), ...strings(SERIES_LOCK_COPY), ...strings(DEGRADED_LOCK_COPY),
    handleProblem(''), handleProblem('a b'), handleProblem('ab'), handleProblem('a'.repeat(21)),
  ];
  test('short forms throughout', () => {
    for (const s of all) assert.doesNotMatch(s, LONG_FORMS, s);
  });
  test('every full-sentence heading ends with a full stop', () => {
    for (const h of [NOT_FOUND.title, DOB_COPY.title, DOB_COPY.underTitle, DOB_COPY.reauthTitle, STORY_LOCK_COPY.headline,
      SERIES_LOCK_COPY.headline, DEGRADED_LOCK_COPY.headline, ...Object.values(UNAVAILABLE_COPY.kinds).map((k) => k.title)]) {
      assert.match(h, /\.$/, h);
    }
  });
  test('eyebrows, labels, buttons, field names and fragments take none', () => {
    for (const f of [NOT_FOUND.eyebrow, NOT_FOUND.home, NOT_FOUND.search, AGE_COPY.label, HANDLE_COPY.label, COMPLETION_COPY.nameLabel,
      COMPLETION_COPY.submit, COMPLETION_COPY.signOut, DOB_COPY.label, DOB_COPY.confirm, DOB_COPY.signOut, DOB_COPY.underDelete,
      DOB_COPY.underBack, SAVE_TOAST_COPY.saved, SAVE_TOAST_COPY.removed, SAVE_TOAST_COPY.view, SAVE_TOAST_COPY.undo,
      UNAVAILABLE_COPY.eyebrow, UNAVAILABLE_COPY.retry, STORY_LOCK_COPY.eyebrow, STORY_LOCK_COPY.cta, SERIES_LOCK_COPY.eyebrow,
      SERIES_LOCK_COPY.cta, DEGRADED_LOCK_COPY.cta, handleProblem('a b'), handleProblem('ab'), handleProblem('a'.repeat(21))]) {
      assert.doesNotMatch(f, /\.$/, f);
    }
  });
});
