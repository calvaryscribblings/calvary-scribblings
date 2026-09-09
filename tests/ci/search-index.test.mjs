// R46 — THE ISLAND'S INDEX, the half that can be settled without a browser.
//
// ⚠ THESE RUN AGAINST THE LIVE CATALOGUE, not a fixture. The index is DERIVED from the shelf
// — forms, subjects, counts and weights all fall out of cms_stories_index — so a fixture
// would be testing the fixture. Four recent rounds in this repo shipped a guard that could
// not fail (one satisfied by its own docblock, one asserting the defect as correct, one whose
// regex crossed newlines, one whose fixture had nothing to exercise), and the common thread
// was an instrument that never touched production. Every test below asserts a non-vacuous
// count first, so an empty read fails loudly instead of passing quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUBCATEGORIES, CATEGORIES } from '../../app/lib/taxonomy.js';
import { indexOpening, buildIndexRecord } from '../../app/lib/storyIndex.js';
import {
  formRows, subjectRuns, markCollisions, weightStep, WEIGHT_CUTS,
  matchStories, matchVoices, highlightParts, normalizeQuery,
} from '../../app/lib/searchIndex.js';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const node = async (p) => {
  const r = await fetch(`${DB}/${p}.json`);
  assert.ok(r.ok, `live read of ${p} failed with ${r.status} — the suite cannot judge anything`);
  return r.json();
};

// ⚠ EVERY SOURCE ASSERTION BELOW READS CODE, NOT PROSE.
//
// The first version of the reader-search guard failed on app/search/page.js's own docblock:
// the comment explaining what the OLD code did matched the pattern looking for that call.
// That is the same defect as a guard SATISFIED by its docblock, arriving from the other side
// — an instrument that cannot tell an explanation from an instruction is measuring the
// writing about the file, not the file.
//
// So comments come out first. Block and JSX comments wholesale; line comments only where the
// '//' is not preceded by a colon, so that https:// inside the font import survives.
const codeOf = (src) =>
  String(src)
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceOf = (rel) => codeOf(readFileSync(new URL(rel, import.meta.url), 'utf8'));

let _live;
async function live() {
  if (!_live) {
    const idx = await node('cms_stories_index');
    const now = Date.now();
    _live = Object.entries(idx || {})
      .map(([id, s]) => ({ ...s, id }))
      .filter((s) => s.published !== false && (!s.publishAt || new Date(s.publishAt).getTime() <= now));
  }
  return _live;
}

test('the index reproduces the live shelf, form by form', async () => {
  const rows = await live();
  assert.ok(rows.length > 100, `only ${rows.length} live stories — read looks wrong`);
  const forms = formRows(rows);
  assert.ok(forms.length > 0, 'no forms at all');
  // Every count matches a straight recount of the shelf, and the totals close.
  for (const f of forms) {
    const actual = rows.filter((s) => s.category === f.value).length;
    assert.equal(f.count, actual, `${f.label} says ${f.count}, shelf holds ${actual}`);
  }
  const counted = forms.reduce((t, f) => t + f.count, 0);
  const withKnownCategory = rows.filter((s) => CATEGORIES.some((c) => c.value === s.category)).length;
  assert.equal(counted, withKnownCategory, 'the form rows do not account for the shelf');
});

test('an empty form is ABSENT, not a row reading zero', async () => {
  const forms = formRows(await live());
  assert.ok(forms.every((f) => f.count > 0), 'a form with no stories drew a row');
  // Non-vacuous: at least one taxonomy category must actually be empty, or this proves nothing.
  const empties = CATEGORIES.filter((c) => !forms.some((f) => f.value === c.value));
  assert.ok(empties.length > 0, 'every category is occupied — the absence rule is untested');
  assert.ok(empties.some((c) => c.value === 'novel'), 'expected Novel to be the empty form');
});

