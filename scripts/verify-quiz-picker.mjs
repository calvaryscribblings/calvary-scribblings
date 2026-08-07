// Verifies the Quiz Builder's story picker against the LIVE data by importing the
// page's own list logic (app/lib/quizPicker.js) — not a re-implementation of it.
// Read-only: three GETs, no writes.
//
//   node scripts/verify-quiz-picker.mjs
//
// Checks, in order:
//   1. payload — what the picker downloads now vs what it downloaded before
//   2. quiz-state counts, against cms_quizzes and the index badge independently
//   3. search hits AND misses, including punctuation/accent/digit cases
//   4. each filter alone, and combined as AND
//   5. facet counts — every count equals the length of the list it promises
//   6. sort — newest/oldest/title
import { toRow, tokenize, quizState, selectRows } from '../app/lib/quizPicker.js';
import { INDEX_PATH, isIndexed } from '../app/lib/storyIndex.js';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`   ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const kb = n => `${(n / 1024).toFixed(1)} KB`;

async function grab(path) {
  const res = await fetch(`${DB}/${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return { bytes: Buffer.byteLength(text), json: JSON.parse(text) };
}

// ── 1. Payload ───────────────────────────────────────────────────────────────
const index = await grab(`${INDEX_PATH}.json`);
const quizKeys = await grab('cms_quizzes.json?shallow=true');
const storyKeys = await grab('cms_stories.json?shallow=true');
const before = { stories: await grab('cms_stories.json'), quizzes: await grab('cms_quizzes.json') };

const afterBytes = index.bytes + quizKeys.bytes + storyKeys.bytes;
const beforeBytes = before.stories.bytes + before.quizzes.bytes;
console.log('\n1. PAYLOAD');
console.log(`   before  cms_stories ${kb(before.stories.bytes)} + cms_quizzes ${kb(before.quizzes.bytes)} = ${kb(beforeBytes)}`);
console.log(`   after   ${INDEX_PATH} ${kb(index.bytes)} + cms_quizzes?shallow ${kb(quizKeys.bytes)} + cms_stories?shallow ${kb(storyKeys.bytes)} = ${kb(afterBytes)}`);
console.log(`   → ${(100 - (afterBytes / beforeBytes) * 100).toFixed(1)}% smaller (${(beforeBytes / afterBytes).toFixed(1)}× less)`);
ok(afterBytes < beforeBytes / 5, 'the picker downloads at least 5× less than it did');

// ── Build the rows exactly as the page does ──────────────────────────────────
const rows = Object.entries(index.json).map(([slug, r]) => toRow(slug, r, true));
const quizSlugs = new Set(Object.keys(quizKeys.json));
const advertisedSlugs = new Set(rows.filter(r => r.advertised).map(r => r.slug));
const stateOf = slug => quizState(slug, { quizSlugs, advertisedSlugs, quizKeysOk: true });
const run = f => selectRows(rows, f, stateOf);

console.log(`\n   rows: ${rows.length} from ${INDEX_PATH}; ${Object.keys(storyKeys.json).length - rows.length} unpublished stories held back behind the "Load them" control`);

// ── 2. Quiz-state counts, cross-checked against the full nodes ───────────────
console.log('\n2. QUIZ STATE');
const full = before.quizzes.json;
const src = before.stories.json;
const truthBuilt = rows.filter(r => !!full[r.slug]).length;
const truthAdvertised = rows.filter(r => !!(src[r.slug]?.quizMeta?.hasQuiz)).length;
const base = run({});
console.log(`   All (${base.quizCounts.all}) · No quiz yet (${base.quizCounts.none}) · Has quiz (${base.quizCounts.has})`);
ok(base.quizCounts.all === rows.length, 'All = every row');
ok(base.quizCounts.none + base.quizCounts.has === rows.length, 'the two states partition the list');
ok(base.quizCounts.has === truthBuilt, 'Has quiz = rows with a cms_quizzes record', `${base.quizCounts.has} vs ${truthBuilt}`);
ok(base.quizCounts.none === rows.length - truthBuilt, 'No quiz yet = the rest', `${base.quizCounts.none}`);
ok(run({ quiz: 'none' }).visible.length === base.quizCounts.none, '"No quiz yet" chip count matches its own list length');
ok(run({ quiz: 'has' }).visible.length === base.quizCounts.has, '"Has quiz" chip count matches its own list length');
ok(run({ quiz: 'none' }).visible.every(r => !full[r.slug]), 'no story with a quiz is filed under "No quiz yet"');

