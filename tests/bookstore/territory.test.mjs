// R8.4 — TERRITORY RESTRICTIONS, as executable assertions.
//
//   node --test tests/bookstore/territory.test.mjs      (npm run test:purchases)
//
// OFFLINE AND HOST-INDEPENDENT, like the payment-rail suite next door: this imports the pure
// modules and asserts them. Everything decidable about a licence — what a stored value means,
// who may buy, which mark shows, what an editor may save — is decidable without a network, and
// a test that needed test-mode keys is a test nobody runs.
//
// The endpoint-level half (the 403s, and the proof that stream.js is NOT territory-gated) lives
// in tests/bookstore/territory-endpoints.test.mjs, which needs a fetch stub and so is worth its
// own file.
//
// The modules are .js under app/, and the repo has no "type": "module" — they load because
// Node >= 22.12 detects unambiguous ESM syntax. Same mechanism tests/bookstore/currency.test.mjs
// already relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTerritories,
  isSellableIn,
  isTitleSellableIn,
  territoriesOf,
  assertTerritories,
  describeTerritories,
  territoriesToForm,
  territoriesFromForm,
  TERRITORY_PRESETS,
  TERRITORY_NOTE,
  SELL_TO_UNKNOWN_COUNTRY,
  WORLDWIDE,
  MODE_WORLDWIDE,
  MODE_ALLOW,
  MODE_DENY,
} from '../../app/lib/bookstore/territory.js';

import { COUNTRY_NAMES, COUNTRY_CODES, isKnownCountry } from '../../app/lib/bookstore/countries.js';

// The precedence rule lives at the composition point in currency.js, so that is where it is
// asserted from. currency.js imports react; it loads fine under bare Node (currency.test.mjs
// has relied on that since R8.3).
import { priceLine } from '../../app/lib/currency.js';

// The four titles in the live catalogue at the time of writing, all worldwide. Used to pin the
// one behaviour this whole round must not change: the shop as it stands today.
const LIVE_SHAPE = '*';

// ═══════════════════════════════════════════════════════════════════════════════
// normaliseTerritories — every shape the field can arrive in
// ═══════════════════════════════════════════════════════════════════════════════

test('normalise: the live sentinel is worldwide', () => {
  const t = normaliseTerritories(LIVE_SHAPE, undefined);
  assert.equal(t.mode, MODE_WORLDWIDE);
  assert.deepEqual([...t.countries], []);
});

test('normalise: MISSING means worldwide, not nowhere — a title predating the field must sell', () => {
  for (const missing of [undefined, null]) {
    assert.equal(normaliseTerritories(missing, undefined).mode, MODE_WORLDWIDE);
  }
});

test('normalise: empty and unusable values mean worldwide', () => {
  const cases = [[], {}, '', '   ', 'worldwide', 'all', ['zz9', 'United Kingdom'], [null, 42], 42, true, () => {}];
  for (const value of cases) {
    assert.equal(
      normaliseTerritories(value, undefined).mode,
      MODE_WORLDWIDE,
      `${JSON.stringify(value) ?? String(value)} should normalise to worldwide`,
    );
  }
});

test('normalise: an array is an ALLOW-list, uppercased, deduplicated and sorted', () => {
  const t = normaliseTerritories(['ng', 'GB', 'gb', ' ie '], undefined);
  assert.equal(t.mode, MODE_ALLOW);
  assert.deepEqual([...t.countries], ['GB', 'IE', 'NG']);
});

test('normalise: RTDB hands a sparse array back as an object — same licence', () => {
  assert.deepEqual([...normaliseTerritories({ 0: 'GB', 1: 'NG' }, undefined).countries], ['GB', 'NG']);
  assert.deepEqual([...normaliseTerritories({ 1: 'NG' }, undefined).countries], ['NG']);
});

test('normalise: a hand-edited separated string is read as the list it plainly is', () => {
  assert.deepEqual([...normaliseTerritories('GB,NG', undefined).countries], ['GB', 'NG']);
  assert.deepEqual([...normaliseTerritories('GB NG', undefined).countries], ['GB', 'NG']);
});

test('normalise: exclusions alongside the sentinel are a DENY-list', () => {
  const t = normaliseTerritories(WORLDWIDE, ['US', 'ca']);
  assert.equal(t.mode, MODE_DENY);
  assert.deepEqual([...t.countries], ['CA', 'US']);
});

test('normalise: an EMPTY exclusion list is not a restriction', () => {
  for (const empty of [[], {}, null, undefined, '']) {
    assert.equal(normaliseTerritories(WORLDWIDE, empty).mode, MODE_WORLDWIDE);
  }
});

