// R8.3 — CURRENCY SELECTION, the pure half.
//
//   node --test tests/bookstore/currency.test.mjs      (npm run test:purchases)
//
// priceFor() and formatPrice() decide what a reader is shown and, through the buy button, what
// they are told they will be charged. Both are pure, so both can be pinned exactly — and they
// need to be, because the failure modes are silent: a fallback that picks the wrong currency
// prints a plausible price in the wrong money, and nothing about the page looks broken.
//
// THE INVARIANT THE WHOLE ROUND RESTS ON: the currency priceFor() RETURNS is the currency that
// will be charged. The reader's selection is a preference and may differ. Every assertion about
// a fallback below is really an assertion that those two are allowed to disagree, and that the
// returned one is the honest one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  priceFor,
  formatPrice,
  currencyForCountry,
  isCurrency,
  CURRENCIES,
  CURRENCY_NAMES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
} from '../../app/lib/currency.js';
import { formatGbp } from '../../app/bookstore/components/fields.js';
import { countryFrom } from '../../functions/api/bookstore/region.js';

// ═══════════════════════════════════════════════════════════════════════════════
describe('formatPrice', () => {
  test('gbp and usd print two decimals', () => {
    assert.equal(formatPrice('gbp', 499), '£4.99');
    assert.equal(formatPrice('usd', 699), '$6.99');
    assert.equal(formatPrice('gbp', 100), '£1.00');
    assert.equal(formatPrice('gbp', 5), '£0.05');
  });

  test('ngn prints whole naira with thousands separators and NO decimals', () => {
    // 450000 kobo = ₦4,500. The separator is not decoration: ₦450000 is unreadable.
    assert.equal(formatPrice('ngn', 450000), '₦4,500');
    assert.equal(formatPrice('ngn', 100000), '₦1,000');
    assert.equal(formatPrice('ngn', 99900), '₦999');
    assert.equal(formatPrice('ngn', 150000000), '₦1,500,000');
  });

  test('grouping appears in gbp/usd too, once the amount is large enough', () => {
    assert.equal(formatPrice('gbp', 123456), '£1,234.56');
    assert.equal(formatPrice('usd', 100000000), '$1,000,000.00');
  });

  test('rounding happens before grouping, not after', () => {
    // 99999.5 pence rounds the integer part up to 1000 — grouping must run on the rounded
    // value, or this prints "£999.100" or similar nonsense.
    assert.equal(formatPrice('gbp', 99999.5), '£1,000.00');
    assert.equal(formatPrice('ngn', 99950), '₦1,000');
  });

  test('unusable input returns null so the call site omits the line', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '499', {}]) {
      assert.equal(formatPrice('gbp', bad), null, `gbp/${String(bad)}`);
    }
    assert.equal(formatPrice('eur', 499), null, 'an unsupported currency has no format');
    assert.equal(formatPrice(undefined, 499), null);
  });

  test('formatGbp is a projection of formatPrice, contract unchanged', () => {
    // The original contract, asserted directly: R8.3 must not have altered it for the four
    // call sites that still use it.
    for (const v of [499, 0, 1, 123456, NaN, Infinity, undefined, null]) {
      assert.equal(formatGbp(v), formatPrice('gbp', v), `formatGbp(${String(v)})`);
    }
    assert.equal(formatGbp(499), '£4.99');
    assert.equal(formatGbp(undefined), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('priceFor', () => {
  const ALL = { prices: { gbp: 499, ngn: 450000, usd: 699 } };

  test('a title priced in the selected currency uses it, and is not a fallback', () => {
    for (const c of CURRENCIES) {
      const p = priceFor(ALL, c);
      assert.equal(p.currency, c);
      assert.equal(p.minorUnits, ALL.prices[c]);
      assert.equal(p.isFallback, false, `${c} is priced — nothing to fall back to`);
    }
  });

  test('a title NOT priced in the selected currency falls back to GBP and says so', () => {
    const gbpOnly = { prices: { gbp: 499 } };
    for (const c of ['ngn', 'usd']) {
      const p = priceFor(gbpOnly, c);
      assert.deepEqual(p, { currency: 'gbp', minorUnits: 499, isFallback: true });
    }
  });

  test('absent GBP, a title falls back to its only price', () => {
    // The real case: a Nigerian-published title priced only in naira. The alternative to
    // showing its naira price to a reader browsing in pounds is hiding the book from them.
    const ngnOnly = { prices: { ngn: 450000 } };
    assert.deepEqual(priceFor(ngnOnly, 'gbp'), { currency: 'ngn', minorUnits: 450000, isFallback: true });
    assert.deepEqual(priceFor(ngnOnly, 'usd'), { currency: 'ngn', minorUnits: 450000, isFallback: true });
    // ...and selecting it is not a fallback at all.
    assert.deepEqual(priceFor(ngnOnly, 'ngn'), { currency: 'ngn', minorUnits: 450000, isFallback: false });

    const usdOnly = { prices: { usd: 699 } };
    assert.deepEqual(priceFor(usdOnly, 'ngn'), { currency: 'usd', minorUnits: 699, isFallback: true });
  });

  test('GBP wins over another available currency when the selection is missing', () => {
    const gbpAndNgn = { prices: { gbp: 499, ngn: 450000 } };
    assert.deepEqual(priceFor(gbpAndNgn, 'usd'), { currency: 'gbp', minorUnits: 499, isFallback: true });
  });

  test('the last-resort choice is deterministic when two non-GBP prices exist', () => {
    // No GBP, selection is the third currency: the answer must not depend on key order.
    const a = { prices: { ngn: 450000, usd: 699 } };
    const b = { prices: { usd: 699, ngn: 450000 } };
    assert.deepEqual(priceFor(a, 'gbp'), priceFor(b, 'gbp'));
    assert.equal(priceFor(a, 'gbp').currency, 'ngn', 'CURRENCIES order decides, not object order');
  });

  test('a title with no usable price returns null', () => {
    assert.equal(priceFor({ prices: {} }, 'gbp'), null);
    assert.equal(priceFor({}, 'gbp'), null);
    assert.equal(priceFor(null, 'gbp'), null);
    assert.equal(priceFor(undefined, 'gbp'), null);
    assert.equal(priceFor({ prices: null }, 'gbp'), null);
  });

  test('zero, negative and non-integer prices are not usable', () => {
    // A zero price would render "£0.00" beside a buy button that charges nothing, and the
    // server would 409 anyway — better to omit the line.
    assert.equal(priceFor({ prices: { gbp: 0 } }, 'gbp'), null);
    assert.equal(priceFor({ prices: { gbp: -499 } }, 'gbp'), null);
    assert.equal(priceFor({ prices: { gbp: 4.99 } }, 'gbp'), null, 'minor units are integers');
    assert.equal(priceFor({ prices: { gbp: '499' } }, 'gbp'), null);
  });

  test('an unusable selected price falls back rather than returning it', () => {
    const p = priceFor({ prices: { ngn: 0, gbp: 499 } }, 'ngn');
    assert.deepEqual(p, { currency: 'gbp', minorUnits: 499, isFallback: true });
  });

  test('an unknown selected currency falls back to GBP', () => {
    assert.deepEqual(priceFor({ prices: { gbp: 499 } }, 'eur'), { currency: 'gbp', minorUnits: 499, isFallback: true });
    assert.deepEqual(priceFor({ prices: { gbp: 499 } }, undefined), { currency: 'gbp', minorUnits: 499, isFallback: true });
  });

  test('THE INVARIANT: the returned currency is always one the title is really priced in', () => {
    const titles = [
      { prices: { gbp: 499, ngn: 450000, usd: 699 } },
      { prices: { gbp: 499 } },
      { prices: { ngn: 450000 } },
      { prices: { usd: 699 } },
      { prices: { gbp: 499, usd: 699 } },
    ];
    for (const t of titles) {
      for (const sel of [...CURRENCIES, 'eur', undefined]) {
        const p = priceFor(t, sel);
        if (!p) continue;
        assert.equal(p.minorUnits, t.prices[p.currency],
          `returned ${p.currency} must be the title's real ${p.currency} price`);
        assert.equal(p.isFallback, p.currency !== sel,
          `isFallback must mean exactly "not what was asked for" (asked ${String(sel)}, got ${p.currency})`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('region → currency', () => {
  test('the two mapped countries, and everyone else', () => {
    assert.equal(currencyForCountry('NG'), 'ngn');
    assert.equal(currencyForCountry('US'), 'usd');
    assert.equal(currencyForCountry('GB'), 'gbp');
    assert.equal(currencyForCountry('FR'), 'gbp');
    assert.equal(currencyForCountry('ZA'), 'gbp');
  });

  test('case and whitespace do not decide a reader\'s currency', () => {
    assert.equal(currencyForCountry('ng'), 'ngn');
    assert.equal(currencyForCountry(' us '), 'usd');
  });

  test('an absent or malformed country falls to the default', () => {
    for (const v of [null, undefined, '', 'XX', 123, {}]) {
      assert.equal(currencyForCountry(v), DEFAULT_CURRENCY, String(v));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('the region endpoint', () => {
  // A Pages Function request, faked to whatever precision each case needs. The branch that
  // matters most — geography absent — is the one a live call can never exercise.
  const req = ({ cf, headers = {} } = {}) => ({
    cf,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  });

  test('request.cf.country is preferred', () => {
    assert.equal(countryFrom(req({ cf: { country: 'NG' } })), 'NG');
  });

  test('the CF-IPCountry header is the fallback when cf is absent', () => {
    // This is the wrangler-dev / local-harness case.
    assert.equal(countryFrom(req({ headers: { 'CF-IPCountry': 'US' } })), 'US');
    assert.equal(countryFrom(req({ cf: undefined, headers: { 'CF-IPCountry': 'GB' } })), 'GB');
  });

  test('cf wins when both are present', () => {
    assert.equal(countryFrom(req({ cf: { country: 'NG' }, headers: { 'CF-IPCountry': 'US' } })), 'NG');
  });

  test('absent geography is null, NEVER a guessed country', () => {
    // A visitor Cloudflare cannot place must not be told the shop knows where they are.
    assert.equal(countryFrom(req()), null);
    assert.equal(countryFrom(req({ cf: {} })), null);
    assert.equal(countryFrom({}), null);
    assert.equal(countryFrom(null), null);
  });

  test("Cloudflare's own unknown codes are treated as unknown", () => {
    assert.equal(countryFrom(req({ cf: { country: 'XX' } })), null, 'XX = could not determine');
    assert.equal(countryFrom(req({ cf: { country: 'T1' } })), null, 'T1 = Tor exit node');
  });

  test('anything not shaped like an ISO country code is refused', () => {
    for (const v of ['', 'G', 'GBR', 'gb1', '12', 'US,GB', 42, null, {}]) {
      assert.equal(countryFrom(req({ cf: { country: v } })), null, JSON.stringify(v));
    }
  });

  test('a lowercase code is normalised rather than dropped', () => {
    assert.equal(countryFrom(req({ cf: { country: 'ng' } })), 'NG');
    assert.equal(countryFrom(req({ headers: { 'CF-IPCountry': ' us ' } })), 'US');
  });

  test('end to end: the endpoint answer maps to the currency it should', () => {
    assert.equal(currencyForCountry(countryFrom(req({ cf: { country: 'NG' } }))), 'ngn');
    assert.equal(currencyForCountry(countryFrom(req({ cf: { country: 'US' } }))), 'usd');
    assert.equal(currencyForCountry(countryFrom(req({ cf: { country: 'FR' } }))), 'gbp');
    assert.equal(currencyForCountry(countryFrom(req())), 'gbp', 'unknown stays on the default');
  });
});

describe('the currency vocabulary', () => {
  test('every supported currency has a label, a prose name and a format', () => {
    for (const c of CURRENCIES) {
      assert.ok(CURRENCY_LABELS[c], `${c} needs a selector label`);
      assert.ok(CURRENCY_NAMES[c], `${c} needs a prose name`);
      assert.ok(formatPrice(c, 100), `${c} needs a working format`);
      assert.equal(isCurrency(c), true);
    }
    assert.equal(isCurrency('eur'), false);
    assert.equal(isCurrency(null), false);
    assert.equal(CURRENCIES[0], DEFAULT_CURRENCY, 'the default is first, so it wins last-resort ties');
  });

  test('prose names are lowercase — they appear mid-sentence', () => {
    // "in pounds only", "you'll be charged £4.99 in pounds". A capitalised name reads as a
    // proper noun and breaks the sentence.
    for (const c of CURRENCIES) {
      assert.equal(CURRENCY_NAMES[c], CURRENCY_NAMES[c].toLowerCase());
    }
  });
});
