// THE SERIES GATE, asserted. `npm run test:ci`.
//
// Every test here is about a decision that is invisible from the outside until it is wrong:
// a day pass that quietly unlocks a Platinum benefit, a release date compared as a string, a
// Platinum member told next month's instalment is not for their tier. None of these produce
// an error — they produce a plausible wrong answer — so they are asserted rather than trusted.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  grantForInstalment,
  policyGrantForInstalment,
  SERIES_TIER_GATE_ENABLED,
  TIER_GATE_OFF,
  isReleased,
  releasedCount,
  instalmentsOf,
  refusalCopy,
  REFUSAL_STATUS,
} from '../../app/lib/series/access.js';
import {
  validateSeries,
  validateInstalment,
  validateInstalmentDetail,
  epubObjectPath,
  instalmentImageKey,
  INSTALMENT_DETAIL_SCHEMA,
  INSTALMENT_SCHEMA,
  INSTALMENT_ID_RE,
} from '../../app/lib/series/schema.js';
import {
  formatRelease, shelfLine, instalmentLabel, instalmentEyebrow, readActionLabel,
  releaseCreditLabel, readingMinutes, readingTimeLabel, WORDS_PER_MINUTE, SPONSOR_PREAMBLE,
} from '../../app/lib/series/format.js';
import { IMMERSIVE_ROUTES, isImmersive } from '../../app/lib/immersiveRoutes.js';
import { hasStaticPage } from '../../app/lib/storyAccess.js';

const ROOT = new URL('../../', import.meta.url);
const NOW = Date.UTC(2026, 9, 20); // 20 Oct 2026
const PAST = Date.UTC(2026, 9, 14);
const FUTURE = Date.UTC(2026, 10, 14);

const row = (over = {}) => ({
  schemaVersion: 1,
  seriesId: 'beta-princess',
  ordinal: 1,
  releaseAtMs: PAST,
  freeForGold: false,
  status: 'published',
  addedAt: 1,
  updatedAt: 1,
  ...over,
});

describe('release is a gate before tier, for everyone', () => {
  test('an unreleased instalment is refused to PLATINUM, as not_released', () => {
    const g = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.code, 'not_released');
    assert.equal(g.status, 403);
    // The date travels with the refusal so the reader is told WHEN, not just no.
    assert.equal(g.releaseAtMs, FUTURE);
  });

  test('a Platinum member is never told an unreleased instalment is a tier problem', () => {
    const g = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', now: NOW });
    assert.notEqual(g.code, 'tier_too_low');
    assert.match(refusalCopy(g), /not arrived yet/i);
  });

  test('unreleased answers identically signed out and signed in — no schedule leak', () => {
    const a = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'free', signedIn: false, now: NOW });
    const b = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: 'platinum', signedIn: true, now: NOW });
    assert.equal(a.code, b.code);
    assert.equal(a.code, 'not_released');
  });

  test('a draft or unpublished row is not_released, and does not announce itself', () => {
    for (const status of ['draft', 'unpublished']) {
      const g = grantForInstalment(row({ status, releaseAtMs: PAST }), { subscriptionTier: 'platinum', now: NOW });
      assert.equal(g.code, 'not_released', status);
    }
  });

  test('releaseAtMs exactly equal to now HAS released — the boundary is inclusive', () => {
    assert.equal(isReleased(row({ releaseAtMs: NOW }), NOW), true);
    assert.equal(isReleased(row({ releaseAtMs: NOW + 1 }), NOW), false);
  });

  test('a non-numeric releaseAtMs never releases', () => {
    // The scar this guards: a string compares against a clock as a string. It must fail
    // CLOSED — an instalment nobody can read is recoverable; one that leaked early is not.
    for (const bad of ['2026-10-14', null, undefined, NaN, {}]) {
      assert.equal(isReleased(row({ releaseAtMs: bad }), NOW), false, String(bad));
    }
  });
});

describe('the tier gate — subscription only', () => {
  // ── THESE ASSERT THE POLICY, NOT THE SWITCH ────────────────────────────────────────────
  // They call policyGrantForInstalment because SERIES_TIER_GATE_ENABLED is false today and
  // grantForInstalment would answer 'granted' to every one of them. That is the switch
  // working, not the policy changing — and a suite that let the switch blind it is exactly
  // how you find, on the day you flip it back, that the policy rotted while nobody looked.
  // The switch itself is asserted in its own describe below. Same split, same reason, as
  // tests/ci/story-access.test.mjs draws around GATING_ENABLED.
  const grant = (r, o) => policyGrantForInstalment(r, o);

  test('Platinum reads a released instalment', () => {
    const g = grant(row(), { subscriptionTier: 'platinum', now: NOW });
    assert.equal(g.access, 'granted');
    assert.equal(g.reason, 'platinum');
  });

  test('Gold reads ONLY the freeForGold instalment', () => {
    assert.equal(grant(row({ freeForGold: true }), { subscriptionTier: 'gold', now: NOW }).access, 'granted');
    assert.equal(grant(row({ freeForGold: false }), { subscriptionTier: 'gold', now: NOW }).access, 'locked');
  });

  test('Free reads nothing, freeForGold included', () => {
    for (const f of [true, false]) {
      const g = grant(row({ freeForGold: f }), { subscriptionTier: 'free', now: NOW });
      assert.equal(g.access, 'locked', `freeForGold=${f}`);
      assert.equal(g.code, 'tier_too_low');
    }
  });

  test('freeForGold is read as an explicit boolean, never inferred from ordinal', () => {
    // Instalment 1 with the flag OFF is locked to Gold; instalment 5 with it ON is open.
    assert.equal(grant(row({ ordinal: 1, freeForGold: false }), { subscriptionTier: 'gold', now: NOW }).access, 'locked');
    assert.equal(grant(row({ ordinal: 5, freeForGold: true }), { subscriptionTier: 'gold', now: NOW }).access, 'granted');
    // A missing flag is not truthy-tested into a grant.
    const g = grant({ ...row(), freeForGold: undefined }, { subscriptionTier: 'gold', now: NOW });
    assert.equal(g.access, 'locked');
  });

  test('a released instalment refuses a signed-out reader with signed_out, not tier_too_low', () => {
    const g = grant(row(), { subscriptionTier: 'free', signedIn: false, now: NOW });
    assert.equal(g.code, 'signed_out');
    assert.equal(g.status, 401);
  });
});