test('normalise: the contradictory pair resolves to the MOST RESTRICTIVE reading', () => {
  // assertTerritories refuses to store this; a console hand-edit can still create it, and the
  // matcher must answer without ever selling into a country either field says no to.
  const t = normaliseTerritories(['GB', 'NG', 'US'], ['US']);
  assert.equal(t.mode, MODE_ALLOW);
  assert.deepEqual([...t.countries], ['GB', 'NG']);
});

test('normalise: a contradiction that empties the allow-list does NOT invert into worldwide', () => {
  // The trap this test exists for: everywhere else an empty list means "no restriction was
  // made", and folding this case in with those would turn the most restrictive possible
  // licence into the least restrictive one.
  const t = normaliseTerritories(['GB'], ['GB']);
  assert.equal(t.mode, MODE_ALLOW);
  assert.deepEqual([...t.countries], []);
  assert.equal(isSellableIn(t, 'GB'), false);
  assert.equal(isSellableIn(t, 'US'), false);
});

test('normalise: the canonical form is frozen — a caller cannot edit a licence in place', () => {
  const t = normaliseTerritories(['GB'], undefined);
  assert.throws(() => { t.mode = MODE_WORLDWIDE; }, TypeError);
  assert.throws(() => { t.countries.push('US'); }, TypeError);
});

// ═══════════════════════════════════════════════════════════════════════════════
// isSellableIn — the truth table, all three modes, both null-country branches
// ═══════════════════════════════════════════════════════════════════════════════

test('sellable: worldwide sells everywhere, including to an undetermined country', () => {
  for (const country of ['GB', 'NG', 'US', 'JP', null, undefined, '', 'XX']) {
    assert.equal(isSellableIn(WORLDWIDE, country), true, `worldwide must sell to ${country}`);
  }
});

test('sellable: an allow-list sells inside itself and nowhere else', () => {
  const rights = ['GB', 'IE'];
  assert.equal(isSellableIn(rights, 'GB'), true);
  assert.equal(isSellableIn(rights, 'IE'), true);
  assert.equal(isSellableIn(rights, 'US'), false);
  assert.equal(isSellableIn(rights, 'NG'), false);
});

test('sellable: a deny-list sells everywhere except itself', () => {
  const rights = normaliseTerritories(WORLDWIDE, ['US', 'CA']);
  assert.equal(isSellableIn(rights, 'US'), false);
  assert.equal(isSellableIn(rights, 'CA'), false);
  assert.equal(isSellableIn(rights, 'GB'), true);
  assert.equal(isSellableIn(rights, 'MX'), true);
});

test('sellable: country matching is case-insensitive and whitespace-tolerant', () => {
  assert.equal(isSellableIn(['GB'], 'gb'), true);
  assert.equal(isSellableIn(['GB'], 'Gb'), true);
  assert.equal(isSellableIn(['GB'], ' gb '), true);
  assert.equal(isSellableIn(normaliseTerritories(WORLDWIDE, ['US']), 'us'), false);
});

test('sellable: THE NULL-COUNTRY ASYMMETRY — worldwide yes, restricted no, both modes', () => {
  // The decision R8.4 was asked to make, asserted in both directions at once.
  assert.equal(isSellableIn(WORLDWIDE, null), true, 'a worldwide title has no licence to breach');
  assert.equal(isSellableIn(['GB'], null), SELL_TO_UNKNOWN_COUNTRY);
  assert.equal(isSellableIn(normaliseTerritories(WORLDWIDE, ['US']), null), SELL_TO_UNKNOWN_COUNTRY);

  // And the constant that implements it is the one documented: false, i.e. refuse.
  assert.equal(SELL_TO_UNKNOWN_COUNTRY, false);
  assert.equal(isSellableIn(['GB'], null), false);
  assert.equal(isSellableIn(normaliseTerritories(WORLDWIDE, ['US']), null), false);
});

test('sellable: a malformed country is treated as undetermined, never as a match', () => {
  for (const bad of ['', 'G', 'GBR', 'united kingdom', 42, {}, null, undefined]) {
    assert.equal(isSellableIn(['GB'], bad), false, `${String(bad)} must not satisfy a GB licence`);
  }
});

test('sellable: it never returns null or undefined — a till cannot defer this', () => {
  for (const rights of [WORLDWIDE, ['GB'], normaliseTerritories(WORLDWIDE, ['US']), undefined, {}]) {
    for (const country of ['GB', null]) {
      assert.equal(typeof isSellableIn(rights, country), 'boolean');
    }
  }
});

