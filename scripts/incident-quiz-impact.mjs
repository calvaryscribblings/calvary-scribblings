// Did the R11.9 gate suppress quiz activity? — the measurement, not the assumption.
//
//   node scripts/incident-quiz-impact.mjs
//
// READ-ONLY BY CONSTRUCTION, the same discipline as scripts/leaderboard-audit.mjs:
// no set, update, push, remove or transaction appears in this file. Grep it. It is
// safe to run at any point, including mid-contest.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
//
// On 2026-08-08 a reader-visible paywall was live on the web story page from ~14:08Z
// until 18:54Z (R11.9 shipped it, R11.11 switched it off). Quiz ACCESS never followed
// the story's gate — generate-quiz and evaluate-quiz read bodies through
// _story-body.js, which takes no tier and checks no window — so no score is wrong and
// nothing needs rescoring.
//
// But a reader who could not finish an archive story plausibly never reached its
// quiz. That is a PARTICIPATION effect, not a scoring one, and the Aug 2026 contest
// pays out on 1 Sept. "No measurable effect" therefore has to be a measurement.
//
// ── THE COUNTERFACTUAL, AND WHY THE BASELINE IS NOT A FIXED SLUG LIST ────────────
//
// The naive comparison takes tonight's 130 gated slugs and counts their submissions
// on prior Saturdays. That is wrong, and wrong in the direction that INVENTS a dip:
// a story that is archive today may have been inside its free window three weeks ago,
// when it was new and at its most-read. Comparing a story's quiet old age against its
// own launch week would show a "drop" caused entirely by the calendar.
//
// So each window is classified on ITS OWN DATE: for every observation window, every
// story is run through the real policy as it stood at that moment. The comparison is
// "stories that WOULD have been gated then" vs "stories that WERE gated tonight" —
// like against like, at like points in their lives.
//
// policyGrantFor and resolveRecentFloor are imported from app/lib/storyAccess.js, not
// reimplemented here. A second copy of the window arithmetic in the file that audits
// the window arithmetic is how a measurement agrees with itself and with nothing else.
//
// ── WHAT quiz_submissions CAN AND CANNOT SAY ─────────────────────────────────────
//
// ONE RECORD PER (uid, slug) — retakes are locked out by QuizCard (quizState 'D'),
// and functions/api/admin/reset-attempt.js is the only thing that clears one. So this
// counts FIRST COMPLETIONS, not attempts-in-the-colloquial-sense. That is the right
// unit here anyway: the question is whether readers got to the quiz at all, and a
// first completion is exactly that event, timestamped by `submittedAt`.
//
// It cannot see a reader who opened a story, hit the wall and left. That reader is in
// the hit logs, not here. This measures the consequence, not the cause.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { policyGrantFor, resolveRecentFloor } from '../app/lib/storyAccess.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// The incident, in UTC. Start is the deploy estimate (push 14:03:34Z + the ~4m40s
// Cloudflare Pages build observed on the fix deploy); end is the moment the fix was
// pushed. Both are stated as estimates in the report rather than dressed up as exact.
const INCIDENT_START = Date.UTC(2026, 7, 8, 14, 8);
const INCIDENT_END = Date.UTC(2026, 7, 8, 18, 54);
const WINDOW_MS = INCIDENT_END - INCIDENT_START;

// Same weekday (Saturday), same clock hours, the prior three weeks. Europe/London is
// BST (UTC+1) across all four dates, so matching UTC hours matches LOCAL hours too —
// no offset correction is needed and none is applied. If this is ever re-run across a
// DST boundary that stops being true and the baselines must be built in local time.
// SIX of them, not the three first written. Three gave 10 / 0 / 0 archive
// completions — a mean of 3.33 standing on a spread that wide is not a baseline, it
// is a coin flip with extra steps. More windows do not make quiz activity less
// sparse, but they do make the sparsity legible instead of letting one busy
// Saturday masquerade as a norm.
const BASELINES = [
  Date.UTC(2026, 7, 1, 14, 8),
  Date.UTC(2026, 6, 25, 14, 8),
  Date.UTC(2026, 6, 18, 14, 8),
  Date.UTC(2026, 6, 11, 14, 8),
  Date.UTC(2026, 6, 4, 14, 8),
  Date.UTC(2026, 5, 27, 14, 8),
];

const FREE_CLASSES = ['free_window', 'recent_floor', 'poetry', 'reader_mode'];

// ── THE CONFOUND, NAMED BEFORE IT IS READ ────────────────────────────────────────
//
// The Summer Reading contest opens 2026-08-01 00:00 Europe/London (startsAt in
// app/lib/leaderboards.js). The 2026-08-01 baseline window sits FIFTEEN HOURS into
// it — it is contest launch day, and it carries more quiz activity than the other
// five baselines combined.
//
// It is kept in the table and excluded from the mean. Dropping it silently would be
// convenient in the wrong direction: it is the single largest baseline, and its
// removal is what turns "the incident looks average" into "the incident looks
// busier than normal". A reader of this output is entitled to see the number that
// was excluded and why, and to disagree.
const CONTEST_START = 1785538800000;
const LAUNCH_DAY_WINDOW = Date.UTC(2026, 7, 1, 14, 8);

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