describe('THE £1 DAY PASS IS EXCLUDED — the one that will not fall out of copying', () => {
  // POLICY again — see the note in the describe above. The exclusion has to survive the flag
  // being flipped back on, which is the moment it starts mattering.
  const grant = (r, o) => policyGrantForInstalment(r, o);

  // PASS_TIER is 'gold' (app/lib/membershipPasses.js), so effectiveTier() returns the SAME
  // string for a day-pass holder as for a paying Gold member. A gate written against
  // effectiveTier would hand every freeForGold instalment of every series to a £1 purchase.
  const dayPassHolder = { subscriptionTier: 'free', effectiveTier: 'gold' };

  test('a day-pass holder does NOT get the Gold taste', () => {
    const g = grant(row({ freeForGold: true }), { ...dayPassHolder, now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.code, 'tier_too_low');
  });

  test('and is told the actual reason, not a generic Platinum line', () => {
    const g = grant(row({ freeForGold: true }), { ...dayPassHolder, now: NOW });
    assert.equal(g.reason, 'pass_excluded');
    assert.match(refusalCopy(g), /passes do not include the Series/i);
  });

  test('a real Gold member with the same effective tier DOES get it', () => {
    const g = grant(row({ freeForGold: true }), { subscriptionTier: 'gold', effectiveTier: 'gold', now: NOW });
    assert.equal(g.access, 'granted');
    assert.equal(g.reason, 'gold_taste');
  });

  test('a Gold member holding a pass is unaffected — the pass adds nothing and takes nothing', () => {
    const g = grant(row({ freeForGold: true }), { subscriptionTier: 'gold', effectiveTier: 'gold', now: NOW });
    assert.equal(g.access, 'granted');
  });

  test('a pass could never reach Platinum content either', () => {
    const g = grant(row({ freeForGold: false }), { ...dayPassHolder, now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.reason, 'needs_platinum');
  });

  test('omitting effectiveTier falls back to the subscription and never over-grants', () => {
    const g = grant(row({ freeForGold: true }), { subscriptionTier: 'free', now: NOW });
    assert.equal(g.access, 'locked');
    assert.equal(g.reason, 'needs_gold');
  });
});

describe('refusal codes and statuses', () => {
  test('the four codes map to the statuses the endpoint documents', () => {
    assert.equal(REFUSAL_STATUS.signed_out, 401);
    assert.equal(REFUSAL_STATUS.not_released, 403);
    assert.equal(REFUSAL_STATUS.tier_too_low, 403);
    assert.equal(REFUSAL_STATUS.not_found, 404);
  });

  test('502, not 503, on a read failure — the 502-vs-503 ruling', () => {
    // functions/api/story.js answers 503 for the same class; the Series takes the bookstore's
    // 502 because it is a transplant of that endpoint. Asserted so it cannot drift back.
    assert.equal(REFUSAL_STATUS.unavailable, 502);
  });

  test('every reason a grant can carry has copy behind it', () => {
    // POLICY, so the sweep still reaches the tier refusals while the switch is off.
    const reasons = new Set();
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const freeForGold of [true, false]) {
        for (const releaseAtMs of [PAST, FUTURE]) {
          for (const signedIn of [true, false]) {
            const g = policyGrantForInstalment(row({ freeForGold, releaseAtMs }), {
              subscriptionTier: tier, effectiveTier: 'gold', signedIn, now: NOW,
            });
            if (g.access === 'locked') reasons.add(g.reason);
          }
        }
      }
    }
    assert.ok(reasons.size >= 4, `expected several refusal reasons, got ${[...reasons]}`);
    for (const r of reasons) {
      assert.notEqual(refusalCopy({ reason: r }), refusalCopy({ reason: '__missing__' }), `no copy for ${r}`);
    }
  });
});

describe('the released count is derived, never stored', () => {
  const rows = [
    row({ ordinal: 1, releaseAtMs: PAST }),
    row({ ordinal: 2, releaseAtMs: PAST }),
    row({ ordinal: 3, releaseAtMs: FUTURE }),
    row({ ordinal: 4, status: 'draft', releaseAtMs: PAST }),
  ];

  test('counts only published rows whose date has passed', () => {
    assert.equal(releasedCount(rows, NOW), 2);
  });

  test('the same rows give a different count at a different clock — which is the point', () => {
    assert.equal(releasedCount(rows, FUTURE + 1), 3);
    assert.equal(releasedCount(rows, PAST - 1), 0);
  });

  test('accepts the { id: row } shape an RTDB snapshot yields', () => {
    const asObject = Object.fromEntries(rows.map((r, i) => [`x-i${i}`, r]));
    assert.equal(releasedCount(asObject, NOW), 2);
  });

  test('instalmentsOf orders by ordinal and drops drafts', () => {
    const list = instalmentsOf([rows[2], rows[0], rows[3], rows[1]], 'beta-princess', NOW);
    assert.deepEqual(list.map((r) => r.ordinal), [1, 2, 3]);
    assert.deepEqual(list.map((r) => r.released), [true, true, false]);
  });
});