test('an empty subject draws nothing, and the vocabulary is free to run ahead', async () => {
  const rows = subjectRuns(await live());
  const vocab = [...new Set(Object.values(SUBCATEGORIES).flat())];
  assert.ok(rows.every((r) => r.count > 0), 'a subject with no stories appeared in the run');
  const absent = vocab.filter((l) => !rows.some((r) => r.label === l));
  assert.ok(absent.length > 0, 'every subject is occupied — the absence rule is untested');
  // Elegy was ruled in (R44) with nothing filed under it. It must be silent, not an empty tab.
  assert.ok(absent.includes('Elegy'), 'Elegy is occupied now — pick another unfilled subject here');
  assert.ok(!rows.some((r) => r.label === 'Elegy'), 'Elegy drew a subject with nothing under it');
});

test('a subject spanning categories counts across them — the index is the island\'s', async () => {
  const shelf = await live();
  const rows = subjectRuns(shelf);
  const spanning = rows.filter((r) => r.categories.length > 1);
  assert.ok(spanning.length > 0, 'no subject spans two forms — this rule is untested today');
  for (const r of spanning) {
    const across = shelf.filter((s) => (s.subcategory || '').trim() === r.label).length;
    assert.equal(r.count, across, `${r.label} counted ${r.count}, the island holds ${across}`);
    // and it is strictly more than any single form's share, which is the point
    const biggest = Math.max(
      ...r.categories.map((c) => shelf.filter((s) => s.category === c && (s.subcategory || '').trim() === r.label).length)
    );
    assert.ok(r.count > biggest, `${r.label} was scoped to one form`);
  }
});

test('the weight steps are ordered, exhaustive, and match their derived cuts', async () => {
  const rows = subjectRuns(await live());
  for (const r of rows) {
    assert.ok([1, 2, 3].includes(r.step), `${r.label} has step ${r.step}`);
    assert.equal(r.step, weightStep(r.count));
  }
  assert.equal(weightStep(WEIGHT_CUTS.A), 1);
  assert.equal(weightStep(WEIGHT_CUTS.A - 1), 2);
  assert.equal(weightStep(WEIGHT_CUTS.B), 2);
  assert.equal(weightStep(WEIGHT_CUTS.B - 1), 3);
  // All three steps must be populated, or the three-size design is not being exercised.
  for (const st of [1, 2, 3]) {
    assert.ok(rows.some((r) => r.step === st), `weight step ${st} is empty on the live shelf`);
  }
  // Alphabetical WITHIN each step, steps in order.
  const seq = rows.map((r) => `${r.step}|${r.label.toLowerCase()}`);
  assert.deepEqual(seq, [...seq].sort(), 'the run is not step-then-alphabetical');
});

test('near-identical labels are marked — Politics and Political BY NAME', async () => {
  const rows = markCollisions(subjectRuns(await live()));
  const marked = rows.filter((r) => r.collides).map((r) => r.label).sort();
  // ⚠ NAMED, NOT COUNTED. Two earlier versions of this rule returned an EMPTY collision set
  // against the live shelf and looked correct doing it — the first tested equality after
  // stripping a plural 's' ('politic' ≠ 'political'), the second tested whether one label was
  // a prefix of the other, which this pair also fails (they diverge at character 8). A test
  // that only asserted "some collisions exist" would have passed neither, and a test that
  // asserted "collides.length >= 0" would have passed both. Name the case.
  assert.deepEqual(marked, ['Political', 'Politics'], 'the live collision pair is not marked');
  // and the rest of the run is NOT marked — the treatment must stay rare
  assert.ok(rows.filter((r) => !r.collides).length > 20, 'the collision rule is over-firing');
  // the disambiguator only means something if each is in exactly one form
  for (const r of rows.filter((x) => x.collides)) {
    assert.equal(r.categories.length, 1, `${r.label} spans forms, so naming one would mislead`);
  }
});

