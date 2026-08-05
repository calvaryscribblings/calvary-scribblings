// Inventory what actually opens a story body across live CMS content.
//
// READ ONLY. Never writes.
//
//   node scripts/audit-story-openers.mjs            print the report
//   node scripts/audit-story-openers.mjs --emit     …and rewrite the test fixture
//
// Motivation: the drop cap is decided in the render pipeline (app/lib/dropcap.js),
// which walks the body and picks the first "real" paragraph. Before changing that
// heuristic we need to know what genuinely occurs at the top of a story body —
// which tags, which classes, and what first character — rather than guessing.
//
// Prints:
//   1. Distribution of the FIRST element in each body (tag + class).
//   2. Distribution of the first element that is a bare <p> with no class.
//   3. Every story whose first prose character is punctuation or a digit.
//   4. Class frequency across the first three elements of every body.
//
// ── THE FIXTURE (--emit) ─────────────────────────────────────────────────────
// tests/ci/dropcap-openers.test.mjs asserts that every class this audit sees near
// the top of a body is CLASSIFIED — either excluded by dropcap.js or explicitly
// named as prose. The test is offline (test:ci runs on every push and must not
// need a service account), so the live observation is snapshotted here into
// tests/fixtures/story-openers.json and committed.
//
// That makes the workflow explicit rather than magical: content gains a new
// opener class → someone re-runs this with --emit → the test fails until the new
// class is classified. Re-run it whenever the CMS gains a block type.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Crude but sufficient top-level element splitter for CMS HTML: we only need the
// opening tag name, its class attribute and its text, in document order.
function elements(html) {
  const out = [];
  const re = /<(p|h1|h2|h3|h4|h5|h6|blockquote|figure|img|ul|ol|div|hr|section)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const cls = (attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [, ''])[1].trim();
    // Text of this element = everything up to its matching close (approximated by
    // the next close tag of the same name), stripped of markup.
    const rest = html.slice(re.lastIndex);
    const close = rest.search(new RegExp(`</${tag}>`, 'i'));
    const inner = close === -1 ? rest : rest.slice(0, close);
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’')
      .replace(/&#8220;|&ldquo;/g, '“').replace(/&quot;/g, '"')
      .replace(/&#8212;|&mdash;/g, '—').trim();
    out.push({ tag, cls, text });
  }
  return out;
}

const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

function sorted(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref('cms_stories').get();
  const stories = snap.val() || {};
  const slugs = Object.keys(stories);

  const firstEl = new Map();       // "tag.class" of element 1
  const firstProse = new Map();    // "tag.class" of the first classless <p>
  const classFreq = new Map();     // classes seen in the first 3 elements
  const punctOpeners = [];
  const noProse = [];
  let withBody = 0;

  for (const slug of slugs) {
    const s = stories[slug] || {};
    const html = typeof s.content === 'string' ? s.content : '';
    if (!html.trim()) continue;
    withBody++;

    const els = elements(html).filter((e) => e.tag === 'img' || e.tag === 'hr' || e.text.length > 0);
    if (!els.length) continue;

    bump(firstEl, els[0].cls ? `${els[0].tag}.${els[0].cls}` : els[0].tag);
    els.slice(0, 3).forEach((e) => { if (e.cls) bump(classFreq, e.cls); });

    const prose = els.find((e) => e.tag === 'p' && !e.cls && e.text.length > 0);
    if (!prose) { noProse.push({ slug, title: s.title, opener: `${els[0].tag}.${els[0].cls}` }); continue; }
    bump(firstProse, `p (index ${els.indexOf(prose)})`);

    const ch = prose.text[0];
    if (/[^\p{L}]/u.test(ch)) {
      punctOpeners.push({ slug, title: s.title || '(untitled)', ch, cp: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), head: prose.text.slice(0, 60) });
    }
  }

  console.log(`\nStories in cms_stories: ${slugs.length}   with a non-empty body: ${withBody}\n`);

  console.log('─── 1. FIRST element of the body ───');
  for (const [k, n] of sorted(firstEl)) console.log(`  ${String(n).padStart(4)}  ${k}`);

  console.log('\n─── 2. Position of the first classless <p> ───');
  for (const [k, n] of sorted(firstProse)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  if (noProse.length) {
    console.log(`  ${String(noProse.length).padStart(4)}  NONE — no classless <p> anywhere in the body`);
    noProse.slice(0, 15).forEach((r) => console.log(`         · ${r.slug} — opens ${r.opener}`));
  }

  console.log('\n─── 3. Classes appearing in the first 3 elements ───');
  for (const [k, n] of sorted(classFreq)) console.log(`  ${String(n).padStart(4)}  .${k}`);

  console.log(`\n─── 4. Stories whose first prose char is NOT a letter (${punctOpeners.length}) ───`);
  for (const r of punctOpeners) {
    console.log(`  ${r.cp} ${JSON.stringify(r.ch)}  ${r.slug}`);
    console.log(`          ${JSON.stringify(r.head)}`);
  }

  if (process.argv.includes('--emit')) {
    const target = resolve(ROOT, 'tests/fixtures/story-openers.json');
    // observedAt is stamped from the run, and is the only reason to re-read this
    // file rather than trust it: a stale date means the inventory predates the
    // content it claims to describe.
    const fixture = {
      _: 'GENERATED by scripts/audit-story-openers.mjs --emit. Do not hand-edit — re-run it.',
      observedAt: new Date().toISOString().slice(0, 10),
      storiesScanned: slugs.length,
      bodiesScanned: withBody,
      // Every class seen on any of the first three elements of any story body.
      // tests/ci/dropcap-openers.test.mjs requires each to be classified.
      openerClasses: Object.fromEntries(sorted(classFreq)),
      firstElement: Object.fromEntries(sorted(firstEl)),
      punctuationOpeners: punctOpeners.map((r) => ({ slug: r.slug, cp: r.cp })),
    };
    await writeFile(target, JSON.stringify(fixture, null, 2) + '\n');
    console.log(`\n  wrote ${target}`);
  }

  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
