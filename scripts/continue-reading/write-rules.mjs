// CR-2 — writes the reading_position node into database.rules.json from
// app/lib/continueReading/schema.js, so its patterns are generated, never retyped. Idempotent:
//
//   node scripts/continue-reading/write-rules.mjs          rewrites the file
//   node scripts/continue-reading/write-rules.mjs --check  exits 1 if the file differs from what it would write
//
// The node (docs/CONTINUE-READING.md §2):
//   reading_position/{uid}/stories/{slug}           { fraction 0..1, updatedAt === now }
//   reading_position/{uid}/hidden/stories/{slug}    === now
//   reading_position/{uid}/hidden/instalments/{id}  === now
// Owner-only read and write. A story slug must match app/lib/ids.js AND exist in
// cms_stories_index; an instalment id must exist in series_instalments. $other is false at every
// level. A removal always lands (.validate never runs on a delete), so the end-of-story removal
// works even for a story that has since left the index.
//
// WHERE IT SITS IN THE FILE. Radio's generator (scripts/radio/write-rules.mjs) keeps its four nodes
// LAST, and its own --check fails if anything follows them. So this node is replaced where it
// stands, or, the first time, inserted just before radio_collections. Both generators stay
// idempotent over each other's output (tests/ci/continue-reading.test.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { POSITION_PATH, STORY_SLUG_RE, STORY_SLUG_MAX, INSTALMENT_ID_RE } from '../../app/lib/continueReading/schema.js';

const FILE = new URL('../../database.rules.json', import.meta.url);
const OWN = 'auth != null && auth.uid === $uid';
const closed = { '.validate': false };

/**
 * The slug pattern in the rules language. RTDB rules regexes have no non-capturing group, so
 * `(?:…)` becomes `(…)`: the same language. tests/ci/continue-reading.test.mjs checks both
 * patterns agree on a list of slugs, good and bad.
 */
export const RULES_SLUG_RE = `/${STORY_SLUG_RE.source.replace(/\(\?:/g, '(')}/`;
const slugOk = (v) => `${v}.matches(${RULES_SLUG_RE}) && ${v}.length <= ${STORY_SLUG_MAX}`;
const inIndex = (v) => `root.child('cms_stories_index').child(${v}).exists()`;
const idOk = (v) => `${v}.matches(${INSTALMENT_ID_RE.toString()})`;
const inSeries = (v) => `root.child('series_instalments').child(${v}).exists()`;

export const CONTINUE_RULES = {
  [POSITION_PATH]: {
    $uid: {
      '.read': OWN,
      '.write': OWN,
      stories: {
        $slug: {
          '.validate': `${slugOk('$slug')} && ${inIndex('$slug')} && newData.hasChildren(['fraction', 'updatedAt'])`,
          fraction: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 1' },
          updatedAt: { '.validate': 'newData.val() === now' },
          $other: closed,
        },
      },
      hidden: {
        stories: {
          $slug: { '.validate': `${slugOk('$slug')} && ${inIndex('$slug')} && newData.val() === now` },
        },
        instalments: {
          $id: { '.validate': `${idOk('$id')} && ${inSeries('$id')} && newData.val() === now` },
        },
        $other: closed,
      },
      $other: closed,
    },
  },
};

/** The rules file with reading_position (re)written: in place, or before Radio's nodes the first time. */
export function build(rules) {
  const r = rules.rules;
  const out = {};
  const present = POSITION_PATH in r;
  for (const [k, v] of Object.entries(r)) {
    if (k === POSITION_PATH) { out[k] = CONTINUE_RULES[POSITION_PATH]; continue; }
    if (!present && k === 'radio_collections') out[POSITION_PATH] = CONTINUE_RULES[POSITION_PATH];
    out[k] = v;
  }
  if (!(POSITION_PATH in out)) out[POSITION_PATH] = CONTINUE_RULES[POSITION_PATH];
  return { ...rules, rules: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = readFileSync(FILE, 'utf8');
  const after = JSON.stringify(build(JSON.parse(before)), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (after !== before) { console.error('database.rules.json differs from scripts/continue-reading/write-rules.mjs'); process.exit(1); }
    console.log('continue-reading rules: in step');
  } else {
    writeFileSync(FILE, after);
    console.log(after === before ? 'unchanged' : 'database.rules.json written');
  }
}