const unlisted = rows.filter(r => stateOf(r.slug) === 'unlisted');
console.log(`   badges: live ${rows.filter(r => stateOf(r.slug) === 'live').length} · built-but-not-shown ${unlisted.length} · none ${base.quizCounts.none}`);
ok(rows.filter(r => stateOf(r.slug) === 'live').length === truthAdvertised, '"Quiz live" = quizMeta.hasQuiz on the full record', `${truthAdvertised}`);
ok(unlisted.every(r => full[r.slug] && !src[r.slug]?.quizMeta?.hasQuiz), 'every "built · not shown" row really is built and really is not advertised');
if (unlisted.length) console.log(`   (these ${unlisted.length} would read "No quiz yet" if the picker trusted the index badge alone: ${unlisted.slice(0, 4).map(r => r.slug).join(', ')}…)`);

// ── 3. Search ────────────────────────────────────────────────────────────────
console.log('\n3. SEARCH');
const titles = new Map(rows.map(r => [r.slug, r.title]));
const hit = (q, slug) => {
  const list = run({ tokens: tokenize(q) }).visible;
  ok(list.some(r => r.slug === slug), `"${q}" finds ${JSON.stringify(titles.get(slug) || slug)}`, `${list.length} result${list.length === 1 ? '' : 's'}`);
};
const miss = (q, slug) => {
  const list = run({ tokens: tokenize(q) }).visible;
  ok(!list.some(r => r.slug === slug), `"${q}" does NOT match ${JSON.stringify(titles.get(slug) || slug)}`, `${list.length} result${list.length === 1 ? '' : 's'}`);
};

hit('47 sessions', '47-sessions');           // digits + case
hit('47 SESSIONS', '47-sessions');           // case-insensitive
hit('sessions 47', '47-sessions');           // token order
hit("amore's cage", 'amor-s-cage');         // typed straight apostrophe vs curly ’
hit('amores cage', 'amor-s-cage');          // apostrophe omitted entirely
hit('amoré', 'amor-s-cage');                // accent typed
hit('amore', 'amor-s-cage');                // accent folded away
hit('dont worry', 'dont-worry');             // apostrophe omitted, straight source
hit("don't worry", 'dont-worry');
hit('5-to-9', '5-to-9');                     // hyphens
hit('5 to 9', '5-to-9');
hit('in your 20s', 'in-your-20-s');          // curly apostrophe inside "20’s"
hit('okaro', 'a-legacy-through-time');       // author match (Dera Okaro)
hit('dera okaro', 'a-legacy-through-time');
hit('okaro dera', 'a-legacy-through-time');  // author, token order
hit('legacy okaro', 'a-legacy-through-time');// title token + author token together
miss('zzzz', '47-sessions');
miss('47 sessionz', '47-sessions');          // a real typo still misses
miss('sessions elephant', '47-sessions');    // AND across tokens, not OR
ok(run({ tokens: tokenize('') }).visible.length === rows.length, 'empty query = unfiltered');
ok(run({ tokens: tokenize('   ') }).visible.length === rows.length, 'whitespace-only query = unfiltered');
ok(run({ tokens: tokenize('zzzzqqq') }).visible.length === 0, 'a no-match query yields the empty state, not a crash');

const byAuthor = run({ tokens: tokenize('dera okaro') }).visible;
ok(byAuthor.length > 0 && byAuthor.every(r => r.author === 'Dera Okaro' || r.key.includes('dera')), 'an author search returns only that author’s stories', `${byAuthor.length} rows`);

// ── 4. Filters, alone and combined ───────────────────────────────────────────
console.log('\n4. FILTERS');
const readerRows = rows.filter(r => r.reader);
ok(run({ mode: 'reader' }).visible.length === readerRows.length, 'Book reader shows every reader story', `${readerRows.length}`);
ok(run({ mode: 'story' }).visible.length === rows.length - readerRows.length, 'Story page shows the rest');
ok(run({ mode: 'reader' }).visible.every(r => r.reader) && run({ mode: 'story' }).visible.every(r => !r.reader), 'the two story-type filters do not overlap');

const cat = 'Short Story';
const catRows = rows.filter(r => r.categoryName === cat);
ok(run({ cat }).visible.length === catRows.length, `category "${cat}" alone`, `${catRows.length}`);
const author = 'Dera Okaro';
const authorRows = rows.filter(r => r.author === author);
ok(run({ author }).visible.length === authorRows.length, `author "${author}" alone`, `${authorRows.length}`);