describe('schema', () => {
  test('releaseAtMs must be an integer — an ISO string is rejected', () => {
    const r = validateInstalment({ ...row(), releaseAtMs: '2026-10-14' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /releaseAtMs/.test(e)));
  });

  test('freeForGold must be present and boolean', () => {
    assert.equal(validateInstalment({ ...row(), freeForGold: undefined }).valid, false);
    assert.equal(validateInstalment({ ...row(), freeForGold: 'yes' }).valid, false);
    assert.equal(validateInstalment(row()).valid, true);
  });

  test('an instalment detail without authorUid/authorHandle is rejected', () => {
    const base = {
      schemaVersion: 1, title: 'Part One', synopsis: null, author: 'Monica Garcia',
      authorUid: 'u', authorHandle: 'h', coverUrl: null, epubPath: 'p', updatedAt: 1,
    };
    assert.equal(validateInstalmentDetail(base).valid, true);
    assert.equal(validateInstalmentDetail({ ...base, authorUid: '' }).valid, false);
    assert.equal(validateInstalmentDetail({ ...base, authorHandle: '' }).valid, false);
  });

  test('a published instalment must have an epubPath', () => {
    const base = {
      schemaVersion: 1, title: 't', synopsis: null, author: 'a', authorUid: 'u',
      authorHandle: 'h', coverUrl: null, epubPath: null, updatedAt: 1,
    };
    assert.equal(validateInstalmentDetail(base, { publishing: true }).valid, false);
    assert.equal(validateInstalmentDetail(base, { publishing: false }).valid, true);
  });

  test('a published series must have a poster', () => {
    const base = { schemaVersion: 1, slug: 'x', title: 'X', synopsis: 's', coverUrl: null, status: 'draft', addedAt: 1, updatedAt: 1 };
    assert.equal(validateSeries(base).valid, true);
    assert.equal(validateSeries({ ...base, status: 'published' }).valid, false);
    assert.equal(validateSeries({ ...base, status: 'published', coverUrl: 'u' }).valid, true);
  });

  test('no schema carries an instalmentCount — the count is derived', () => {
    const src = readFileSync(fileURLToPath(new URL('app/lib/series/schema.js', ROOT)), 'utf8');
    assert.equal(/^\s*instalmentCount:/m.test(src), false);
  });

  test('the epub path is derived from the id and lives under the gated prefix', () => {
    assert.equal(epubObjectPath('beta-princess-i1'), 'series_epubs/beta-princess-i1/master.epub');
  });

  test('the id pattern refuses anything that could walk out of the prefix', () => {
    for (const bad of ['../secrets', 'a/b', 'x'.repeat(129), '', 'a b']) {
      assert.equal(INSTALMENT_ID_RE.test(bad), false, bad);
    }
    assert.equal(INSTALMENT_ID_RE.test('beta-princess-i1'), true);
  });
});

describe('copy', () => {
  test('the vocabulary is "instalment", never "episode"', () => {
    const files = [
      'app/lib/series/schema.js', 'app/lib/series/access.js', 'app/lib/series/format.js',
      'app/lib/series/loader.js', 'app/lib/series/admin-writes.js', 'app/lib/series/stream.js',
      'functions/api/series/stream.js', 'docs/series.md', 'audit/membership-copy-deck.md',
      // R12.4 — the instalment page and its admin fields. The word appears on this page more
      // often than anywhere else on the site (eyebrow, button, sponsor preamble), so it is the
      // likeliest place for "episode" to creep back in.
      'app/series/instalment/[instalmentId]/page.js',
      'app/series/instalment/[instalmentId]/page-instalment.js',
      'app/admin/series/page.js',
    ];
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(f, ROOT)), 'utf8');
      // 'episode' survives only where the correction itself is being described.
      const offending = src.split('\n').filter(
        (l) => /episode/i.test(l) && !/said|corrected|"episodes"|\*\*episodes\*\*/i.test(l),
      );
      assert.deepEqual(offending, [], `${f} still says "episode": ${offending.join(' | ')}`);
    }
  });

  test('instalmentLabel is the one place the row label is spelled', () => {
    assert.equal(instalmentLabel(3), 'Instalment 3');
  });

  test('a release date renders in UTC, with the year only when it is not this one', () => {
    assert.equal(formatRelease(Date.UTC(2026, 9, 14), NOW), '14 October');
    assert.equal(formatRelease(Date.UTC(2027, 9, 14), NOW), '14 October 2027');
    assert.equal(formatRelease(null, NOW), null);
  });

  test('the shelf line counts what is readable and names what is next', () => {
    const rows = [
      row({ ordinal: 1, releaseAtMs: PAST }),
      row({ ordinal: 2, releaseAtMs: FUTURE }),
    ];
    assert.equal(shelfLine(rows, NOW), '1 instalment · next 14 November');
    assert.equal(shelfLine([rows[0]], NOW), '1 instalment');
    assert.equal(shelfLine([rows[1]], NOW), 'Arriving soon · next 14 November');
    assert.equal(shelfLine([], NOW), 'Arriving soon');
  });

  test('two instalments is plural, one is not', () => {
    const two = [row({ ordinal: 1, releaseAtMs: PAST }), row({ ordinal: 2, releaseAtMs: PAST })];
    assert.equal(shelfLine(two, NOW), '2 instalments');
  });
});

