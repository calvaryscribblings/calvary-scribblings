// APP-DL1 — THE TWO ASSOCIATION FILES, AND THE PLACEHOLDER GATE.
//
// ⚠ WHAT MAKES THIS WORTH A SUITE RATHER THAN A CODE REVIEW: both files fail SILENTLY.
// A wrong Team ID, a missing fingerprint, an upload-key fingerprint where the app-signing
// one belongs, a 301 where a 200 belongs — none of them errors anywhere a developer would
// look. The link simply opens the browser, exactly as it does today, and the only symptom
// is that nothing changed. That is the same shape as R48's isLive(url): a check of the
// CONFIG standing in for a check of the WORLD.
//
// ⭑ AND IOS CACHES THE ANSWER. Apple's CDN fetches this file and a device fetches through it
// at install/update; a wrong file at first fetch is sticky and can need a reinstall to clear.
// So the file has to be right BEFORE a binary claims it, which means the only place the
// wrongness can be caught is here.
//
// ── THE PLACEHOLDER GATE — BOTH VALUES HAVE NOW LANDED ───────────────────────────────────
//
// Two values could not be derived from anything this repo can reach: the Apple Team ID (Apple
// Developer → Membership details) and the Play App Signing SHA-256 (Play Console → Test and
// release → Setup → App integrity → App signing → *App signing key certificate*, NOT the
// upload key). Ikenna supplied both on 10 Sep 2026 and they are in the files.
//
// ⭑ THE GATE STAYS, AND THE PAIR STAYS STATED OUT LOUD — same idiom as
// tests/applinks/applinks.test.mjs holding the two store flags. It is not a leftover from the
// pending state: it is what makes the two halves inseparable in BOTH directions. Landing a
// value without flipping its flag fails; flipping a flag without landing its value fails.
// Proved by mutation, all four ways, before the values were pushed.
//
// ⚠ AND THIS IS WHAT THE FLAGS BUY NOW THEY ARE FALSE: the well-formedness checks below are
// live. A Team ID that is not ten alphanumerics, or a fingerprint that is not 32 uppercase
// hex pairs, now fails here rather than in six months when somebody wonders why links open
// the browser. What NO check can catch is a well-formed value that is simply the WRONG one —
// the upload key instead of the app signing key, or the artist id instead of the Team ID.
// Those two are verified by a human reading the Console, and by the CDN gate in
// docs/APP-DEEP-LINKS.md §7.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseRedirects, isDynamic } from '../../scripts/redirects-limits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AASA_PATH = 'public/app-association/apple-app-site-association.json';
const LINKS_PATH = 'public/app-association/assetlinks.json';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// ⭑ THE ONE IDENTIFIER, ASSERTED AGAINST ITS OWN SOURCE OF TRUTH RATHER THAN RETYPED.
// Apple's iTunes Lookup API returns bundleId "uk.co.storyisland.app" for id6769357370, and
// the Play URL's ?id= IS the package name — the two platforms genuinely share the string.
// Both were verified against the live stores on 10 Sep 2026.
const APP_ID = 'uk.co.storyisland.app';

// ⛔ THE CLAIM SET. Ikenna's ruling, APP-DL1: TIER 1 ONLY. Widening is a deliberate edit to
// this array AND to the file, never a drift. It is cheap on iOS — a web deploy — and it costs
// a binary on Android, because there the path list lives in the app manifest and this file
// proves ownership only. See docs/APP-DEEP-LINKS.md.
const CLAIMED = ['/stories/*'];

// ── THE PENDING VALUES. FLIP BOTH WHEN THE REAL ONES LAND. ───────────────────────────────
const TEAM_ID_PENDING = false;
const FINGERPRINT_PENDING = false;