const both = run({ cat, author });
const bothTruth = rows.filter(r => r.categoryName === cat && r.author === author);
ok(both.visible.length === bothTruth.length, 'category AND author', `${both.visible.length}`);
const triple = run({ cat, author, quiz: 'none' });
const tripleTruth = bothTruth.filter(r => !full[r.slug]);
ok(triple.visible.length === tripleTruth.length, 'category AND author AND "No quiz yet"', `${triple.visible.length}`);
// Search on a word from a story that survives the other three filters, so the
// four-way AND is asserted on a non-empty list rather than passing vacuously.
const seed = triple.visible[0];
const seedWord = seed.key.split(' ').find(w => w.length > 3) || seed.key.split(' ')[0];
const quad = run({ cat, author, quiz: 'none', tokens: tokenize(seedWord) });
ok(quad.visible.length > 0, `search AND category AND author AND quiz state still finds ${JSON.stringify(seed.title)}`, `"${seedWord}" → ${quad.visible.length}`);
ok(quad.visible.every(r => r.categoryName === cat && r.author === author && !full[r.slug] && r.key.includes(seedWord)), 'every row in that four-way result satisfies all four');
ok(quad.visible.length <= triple.visible.length, 'adding a search term never widens the list');
ok(run({ cat: 'Poetry', author, quiz: 'none', tokens: tokenize(seedWord) }).visible.length === 0, 'a contradictory combination returns nothing, not everything');

// ── 5. Facet counts describe their own lists ─────────────────────────────────
console.log('\n5. FACET COUNTS');
const withAuthor = run({ author });
ok(withAuthor.quizCounts.all === authorRows.length, 'quiz-state counts narrow to the selected author', `All (${withAuthor.quizCounts.all})`);
ok(withAuthor.quizCounts.none === authorRows.filter(r => !full[r.slug]).length, `"No quiz yet (${withAuthor.quizCounts.none})" is right for ${author}`);
ok(run({ author, quiz: 'none' }).visible.length === withAuthor.quizCounts.none, 'clicking it yields exactly that many rows');

let catCountsOk = true;
for (const [name, n] of base.catOptions) {
  if (run({ cat: name }).visible.length !== n) catCountsOk = false;
}
ok(catCountsOk, 'every category option count equals the list it produces', `${base.catOptions.length} categories`);
let authorCountsOk = true;
for (const [name, n] of base.authorOptions) {
  if (run({ author: name }).visible.length !== n) authorCountsOk = false;
}
ok(authorCountsOk, 'every author option count equals the list it produces', `${base.authorOptions.length} authors`);
ok(base.catOptions.reduce((a, [, n]) => a + n, 0) === rows.filter(r => r.categoryName).length, 'the category counts sum to the whole list');

const facetUnderQuiz = run({ quiz: 'none' });
ok(facetUnderQuiz.authorOptions.every(([name, n]) => authorRowsFor(name).filter(r => !full[r.slug]).length === n), 'author counts respect the active quiz-state filter');
function authorRowsFor(name) { return rows.filter(r => r.author === name); }

// ── 6. Sort ──────────────────────────────────────────────────────────────────
console.log('\n6. SORT');
const newest = run({ sort: 'newest' }).visible;
const oldest = run({ sort: 'oldest' }).visible;
const alpha = run({ sort: 'title' }).visible;
ok(newest.every((r, i) => i === 0 || newest[i - 1].ts >= r.ts), 'newest first is monotonically descending');
ok(oldest.every((r, i) => i === 0 || oldest[i - 1].ts <= r.ts), 'oldest first is monotonically ascending');
ok(alpha.every((r, i) => i === 0 || alpha[i - 1].title.localeCompare(r.title) <= 0), 'title A–Z is alphabetical');
ok(newest.length === oldest.length && newest.length === alpha.length, 'sorting never adds or drops a row');
ok(rows.every(r => r.ts > 0), 'every row has a parseable date', `${rows.filter(r => !r.ts).length} unparseable`);
console.log(`   newest: ${newest[0].date} ${JSON.stringify(newest[0].title)} … oldest: ${oldest[0].date} ${JSON.stringify(oldest[0].title)}`);

// ── Index integrity note (read-only, informational) ──────────────────────────
const eligible = Object.keys(src).filter(s => isIndexed(src[s]));
ok(eligible.length === rows.length, 'the index carries every published story', `${eligible.length} eligible, ${rows.length} indexed`);

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all checks passed'}\n`);
process.exit(failures ? 1 : 0);