test('every subject is one unbreakable unit — no label is ever concatenated', async () => {
  const rows = subjectRuns(await live());
  const multiword = rows.filter((r) => /\s/.test(r.label));
  assert.ok(multiword.length >= 4, `only ${multiword.length} multi-word subjects — check the shelf`);
  // The rendered guarantee is CSS (white-space: nowrap on each item) and is proven in the
  // browser suite. What is provable here: the run is a LIST OF LABELS and never a joined
  // string, so the renderer is given per-subject elements to make unbreakable.
  for (const r of rows) {
    assert.equal(typeof r.label, 'string');
    assert.ok(!r.label.includes('·') && !r.label.includes(','), `${r.label} carries a delimiter`);
  }
  const page = sourceOf('../../app/search/page.js');
  assert.ok(/white-space:\s*nowrap/.test(page), 'the subject item is not nowrap');
  assert.ok(!/subjects\s*\.\s*map[^)]*\)\s*\.\s*join/.test(page), 'the run is being joined into a string');
});

test('the opening line comes from the shared predicate, never a substring', async () => {
  const shelf = await live();
  const withOpening = shelf.filter((s) => (s.opening || '').trim());
  assert.equal(withOpening.length, shelf.length, 'some live records carry no opening line');

  // 1967 is the proof case: its body opens on a content note, so a character cutter shows the
  // reader a warning and nothing of the story.
  const proof = shelf.find((s) => s.id === '1967');
  assert.ok(proof, 'story 1967 is gone — pick another front-matter case');
  assert.ok(!/content note/i.test(proof.opening), 'the opening line is the content note');
  assert.match(proof.opening, /^I was only eleven years old/);

  // And the field is what buildIndexRecord would write today — index and predicate agree.
  const src = await node('cms_stories/1967');
  assert.equal(buildIndexRecord('1967', src).opening, proof.opening, 'the stored line has drifted');
  assert.equal(indexOpening(src.content), proof.opening);
});

test('indexOpening never throws, whatever it is handed', () => {
  for (const bad of ['', null, undefined, '<p>unclosed', '<<>>', '<blockquote><p>only an epigraph</p></blockquote>']) {
    assert.doesNotThrow(() => indexOpening(bad));
    assert.equal(typeof indexOpening(bad), 'string');
  }
});

test('reader search reads a node a NON-FOUNDER can actually read', async () => {
  // ⚠ THE DEFECT THIS ROUND FIXED. An unauthenticated fetch is exactly a signed-out reader.
  const denied = await fetch(`${DB}/users.json`);
  const body = await denied.json();
  assert.ok(body && body.error, 'users root became readable — re-examine which node search should use');

  const search = await node('user_search');
  const rows = Object.entries(search || {});
  assert.ok(rows.length > 50, `user_search holds ${rows.length} records — too few to be the index`);
  for (const [, v] of rows.slice(0, 20)) {
    assert.ok('displayName' in v, 'user_search record has no displayName to match on');
  }
  // and the page must not have gone back to the node that cannot be read
  const page = sourceOf('../../app/search/page.js');
  assert.ok(/'user_search'/.test(page), 'the page no longer reads user_search');
  assert.ok(!/ref\(db,\s*'users'\)/.test(page), 'the page reads the founder-only users root again');
});

