// R9.3 — THE DROP CAP'S EXCLUSION LIST, HELD AGAINST WHAT CONTENT ACTUALLY DOES.
//
//   node --test tests/ci/dropcap-openers.test.mjs      (npm run test:ci)
//
// app/lib/dropcap.js decides which paragraph gets the drop cap, and it excludes front-matter
// by CLASS — .intro-note, .poem-numeral, .section-break and so on. A class-driven list has a
// specific failure mode: it does not break when it goes stale, it just silently stops
// covering the thing it was written for. The CMS gains a block type, some new class lands at
// the top of a story body, the list has never heard of it, and a section numeral gets a
// floated 4.2em capital next to it. That is exactly the bug R9.3 was opened to fix — this
// suite exists so it cannot recur quietly.
//
// THE ASSERTION. Every class the audit observes near the top of a live story body must be
// CLASSIFIED: either excluded by dropcap.js, or named in PROSE below as a class that may
// legitimately carry opening prose. Neither → failure, with the class named.
//
// WHY A FIXTURE AND NOT A LIVE READ. test:ci runs on every push and must not need a service
// account or the network. So the live observation is snapshotted:
//
//     node scripts/audit-story-openers.mjs --emit    →   tests/fixtures/story-openers.json
//
// Re-run that whenever the CMS gains a block type. The snapshot is the contract; this test
// is what makes forgetting to classify a new class loud instead of silent.
//
// WHAT THIS SUITE DOES NOT DO. It does not test the tagger's behaviour — that is
// tests/dropcap/dropcap.spec.mjs, which runs the real module against real DOM in real
// Chromium. This one is a data check and stays offline and instant.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DROPCAP_EXCLUDED_SELECTORS } from '../../app/lib/dropcap.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'tests/fixtures/story-openers.json');

const inventory = JSON.parse(readFileSync(FIXTURE, 'utf8'));

// Classes that may legitimately sit on — or around — the paragraph that opens a story, and
// so must NOT be excluded. Adding to this list is a deliberate statement that a paragraph
// wearing this class can be the drop cap. Keep it small and keep the reason attached.
const PROSE = new Set([
  // Nothing yet. Every opener class observed to date is front-matter or furniture. When a
  // genuinely prose-bearing class does appear, name it here WITH its reason rather than
  // deleting the assertion — the empty set is the finding, not an oversight.
]);

const excludedClasses = new Set(
  DROPCAP_EXCLUDED_SELECTORS.filter((s) => s.startsWith('.')).map((s) => s.slice(1)),
);

describe('drop-cap exclusions vs. the live opener inventory', () => {
  test('the fixture is a real observation, not a placeholder', () => {
    assert.ok(inventory.bodiesScanned > 100,
      `fixture claims only ${inventory.bodiesScanned} bodies scanned — re-run scripts/audit-story-openers.mjs --emit`);
    assert.match(inventory.observedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('every observed opener class is classified — excluded or explicitly prose', () => {
    const unclassified = Object.keys(inventory.openerClasses)
      .filter((cls) => !excludedClasses.has(cls) && !PROSE.has(cls));

    assert.deepEqual(unclassified, [],
      `Unclassified opener class(es): ${unclassified.join(', ')}.\n`
      + `      These appear at the top of live story bodies but dropcap.js has never heard of them.\n`
      + `      Either add them to DROPCAP_EXCLUDED_SELECTORS in app/lib/dropcap.js (front-matter\n`
      + `      or furniture) or to PROSE in this file (can legitimately open a story).`);
  });

  test('the exclusion list still covers the classes it was written for', () => {
    // Guards the other direction: someone "tidying" the list cannot quietly drop the class
    // that caused the original bug. .intro-note is CHAFF's section marker.
    for (const cls of ['intro-note', 'poem-numeral', 'section-break']) {
      assert.ok(excludedClasses.has(cls), `.${cls} must stay excluded — see dropcap.js`);
    }
    // Container exclusions are matched by .closest(), so `blockquote > p` is reachable from
    // querySelectorAll('p') and an epigraph must not become the drop cap.
    for (const sel of ['blockquote', 'figure', 'li']) {
      assert.ok(DROPCAP_EXCLUDED_SELECTORS.includes(sel), `${sel} must stay excluded — see dropcap.js`);
    }
  });

  test('no exclusion selector is also declared prose', () => {
    const both = [...excludedClasses].filter((c) => PROSE.has(c));
    assert.deepEqual(both, [], `class(es) both excluded and declared prose: ${both.join(', ')}`);
  });

  test('the punctuation-guard corpus is still what dropcap.js documents', () => {
    // dropcap.js names these eight slugs so a future round building the span-wrapping fix has
    // its corpus without re-deriving it. If content changes underneath, the comment is now
    // lying — re-emit the fixture and update the comment together.
    const observed = inventory.punctuationOpeners.map((r) => r.slug).sort();
    const documented = [
      'dont-worry',
      'full',
      'i-dey-your-back',
      'is-2026-shaping-up-to-be-the-year-for-peak-modern-cinema',
      'mask-with-no-memory',
      'peer-pressure-from-the-dead',
      'release-the-footage-how-the-henry-nowak-case-became-an-international-debate',
      'unstoppabbl',
    ].sort();
    assert.deepEqual(observed, documented,
      'the punctuation-opener corpus moved — update the comment in app/lib/dropcap.js to match');
  });
});
