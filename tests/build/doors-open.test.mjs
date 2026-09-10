// R50 — THE DOORS, AND THE COUPLING. Swept across a fortnight built from the constant.
//
//   node --test tests/build/doors-open.test.mjs      (npm run test:doors)
//
// ⚠ THIS ASSERTS THE COUPLING, NOT THE ANSWER. Nowhere below is there a line saying "on
// 30 September the doors are open" — that would be a twelfth place the date is written down,
// and it would pass for the wrong reason the moment the date moved. Every case is built from
// LAUNCH, so the sweep follows the constant wherever it goes.
//
// WHAT IS ACTUALLY BEING PROVED
// ─────────────────────────────
// The launch-day risk was never the copy. GATE_ENABLED was a HAND-FLIPPED BOOLEAN, so on
// opening day the countdown would reach zero, the gateway would say "Opens 30 September", and
// the shop would stay shut because opening it was a manual edit somebody had to remember. The
// fix is doorsOpen() in app/lib/launch.js, and the property worth testing is not "what does it
// return today" but:
//
//     the early-access note is absent IF AND ONLY IF the doors are open
//     the curtain is up      IF AND ONLY IF the doors are shut
//
// on every day of a fortnight straddling launch, with the clock moved rather than the code.
//
// ⚠ AND THE OTHER DIRECTION IS ASSERTED TOO. An "if and only if" tested in one direction is
// half a test: a doorsOpen() that returned true always would satisfy "the note is gone once
// the doors open" perfectly, and would open the shop in July.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAUNCH } from '../../app/lib/launch.js';

const ROOT = new URL('../../', import.meta.url);

// ⚠ COMMENTS ARE STRIPPED BEFORE ANY SOURCE ASSERTION, AND THE FIRST RUN OF THIS FILE IS WHY.
// The assertions below check that GATE_ENABLED and BOOKSTORE_LAUNCHED are GONE — and they
// failed on a tree where both genuinely were, because the comments explaining their removal
// name them. That is the docblock trap from the other side: a guard reading its own
// explanation and calling it evidence. Strings and templates are deliberately left intact —
// copy lives in those, and stripping them would blind the checks that matter.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code';   // code | line | block | s | d | t
  while (i < n) {
    const c = src[i];
    const nx = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && nx === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && nx === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 's';
      else if (c === '"') mode = 'd';
      else if (c === '`') mode = 't';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') {
      // Newlines are kept so reported line numbers stay honest.
      if (c === '*' && nx === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c;
      i++; continue;
    }
    // inside a string/template
    if (c === '\\') { out += c + (nx ?? ''); i += 2; continue; }
    if ((mode === 's' && c === "'") || (mode === 'd' && c === '"') || (mode === 't' && c === '`')) mode = 'code';
    out += c; i++;
  }
  return out;
}

const read = (p) => stripComments(readFileSync(new URL(p, ROOT), 'utf8'));

// ── THE CLOCK, MOVED ─────────────────────────────────────────────────────────────────────
// doorsOpen() reads `new Date()` inside daysUntilLaunch(), so the only honest way to sweep it
// is to move the clock and re-import. The module is re-imported per case with a cache-busting
// query so the sweep sees a fresh evaluation rather than a memoised one.
async function atLondonNoon(y, m, d, fn) {
  const RealDate = globalThis.Date;
  // Noon UTC, so the London date is unambiguous on both sides of a DST boundary — a midnight
  // fixture would land on the previous day for half the year and the sweep would silently
  // test the wrong dates.
  const fixed = RealDate.UTC(y, m - 1, d, 12, 0, 0);
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate;
  try {
    const mod = await import(`../../app/lib/launch.js?t=${fixed}`);
    return await fn(mod);
  } finally {
    globalThis.Date = RealDate;
  }
}

/** A fortnight around launch: seven days before, the day itself, six after. Built from LAUNCH. */
function fortnight() {
  const out = [];
  for (let offset = -7; offset <= 6; offset++) {
    const t = Date.UTC(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d + offset, 12);
    const dt = new Date(t);
    out.push({
      offset,
      y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
      // The expectation is derived from the offset, never from a typed date.
      shouldBeOpen: offset >= 0,
      label: `${offset >= 0 ? '+' : ''}${offset} day${Math.abs(offset) === 1 ? '' : 's'}`,
    });
  }
  return out;
}