test('identity resolves from the live record, not from a stored copy', async () => {
  const roster = await node('cms_voices');
  const published = Object.entries(roster || {}).filter(([, v]) => v.published === true);
  assert.ok(published.length >= 5, 'roster too small to judge');

  // Every voice must carry matchUid — authorUid is absent on all ten and reading it would
  // silently yield a screen of fallback discs.
  for (const [slug, v] of published) {
    assert.ok(v.matchUid, `${slug} has no matchUid`);
  }

  // ⚠ NON-VACUOUS: there must be at least one voice whose STORED name differs from the live
  // record, or "resolves at render" is untestable. Today it is Stanley — cms_voices says
  // "Mcdaniels", user_search says "Stanley P. Balogun", users/{uid} says "McDaniels".
  const search = await node('user_search');
  let drifted = 0;
  for (const [, v] of published) {
    const u = await node(`users/${v.matchUid}`);
    if (!u) continue;
    if (u.displayName && u.displayName !== v.displayName) drifted += 1;
    const copy = search?.[v.matchUid];
    if (copy && copy.displayName && copy.displayName !== u.displayName) drifted += 1;
  }
  assert.ok(drifted > 0, 'no stored name differs from its record — resolution is unproven today');

  const page = sourceOf('../../app/search/page.js');
  assert.ok(/resolveIdentities/.test(page), 'the page does not resolve identities at all');
  assert.ok(/nameFor\(v\.matchUid, v\.displayName\)/.test(page), 'the voice row prints the roster copy');
});

test('the avatar situation is a MIX — six photographs and four discs', async () => {
  const roster = await node('cms_voices');
  const published = Object.entries(roster || {}).filter(([, v]) => v.published === true);
  let withPhoto = 0;
  let without = 0;
  for (const [, v] of published) {
    const u = await node(`users/${v.matchUid}`);
    if (u && String(u.avatarUrl || '').trim()) withPhoto += 1;
    else without += 1;
  }
  // Both must be non-zero, or the row is not being judged as a row — a fallback that is never
  // rendered beside a photograph has never actually been designed against anything.
  assert.ok(withPhoto > 0, 'no voice has a photograph');
  assert.ok(without > 0, 'every voice has a photograph — the fallback disc is untested');
  assert.equal(withPhoto + without, published.length, 'nobody may be dropped from the row');
});

test('matching finds a subject across forms, and an author by their CURRENT name', async () => {
  const shelf = await live();
  const drama = matchStories(shelf, normalizeQuery('drama'));
  const forms = new Set(drama.map((s) => s.category));
  assert.ok(drama.length > 20, `drama matched only ${drama.length}`);
  assert.ok(forms.size > 1, 'drama matched inside a single form');
  // a leading @ is a sigil, not a character to match
  assert.equal(normalizeQuery('@Byokpara'), 'byokpara');
  assert.equal(matchStories(shelf, '').length, 0, 'an empty query matched something');
});

test('a voice with no register matches and renders on its name alone', () => {
  const withReg = { displayName: 'A Name', register: 'Short fiction that waits until the last line to hurt' };
  const without = { displayName: 'A Name', bio: 'A Name is a writer and storyteller who blends…' };
  assert.equal(matchVoices([withReg], 'last line').length, 1);
  assert.equal(matchVoices([without], 'last line').length, 0);
  assert.equal(matchVoices([without], 'a name').length, 1, 'a registerless voice became unfindable');

  // ⚠ AND NOTHING STANDS IN FOR AN ABSENT REGISTER. The render is `v.register ? … : null` —
  // no bio clause, no genreTag. A fallback here would be worse than the absence.
  const page = sourceOf('../../app/search/page.js');
  assert.ok(/v\.register \? <span className="ix-voice-r">\{v\.register\}<\/span> : null/.test(page),
    'the register render is no longer a bare presence check');
  assert.ok(!/register\s*\|\|\s*(v\.)?(bio|genreTag)/.test(page), 'a fallback was wired in behind the register');
});

test('the matched word is picked out without an innerHTML sink', () => {
  const parts = highlightParts('The Politics of Drama', 'poli');
  assert.deepEqual(parts.map((p) => p.text).join(''), 'The Politics of Drama', 'text was lost');
  assert.equal(parts.filter((p) => p.hit).length, 1);
  assert.equal(parts.find((p) => p.hit).text, 'Poli', 'the hit did not preserve original case');
  // a query with regex metacharacters must not throw or mangle
  assert.doesNotThrow(() => highlightParts('a (b) c', '('));
  assert.equal(highlightParts('a (b) c', '(').filter((p) => p.hit).length, 1);
  const page = sourceOf('../../app/search/page.js');
  assert.ok(!/dangerouslySetInnerHTML/.test(page), 'the page still writes markup into an HTML sink');
});