describe('THE TIER GATE FLAG — and the release gate that does not move with it', () => {
  // SERIES_TIER_GATE_ENABLED is false while MEMBERSHIPS_ON_SALE is false: gating against a
  // tier nobody can buy refuses every reader in the name of a product the site will not sell.
  // Same shape as GATING_ENABLED — the POLICY is asserted through policyGrantForInstalment so
  // it cannot rot while switched off, the SWITCH through grantForInstalment.

  // ── THE THREE TESTS BELOW ASSERT THE FLAG'S CURRENT POSITION, NOT THE POLICY ──────────
  //
  // They are a TRIPWIRE, and going red is their job on the day someone flips
  // SERIES_TIER_GATE_ENABLED to true. That is not a bug to route around: turning the Series
  // on is a commercial decision that should require touching the suite that describes it, in
  // the same commit, deliberately. The instruction is in the message so nobody has to guess.
  //
  // WHAT TO DO WHEN THEY FAIL AFTER AN INTENTIONAL FLIP: change `false` to `true` here and
  // delete the two 'with the flag off' cases. Change NOTHING else — every other test in this
  // file is about the policy or the release gate and must keep passing untouched. If one of
  // those goes red too, the flip broke something real.
  const FLIP_HINT = 'flag flipped? update this describe and nothing else — see the note above';

  test('the flag is off today, matching MEMBERSHIPS_ON_SALE', () => {
    assert.equal(SERIES_TIER_GATE_ENABLED, false, FLIP_HINT);
  });

  test('with the flag off, an anonymous reader is granted a released instalment', () => {
    for (const freeForGold of [true, false]) {
      const g = grantForInstalment(row({ freeForGold }), { subscriptionTier: 'free', signedIn: false, now: NOW });
      assert.equal(g.access, 'granted', `freeForGold=${freeForGold} — ${FLIP_HINT}`);
      assert.equal(g.reason, TIER_GATE_OFF);
      assert.equal(g.status, 200);
    }
  });

  test('...and so is a day-pass holder, who the policy would refuse', () => {
    const g = grantForInstalment(row({ freeForGold: true }), { subscriptionTier: 'free', effectiveTier: 'gold', now: NOW });
    assert.equal(g.access, 'granted', FLIP_HINT);
    assert.equal(g.reason, TIER_GATE_OFF);
  });

  test('flipping the flag ON restores the policy EXACTLY — a toggle, not a one-way door', () => {
    // The mathematical form of "flipping it back off restores exactly the tier-gated
    // behaviour". grantForInstalment is `policy + switch`, and the switch's only clause is
    // `if (!FLAG && code is tier_too_low|signed_out)`. So with FLAG true the wrapper IS the
    // policy for every possible input — asserted here over the whole space rather than
    // reasoned about, because "it's obviously the same" is how a wrapper grows a second
    // clause nobody notices.
    //
    // Verified by direct execution too: with the constant temporarily set true, 0 of 432
    // input combinations differed between the two functions.
    let differing = 0;
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const eff of ['free', 'gold', 'platinum', null]) {
        for (const freeForGold of [true, false]) {
          for (const releaseAtMs of [PAST, FUTURE, NOW]) {
            for (const status of ['published', 'draft', 'unpublished']) {
              for (const signedIn of [true, false]) {
                const r = row({ freeForGold, releaseAtMs, status });
                const o = { subscriptionTier: tier, effectiveTier: eff, signedIn, now: NOW };
                const policy = policyGrantForInstalment(r, o);
                const wrapped = grantForInstalment(r, o);
                // With the flag OFF the only permitted divergence is a tier refusal opening.
                if (JSON.stringify(policy) !== JSON.stringify(wrapped)) {
                  differing++;
                  assert.ok(['tier_too_low', 'signed_out'].includes(policy.code),
                    `divergence on a ${policy.code} grant — the switch reaches further than its two codes`);
                }
              }
            }
          }
        }
      }
    }
    // Sanity: the switch must actually be doing something, or this test proves nothing.
    assert.ok(differing > 0, 'the switch changed no grant at all — is it wired in?');
  });

  test('⛔ THE RELEASE GATE DOES NOT MOVE — unreleased is still refused to everyone', () => {
    // The whole point. A future instalment stays invisible whichever way the tier flag sits;
    // "the paywall is down" has no reading that also means "next month's is out early".
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const signedIn of [true, false]) {
        const g = grantForInstalment(row({ releaseAtMs: FUTURE }), { subscriptionTier: tier, signedIn, now: NOW });
        assert.equal(g.access, 'locked', `${tier}/${signedIn}`);
        assert.equal(g.code, 'not_released');
        assert.equal(g.reason, 'not_released');
        assert.equal(g.releaseAtMs, FUTURE);
      }
    }
  });

  test('a draft or withdrawn instalment is still refused with the flag off', () => {
    for (const status of ['draft', 'unpublished']) {
      const g = grantForInstalment(row({ status }), { subscriptionTier: 'free', signedIn: false, now: NOW });
      assert.equal(g.code, 'not_released', status);
    }
  });

  test('the flag rewrites ONLY tier_too_low and signed_out', () => {
    // Asserted as a property rather than by inspection: across the whole input space, every
    // grant the switch changed must have been one of those two codes.
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const freeForGold of [true, false]) {
        for (const releaseAtMs of [PAST, FUTURE]) {
          for (const status of ['published', 'draft']) {
            for (const signedIn of [true, false]) {
              const opts = { subscriptionTier: tier, effectiveTier: 'gold', signedIn, now: NOW };
              const r = row({ freeForGold, releaseAtMs, status });
              const policy = policyGrantForInstalment(r, opts);
              const actual = grantForInstalment(r, opts);
              if (policy.access === actual.access && policy.reason === actual.reason) continue;
              assert.ok(['tier_too_low', 'signed_out'].includes(policy.code),
                `the switch changed a ${policy.code} grant, which it must never do`);
              assert.equal(actual.access, 'granted');
            }
          }
        }
      }
    }
  });

  test('THE POLICY IS INTACT BENEATH THE SWITCH — flipping it back restores every refusal', () => {
    // policyGrantForInstalment is exactly what grantForInstalment returns when the flag is
    // true, so asserting the policy here IS asserting the flipped-on behaviour. These are the
    // same expectations proven live against production with the gate up.
    const p = (r, o) => policyGrantForInstalment(r, { now: NOW, ...o });
    assert.equal(p(row(), { subscriptionTier: 'platinum' }).access, 'granted');
    assert.equal(p(row({ freeForGold: true }), { subscriptionTier: 'gold' }).reason, 'gold_taste');
    assert.equal(p(row({ freeForGold: false }), { subscriptionTier: 'gold' }).reason, 'needs_platinum');
    assert.equal(p(row({ freeForGold: true }), { subscriptionTier: 'free' }).reason, 'needs_gold');
    assert.equal(p(row(), { subscriptionTier: 'free', signedIn: false }).code, 'signed_out');
    assert.equal(p(row({ freeForGold: true }), { subscriptionTier: 'free', effectiveTier: 'gold' }).reason, 'pass_excluded');
  });

  test('the endpoint skips identity and the membership reads while the flag is off', () => {
    const src = readFileSync(fileURLToPath(new URL('functions/api/series/stream.js', ROOT)), 'utf8');
    assert.ok(/if \(!SERIES_TIER_GATE_ENABLED\)/.test(src), 'the endpoint does not branch on the flag');
    // The release check must sit ABOVE that branch, or an unreleased instalment could be
    // handed out by the free path.
    assert.ok(src.indexOf("reason === 'not_released'") < src.indexOf('if (!SERIES_TIER_GATE_ENABLED)'),
      'the release check must run BEFORE the tier-gate branch');
  });

  test('the homepage row and the landing page follow the same flag', () => {
    for (const f of ['app/public-library/page.js', 'app/series/page.js']) {
      const src = readFileSync(fileURLToPath(new URL(f, ROOT)), 'utf8');
      assert.ok(/SERIES_TIER_GATE_ENABLED/.test(src), `${f} does not read the flag`);
    }
  });
});

