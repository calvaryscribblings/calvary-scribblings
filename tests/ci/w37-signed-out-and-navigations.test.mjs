// W37 — the signed-out story page's refused read, and the four navigations W36 left. Source halves.
//
//   node --test tests/ci/w37-signed-out-and-navigations.test.mjs      (part of npm run test:ci)
//
// The browser half is tests/stories/w37-signed-out.spec.mjs: it opens the public pages signed out
// against the live database and fails on any uncaught error or any read the rules refuse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(p, 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('W37 · story_exercises is read only when signed in', () => {
  test('the rule: signed-in readers only', () => {
    const rules = JSON.parse(src('database.rules.json'));
    assert.equal(rules.rules.story_exercises['.read'], 'auth != null');
  });
  test('ExerciseSection waits for a uid before it reads', () => {
    const page = code('app/stories/[slug]/page-client.js');
    const at = page.indexOf('story_exercises/');
    assert.ok(at > 0, 'the read is still there for signed-in readers');
    const effect = page.slice(page.lastIndexOf('useEffect(', at), at);
    assert.match(effect, /if \(!slug \|\| !uid\) return;/);
  });
});

describe('W37 · the four navigations', () => {
  const RULE = '@next/next/no-location-assign-relative-destination';
  // W52: the cards no longer load /square#id (an anchor that existed only once the room had
  // loaded); they open the post's thread, /square/p, at the reply where there is one.
  test('1 and 2: the Square post cards open the thread, and nothing still loads /square#id', () => {
    for (const p of ['app/profile/page.js', 'app/user/page.js']) {
      const s = src(p);
      assert.doesNotMatch(s, /\/square#/, `${p}: a card still loads /square#id`);
      assert.match(s, /onClick=\{\(\) => window\.location\.assign\(postHref\((post|p)\)\)\}/, p);
      assert.doesNotMatch(s, new RegExp(`${RULE} -- .*anchor exists only after`), `${p}: the exception's reason is gone with it`);
    }
  });
  test('3: the series reader signs in through AuthModal, not a load of /account', () => {
    const reader = code('app/series/read/[instalmentId]/page-reader.js');
    assert.doesNotMatch(reader, /location\.href\s*=\s*'\/account'/);
    assert.match(reader, /import AuthModal from '..\/..\/..\/components\/AuthModal'/);
    assert.match(reader, /signIn=\{gate === 'signedout' \? \{ label: SERIES_LOCK_COPY\.signIn, onClick: onSignIn \}/);
  });
  test('4: own-profile redirect replaces the history entry', () => {
    const user = code('app/user/page.js');
    assert.match(user, /u\.uid === uid\) \{ window\.location\.replace\('\/profile'\)/);
    assert.doesNotMatch(user, /location\.href = '\/profile'/);
  });
});
