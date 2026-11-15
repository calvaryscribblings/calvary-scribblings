// P4-B4 — the website's half of rulings 370 and 371 (the sponsor line), and ruling 377 (the moon
// note on the push settings page). Rulings 375 and 376 are tested in p4-push.test.mjs and, end to
// end, in tests/notify/p4-drain.emulator.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPONSOR_PREAMBLE } from '../../app/lib/series/format.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// WCAG 2.x relative luminance and contrast, the cream composited over the page's ground.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (fg, a, bg) => fg.map((f, i) => f * a + bg[i] * (1 - a));
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const CREAM = hex('#F5F0E8');

describe('370, 371: the sponsor line', () => {
  const page = read('app/series/instalment/[instalmentId]/page-instalment.js');
  const aside = page.slice(page.indexOf('{SPONSOR_PREAMBLE}') - 400, page.indexOf('{SPONSOR_PREAMBLE}') + 300);

  test('370: the preamble reads "Made possible by", and the lowercase is no longer called deliberate', () => {
    assert.equal(SPONSOR_PREAMBLE, 'Made possible by');
    const format = read('app/lib/series/format.js');
    assert.equal(/Lowercase, and that is the design/.test(format), false);
  });

  test('371: the line at 50% of #F5F0E8 and the name at 70%, on the page\'s ground', () => {
    assert.match(page, /const PAGE = '#080610';/);
    assert.match(aside, /fontSize: 11, color: 'rgba\(245,240,232,0\.5\)'/);
    assert.match(aside, /fontSize: 13\.5, color: 'rgba\(245,240,232,0\.7\)'/);
  });

  test('371: the line reaches 4.5:1 against #080610', () => {
    const ground = hex('#080610');
    const line = contrast(over(CREAM, 0.5, ground), ground);
    const name = contrast(over(CREAM, 0.7, ground), ground);
    assert.ok(line >= 4.5, `line ${line.toFixed(2)}:1`);
    assert.ok(name >= 4.5, `name ${name.toFixed(2)}:1`);
    assert.ok(contrast(over(CREAM, 0.28, ground), ground) < 4.5, 'the old 28% did not');
  });
});

describe('377: the moon note on the push settings page', () => {
  const page = read('app/notifications/settings/page.js');
  test('reads exactly as ruled, glyph, type, colour and spacing kept', () => {
    const note = 'Messages, replies and mentions reach you at any hour. Anything else that comes between midnight and 08:00 London waits until 08:00, when the first three arrive. The rest stay in your notifications.';
    assert.ok(page.includes(`<span>${note}</span>`));
    assert.equal(page.includes('Nothing arrives between midnight and 08:00 London.'), false);
    assert.ok(page.includes(`<p data-quiet-hours style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, lineHeight: 1.45, color: '#A39CB2', margin: '28px 6px 0' }}>`));
    assert.ok(page.includes(`<span style={{ paddingTop: 3 }}><MoonGlyph size={16} color="#A39CB2" /></span>`));
  });
});