describe('⭑ THE DOORS — the coupling, across a fortnight built from LAUNCH', () => {
  test('the sweep is real: it straddles launch and moves the clock', async () => {
    const days = fortnight();
    assert.equal(days.length, 14);
    assert.ok(days.some((x) => !x.shouldBeOpen) && days.some((x) => x.shouldBeOpen),
      'the fortnight does not straddle launch — the sweep would prove one state only');
    // And the clock harness actually moves the clock, or every case below is the same case.
    const before = await atLondonNoon(LAUNCH.y, LAUNCH.m, LAUNCH.d - 3, (m) => m.daysUntilLaunch());
    const after = await atLondonNoon(LAUNCH.y, LAUNCH.m, LAUNCH.d + 3, (m) => m.daysUntilLaunch());
    assert.equal(before, 3, `the clock did not move: daysUntilLaunch() was ${before} three days out`);
    assert.equal(after, -3, `the clock did not move: daysUntilLaunch() was ${after} three days past`);
  });

  for (const day of fortnight()) {
    test(`${day.label}: doorsOpen() is ${day.shouldBeOpen}, and the curtain is its inverse`, async () => {
      await atLondonNoon(day.y, day.m, day.d, async (launch) => {
        assert.equal(launch.doorsOpen(), day.shouldBeOpen,
          `doorsOpen() disagreed with the calendar ${day.label} from launch`);

        // ⭑ THE CURTAIN IS THE LAUNCH-DAY RISK, so it is asserted against the same clock.
        // gate.js imports doorsOpen from launch.js, so a fresh import of the gate under the
        // moved clock exercises the real wiring rather than a restatement of it.
        const gate = await import(`../../app/lib/bookstore/gate.js?t=${day.y}${day.m}${day.d}`);
        assert.equal(gate.isCurtainUp(), !day.shouldBeOpen,
          `the curtain was ${gate.isCurtainUp() ? 'up' : 'down'} ${day.label} from launch`);
      });
    });
  }

  test('⚠ BOTH DIRECTIONS — the doors are never open before, and never shut after', async () => {
    // Stated separately from the per-day cases because an "if and only if" checked one way is
    // half a test: doorsOpen() === true always would pass "open on launch day" and open the
    // shop in July.
    const days = fortnight();
    const openEarly = [];
    const shutLate = [];
    for (const day of days) {
      const open = await atLondonNoon(day.y, day.m, day.d, (m) => m.doorsOpen());
      if (open && !day.shouldBeOpen) openEarly.push(day.label);
      if (!open && day.shouldBeOpen) shutLate.push(day.label);
    }
    assert.deepEqual(openEarly, [], `the doors were open BEFORE launch on: ${openEarly.join(', ')}`);
    assert.deepEqual(shutLate, [], `the doors were shut AFTER launch on: ${shutLate.join(', ')}`);
  });

  test('a year either side, so nothing depends on being near the date', async () => {
    const wayBefore = await atLondonNoon(LAUNCH.y - 1, LAUNCH.m, LAUNCH.d, (m) => m.doorsOpen());
    const wayAfter = await atLondonNoon(LAUNCH.y + 1, LAUNCH.m, LAUNCH.d, (m) => m.doorsOpen());
    assert.equal(wayBefore, false, 'the doors were open a year early');
    assert.equal(wayAfter, true, 'the doors were shut a year late');
  });

  test('⭑ THE NOTE IS GATED ON THE CALENDAR, NOT ON THE READER\'S ACCESS', async () => {
    // A reader who typed the passcode in August is INSIDE the shop and is genuinely EARLY —
    // "the doors open to everyone on 30 September" is true for them and is exactly the thing
    // they most want to know. Gate the note on hasGatePass() and the one reader who needs the
    // date stops seeing it.
    //
    // Asserted at the source, because the two halves live in different files: isStoreUnlocked()
    // is the ACCESS question and consults the pass; the note's condition is the CALENDAR
    // question and must not.
    const gate = read('app/lib/bookstore/gate.js');
    assert.match(gate, /export function isCurtainUp\(\)\s*\{\s*return !doorsOpen\(\);/,
      'the curtain no longer derives from doorsOpen()');
    assert.match(gate, /if \(!isCurtainUp\(\)\) return true;/,
      'isStoreUnlocked() does not consult the curtain first');
    assert.ok(!/GATE_ENABLED\s*=/.test(gate),
      'a hand-flipped GATE_ENABLED is back — that was the launch-day risk');

    for (const [file, what] of [
      ['app/components/Gateway.js', 'the gateway countdown'],
      ['app/my-library/page.js', 'the My Library countdown'],
    ]) {
      const src = read(file);
      assert.match(src, /if \(doorsOpen\(\)\) setOpensLabel\(null\);/,
        `${what} does not return null once the doors are open`);
      assert.ok(!/launch-day handling comes later/.test(src),
        `${what} still carries the unfinished TODO`);
      // The note must not consult the reader's pass — that is the access question.
      assert.ok(!/hasGatePass|isStoreUnlocked/.test(src),
        `${what} gates its note on the reader's access rather than on the calendar`);
    }
  });

  test('the four booleans are classified, and the two configuration ones are untouched', () => {
    // ⚠⚠ MEMBERSHIPS_ON_SALE MUST NOT BECOME A CLOCK. It asks whether live Stripe and Paystack
    // price ids exist, is asserted against isConfigured('live') by
    // tests/membership/on-sale.test.mjs, and that interlock exists precisely because it
    // "cannot silently drift, because the build stops". A date-driven membership flag would
    // sell subscriptions on a day the prices do not exist.
    const prices = read('app/lib/membershipPrices.js');
    assert.match(prices, /export const MEMBERSHIPS_ON_SALE = (true|false);/,
      'MEMBERSHIPS_ON_SALE is no longer a plain constant');
    assert.ok(!/doorsOpen/.test(prices),
      'MEMBERSHIPS_ON_SALE has been wired to the calendar — it asks whether PRICES EXIST');

    const links = read('app/links/page.js');
    // The Book Store label IS a calendar question and now derives.
    assert.match(links, /const BOOKSTORE_LABEL = doorsOpen\(\)/,
      'the /links Book Store label is not derived from the calendar');
    assert.ok(!/const BOOKSTORE_LAUNCHED\s*=/.test(links),
      'BOOKSTORE_LAUNCHED is back — a second hand-flipped opinion about opening day');
    // MEMBERSHIP_LAUNCHED is NOT: "open the archive" is a lie unless memberships are
    // purchasable, which is configuration rather than a date.
    assert.match(links, /const MEMBERSHIP_LAUNCHED = (true|false);/,
      'MEMBERSHIP_LAUNCHED should stay a hand-flipped boolean — it is a configuration question');
  });
});