describe('a pulled story keeps no page at a URL a reader can type', () => {
  // R12.1. The pull unpublishes; it does not delete. Before this predicate existed, all three
  // generateStaticParams enumerated every cms_stories key, so hiding a story delisted it and
  // left its page standing — 182 built pages against 158 published records on the deploy that
  // found it. For a reader-mode record that page redirected to /reader/<slug>, which resolved
  // a still-public epubUrl. Delisted was not gone.
  test('an unpublished story with no schedule gets no page', () => {
    assert.equal(hasStaticPage({ published: false }), false);
    assert.equal(hasStaticPage({ published: false, publishAt: '' }), false);
    assert.equal(hasStaticPage({ published: false, publishAt: null }), false);
  });

  test('a published story does', () => {
    assert.equal(hasStaticPage({ published: true }), true);
    assert.equal(hasStaticPage({}), true);           // absent means published, as everywhere else
    assert.equal(hasStaticPage(null), true);
  });

  test('a SCHEDULED story still does — the cron flips a record, not a deploy', () => {
    // The external calvary-newsletter Worker sets published:true when publishAt arrives. If
    // the page were not already built, the story would go live to a 404 until someone
    // deployed. Presence, not futurity: the page must survive the instant the schedule fires,
    // when the record is briefly still published:false with a past publishAt.
    assert.equal(hasStaticPage({ published: false, publishAt: '2027-01-01T09:00:00Z' }), true);
    assert.equal(hasStaticPage({ published: false, publishAt: '2020-01-01T09:00:00Z' }), true);
  });

  test('all three route enumerations use it', () => {
    for (const f of ['app/stories/[slug]/page.js', 'app/stories/[slug]/layout.js', 'app/reader/[slug]/page.js']) {
      const src = readFileSync(fileURLToPath(new URL(f, ROOT)), 'utf8');
      assert.ok(/hasStaticPage/.test(src), `${f} does not filter generateStaticParams`);
    }
  });
});