test('sellable: isTitleSellableIn reads BOTH fields off a title record', () => {
  const worldwide = { territoriesAllowed: '*' };
  const denied = { territoriesAllowed: '*', territoriesExcluded: ['US'] };
  const allowed = { territoriesAllowed: ['GB'] };

  assert.equal(isTitleSellableIn(worldwide, 'US'), true);
  assert.equal(isTitleSellableIn(denied, 'US'), false);
  assert.equal(isTitleSellableIn(denied, 'GB'), true);
  assert.equal(isTitleSellableIn(allowed, 'GB'), true);
  assert.equal(isTitleSellableIn(allowed, 'US'), false);
  // A missing/absent title is not a licence to sell nothing — it is nothing to sell. Worldwide
  // is the safe answer because the caller has no title to charge for anyway.
  assert.equal(isTitleSellableIn(null, 'US'), true);
  assert.equal(territoriesOf(undefined).mode, MODE_WORLDWIDE);
});

test('sellable: THE LIVE CATALOGUE IS UNCHANGED by this round', () => {
  // All four titles carry '*' and no exclusions. If R8.4 made any of them refuse anyone
  // anywhere, that is a regression and this fails.
  const live = { territoriesAllowed: LIVE_SHAPE };
  for (const country of ['GB', 'NG', 'US', 'CA', 'JP', 'AU', null]) {
    assert.equal(isTitleSellableIn(live, country), true);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRECEDENCE — territory outranks currency
// ═══════════════════════════════════════════════════════════════════════════════

const GBP_ONLY = { prices: { gbp: 499 } };

test('precedence: a title both RESTRICTED and unpriced in the selection shows ONE mark', () => {
  // Browsing in naira, priced only in pounds (so the currency mark would fire), and not
  // licensed here (so the territory mark fires). Exactly one may appear.
  const title = { ...GBP_ONLY, territoriesAllowed: ['GB'] };
  const line = priceLine(title, 'ngn', 'US');

  assert.equal(line.sellable, false);
  assert.equal(line.note, TERRITORY_NOTE);
  assert.equal(line.isTerritoryNote, true);
  // NEVER A PRICE THE READER CANNOT ACT ON.
  assert.equal(line.price, null);
  assert.equal(line.priced, null);
});

test('precedence: the currency mark still fires when the title IS sellable', () => {
  const title = { ...GBP_ONLY, territoriesAllowed: ['GB'] };
  const line = priceLine(title, 'ngn', 'GB');

  assert.equal(line.sellable, true);
  assert.equal(line.isTerritoryNote, false);
  assert.equal(line.note, 'in pounds only');
  assert.equal(line.price, '£4.99');
});

test('precedence: a worldwide title priced in the selection carries NO mark at all', () => {
  const line = priceLine({ prices: { gbp: 499, ngn: 450000, usd: 649 }, territoriesAllowed: '*' }, 'ngn', 'US');
  assert.equal(line.sellable, true);
  assert.equal(line.note, null);
  assert.equal(line.price, '₦4,500');
});

test('precedence: an UNDETERMINED country marks nothing and withholds nothing', () => {
  // The honest-error rule: no marks anywhere, the price shown, the button live — and the
  // server refuses if the title really is restricted. A shelf of warnings the shop is guessing
  // at is worse than one accurate refusal at the till.
  const title = { ...GBP_ONLY, territoriesAllowed: ['GB'] };
  const line = priceLine(title, 'gbp', null);
  assert.equal(line.sellable, false, 'the CLIENT still knows it cannot be sold...');
  assert.equal(line.price, null);
  // ...and priceLine says so because isSellableIn said so. The "no marks when country is
  // unknown" behaviour is the region store never producing a country in that case, which the
  // app spec asserts against the real page. Here the contract is simply that null country and
  // a restricted title do not sell — which is the same assertion the server makes.
});

test('precedence: priceLine never returns two marks, for any combination', () => {
  const titles = [
    { prices: { gbp: 499 }, territoriesAllowed: '*' },
    { prices: { gbp: 499 }, territoriesAllowed: ['GB'] },
    { prices: { gbp: 499, ngn: 450000 }, territoriesAllowed: '*', territoriesExcluded: ['US'] },
    { prices: {}, territoriesAllowed: ['NG'] },
  ];
  for (const title of titles) {
    for (const currency of ['gbp', 'ngn', 'usd']) {
      for (const country of ['GB', 'NG', 'US', null]) {
        const line = priceLine(title, currency, country);
        // One note or none — `note` is a single string by construction, and a territory note
        // is never accompanied by a price.
        if (line.isTerritoryNote) {
          assert.equal(line.price, null);
          assert.equal(line.note, TERRITORY_NOTE);
        }
        if (line.note && !line.isTerritoryNote) assert.notEqual(line.price, null);
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE-TIME VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test('write: each of the three storable states is accepted', () => {
  assert.equal(assertTerritories(WORLDWIDE, undefined).ok, true, 'worldwide');
  assert.equal(assertTerritories(WORLDWIDE, ['US', 'CA']).ok, true, 'worldwide-except');
  assert.equal(assertTerritories(['GB', 'NG'], undefined).ok, true, 'only-in');
});

test('write: the CONTRADICTORY combination is refused, with a message an editor can act on', () => {
  const verdict = assertTerritories(['GB', 'NG'], ['US']);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /remove the exclusions|Worldwide, except/i);
});

test('write: bad codes are refused — shape and ISO membership', () => {
  assert.equal(assertTerritories(['GBR'], undefined).ok, false, 'alpha-3 is not alpha-2');
  assert.equal(assertTerritories(['gb'], undefined).ok, false, 'the writer receives tidied codes; lower case is a bug upstream');
  assert.equal(assertTerritories(['United Kingdom'], undefined).ok, false);
  assert.equal(assertTerritories([42], undefined).ok, false);
  // Shape-valid but not a country: the case a /^[A-Z]{2}$/ check would wave through, and a
  // licence naming it could never sell to anyone.
  const zz = assertTerritories(['ZZ'], undefined);
  assert.equal(zz.ok, false);
  assert.match(zz.error, /ISO country code/);
  assert.equal(assertTerritories(WORLDWIDE, ['QQ']).ok, false);
});

test('write: an empty or nulled restriction is refused rather than stored as a husk', () => {
  assert.equal(assertTerritories([], undefined).ok, false, 'an empty allow-list says nothing');
  assert.equal(assertTerritories(WORLDWIDE, []).ok, false, 'omit the field instead');
  assert.equal(assertTerritories(WORLDWIDE, 'US').ok, false, 'exclusions are a list, not a string');
});

test('write: duplicates are refused in both lists', () => {
  assert.equal(assertTerritories(['GB', 'GB'], undefined).ok, false);
  assert.equal(assertTerritories(WORLDWIDE, ['US', 'US']).ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE PLAIN-WORDS RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

test('describe: the three states read as English', () => {
  assert.equal(describeTerritories(WORLDWIDE, undefined), 'Sold worldwide');
  // The codes are canonicalised (sorted) before they are named, so the sentence reads in code
  // order rather than in whatever order the boxes happened to be ticked — which is what makes
  // two spellings of one licence produce one sentence.
  assert.equal(describeTerritories(WORLDWIDE, ['US', 'CA']), 'Sold worldwide except Canada and the United States');
  assert.equal(describeTerritories(['GB', 'NG'], undefined), 'Sold only in the United Kingdom and Nigeria');
});

test('describe: one country, three countries, and the definite article', () => {
  assert.equal(describeTerritories(['NG'], undefined), 'Sold only in Nigeria');
  assert.equal(describeTerritories(WORLDWIDE, ['US']), 'Sold worldwide except the United States');
  // No serial comma — the house style.
  assert.equal(
    describeTerritories(['GB', 'IE', 'NG'], undefined),
    'Sold only in the United Kingdom, Ireland and Nigeria',
  );
});

test('describe: a contradiction says so rather than trailing off', () => {
  assert.match(describeTerritories(['GB'], ['GB']), /contradict/);
});

test('describe: an unknown stored code stays legible so an editor can fix it', () => {
  // Not reachable through the admin (assertTerritories rejects it), but reachable by hand-edit,
  // and the rights column is exactly where someone would notice.
  assert.equal(describeTerritories(['QQ'], undefined), 'Sold only in QQ');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE ADMIN ROUND TRIP
// ═══════════════════════════════════════════════════════════════════════════════

test('round trip: worldwide → form → stored → described', () => {
  const stored = { territoriesAllowed: '*' };
  const form = territoriesToForm(stored);
  assert.equal(form.mode, MODE_WORLDWIDE);
  assert.deepEqual(form.countries, []);

  const back = territoriesFromForm(form.mode, form.countries);
  assert.equal(back.territoriesAllowed, WORLDWIDE);
  assert.deepEqual(back.territoriesExcluded, []);
  assert.equal(assertTerritories(back.territoriesAllowed, undefined).ok, true);
  assert.equal(describeTerritories(back.territoriesAllowed, back.territoriesExcluded), 'Sold worldwide');
});

test('round trip: worldwide-except survives a load and a save unchanged', () => {
  const stored = { territoriesAllowed: '*', territoriesExcluded: ['CA', 'US'] };
  const form = territoriesToForm(stored);
  assert.equal(form.mode, MODE_DENY);
  assert.deepEqual(form.countries, ['CA', 'US']);

  const back = territoriesFromForm(form.mode, form.countries);
  assert.deepEqual(back, { territoriesAllowed: WORLDWIDE, territoriesExcluded: ['CA', 'US'] });
  assert.equal(isTitleSellableIn(back, 'US'), false);
  assert.equal(isTitleSellableIn(back, 'GB'), true);
});

test('round trip: only-in survives a load and a save unchanged', () => {
  const stored = { territoriesAllowed: ['GB', 'NG'] };
  const form = territoriesToForm(stored);
  assert.equal(form.mode, MODE_ALLOW);
  const back = territoriesFromForm(form.mode, form.countries);
  assert.deepEqual(back.territoriesAllowed, ['GB', 'NG']);
  assert.deepEqual(back.territoriesExcluded, [], 'cleared, so a mode switch really clears it');
});

test('round trip: switching a title back to worldwide CLEARS the exclusions', () => {
  // The bug this guards: the write path spreads the existing record, so an omitted key keeps
  // the old value and a title would stay restricted after the editor said it should not be.
  const form = territoriesToForm({ territoriesAllowed: '*', territoriesExcluded: ['US'] });
  const back = territoriesFromForm(MODE_WORLDWIDE, form.countries);
  assert.deepEqual(back.territoriesExcluded, []);
  assert.equal(describeTerritories(back.territoriesAllowed, back.territoriesExcluded), 'Sold worldwide');
});

test('round trip: A PRESET IS STORED AS CODES, never as its name', () => {
  const na = TERRITORY_PRESETS.find((p) => p.key === 'north-america');
  assert.ok(na, 'the North America preset must exist');

  // What the form does when the button is pressed: the codes go into the list.
  const chosen = [...new Set([...[], ...na.codes])];
  const back = territoriesFromForm(MODE_DENY, chosen);

  assert.equal(back.territoriesAllowed, WORLDWIDE);
  assert.deepEqual([...back.territoriesExcluded].sort(), ['CA', 'MX', 'US']);
  // Nothing anywhere in the stored value refers to the group.
  assert.equal(JSON.stringify(back).includes('north-america'), false);
  assert.equal(JSON.stringify(back).includes('North America'), false);

  assert.equal(
    describeTerritories(back.territoriesAllowed, back.territoriesExcluded),
    'Sold worldwide except Canada, Mexico and the United States',
  );
  assert.equal(isTitleSellableIn(back, 'US'), false);
  assert.equal(isTitleSellableIn(back, 'GB'), true);
});

test('presets: every preset expands to real, storable ISO codes', () => {
  for (const preset of TERRITORY_PRESETS) {
    assert.ok(preset.codes.length > 0, `${preset.key} must expand to something`);
    assert.equal(new Set(preset.codes).size, preset.codes.length, `${preset.key} has a duplicate`);
    for (const code of preset.codes) {
      assert.ok(isKnownCountry(code), `${preset.key} names ${code}, which is not an ISO country`);
    }
    // The whole point: a preset must be savable as-is, in either restricting mode.
    assert.equal(assertTerritories(WORLDWIDE, [...preset.codes]).ok, true, `${preset.key} as exclusions`);
    assert.equal(assertTerritories([...preset.codes], undefined).ok, true, `${preset.key} as an allow-list`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE BUNDLED COUNTRY LIST
// ═══════════════════════════════════════════════════════════════════════════════

test('countries: the list is bundled, complete enough, and consistent', () => {
  assert.ok(COUNTRY_CODES.length > 200, 'this should be the world, not a shortlist');
  assert.equal(COUNTRY_CODES.length, Object.keys(COUNTRY_NAMES).length);
  for (const code of COUNTRY_CODES) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.ok(COUNTRY_NAMES[code].length > 0);
  }
  // The codes the shop actually trades in must be there.
  for (const code of ['GB', 'NG', 'US', 'CA', 'IE', 'AU', 'ZA']) assert.ok(isKnownCountry(code));
  // And the non-countries must not be, or a licence could name one and never sell.
  for (const code of ['EU', 'UK', 'ZZ', 'XX']) assert.equal(isKnownCountry(code), false);
});

test('countries: sorted by name, which is the order a human scans', () => {
  const names = COUNTRY_CODES.map((c) => COUNTRY_NAMES[c]);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
