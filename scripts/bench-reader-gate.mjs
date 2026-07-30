// R7.3 §C — does opening a story cost less now that the gate reads in parallel?
//
//   node scripts/bench-reader-gate.mjs [slug] [runs]
//
// READ ONLY. It performs the same two RTDB reads /reader/{slug} performs and nothing else.
//
// WHAT IT MEASURES, and why this is the honest comparison. The gate has to answer one
// question — which register owns this slug — and answering it needs two reads:
//
//   bookstore   query(bookstore_titles, orderByChild('slug'), equalTo(slug))
//   story       get(cms_stories/{slug})
//
// BEFORE R7.3 those were serial by CONSTRUCTION, not by choice. The gate awaited the
// bookstore lookup, and only once it had resolved did it mount StoryReaderClient, whose own
// useEffect then began fetching the story. Neither read knew the other existed, so a story
// open paid RT1 + RT2 end to end when it needed to pay max(RT1, RT2).
//
// AFTER, they are one Promise.all and the resolved story is handed down as a prop, so the
// register's fallback fetch never runs.
//
// SERIAL here reproduces the old shape exactly (await, then await); PARALLEL reproduces the
// new one. Both run against the live database over the same warm connection, alternating
// and interleaved so drift in the network hits both arms equally. The first pair is
// discarded: it pays for the WebSocket handshake, which neither shape can avoid and which
// would otherwise be charged entirely to whichever arm happened to go first.
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, query, orderByChild, equalTo } from 'firebase/database';

const SLUG = process.argv[2] || 'beta-princess';
const RUNS = Number(process.argv[3] || 12);

const app = initializeApp({
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
});
const db = getDatabase(app);

const readBookstore = () =>
  get(query(ref(db, 'bookstore_titles'), orderByChild('slug'), equalTo(SLUG))).catch(() => null);
const readStory = () => get(ref(db, 'cms_stories/' + SLUG)).catch(() => null);

async function serial() {
  const t = performance.now();
  await readBookstore();
  await readStory();          // ← only STARTS once the line above has landed
  return performance.now() - t;
}

async function parallel() {
  const t = performance.now();
  await Promise.all([readBookstore(), readStory()]);
  return performance.now() - t;
}

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return {
    min: s[0],
    median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    max: s[s.length - 1],
  };
};
const ms = (n) => `${n.toFixed(1)} ms`;

// Warm the connection AND the query index, so neither arm is charged for the handshake.
await serial();
await parallel();

const S = [];
const P = [];
for (let i = 0; i < RUNS; i++) {
  // Alternate the leading arm: if the network drifts mid-run, it drifts across both.
  if (i % 2 === 0) { S.push(await serial()); P.push(await parallel()); }
  else { P.push(await parallel()); S.push(await serial()); }
}

const s = stat(S);
const p = stat(P);
console.log(`\nR7.3 §C — reader gate, slug "${SLUG}", ${RUNS} runs each (live RTDB)\n`);
console.table({
  'SERIAL (pre-R7.3)': { min: ms(s.min), median: ms(s.median), mean: ms(s.mean), max: ms(s.max) },
  'PARALLEL (R7.3)': { min: ms(p.min), median: ms(p.median), mean: ms(p.mean), max: ms(p.max) },
});
const saved = s.median - p.median;
console.log(
  `median: ${ms(s.median)} → ${ms(p.median)}  (${saved >= 0 ? '−' : '+'}${ms(Math.abs(saved))}, ` +
  `${((saved / s.median) * 100).toFixed(0)}% of the serial cost)\n`,
);
console.log('READ ONLY — nothing written.');
process.exit(0);