/**
 * What would a signed-out reader have got for this story, at this instant?
 *
 * Returns the grant `reason`, which is the classification: 'archive' is the gated
 * set, everything else stayed free. Unpublished/not-yet-published stories return
 * null and are excluded — a story that did not exist could not have been read.
 */
function classify(stories, floorSlugs, slug, now) {
  const s = stories[slug];
  if (!s) return null;
  if (s.published === false) return null;
  // Not yet published at this instant. publishedAtMs is the projection the whole
  // gate runs on, so a missing one is genuinely unknown, not assumed-old.
  if (typeof s.publishedAtMs !== 'number') return null;
  if (s.publishedAtMs > now) return null;
  return policyGrantFor(s, { tier: 'free', floorSlugs, slug, now }).reason;
}

/**
 * THE SECOND SIGNAL: story reads. Higher volume, and closer to the cause.
 *
 * `storyReads/<slug>/<uid>` is a single timestamp per pair, so this counts distinct
 * readers who opened a story in the window — a bigger number than quiz completions
 * and therefore a better chance of showing an effect at all.
 *
 * ⚠ TWO LIMITS, AND THE FIRST IS SEVERE:
 *
 *   1. IT IS KEYED BY uid, SO IT CANNOT SEE A SIGNED-OUT READER — and signed-out
 *      readers are precisely who the screenshot showed and who the gate hit hardest.
 *      What it does cover is signed-in FREE-tier readers, who were gated too. So it
 *      is a partial view of the affected population, not a proxy for it.
 *   2. ONE TIMESTAMP PER PAIR, overwritten on re-read. A reader who opened a story
 *      during the incident and again later appears only at the later time. That
 *      biases this count DOWNWARD for past windows, including the baselines, and it
 *      biases the incident window down too if those readers came back after 18:54.
 *
 * Reported alongside the quiz numbers, never instead of them, and never quoted
 * without both caveats attached.
 */
function countReads(stories, reads, floorSlugs, start) {
  const end = start + WINDOW_MS;
  const buckets = { archive: 0, free: 0 };
  for (const [slug, byUid] of Object.entries(reads || {})) {
    const cls = classify(stories, floorSlugs, slug, start);
    if (!cls) continue;
    for (const t of Object.values(byUid || {})) {
      if (typeof t !== 'number' || t < start || t >= end) continue;
      if (cls === 'archive') buckets.archive += 1;
      else buckets.free += 1;
    }
  }
  return buckets;
}

function countWindow(stories, submissions, start) {
  const end = start + WINDOW_MS;
  // The floor as it stood AT THE START OF THIS WINDOW — five newest gateable stories
  // then, not now. Records published later are withheld so the floor cannot be filled
  // by stories that did not yet exist.
  const asOf = Object.fromEntries(
    Object.entries(stories).filter(([, s]) => typeof s.publishedAtMs === 'number' && s.publishedAtMs <= start),
  );
  const floorSlugs = resolveRecentFloor(asOf);

  const buckets = { archive: 0, free_window: 0, recent_floor: 0, poetry: 0, reader_mode: 0 };
  let unclassified = 0;
  const gatedSlugs = new Set();

  for (const slug of Object.keys(asOf)) {
    if (classify(stories, floorSlugs, slug, start) === 'archive') gatedSlugs.add(slug);
  }

  for (const [, bySlug] of Object.entries(submissions || {})) {
    for (const [slug, rec] of Object.entries(bySlug || {})) {
      const t = rec?.submittedAt;
      if (typeof t !== 'number' || t < start || t >= end) continue;
      const cls = classify(stories, floorSlugs, slug, start);
      if (cls && cls in buckets) buckets[cls] += 1;
      else unclassified += 1;
    }
  }

  const free = FREE_CLASSES.reduce((n, k) => n + buckets[k], 0);
  return { start, end, buckets, free, unclassified, gatedCount: gatedSlugs.size, floorSlugs };
}

