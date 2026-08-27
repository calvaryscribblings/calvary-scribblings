// ═══════════════════════════════════════════════════════════════════════════════════════════
// R24 — _redirects LOST ITS TAIL FOR MONTHS, AND THIS IS WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:redirects
//
// ⚠ WHAT THIS SUITE REFUSES TO BE. Eight instances have now been found across this project of
// tests that could not fail — green for months while the thing they named was gone. So there
// is no assertion here about the shape of a function or the text of a comment, and every guard
// this suite relies on is PROVED able to go red by removing it and watching the assertion stop
// holding. The mutation group at the bottom is not decoration; it is the reason to believe the
// groups above it.
//
// ── THE FACTS THIS SUITE EXISTS TO KEEP TRUE (measured against the live site, 27 Aug 2026) ──
//
//   · public/_redirects held 335 rules. Cloudflare served 108 and silently dropped 227.
//   · The boundary was exact — rules 1-108 all 301'd, rules 109-335 all 404'd, no interleaving.
//     The full sweep is kept verbatim in fixtures/redirects-live-boundary.tsv.
//   · 114 legacy story URLs were 404'ing, every one of them with a live /stories/<slug> target.
//   · The cause was NOT the 2,000-rule static limit and NOT malformed lines. It was ONE dynamic
//     rule, /u/:handle, sitting ninth: Cloudflare latches every rule below the first dynamic
//     one into the 100-rule dynamic bucket and then `break`s out of the file entirely.
//     8 static + 100 latched = 108. See scripts/redirects-limits.mjs for the parser transcript.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { analyseRedirects, assertServable, isDynamic, LIMITS } from '../../scripts/redirects-limits.mjs';
import { startRig } from './fixtures/redirects-rig.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/generate-redirects.mjs');
const MODULE = join(ROOT, 'scripts/redirects-limits.mjs');
const PROBE = join(ROOT, 'scripts/.r24-probe-redirects.mjs');
const REDIRECTS = join(ROOT, 'public/_redirects');
const FIXTURES = join(ROOT, 'tests/build/fixtures');

async function attempt(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...opts });
    return { code: 0, stdout, stderr, said: stdout + stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout || '', stderr: e.stderr || '', said: (e.stdout || '') + (e.stderr || '') };
  }
}