describe('the AASA is exactly the claim that was ruled, and nothing wider', () => {
  test('it parses, and the shape is the one Apple reads', () => {
    const aasa = json(AASA_PATH);
    assert.ok(Array.isArray(aasa.applinks?.details), 'applinks.details must be an array');
    assert.equal(aasa.applinks.details.length, 1, 'one app, one details entry');
    assert.deepEqual(Object.keys(aasa.applinks), ['details'], 'no stray top-level keys');
  });

  test('the appID names THIS app, whatever the team prefix turns out to be', () => {
    const [d] = json(AASA_PATH).applinks.details;
    assert.equal(d.appIDs.length, 1);
    assert.ok(d.appIDs[0].endsWith(`.${APP_ID}`),
      `the appID must end .${APP_ID} — Apple's own Lookup API gives that bundleId for id6769357370`);
  });

  test('CLAIMED PATHS ARE EXACTLY THE TIER-1 RULING — a widening must edit this assertion', () => {
    const [d] = json(AASA_PATH).applinks.details;
    const claims = d.components.filter((c) => !c.exclude).map((c) => c['/']);
    assert.deepEqual(claims, CLAIMED,
      'the claim set moved. Ikenna ruled tier 1 only; widening is a ruling, not a refactor');
  });

  test('⛔ THE BOOK STORE EXCLUSION IS FIRST, because the first match wins', () => {
    // Components are evaluated in order and iOS stops at the first match, so an exclusion that
    // sits BELOW the pattern it excludes from is not an exclusion at all. It is inert against a
    // /stories/* allow-list and it is meant to be — it is the record of the ruling at the site,
    // and it is already correctly positioned if the claim is ever widened.
    const [first, ...rest] = json(AASA_PATH).applinks.details[0].components;
    assert.equal(first['/'], '/bookstore/*');
    assert.equal(first.exclude, true);
    assert.ok(!rest.some((c) => c.exclude), 'one exclusion, and it leads');
  });

  test('the ruling is recorded AT THE SITE, not only in a report', () => {
    // Ikenna: "record the reason at the site". A rule whose reason lives only in a round report
    // is a rule somebody deletes in six months for looking arbitrary.
    const c = json(AASA_PATH).applinks.details[0].components[0].comment || '';
    for (const phrase of ['3.1.1', 'no prices and no buy button', 'buy on the website',
                          'ANDROID DOES NOT DIFFER', 'legal assumption', 'Play Billing']) {
      assert.ok(c.includes(phrase), `the exclusion comment must carry "${phrase}"`);
    }
  });

  test('nothing on the never-claim list appears as a claim', () => {
    const claims = json(AASA_PATH).applinks.details[0].components
      .filter((c) => !c.exclude).map((c) => c['/']);
    for (const never of ['/', '/admin', '/bookstore', '/membership', '/rewards', '/my-library',
                         '/profile', '/settings', '/delete-account', '/app', '/links',
                         '/open-pages', '/series', '/privacy', '/terms', '/api']) {
      assert.ok(!claims.some((c) => c === never || c.startsWith(`${never}/`) || c === `${never}*`),
        `${never} is on the never-claim list — see docs/APP-DEEP-LINKS.md for the reason`);
    }
  });
});

