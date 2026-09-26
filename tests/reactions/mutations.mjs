// W13 — MUTATIONS: break each rule on purpose and confirm a test catches it.
//
//   node tests/reactions/mutations.mjs <scratchDir>
//
// Each mutation copies its file aside, applies one edit, runs the suite that owns the rule
// (the node test in tests/ci, or the browser proof in WebKit), and copies the file back — in
// a finally, so an interrupted run cannot leave a mutant behind. Run it alone in the tree
// (CLAUDE.md: no other worker may build from these files while it runs). Exit 1 if any
// mutation SURVIVES.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';

const SCRATCH = process.argv[2];
if (!SCRATCH) { console.error('usage: node tests/reactions/mutations.mjs <scratchDir>'); process.exit(2); }
mkdirSync(SCRATCH, { recursive: true });

const R = 'app/components/conversation/Reaction.js';
const M = 'app/lib/reactionMotion.js';
const STORY = 'app/stories/[slug]/page-client.js';
const SQUARE = 'app/square/page.js';
const OPEN = 'app/open-pages/[id]/page-client.js';
const CI = ['node', ['--test', 'tests/ci/w13-reactions.test.mjs']];
const PROOF = (only) => ['node', ['tests/reactions/proof.mjs', join(SCRATCH, `proof-${only}`), '--quick', `--only=${only}`, '--engine=webkit']];

const MUTANTS = [
  ['the motion is verbatim — a retimed beat', M, '470, 200, E.spring, "backwards");', '480, 200, E.spring, "backwards");', CI],
  ['heart is #A92339', M, "heart: '#A92339'", "heart: '#d4537e'", CI],
  ['the rose sparks are hsl(350, 66%, 58%)', M, "rose: 'hsl(350, 66%, 58%)'", "rose: '#d4537e'", CI],
  ['comments show heart and fire only (CI)', R, "  { key: 'heart', kind: 'heart' },\n  { key: 'fire', kind: 'fire' },", "  { key: 'heart', kind: 'heart' },\n  { key: 'clap', kind: 'like' },\n  { key: 'fire', kind: 'fire' },", CI],
  ['comments show heart and fire only (browser)', R, "  { key: 'heart', kind: 'heart' },\n  { key: 'fire', kind: 'fire' },", "  { key: 'heart', kind: 'heart' },\n  { key: 'clap', kind: 'like' },\n  { key: 'fire', kind: 'fire' },", PROOF('row')],
  ['the Square keeps heart, like and fire', R, "  { key: 'clap', kind: 'like' },", "  { key: 'clap', kind: 'heart' },", CI],
  ['Reply is a word, not grey capitals', STORY, 'letter-spacing: 0; text-transform: none;', 'letter-spacing: 0.1em; text-transform: uppercase;', CI],
  ['Reply reads Cancel while open (Open Pages)', OPEN, "{replyOpen ? 'Cancel' : 'Reply'}", 'Reply', CI],
  ['the section says Responses', STORY, '<div className="cs-title">Responses</div>', '<div className="cs-title">Discussion</div>', CI],
  ['the placeholder says Add a response…', STORY, 'placeholder="Add a response…"', 'placeholder="Share your thoughts on this story…"', CI],
  ['no slide on mount', R, '    setCount(b, count);\n    return () => clear(b);', '    setCount(b, count - 1); setCount(b, count);\n    return () => clear(b);', PROOF('count')],
  // The echo guard is DOUBLE: the count effect runs only when `count` changes, and the
  // prototype's setCount returns on an equal value. Either alone holds; the mutant drops both.
  ['no slide on a same-value echo', [[M, '  if (cur && +cur.textContent === n) return;\n', ''], [R, '    setCount(btn.current, count);\n  }, [count]);', '    setCount(btn.current, count);\n  });']], PROOF('count')],
  ['full strength once reacted', R, 'color: on ? REACTION_FULL : REACTION_REST', 'color: on ? REACTION_REST : REACTION_REST', PROOF('count')],
  ['Reduce Motion: at once, no burst', R, '    if (!reducedMotion()) {\n      clear(b);', '    if (true) {\n      clear(b);', PROOF('behaviour')],
  ['a failed save shakes and says so', R, '() => { busy.current = false; clear(b); shake(b); onFail?.(); },', '() => { busy.current = false; },', PROOF('behaviour')],
  ['a surface rethrows a failed save', SQUARE, '      apply(hasReacted, currentCount);\n      throw e;', '      apply(hasReacted, currentCount);', CI],
  ['the press-down is .88', M, "{ transform: 'scale(.88)' }], 90", "{ transform: 'scale(.95)' }], 90", PROOF('behaviour')],
  ['the 44px slot', R, 'width:44px;height:44px;', 'width:40px;height:40px;', PROOF('row')],
  ['0–99 never moves a neighbour', R, "'data-wide': count >= 100 ? '' : undefined,", "'data-wide': count >= 10 ? '' : undefined,", PROOF('row')],
  // The fx layer cannot move layout by construction: it lives inside a fixed S × S icon box in
  // a fixed 44px slot, so no positioning mutant of it moves a neighbour. What CAN move while an
  // effect plays is the count: its two numbers must overlap during the slide.
  ['nothing moves while an effect plays', R, '.rx-count>.n{grid-area:1/1;display:block}', '.rx-count>.n{display:inline-block}', PROOF('stability')],
  ['the Square never remounts its buttons', SQUARE, '{ReactionBar({ p, size: 16 })}', '<ReactionBar p={p} size={16} />', CI],
  ['16px icons in replies', SQUARE, '{ReactionBar({ p: r, size: 16 })}', '{ReactionBar({ p: r, size: 14 })}', CI],
  ['a non-flat ground takes the mask', M, '  if (bg == null) return burstMasked(b, S, R, from, to, delay); // W13-MASK\n', '', PROOF('hole')],
];