const codes = (report) => report.violations.map((v) => v.code);

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the measurement: the model must reproduce what the edge actually did', () => {
  // ⭑ THE ANCHOR OF THE WHOLE SUITE. scripts/redirects-limits.mjs is a transcript of
  // Cloudflare's parser, and a transcript is worth exactly as much as its agreement with the
  // thing it transcribes. So it is not checked against the documentation — the documentation
  // does not describe this behaviour — but against 335 HEAD requests to the production edge.
  const preR24 = readFileSync(join(FIXTURES, 'redirects-pre-r24.txt'), 'utf8');
  const live = readFileSync(join(FIXTURES, 'redirects-live-boundary.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [rule, status, path] = l.split('\t'); return { rule: Number(rule), status, path }; });

  test('the fixture IS the file that was live — 335 rules, one dynamic, at position nine', () => {
    const report = analyseRedirects(preR24);
    assert.equal(report.total, 335);
    assert.equal(report.firstDynamic.rule, 9, 'the dynamic rule sat ninth; that position is the whole defect');
    assert.match(report.firstDynamic.line, /^\/u\/:handle\s/);
  });

  test('RULE FOR RULE — the model predicts the same 108 the live site served, and the same 227 it did not', () => {
    const report = analyseRedirects(preR24);
    const predicted = new Set(report.rules.map((r) => r.from));
    assert.equal(live.length, 335, 'the sweep must cover every rule');

    const disagreements = [];
    for (const probe of live) {
      // /u/:handle had to be probed with a concrete segment; map it back to its rule.
      const from = probe.path.startsWith('/u/') ? '/u/:handle' : probe.path;
      const servedLive = probe.status === '301';
      if (predicted.has(from) !== servedLive) disagreements.push(probe);
    }
    assert.deepEqual(disagreements, [], 'the model and the production edge must agree on every rule');
    assert.equal(report.served, 108);
    assert.equal(report.dropped, 227);
  });

  test('and it names the right cause, not merely the right count', () => {
    const report = analyseRedirects(preR24);
    // ⛔ Getting 108 by accident would be worse than getting it wrong. These are the mechanism.
    assert.equal(report.staticCount, 8, 'only the eight rules ABOVE the dynamic one counted static');
    assert.equal(report.dynamicCount, 101, 'everything from /u/:handle down was counted dynamic');
    assert.equal(report.misfiled.length, 100, 'and 100 of those were plainly static rules');
    assert.equal(report.truncatedAt.rule, 109, 'Cloudflare stopped reading at the 101st dynamic rule');
    assert.match(report.truncatedAt.line, /^\/i-told-you\.html\s/);
    assert.deepEqual(codes(report).slice(0, 3), ['dynamic-before-static', 'dynamic-cap', 'truncated']);
    // It was NOT these, and saying so is what stops the next reader re-deriving the wrong fix.
    assert.equal(report.invalid.length, 0, 'no line was malformed');
    assert.ok(report.staticCount < LIMITS.maxStatic, 'the static limit was never approached');
  });

  test('moving that one rule to the end recovers all 335 — nothing else changes', () => {
    const rules = preR24.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const reordered = [...rules.filter((l) => !isDynamic(l.split(/\s+/)[0])),
                       ...rules.filter((l) => isDynamic(l.split(/\s+/)[0]))].join('\n');
    const report = analyseRedirects(reordered);
    assert.equal(report.served, 335, 'the fix is a reordering, not a rewrite');
    assert.deepEqual(report.violations, []);
    assert.equal(report.staticCount, 334);
    assert.equal(report.dynamicCount, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the shipped file: every rule in public/_redirects is served', () => {
  const shipped = () => readFileSync(REDIRECTS, 'utf8');

  test('nothing is dropped', () => {
    const report = analyseRedirects(shipped());
    assert.deepEqual(report.violations, [], 'the shipped redirect map must carry no violations');
    assert.equal(report.served, report.total);
    assert.equal(report.dropped, 0);
    assert.equal(report.truncatedAt, null);
  });

  test('the counts are inside Cloudflare\'s limits, and the headroom is stated rather than assumed', () => {
    const report = analyseRedirects(shipped());
    assert.ok(report.staticCount <= LIMITS.maxStatic, `${report.staticCount} static rules, limit ${LIMITS.maxStatic}`);
    assert.ok(report.dynamicCount <= LIMITS.maxDynamic, `${report.dynamicCount} dynamic rules, limit ${LIMITS.maxDynamic}`);
    assert.ok(report.total > 300, 'the legacy story rules must still be here — a thin file is the failure mode');
  });

  test('ORDERING — no static rule sits below a dynamic one', () => {
    // ⭑ The single invariant that makes the other two true. Stated positionally rather than
    // via the report, so it holds even if the analyser is wrong about everything else.
    const froms = shipped().split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
    const firstDynamic = froms.findIndex(isDynamic);
    if (firstDynamic === -1) return;
    const stragglers = froms.slice(firstDynamic).filter((f) => !isDynamic(f));
    assert.deepEqual(stragglers, [], 'these static rules are below a dynamic rule and will be counted against the dynamic cap');
  });

  test('no line is malformed or over-length', () => {
    const report = analyseRedirects(shipped());
    assert.deepEqual(report.invalid, []);
    const longest = Math.max(...shipped().split('\n').map((l) => l.trimEnd().length));
    assert.ok(longest <= LIMITS.maxLineLength, `longest declaration is ${longest}, limit ${LIMITS.maxLineLength}`);
  });

  test('no dynamic rule shadows a path a static rule now answers first', () => {
    // Reordering changed precedence: /u/:handle used to be matched before the story rules and
    // is now matched after them. That is only safe while it cannot claim one of their paths.
    assert.deepEqual(analyseRedirects(shipped()).shadowed, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the generator STOPS THE BUILD rather than emitting a file that cannot be served', () => {
  // Every case here drives the REAL scripts/generate-redirects.mjs — patched only in its
  // database URL, exactly as PL-12's suite does — against a catalogue a real database could
  // return. No mutants, no hand-written redirect files: the script's own output is the input
  // to its own gate, which is the only arrangement that proves the gate is wired in.
  let saved;

  const makeProbe = (rigUrl) => {
    const src = readFileSync(SCRIPT, 'utf8');
    const patched = src.replace(/^const FB_DB = '[^']*';$/m, `const FB_DB = '${rigUrl}';`);
    assert.notEqual(patched, src, 'the probe must have replaced the FB_DB line');
    assert.equal(patched.split('\n').length, src.split('\n').length, 'and changed nothing else');
    writeFileSync(PROBE, patched);
    return PROBE;
  };

  before(() => { saved = readFileSync(REDIRECTS, 'utf8'); });
  after(() => {
    writeFileSync(REDIRECTS, saved);
    if (existsSync(PROBE)) unlinkSync(PROBE);
  });

  for (const [mode, code, why] of [
    ['over-static',  'static-cap',  '1,001 stories is 2,002 static rules, past the 2,000-rule limit'],
    ['over-dynamic', 'dynamic-cap', "51 slugs containing ':' become 102 dynamic rules, past the 100-rule limit"],
    ['unparseable',  'unparseable', 'a slug with a space emits a line Cloudflare silently ignores'],
    ['over-length',  'unparseable', 'a 1,200-character slug passes the per-declaration limit'],
  ]) {
    test(`${mode}: exits non-zero, says why, and leaves public/_redirects untouched — ${why}`, async () => {
      const rig = await startRig(mode);
      try {
        const before = readFileSync(REDIRECTS, 'utf8');
        const r = await attempt(process.execPath, [makeProbe(rig.url)]);
        assert.notEqual(r.code, 0, 'a file that cannot be served in full must stop the build');
        assert.match(r.said, /CANNOT BE SERVED IN FULL/);
        assert.match(r.said, new RegExp(`\\[${code}\\]`), `the reason must name ${code}`);
        // ⭑ NOTHING PARTIAL — the same promise PL-12 made about this file. The gate runs before
        // writeFile, so a rejected map never reaches disk for a later deploy to pick up.
        assert.equal(readFileSync(REDIRECTS, 'utf8'), before, 'a rejected map must not have been written');
      } finally { await rig.close(); }
    });
  }

  test('healthy: exits 0, writes the file, and reports what is servable', async () => {
    const rig = await startRig('healthy');
    try {
      const r = await attempt(process.execPath, [makeProbe(rig.url)]);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /\(3 slugs from CMS, 9 static\)/);
      assert.match(r.stdout, /15\/15 rules servable — 14 static, 1 dynamic/);
      const written = readFileSync(REDIRECTS, 'utf8');
      assert.deepEqual(analyseRedirects(written).violations, []);
      assert.doesNotMatch(written, /\/hidden\s/, 'an unpublished story gets no redirect');
      // And the partition put the dynamic rule last, without anyone ordering the source list.
      const froms = written.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
      assert.equal(froms.filter(isDynamic).length, 1);
      assert.ok(isDynamic(froms.at(-1)), 'the dynamic rule must be the last rule in the file');
    } finally { await rig.close(); }
  });

  test('THE PARTITION IS THE FIX — remove it and the same healthy catalogue is rejected', async () => {
    // ⭑ Proof that the reordering in the generator is load-bearing rather than tidy. This is
    // the ONE mutant in this group: the partition is deleted, restoring the pre-R24 emission
    // order, and a catalogue that passed a moment ago now fails at the gate.
    const rig = await startRig('healthy');
    try {
      const src = readFileSync(SCRIPT, 'utf8');
      const needle = '  const all = [...STATIC_LEGACY_REDIRECTS, ...storyRules];\n' +
                     '  const staticRules  = all.filter(([from]) => !isDynamic(from));\n' +
                     '  const dynamicRules = all.filter(([from]) =>  isDynamic(from));';
      assert.ok(src.includes(needle), 'the partition moved — this mutation must be re-aimed');
      const mutated = src.replace(needle,
        '  const all = [...STATIC_LEGACY_REDIRECTS, ...storyRules];\n' +
        '  const staticRules = all;\n' +
        '  const dynamicRules = [];')
        .replace(/^const FB_DB = '[^']*';$/m, `const FB_DB = '${rig.url}';`);
      writeFileSync(PROBE, mutated);

      const r = await attempt(process.execPath, [PROBE]);
      assert.notEqual(r.code, 0, 'without the partition the emitted file is misordered and must be rejected');
      assert.match(r.said, /\[dynamic-before-static\]/);
    } finally { await rig.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('MUTATION — each guard is proved to be the thing making its assertion hold', () => {
  // Every assertion above rests on a specific few lines of scripts/redirects-limits.mjs. Here
  // each of those is deleted in turn and the corresponding finding must DISAPPEAR. A guard
  // whose removal changes nothing was never doing anything, and the test that relied on it
  // could not have failed.
  const mutants = [];
  const src = readFileSync(MODULE, 'utf8');
  const preR24 = readFileSync(join(FIXTURES, 'redirects-pre-r24.txt'), 'utf8');

  after(() => { for (const m of mutants) if (existsSync(m)) unlinkSync(m); });

  // Loads a copy of the module with `needle` replaced, so the guard under test is gone.
  async function withoutGuard(name, needle, replacement = '') {
    // ⛔ EXACTLY ONE OCCURRENCE, and this is not pedantry. scripts/redirects-limits.mjs quotes
    // Cloudflare's parser in its header comment, so several of these needles appear twice — once
    // in prose and once in code — and String.replace takes the FIRST. The first version of this
    // suite mutated the comment, left the code intact, and reported a guard as unproven. An
    // ambiguous needle is a mutation that silently tests nothing.
    const hits = src.split(needle).length - 1;
    assert.equal(hits, 1, `the guard "${name}" matches ${hits} places — re-aim it at exactly one`);
    const path = join(ROOT, `scripts/.r24-mutant-${name}.mjs`);
    mutants.push(path);
    writeFileSync(path, src.replace(needle, replacement));
    return import(pathToFileURL(path).href);
  }

  const OVER_STATIC  = Array.from({ length: 2101 }, (_, i) => `/s${i} /stories/s${i} 301`).join('\n');
  const OVER_DYNAMIC = Array.from({ length: 101 }, (_, i) => `/d${i}/:x /stories/d${i}?x=:x 301`).join('\n');
  const MALFORMED    = '/ok /stories/ok 301\n/bad slug /stories/bad slug 301\n';
  const SHADOWING    = '/u/known /stories/known 301\n/u/:handle /user?handle=:handle 301\n';

  for (const [name, needle, input, code, replacement] of [
    ['latch',
      '      canCreateStaticRule = false;\n      if (dynamicCount > LIMITS.maxDynamic) {',
      preR24, 'truncated', '      if (dynamicCount > LIMITS.maxDynamic) {'],
    ['misfiled-detection',
      '      if (!dynamic) misfiled.push(at);',
      preR24, 'dynamic-before-static', ''],
    ['truncation',
      '        truncatedAt = at;                 // Cloudflare `break`s: everything below is unread',
      preR24, 'truncated', ''],
    ['dynamic-cap',
      "  if (dynamicCount > LIMITS.maxDynamic) {\n    violations.push({\n      code: 'dynamic-cap',",
      OVER_DYNAMIC, 'dynamic-cap',
      "  if (false) {\n    violations.push({\n      code: 'dynamic-cap',"],
    ['static-cap',
      "  if (staticCount > LIMITS.maxStatic) {\n    violations.push({\n      code: 'static-cap',",
      OVER_STATIC, 'static-cap',
      "  if (false) {\n    violations.push({\n      code: 'static-cap',"],
    ['unparseable',
      "  for (const bad of invalid) {\n    violations.push({ code: 'unparseable', message: `line ${bad.lineNumber}: ${bad.why}` });\n  }",
      MALFORMED, 'unparseable', ''],
    ['shadowed',
      "  for (const s of shadowed) {",
      SHADOWING, 'shadowed', '  for (const s of []) {'],
  ]) {
    test(`without the "${name}" guard, [${code}] is no longer reported`, async () => {
      // First: the shipped module DOES report it for this input. Without this half the test
      // would pass against a module that reports nothing at all, ever.
      const before = analyseRedirects(input);
      assert.ok(codes(before).includes(code), `the shipped module must report ${code} for this input`);

      const mutant = await withoutGuard(name, needle, replacement);
      const after_ = mutant.analyseRedirects(input);
      assert.ok(!codes(after_).includes(code), `removing "${name}" must stop ${code} being reported — it did not, so that guard is not what produces it`);
    });
  }

  test('and the gate itself: without assertServable\'s throw, a broken map passes silently', async () => {
    // ⭑ THE LAST LINK. Every finding above is worthless if the build does not act on it.
    assert.throws(() => assertServable(preR24), /CANNOT BE SERVED IN FULL/);
    const mutant = await withoutGuard('gate',
      '  if (report.violations.length === 0 && report.served === report.total) return report;',
      '  return report;');
    assert.doesNotThrow(() => mutant.assertServable(preR24), 'the throw is what stops the build');
  });
});