describe('assetlinks.json is the Digital Asset Links statement Google actually parses', () => {
  test('it parses, and it is a list of statements with no stray keys', () => {
    const links = json(LINKS_PATH);
    assert.ok(Array.isArray(links), 'the file is a LIST of statements, not an object');
    assert.equal(links.length, 1);
    // ⚠ NO COMMENT KEY HERE, DELIBERATELY, and it is the one asymmetry with the AASA. Apple
    // documents `comment` inside a components dictionary; Google documents a fixed statement
    // schema and its verifier fails silently. The reasons live in the AASA comment and in
    // docs/APP-DEEP-LINKS.md, and the Android half carries them in the app manifest.
    assert.deepEqual(Object.keys(links[0]).sort(), ['relation', 'target']);
    assert.deepEqual(Object.keys(links[0].target).sort(),
      ['namespace', 'package_name', 'sha256_cert_fingerprints']);
  });

  test('it names this package, and delegates all URLs', () => {
    const [s] = json(LINKS_PATH);
    assert.deepEqual(s.relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(s.target.namespace, 'android_app');
    assert.equal(s.target.package_name, APP_ID,
      "the package name IS the ?id= in the live Play URL — don't retype it from memory");
  });
});

describe('⭑ THE PLACEHOLDER GATE — nothing is submitted while these are true', () => {
  const teamId = () => json(AASA_PATH).applinks.details[0].appIDs[0].split('.')[0];
  const prints = () => json(LINKS_PATH)[0].target.sha256_cert_fingerprints;

  test('the Apple Team ID is STILL PENDING, and this assertion is how you find out', () => {
    assert.equal(teamId() === '<TEAM_ID>', TEAM_ID_PENDING,
      TEAM_ID_PENDING
        ? 'the Team ID landed — flip TEAM_ID_PENDING to false in this same commit'
        : 'the Team ID went back to a placeholder');
  });

  test('the Play App Signing SHA-256 is STILL PENDING', () => {
    assert.equal(prints()[0] === '<PLAY_APP_SIGNING_SHA256>', FINGERPRINT_PENDING,
      FINGERPRINT_PENDING
        ? 'the fingerprint landed — flip FINGERPRINT_PENDING to false in this same commit'
        : 'the fingerprint went back to a placeholder');
  });

  test('and when they DO land they are well-formed, which is what these two checks are for', () => {
    // ⚠ These are the assertions that start earning their keep the moment the flags flip. A
    // Team ID is 10 alphanumerics; the App Store artist id (1896652339) is 10 DIGITS and is a
    // different number entirely, so the letters-permitted check cannot catch that swap — only
    // a human reading Membership details can. Said here so nobody thinks it can.
    if (!TEAM_ID_PENDING) {
      assert.match(teamId(), /^[A-Z0-9]{10}$/, 'an Apple Team ID is 10 alphanumerics');
    }
    if (!FINGERPRINT_PENDING) {
      for (const p of prints()) {
        assert.match(p, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
          'a SHA-256 fingerprint is 32 uppercase hex pairs, colon-separated, exactly as the Console prints it');
      }
      assert.ok(prints().length >= 1 && prints().length <= 2,
        'the app signing key first; the upload key second only if internal builds must verify');
    }
  });
});

describe('the rewrite is wired, and it is a REWRITE', () => {
  const redirects = () => read('public/_redirects');
  const ruleFor = (from) => analyseRedirects(redirects()).rules.find((r) => r.from === from);

  for (const [from, to] of [
    ['/.well-known/apple-app-site-association', '/app-association/apple-app-site-association.json'],
    ['/.well-known/assetlinks.json', '/app-association/assetlinks.json'],
  ]) {
    test(`${from} is served, as a 200, from a file that exists`, () => {
      const rule = ruleFor(from);
      assert.ok(rule, `${from} is not in the served set — the generator did not emit it`);
      // ⛔ 200 IS THE WHOLE MECHANISM. Apple's CDN and Google's verifier both refuse a 3xx, and
      // Apple caches the refusal. A 301 here fails silently and stickily.
      assert.equal(rule.status, 200, 'this must be a REWRITE, never a redirect');
      assert.equal(rule.to, to);
      assert.ok(existsSync(join(ROOT, 'public', to)), `${to} must exist under public/ to be exported`);
      // Static: no * and no :placeholder in the SOURCE, so R24's latch is untouched.
      assert.equal(isDynamic(from), false, 'a dynamic rule here would cap the whole file at ~100');
    });
  }

  test('the file still carries exactly one dynamic rule, and it is still last', () => {
    const report = analyseRedirects(redirects());
    assert.deepEqual(report.violations, []);
    assert.equal(report.dynamicCount, 1, 'R24: one dynamic rule, and it must stay one');
    const froms = redirects().split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
    assert.ok(isDynamic(froms.at(-1)), 'the dynamic rule must be the last rule in the file');
  });

  test('⚠ THERE IS NO SECOND COPY UNDER public/.well-known/ — one source of truth', () => {
    // The rewrite exists precisely so the dot-directory question never has to be answered.
    // Adding the file there "as well" would create two sets of bytes that can drift, and the
    // rule would win anyway (R24.1: a rule beats a matching asset), so the copy would be a
    // file nobody serves and everybody edits.
    assert.equal(existsSync(join(ROOT, 'public/.well-known')), false,
      'public/.well-known/ exists — delete it; the rewrite is the mechanism');
  });
});