test('no emoji anywhere in the search tree, and the typographic marks stay', () => {
  const files = ['../../app/search/page.js', '../../app/lib/searchIndex.js', '../../app/lib/houseMotion.js'];
  // Pictographs, dingbats, misc symbols and the emoji presentation selector.
  //
  // ⭐ ✦ (U+2726) and ❧ (U+2767) ARE NOT EMOJI and sit deliberately outside this
  // range: they are letterforms Cormorant draws, they take the reading colour, and they stay.
  //
  // ⚠ Scanned over codeOf(), so the editorial marks annotating these files — and the
  // comment naming the two emoji this screen used to carry — are not mistaken for rendered
  // output. The house rule is about what a reader sees.
  //
  // ⭑ THE RULE IS UNICODE'S OWN, NOT A HAND-PICKED RANGE. A first attempt swept the codepoint
  // blocks U+2600–U+27BF, and its own self-check rejected it: ✦ is U+2726 and sits inside
  // them. Widening or carving out ranges by hand is how that guard would have ended up
  // asserting the house mark was an emoji, or quietly stopped catching anything.
  //
  // \p{Emoji_Presentation} is the property that means exactly what the house rule means —
  // "renders as a colour picture by default". ✦, ❦ and ⭑ are TEXT-presentation characters:
  // the font draws them, in the reading colour, which is why they stay. 🔍 and 📭, which this
  // screen used to carry, are emoji-presentation. A text-presentation character forced into
  // colour with U+FE0F is an emoji too, so the selector is caught separately.
  const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u;
  // Checked in BOTH directions before it is trusted on the sources — a sweep that catches
  // nothing and a sweep that catches everything both look like a passing test.
  assert.ok(!EMOJI.test('\u2726'), 'the sweep would reject ✦, the house mark');
  assert.ok(!EMOJI.test('\u2767'), 'the sweep would reject ❧, the fleuron');
  assert.ok(!EMOJI.test('\u26A0'), 'the sweep would reject the editorial warning mark');
  assert.ok(EMOJI.test('\u{1F50D}'), 'the sweep does not detect the magnifier it replaced');
  assert.ok(EMOJI.test('\u{1F4ED}'), 'the sweep does not detect the mailbox it replaced');
  assert.ok(EMOJI.test('\u26A0\uFE0F'), 'the sweep ignores the emoji presentation selector');
  for (const f of files) {
    const m = sourceOf(f).match(EMOJI);
    assert.equal(m, null, `${f} renders ${m ? m[0] : ''}`);
  }
  const raw = readFileSync(new URL('../../app/search/page.js', import.meta.url), 'utf8');
  assert.ok(raw.includes('\u2726'), 'the mark went with the emoji — it is typographic and stays');
});

test('every count carries the oldstyle class', () => {
  const page = sourceOf('../../app/search/page.js');
  // The count-bearing spans, named. A count without cs-onum sets lining figures silently.
  for (const cls of ['ix-form-n', 'ix-subj-n', 'ix-kicker-n']) {
    const re = new RegExp(`className="${cls} cs-onum"`);
    assert.ok(re.test(page), `${cls} does not carry cs-onum`);
  }
  assert.ok(/font-variant-numeric:\s*oldstyle-nums/.test(page), 'oldstyle is not declared');
  assert.ok(/font-feature-settings:\s*'onum' 1/.test(page), "the 'onum' feature is not set");
});