const rows = [];
for (const m of MUTANTS) {
  // [rule, file, find, repl, run] — or [rule, [[file, find, repl], …], run] for a mutant that
  // must break two guards at once.
  const [rule, edits, [cmd, args]] = Array.isArray(m[1]) ? [m[0], m[1], m[2]] : [m[0], [[m[1], m[2], m[3]]], m[4]];
  const srcs = edits.map(([file]) => readFileSync(file, 'utf8'));
  const missing = edits.filter(([, find], i) => !srcs[i].includes(find));
  if (missing.length) { rows.push([rule, 'SETUP', `the edit no longer applies in ${missing.map(([f]) => basename(f)).join(', ')}`]); console.log(`? ${rule} — SETUP`); continue; }
  const files = [...new Set(edits.map(([f]) => f))];
  const asides = files.map((f, i) => { const a = join(SCRATCH, `aside-${i}-${basename(f)}`); copyFileSync(f, a); return a; });
  let caught;
  try {
    for (const [file, find, repl] of edits) writeFileSync(file, readFileSync(file, 'utf8').replace(find, repl));
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 900000 });
    caught = r.status !== 0;
  } finally {
    files.forEach((f, i) => copyFileSync(asides[i], f));
  }
  rows.push([rule, caught ? 'caught' : 'SURVIVED', `${files.map((f) => basename(f)).join(' + ')} → ${args[0] === '--test' ? 'test:ci' : args.at(-2)}`]);
  console.log(`${caught ? '✓' : '✗'} ${rule} — ${caught ? 'caught' : 'SURVIVED'}`);
}
writeFileSync(join(SCRATCH, 'mutations.json'), JSON.stringify(rows, null, 2));
const bad = rows.filter((r) => r[1] !== 'caught');
console.log(`\n${rows.length - bad.length}/${rows.length} mutations caught`);
process.exit(bad.length ? 1 : 0);
