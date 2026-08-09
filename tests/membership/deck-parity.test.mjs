// DECK PARITY — audit/membership-copy-deck.md against the page that actually shipped.
//
//   node --test tests/membership/deck-parity.test.mjs        (after a build; see below)
//   npm run test:membership-copy                             (builds first, then runs this)
//
// WHY THIS EXISTS. R11.13 rewrote every string on /membership from the deck, and R11.15
// corrected one of them. Between those two rounds the deck was the source of truth by
// convention only: nothing checked it. A copy fix landing in app/membership/page.js and not in
// the deck — or in the deck and not the page — was invisible, and the deck quietly became a
// record of what the page used to say. That is the failure mode this closes.
//
// IT CATCHES BOTH DIRECTIONS WITH ONE ASSERTION, which is the reason it is a containment check
// rather than a diff. Every deck string must appear in the built page:
//
//   • page edited, deck not  → the deck still holds the OLD sentence, which is no longer in the
//                              HTML → miss.
//   • deck edited, page not  → the deck now holds the NEW sentence, which is not yet in the
//                              HTML → miss.
//
// Both mutations were run before this file was committed, one in each direction, and both went
// red. A parity test that has never been shown to fail is a test that asserts nothing.
//
// WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes: a string on the page
// that was never in the deck. Containment is one-way — the deck is the contract, and the page
// is allowed to carry chrome, labels and computed strings the deck does not enumerate. The
// browser matrix in copy.spec.mjs is what asserts the page carries nothing it should not
// (no buy affordance, no retired footer, no 'COMING SOON').
//
// WHY IT READS out/ AND NOT THE JSX. The JSX is where the string is written; the HTML is what a
// reader receives. A source-level check would pass on a string that some conditional never
// renders, and the deck is a promise about the page, not about the module.
//
// THE CONVENTION IS THE BLOCKQUOTE, and it is documented in the deck itself (§0) rather than
// only here — the person most likely to break this is editing the deck, not reading this file.
// Every `>` line is a shipped string. A `>` line that is deliberately not a literal on this
// page carries `{{not-asserted: reason}}`, and the reason is mandatory.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const DECK_PATH = fileURLToPath(new URL('audit/membership-copy-deck.md', ROOT));
const PAGE_PATH = fileURLToPath(new URL('out/membership.html', ROOT));

// The floor. Eight of the deck's blockquote lines are exempt by design (§0), and the rest are
// the contract. Both numbers are asserted, so the suite cannot be quietly hollowed out: delete
// the deck's copy and the first fails; paper over a real miss with an exemption marker and the
// second fails. The counts are deliberately expressed as bounds rather than equalities — new
// copy should not have to touch this file, but losing copy should have to.
// The deck holds 46 blockquote lines today: 38 asserted, 8 exempt. The floor sits a couple
// below 38 so ordinary copy edits do not have to touch this file, while a gutted deck does.
const MIN_ASSERTED = 36;
const MAX_EXEMPT = 8;

// ── the deck ─────────────────────────────────────────────────────────────────────────────
const EXEMPT_RE = /\{\{not-asserted:\s*([^}]*)\}\}/;

// Markdown emphasis is presentation, and the page sets it with real tags: the deck's
// `The *Calvary Scribblings Series*, from October` ships as `The <em>…</em>, from October`,
// which is the same text once both sides are reduced to what a reader sees.
function stripMarkdown(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function readDeck() {
  const src = readFileSync(DECK_PATH, 'utf8');
  const asserted = [];
  const exempt = [];
  let section = '(preamble)';

  for (const [i, line] of src.split('\n').entries()) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) { section = heading[1]; continue; }

    const quote = /^>\s?(.*)$/.exec(line);
    if (!quote) continue;
    const body = quote[1].trim();
    if (!body) continue;                       // `>` on its own is a paragraph break

    const where = `${section} (deck line ${i + 1})`;
    const marker = EXEMPT_RE.exec(body);
    if (marker) {
      exempt.push({ where, reason: marker[1].trim(), text: collapse(stripMarkdown(body.replace(EXEMPT_RE, ''))) });
      continue;
    }
    asserted.push({ where, text: collapse(stripMarkdown(body)) });
  }
  return { asserted, exempt };
}

// ── the built page ───────────────────────────────────────────────────────────────────────
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => NAMED[n]);
}

// Reduced to what a reader sees. Script and style bodies go first — Next inlines the RSC
// payload in a <script>, which carries every string a second time in escaped form, and a
// check that matched inside it would pass on copy the page never renders.
//
// Tags are removed WITHOUT substituting a space: the deck's sentences are wrapped in <em> mid
// sentence, and inserting a separator at every tag boundary would break exactly the strings
// this exists to check. The cost is that two adjacent blocks run together, which can only
// create a false match for a string that spans two blocks — and no deck string does.
function readPage() {
  if (!existsSync(PAGE_PATH)) {
    assert.fail(
      `out/membership.html is missing — this suite reads the BUILT page, not the JSX.\n`
      + `Run \`npm run build\` (or \`npm run test:membership-copy\`, which builds first) and try again.`,
    );
  }
  const html = readFileSync(PAGE_PATH, 'utf8');
  return collapse(decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ''),
  ));
}

describe('/membership — the deck and the page say the same thing', () => {
  const { asserted, exempt } = readDeck();
  const page = readPage();

  test('the deck still holds a page worth of copy', () => {
    assert.ok(
      asserted.length >= MIN_ASSERTED,
      `only ${asserted.length} asserted deck strings, expected at least ${MIN_ASSERTED}. `
      + 'Either copy was deleted from audit/membership-copy-deck.md, or the blockquote '
      + 'convention in its §0 was broken — this suite reads `>` lines and nothing else.',
    );
  });

  test('every exemption is declared, counted, and carries a reason', () => {
    assert.ok(
      exempt.length <= MAX_EXEMPT,
      `${exempt.length} deck lines carry {{not-asserted:}}, expected at most ${MAX_EXEMPT}. `
      + 'A new exemption is how a real parity failure gets hidden. If the page genuinely '
      + 'stopped carrying a literal, raise MAX_EXEMPT deliberately and say why in the deck.',
    );
    for (const e of exempt) {
      assert.ok(e.reason.length > 0, `${e.where}: {{not-asserted:}} with no reason — §0 requires one.`);
    }
  });

  // One test per string, so a failure names the line rather than the file.
  for (const { where, text } of asserted) {
    test(`${where} — ${text.length > 62 ? `${text.slice(0, 62)}…` : text}`, () => {
      assert.ok(
        page.includes(text),
        `This deck string is not in out/membership.html:\n\n  ${text}\n\n`
        + 'The deck and the page disagree. Decide which one is right and change the other — '
        + 'do NOT add {{not-asserted:}} to make this green.',
      );
    });
  }
});