// REST with an access token, NOT the admin SDK's websocket — the same shape
// scripts/compute-metrics.mjs uses. The SDK's `db.ref(...).get()` hangs indefinitely
// from this container against europe-west1; the REST read returns in seconds and the
// process exits on its own instead of being held open by a live connection.
async function readNode(path, token) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${token}`);
  if (!res.ok) throw new Error(`read ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(serviceAccount).getAccessToken()).access_token;

  // cms_stories_index, NOT cms_stories: the projection carries every field the gate
  // reads (publishedAtMs, category, published, readerMode, bookReader) at ~85 KB
  // instead of the whole node with 176 story bodies attached.
  //
  // TWO CONSEQUENCES, both benign for this question and both stated rather than
  // discovered later:
  //   · The index holds PUBLISHED stories only. Hidden ones are absent — and a
  //     hidden story has no readers, so it has no submissions to count.
  //   · `epubUrl` is not projected, so a poetry record with an EPUB classifies as
  //     'poetry' rather than 'reader_mode'. Both are FREE classes, so the
  //     archive-vs-free split — the entire question — is unaffected; only the
  //     free-side sub-split can shift between those two columns.
  const [index, submissions, reads] = await Promise.all([
    readNode('cms_stories_index', token),
    readNode('quiz_submissions', token),
    readNode('storyReads', token),
  ]);
  const stories = index || {};

  const incident = countWindow(stories, submissions, INCIDENT_START);
  const baselines = BASELINES.map((b) => countWindow(stories, submissions, b));

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  console.log('\nQUIZ FIRST-COMPLETIONS — incident window vs same-weekday baselines');
  console.log(`window length ${(WINDOW_MS / 3600000).toFixed(2)}h · ${hhmm(INCIDENT_START)}–${hhmm(INCIDENT_END)} UTC · Saturdays\n`);
  console.log(`${pad('window', 14)}${num('gated', 7)}${num('archive', 9)}${num('free', 6)}${num('total', 7)}   free split (window/floor/poetry/reader)`);

  const row = (label, r) => {
    const total = r.buckets.archive + r.free;
    console.log(
      pad(label, 14) + num(r.gatedCount, 7) + num(r.buckets.archive, 9) + num(r.free, 6) + num(total, 7)
      + `   ${r.buckets.free_window}/${r.buckets.recent_floor}/${r.buckets.poetry}/${r.buckets.reader_mode}`
      + (r.unclassified ? `  [+${r.unclassified} unclassified]` : ''),
    );
  };

  row(`${day(INCIDENT_START)}*`, incident);
  for (const b of baselines) row(day(b.start) + (b.start === LAUNCH_DAY_WINDOW ? ' †' : ''), b);

  const clean = baselines.filter((b) => b.start !== LAUNCH_DAY_WINDOW);
  const bArchive = clean.map((b) => b.buckets.archive);
  const bFree = clean.map((b) => b.free);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  console.log('\n* the incident window');
  console.log(`† contest launch day — ${((LAUNCH_DAY_WINDOW - CONTEST_START) / 3600000).toFixed(0)}h into the Summer Reading contest.`);
  console.log('  EXCLUDED from the means below. See CONTEST_START in this file.\n');
  console.log(`baseline mean (${clean.length} windows, launch day excluded) — archive ${mean(bArchive).toFixed(2)} · free ${mean(bFree).toFixed(2)}`);
  console.log(`incident      — archive ${incident.buckets.archive} · free ${incident.free}`);
  console.log(`delta         — archive ${(incident.buckets.archive - mean(bArchive)).toFixed(2)} · free ${(incident.free - mean(bFree)).toFixed(2)}`);

  const grand = [incident, ...baselines].reduce((n, r) => n + r.buckets.archive + r.free, 0);
  console.log(`\nTOTAL first-completions across all ${baselines.length + 1} windows: ${grand}`);

  const spread = (a) => `min ${Math.min(...a)} max ${Math.max(...a)}`;
  console.log(`baseline archive spread — ${spread(bArchive)}`);

  console.log('\nSTORY READS in the same windows — signed-in readers only (see countReads)\n');
  console.log(`${pad('window', 14)}${num('archive', 9)}${num('free', 6)}${num('total', 7)}`);
  const readRow = (label, r) => {
    const c = countReads(stories, reads, r.floorSlugs, r.start);
    console.log(pad(label, 14) + num(c.archive, 9) + num(c.free, 6) + num(c.archive + c.free, 7));
    return c;
  };
  const incReads = readRow(`${day(INCIDENT_START)}*`, incident);
  const baseReads = baselines.map((b) => ({ start: b.start, c: readRow(day(b.start) + (b.start === LAUNCH_DAY_WINDOW ? ' †' : ''), b) }));
  const bra = baseReads.filter((x) => x.start !== LAUNCH_DAY_WINDOW).map((x) => x.c.archive);
  console.log(`\nbaseline mean archive reads ${mean(bra).toFixed(2)} (${spread(bra)}, launch day excluded) · incident ${incReads.archive}`);
  console.log('⚠ the older windows read 0 almost certainly because the timestamp is');
  console.log('  OVERWRITTEN on re-read, not because nobody read. The read baseline');
  console.log('  decays with age and is not trustworthy beyond a week or two.');

  console.log('\n── POWER, WHICH IS THE POINT ───────────────────────────────────────');
  console.log('Read the spreads before the deltas. If the baseline range straddles the');
  console.log('incident value, this instrument cannot detect an effect of the size in');
  console.log('question, and the honest finding is "no effect DETECTABLE at this N" —');
  console.log('not "no effect". Those are different sentences and only one is true.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