test('the press is the house token and survives reduced motion', () => {
  const page = sourceOf('../../app/search/page.js');
  const motion = sourceOf('../../app/lib/houseMotion.js');
  assert.ok(/PRESS_SCALE = 0\.985/.test(motion) && /PRESS_MS = 90/.test(motion));
  // No bespoke scale anywhere on the surface — the token or nothing.
  const scales = [...page.matchAll(/scale\(([^)]+)\)/g)].map((m) => m[1].trim());
  for (const v of scales) {
    assert.ok(v.startsWith('${PRESS_SCALE}') || v === '${PRESS_SCALE}', `bespoke scale: ${v}`);
  }
  // ⚠ THE REDUCED-MOTION BLOCK MUST NOT TOUCH THE PRESS.
  const block = page.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\s*\}\n/);
  assert.ok(block, 'there is no reduced-motion path at all');
  assert.ok(!/ix-press/.test(block[1]), 'reduced motion disabled the press — a control that stops answering the finger is broken');
  // and the entrance is born at its final value, not run fast
  assert.ok(/animation:\s*none/.test(block[1]), 'reduced motion shortens the animation instead of removing it');
});

test('every duration on the surface comes from the ladder', () => {
  const page = sourceOf('../../app/search/page.js');
  const inline = [...page.matchAll(/(\d+(?:\.\d+)?)ms/g)].map((m) => m[1]);
  assert.deepEqual(inline, [], `hardcoded duration(s) on the surface: ${inline.join(', ')}`);
  for (const rung of ['MOTION.hair', 'MOTION.base']) {
    assert.ok(page.includes(rung), `${rung} is unused — check the durations are still tokenised`);
  }
});

test('a group is capped, and the cap never hides the true count', async () => {
  const { capGroup, GROUP_CAP } = await import('../../app/lib/searchIndex.js');
  const rows = Array.from({ length: 191 }, (_, i) => ({ id: i }));
  const { shown, hidden } = capGroup(rows);
  assert.equal(shown.length, GROUP_CAP);
  assert.equal(hidden, 191 - GROUP_CAP);

  // ⭑ THE CAP MUST SIT ABOVE THE SHELF'S LARGEST SUBJECT, so no real query is ever
  // truncated. Asserted against the LIVE shelf, not a remembered number — if Drama grows
  // past the cap this fails and the cap moves, which is the whole point of tying it to a
  // measurement rather than to a round figure.
  const runs = subjectRuns(await live());
  const biggest = Math.max(...runs.map((r) => r.count));
  assert.ok(GROUP_CAP > biggest,
    `the cap (${GROUP_CAP}) is at or below the largest subject on the shelf (${biggest}) — a real search would be truncated`);
  assert.equal(shown.length + hidden, rows.length, 'rows went missing between shown and hidden');
  // a group under the cap is untouched and reports nothing held back
  const small = capGroup([1, 2, 3]);
  assert.deepEqual(small, { shown: [1, 2, 3], hidden: 0 });
  assert.deepEqual(capGroup([]), { shown: [], hidden: 0 });
  assert.deepEqual(capGroup(null), { shown: [], hidden: 0 });

  // ⚠ THE KICKER MUST PRINT THE FULL LENGTH, NOT THE CAPPED ONE. If it printed
  // capGroup(...).shown.length the screen would say "STORIES 40" and be quietly lying about
  // the shelf — which is the one thing an index may never do.
  const page = sourceOf('../../app/search/page.js');
  assert.match(page, /<Kicker count=\{storyHits\.length\}>Stories<\/Kicker>/,
    'the Stories kicker no longer prints the true total');
  assert.match(page, /capGroup\(storyHits\)\.shown\.map/, 'the story group is not capped');
  // every group, not just the one that happens to be biggest today
  for (const g of ['voiceHits', 'readers', 'bookHits']) {
    assert.ok(page.includes(`capGroup(${g}).shown.map`), `the ${g} group is not capped`);
  }
  assert.match(page, /<More n=\{capGroup\(storyHits\)\.hidden\} \/>/, 'the remainder is not stated');
});