describe('wiring', () => {
  test('the instalment reader is an immersive route — no verification banner over a book', () => {
    assert.equal(isImmersive('/series/read/beta-princess-i1'), true);
    assert.equal(isImmersive('/series/read/'), true);
    // The landing page is NOT immersive: it is a browsing surface and wants the banner.
    assert.equal(isImmersive('/series'), false);
    assert.equal(isImmersive('/series/beta-princess'), false);
    assert.ok(IMMERSIVE_ROUTES.some((re) => re.source.includes('series')));
  });

  test('/serial is retired: no route, no sitemap entry, and a redirect exists', () => {
    // Comments are stripped first — the sitemap's own note explains the swap and names the
    // retired route, and a naive grep would read that prose as a live entry.
    const sitemap = readFileSync(fileURLToPath(new URL('app/sitemap.js', ROOT)), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.equal(/'\/serial'/.test(sitemap), false, 'sitemap still lists /serial');
    assert.ok(/'\/series'/.test(sitemap), 'sitemap does not list /series');

    const redirects = readFileSync(fileURLToPath(new URL('scripts/generate-redirects.mjs', ROOT)), 'utf8');
    assert.ok(/\['\/serial',\s*'\/series'\]/.test(redirects), 'no /serial → /series redirect');
  });

  test('the gating kill switch states that it does not cover the Series', () => {
    const src = readFileSync(fileURLToPath(new URL('app/lib/storyAccess.js', ROOT)), 'utf8');
    assert.ok(/WHAT THIS SWITCH DOES NOT COVER: THE SERIES/.test(src));
  });

  test('the release rule is in database.rules.json and compares against `now`', () => {
    const rules = JSON.parse(readFileSync(fileURLToPath(new URL('database.rules.json', ROOT)), 'utf8')).rules;
    const read = rules.series_instalments_detail.$instalmentId['.read'];
    assert.ok(/releaseAtMs/.test(read), 'the detail rule does not mention releaseAtMs');
    assert.ok(/<= now/.test(read), 'the detail rule does not compare against the server clock');
    assert.ok(/isNumber\(\)/.test(read), 'the detail rule does not require a numeric releaseAtMs');
    // The detail node must NOT be listable, or the whole split is decorative.
    assert.equal(rules.series_instalments_detail['.read'], undefined);
    // The row node must be public — it is what a locked card prints.
    assert.equal(rules.series_instalments['.read'], true);
  });

  test('progress is owner-writable, so account deletion can wipe it from the client', () => {
    const rules = JSON.parse(readFileSync(fileURLToPath(new URL('database.rules.json', ROOT)), 'utf8')).rules;
    const node = rules.series_reading_progress.$uid;
    assert.equal(node['.write'], 'auth != null && auth.uid == $uid');
    // Closed record, same as the bookstore's — which is why it could not be shared.
    assert.equal(node.$instalmentId.$other['.validate'], false);
  });

  test('series EPUBs are read:false in storage.rules', () => {
    const src = readFileSync(fileURLToPath(new URL('storage.rules', ROOT)), 'utf8');
    const block = src.slice(src.indexOf('match /series_epubs/'));
    assert.ok(/allow read: if false;/.test(block.slice(0, 400)), 'series_epubs master.epub is not read:false');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R12.4 · the instalment page — logline, sponsor, and a reading time nobody typed', () => {
  const detail = (over = {}) => ({
    schemaVersion: 1,
    title: 'Part One',
    synopsis: null,
    logline: null,
    author: 'Monica Garcia',
    authorUid: 'u',
    authorHandle: 'h',
    coverUrl: null,
    epubPath: 'p',
    sponsorName: null,
    sponsorLogoUrl: null,
    wordCount: null,
    updatedAt: 1,
    ...over,
  });

  // ── THE GATE, ASSERTED WHERE IT IS ACTUALLY DECIDED ────────────────────────────────────
  //
  // "As invisible as its title" is not a rendering promise, it is a PLACEMENT one: the three
  // new reveals are invisible before release because they sit on the node the rule denies. So
  // the test is which schema they are on, not what some component does with them. A field that
  // migrated to the public row would still render correctly on the page and would leak.
  describe('the new fields are behind the release gate BY PLACEMENT', () => {
    for (const field of ['logline', 'sponsorName', 'sponsorLogoUrl', 'wordCount']) {
      test(`${field} is on the detail record, never on the public row`, () => {
        assert.ok(field in INSTALMENT_DETAIL_SCHEMA, `${field} is missing from INSTALMENT_DETAIL_SCHEMA`);
        assert.equal(field in INSTALMENT_SCHEMA, false,
          `${field} is on the PUBLIC row — it would be readable before release by anyone with curl`);
      });
    }

    test('and the row schema still carries only what a locked card may print', () => {
      assert.deepEqual(
        Object.keys(INSTALMENT_SCHEMA).sort(),
        ['addedAt', 'freeForGold', 'ordinal', 'releaseAtMs', 'schemaVersion', 'seriesId', 'status', 'updatedAt'],
      );
    });

    test('the loader does not even ASK for the detail of an unreleased instalment', () => {
      const src = readFileSync(fileURLToPath(new URL('app/lib/series/loader.js', ROOT)), 'utf8');
      const fn = src.slice(src.indexOf('export async function getInstalmentPage'));
      assert.ok(/released \? await getInstalmentDetail\(instalmentId\) : null/.test(fn),
        'getInstalmentPage fires the detail read unconditionally — the rule becomes the only refusal');
    });

    test('the unreleased branch of the page cannot name a single gated field', () => {
      const src = readFileSync(fileURLToPath(new URL('app/series/instalment/[instalmentId]/page-instalment.js', ROOT)), 'utf8');
      const notYet = src.slice(src.indexOf('function NotYet('), src.indexOf('function Missing('));
      assert.ok(notYet.length > 200, 'NotYet was not found — this assertion is measuring nothing');
      for (const field of ['detail', 'logline', 'sponsor', 'wordCount', 'coverUrl', 'author']) {
        assert.equal(new RegExp(field, 'i').test(notYet), false,
          `the pre-release page mentions ${field} — it renders from the public row and the parent series only`);
      }
    });

    test('every gated field on the page is read off `detail`, with no fallback', () => {
      const src = readFileSync(fileURLToPath(new URL('app/series/instalment/[instalmentId]/page-instalment.js', ROOT)), 'utf8');
      const body = src.slice(src.indexOf('export default function'));
      for (const field of ['logline', 'sponsorName', 'sponsorLogoUrl', 'wordCount', 'coverUrl']) {
        // Every read of the field is `detail?.field`. A `row.logline` or a `|| something`
        // fallback would be a second source for a fact that has exactly one.
        const reads = [...body.matchAll(new RegExp(`[\\w?.]*\\.${field}\\b`, 'g'))].map((m) => m[0]);
        assert.ok(reads.length > 0, `${field} is never read on the page`);
        for (const r of reads) {
          assert.equal(r, `detail?.${field}`, `${field} is read as ${r} — the only source is the denied node`);
        }
      }
    });

    test('the instalment route bakes no metadata — same ruling as the reader route', () => {
      const src = readFileSync(fileURLToPath(new URL('app/series/instalment/[instalmentId]/page.js', ROOT)), 'utf8');
      assert.equal(/export async function generateMetadata/.test(src), false,
        'a build with a service credential would bake unreleased loglines into static HTML');
      // It still enumerates from the PUBLIC row node, ids only. Comments are stripped first:
      // the header explains at length why the detail node is not read here, and a naive grep
      // would fail on the explanation.
      const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      assert.ok(/'series_instalments'/.test(code));
      assert.equal(/series_instalments_detail/.test(code), false);
    });
  });

  // ── THE VALIDATOR ──────────────────────────────────────────────────────────────────────
  describe('the writer refuses what the page cannot render', () => {
    test('all three new strings are optional, and null is how they are absent', () => {
      assert.equal(validateInstalmentDetail(detail()).valid, true);
      assert.equal(validateInstalmentDetail(detail({
        logline: 'A princess, a protocol, and a week to decide.',
        sponsorName: 'Ada Type Foundry',
        sponsorLogoUrl: 'https://example.test/logo.png',
      })).valid, true);
    });

    for (const field of ['logline', 'sponsorName', 'sponsorLogoUrl']) {
      test(`${field} rejects the empty string — absent is null, as everywhere else`, () => {
        const r = validateInstalmentDetail(detail({ sponsorName: 'X', [field]: '' }));
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => e.includes(field)), r.errors.join('; '));
      });
    }

    test('a sponsor logo with no sponsor name is refused', () => {
      const r = validateInstalmentDetail(detail({ sponsorLogoUrl: 'https://example.test/logo.png' }));
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /sponsorLogoUrl requires sponsorName/.test(e)));
    });

    test('a sponsor name with no logo is fine — the credit drops the tile', () => {
      assert.equal(validateInstalmentDetail(detail({ sponsorName: 'Ada Type Foundry' })).valid, true);
    });

    test('wordCount is a positive integer or null, and nothing else', () => {
      assert.equal(validateInstalmentDetail(detail({ wordCount: 12345 })).valid, true);
      assert.equal(validateInstalmentDetail(detail({ wordCount: null })).valid, true);
      for (const bad of [0, -1, 12.5, '12345', true]) {
        assert.equal(validateInstalmentDetail(detail({ wordCount: bad })).valid, false, String(bad));
      }
    });
  });

  // ── READING TIME ───────────────────────────────────────────────────────────────────────
  describe('reading time is derived, and says nothing when it does not know', () => {
    test('no count means NO CREDIT — never a zero, never a guess', () => {
      for (const v of [null, undefined, 0, -5, NaN, '3000']) {
        assert.equal(readingMinutes(v), null, String(v));
        assert.equal(readingTimeLabel(v), null, String(v));
      }
    });

    test('220 words is one minute, 221 is two — the platform pace, rounded up', () => {
      assert.equal(readingMinutes(220), 1);
      assert.equal(readingMinutes(221), 2);
      assert.equal(readingMinutes(4400), 20);
      assert.equal(readingTimeLabel(4400), '20 min');
    });

    test('one word still reads as a minute, not as nothing', () => {
      assert.equal(readingTimeLabel(1), '1 min');
    });

    test('the pace matches indexReadTime — one platform, one number', () => {
      assert.equal(WORDS_PER_MINUTE, 220);
      const src = readFileSync(fileURLToPath(new URL('app/lib/storyIndex.js', ROOT)), 'utf8');
      assert.ok(src.includes('.length / 220'),
        'storyIndex.js no longer divides by 220 — the two surfaces now show different minutes for the same prose');
    });

    test('THE COUNT COMES FROM THE UPLOADER AND FROM NOWHERE ELSE', () => {
      // A typed figure is stale the moment a chapter is revised, and the record cannot say so.
      // The count is taken from the File in the same call that uploads it, which is the last
      // moment those bytes are readable — series_epubs/** is `read: false` for this admin too.
      const writes = readFileSync(fileURLToPath(new URL('app/lib/series/admin-writes.js', ROOT)), 'utf8');
      const upload = writes.slice(writes.indexOf('export async function uploadInstalmentEpub'));
      assert.ok(/countEpubWords/.test(upload), 'uploadInstalmentEpub does not count the words it is uploading');
      assert.ok(upload.indexOf('countEpubWords') < upload.indexOf('uploadBytesResumable'),
        'the count must be taken BEFORE the bytes are uploaded');

      const admin = readFileSync(fileURLToPath(new URL('app/admin/series/page.js', ROOT)), 'utf8');
      assert.equal(/wordCount: (Number|f\.|e\.target)/.test(admin), false,
        'the admin binds an input to wordCount — reading time must never be typed');
      assert.ok(/wordCount: up\.wordCount/.test(admin),
        'the admin does not carry the uploader\'s count into the record');
      // Path and count describe the same bytes, so they land in the same write.
      assert.ok(/epubPath: up\.epubPath, wordCount: up\.wordCount/.test(admin),
        'epubPath and wordCount are written separately — one can outlive the other');
    });
  });

  // ── COPY ───────────────────────────────────────────────────────────────────────────────
  describe('the page copy, in one place so it cannot drift', () => {
    test('the eyebrow is the series title and the instalment label, joined', () => {
      assert.equal(instalmentEyebrow('Beta Princess', 2), 'Beta Princess · Instalment 2');
      assert.ok(instalmentEyebrow('X', 3).endsWith(instalmentLabel(3)));
    });

    test('the button names the instalment it opens', () => {
      assert.equal(readActionLabel(2), 'Read Instalment 2');
    });

    test('the date credit is past tense once the date has passed', () => {
      // "releases · 14 October" over a date four months gone is the one credit on the page a
      // reader can check against a calendar, and it was wrong in the present tense.
      assert.equal(releaseCreditLabel(PAST, NOW), 'released');
      assert.equal(releaseCreditLabel(FUTURE, NOW), 'releases');
      // The boundary matches isReleased(): equal to now HAS released.
      assert.equal(releaseCreditLabel(NOW, NOW), 'released');
      assert.equal(releaseCreditLabel(NOW + 1, NOW), 'releases');
    });

    test('a dateless credit takes the future tense — the safer of the two slips', () => {
      for (const bad of [null, undefined, NaN, '2026-10-14']) {
        assert.equal(releaseCreditLabel(bad, NOW), 'releases', String(bad));
      }
    });

    test('the page derives the word rather than hardcoding it', () => {
      const src = readFileSync(fileURLToPath(new URL('app/series/instalment/[instalmentId]/page-instalment.js', ROOT)), 'utf8');
      assert.ok(/label=\{releaseCreditLabel\(row\.releaseAtMs\)\}/.test(src));
      assert.equal(/label="releases"|label="released"/.test(src), false,
        'the tense is hardcoded — it would be the wrong word on the other side of the date');
    });

    test('the sponsor preamble is sentence case, like the credits beside it', () => {
      assert.equal(SPONSOR_PREAMBLE, 'this instalment made possible by');
      assert.equal(SPONSOR_PREAMBLE, SPONSOR_PREAMBLE.toLowerCase());
    });

    test('CAPS APPEAR EXACTLY TWICE BELOW THE NAV, AND BOTH ARE THE EYEBROW', () => {
      // The deliberate constraint of the approved design: small caps for the kicker and for
      // nothing else, so the page does not read as five competing blocks of caps. The nav's
      // own "Membership" link keeps its caps — it is site chrome shared with /series — which
      // is why the count stops at Shell.
      const src = readFileSync(fileURLToPath(new URL('app/series/instalment/[instalmentId]/page-instalment.js', ROOT)), 'utf8');
      const body = src.slice(src.indexOf('export default function'), src.indexOf('function Shell('));
      const caps = [...body.matchAll(/textTransform: 'uppercase'/g)];
      assert.equal(caps.length, 2, 'the released page and the pre-release page each carry exactly one eyebrow');
      const shell = src.slice(src.indexOf('function Shell('));
      assert.equal([...shell.matchAll(/textTransform: 'uppercase'/g)].length, 1, 'the nav link');
    });
  });

  // ── WIRING ─────────────────────────────────────────────────────────────────────────────
  describe('wiring', () => {
    test('a series row opens the instalment page, not the file', () => {
      const src = readFileSync(fileURLToPath(new URL('app/series/[slug]/page-detail.js', ROOT)), 'utf8');
      assert.ok(/router\.push\(`\/series\/instalment\/\$\{inst\.id\}`\)/.test(src));
    });

    test('the instalment page is a browsing surface, so the banner is welcome on it', () => {
      assert.equal(isImmersive('/series/instalment/beta-princess-i1'), false);
      // The READER is still immersive. The two must not be confused by the shared prefix.
      assert.equal(isImmersive('/series/read/beta-princess-i1'), true);
    });

    test('instalment art keys are derived, and cannot walk out of series_covers/', () => {
      assert.equal(instalmentImageKey('beta-princess-i1', 'cover'), 'beta-princess-i1/cover');
      assert.equal(instalmentImageKey('beta-princess-i1', 'sponsor'), 'beta-princess-i1/sponsor');
      assert.throws(() => instalmentImageKey('beta-princess-i1', 'poster'));
    });

    test('THE SPONSOR LOGO WRITES ITS NAME WITH IT, IN ONE CALL', () => {
      // The R12.4 bug. The control shipped gated on the SAVED sponsor name, so it was disabled
      // on every live instalment and a <label> around a disabled input opens no file picker —
      // dead on arrival, and reported as such. The fix is not a looser gate: it is writing the
      // name and the URL in the one atomic update they always belonged in, which is what lets
      // the gate read the TYPED value without the validator refusing the write.
      //
      // Driven end to end by tests/series/sponsor-logo.spec.mjs against the emulators. This is
      // the cheap structural half, so a refactor that split the write cannot pass `test:ci`.
      const src = readFileSync(fileURLToPath(new URL('app/admin/series/page.js', ROOT)), 'utf8');
      assert.ok(/\(url\) => \(\{ sponsorName, sponsorLogoUrl: url \}\)/.test(src),
        'the sponsor upload no longer writes sponsorName alongside the URL');
      assert.ok(/disabled=\{!sponsorName\}/.test(src),
        'the sponsor upload is gated on something other than the typed name');
      assert.equal(/disabled=\{!detail\.sponsorName\}/.test(src), false,
        'the gate is back on the SAVED name — this is the bug, exactly as it shipped');
      assert.ok(/'Add a sponsor name first'/.test(src),
        'the disabled button no longer says what to do about itself');
    });

    test('the emulator switch cannot fire anywhere but localhost', () => {
      // app/lib/firebase.js gains a branch that repoints the whole client at 127.0.0.1 so the
      // browser suite can drive a real upload without writing to production. Two conditions
      // guard it and the SECOND is the one that matters: NEXT_PUBLIC_FB_EMULATOR is inlined at
      // build time and could in principle be set by accident on a deploy, but the hostname
      // check is evaluated in the reader's browser and no build flag can satisfy it.
      const src = readFileSync(fileURLToPath(new URL('app/lib/firebase.js', ROOT)), 'utf8');
      const guard = src.slice(src.indexOf('if (typeof window'), src.indexOf('connectAuthEmulator(auth'));
      assert.ok(/NEXT_PUBLIC_FB_EMULATOR === '1'/.test(guard), 'the build flag is not required');
      assert.ok(/hostname === 'localhost'/.test(guard) && /hostname === '127\.0\.0\.1'/.test(guard),
        'the hostname fence is gone — a mis-set build flag could repoint production');
      // AND, not OR. An `||` here would make the hostname check a second way IN rather than a
      // second lock, and any localhost page would leave production.
      assert.ok(/\)\s*&&\s*process\.env\.NEXT_PUBLIC_FB_EMULATOR/.test(guard.replace(/\n\s*/g, ' '))
        || /window !== 'undefined'\s*&& process\.env/.test(guard.replace(/\n\s*/g, ' ')),
        'the two conditions are not ANDed together');
      assert.equal(/\|\|\s*process\.env\.NEXT_PUBLIC_FB_EMULATOR/.test(guard), false);
    });

    test('the sponsor logo reuses the image path the cover already uses', () => {
      // No storage.rules change was needed and none was made: series_covers/{allPaths=**}
      // already matches a nested key, at public read and admin-only write.
      const src = readFileSync(fileURLToPath(new URL('storage.rules', ROOT)), 'utf8');
      assert.ok(/match \/series_covers\/\{allPaths=\*\*\}/.test(src));
      const writes = readFileSync(fileURLToPath(new URL('app/lib/series/admin-writes.js', ROOT)), 'utf8');
      assert.ok(/uploadInstalmentImage[\s\S]{0,900}uploadSeriesImage\(key, file, onProgress\)/.test(writes));
    });
  });
});
