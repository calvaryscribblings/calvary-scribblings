// R32 — THE ONE BACKFILL. Screens the existing comment backlog for carousel promotion.
//
// DRY RUN BY DEFAULT. Calls no model and writes nothing unless invoked with --apply.
//
//   node scripts/screen-comments.mjs                  # the funnel + the projected cost
//   node scripts/screen-comments.mjs --apply          # screen and write
//   node scripts/screen-comments.mjs --apply --limit 50   # the first 50, to prove the cost
//
// Requires ANTHROPIC_API_KEY in the environment for --apply. The dry run needs only the
// service account, and is complete on its own: the funnel below is measured, not estimated.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⭑ THIS IS ALSO THE RETRY, AND IT IS THE ONLY ONE
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Every comment written from now on is screened at write time by
// functions/api/comments/screen.js. This script existed to catch up the 2,371 records that
// pre-date that endpoint, and it is safe to re-run — it skips anything already carrying a
// verdict, so a second run costs nothing but the reads.
//
// But re-running is not merely harmless, it is REQUIRED, and this is the thing an earlier
// header got wrong by calling this a once-only job:
//
//   A comment that FAILED CLOSED writes no verdict. There is therefore no difference, from
//   the funnel's point of view, between "the model was unreachable when this was screened"
//   and "this was never screened" — both are simply eligible with no verdict, and both are
//   picked up here. That is what makes fail-closed a deferral rather than an exclusion.
//
//   ⚠ AND NOTHING ELSE RETRIES. The browser fires the endpoint once, forgets it, and never
//   fires again (app/lib/requestScreening.js — deliberately, so a moderation failure can
//   never block a comment). The endpoint returns early on any comment that already has a
//   verdict, and does nothing at all for one that has none until it is asked. So the retry
//   path for a fail-closed comment is A LATER RUN OF THIS SCRIPT, and nothing schedules one.
//
// The R32 backfill left exactly one such comment — life-will-be-hard/-Oz1RjHH1T2ubaMJH2RH,
// a fetch error — and a dry run today shows it, alone, as the whole queue.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⭑ THE TOKEN COUNTS ARE MEASURED HERE, NOT ESTIMATED
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The R32 report projected this run at about $0.43 from an ESTIMATED ~526 input and ~70
// output tokens per call, because there was no Anthropic key in the workspace to run
// count_tokens against. THE RUN CAME BACK AT ~1,297 INPUT — every projection was about 100%
// low, and the reason is written up in app/lib/voiceScreening.js: the guess priced the
// system prompt and the comment and forgot that the tool definition and the tool-use
// scaffolding are billed input too.
//
// So the projection below is no longer a constant in this file. It comes from
// estimateCallCost() in the shared module, which is anchored to that measurement and moves
// on its own when the prompt is edited. This script's job is to keep checking it: it
// accumulates the real `usage` block from the FIRST 50 CALLS and prints measured against
// estimated, with a DRIFT line naming the one object to edit when they disagree.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

import { isScreenable, VOICE_MIN_CHARS, SCREENING_NODE } from '../app/lib/trailerVoices.js';
import {
  buildScreeningRequest,
  parseScreeningResponse,
  screeningRow,
  SCREENING_MODEL,
  SCREENING_VERSION,
  CALIBRATION,
  USD_PER_INPUT_TOKEN,
  USD_PER_OUTPUT_TOKEN,
  estimateInputTokens,
  estimateOutputTokens,
  estimateCallCost,
  promptChars,
  foldCategory,
} from '../app/lib/voiceScreening.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Number(process.argv[i + 1]) || null : null;
})();

// Rates and the projection both come from app/lib/voiceScreening.js now — one cost model,
// shared with the endpoint, anchored to a measurement rather than restated as a guess here.
const MEASURE_FIRST = 50;
// How far measured may sit from estimated before the run says the anchor needs re-cutting.
const DRIFT_TOLERANCE = 0.15;

const CONCURRENCY = 4;

function money(n) {
  return `$${n.toFixed(4)}`;
}

async function main() {
  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const app = initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const token = (await app.options.credential.getAccessToken()).access_token;

  const read = async (path) => {
    const res = await fetch(`${DB_URL}/${path}.json`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`read ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const write = async (path, body) => {
    const res = await fetch(`${DB_URL}/${path}.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
  };

  console.log(`\nR32 · comment screening backfill · ${APPLY ? 'APPLY' : 'DRY RUN'} · model ${SCREENING_MODEL}`);
  console.log(`floor ${VOICE_MIN_CHARS} chars · verdicts at ${SCREENING_NODE}/{slug}/{commentId}\n`);

  const [index, comments, screened] = await Promise.all([
    read('cms_stories_index'),
    read('comments'),
    read(SCREENING_NODE),
  ]);

  // ── THE FUNNEL. Every line removes calls that could not have changed an outcome. ───────
  const quoted = new Set(
    Object.entries(index || {})
      .filter(([, s]) => typeof s?.trailerQuote === 'string' && s.trailerQuote.trim())
      .map(([slug]) => slug)
  );

  let all = 0;
  let replies = 0;
  let offIndex = 0;
  let offCarousel = 0;
  let filtered = 0;
  let already = 0;
  const work = [];

  for (const [slug, thread] of Object.entries(comments || {})) {
    for (const [id, c] of Object.entries(thread || {})) {
      if (!c || typeof c !== 'object') continue;
      all++;
      if (c.parentId) { replies++; continue; }
      if (!index?.[slug]) { offIndex++; continue; }
      if (!quoted.has(slug)) { offCarousel++; continue; }
      if (!isScreenable({ text: c.text, parentId: c.parentId, hasTrailerQuote: true })) { filtered++; continue; }
      if (screened?.[slug]?.[id]) { already++; continue; }
      work.push({ slug, id, text: String(c.text).trim(), uid: c.authorUid || null });
    }
  }

  const pad = (n) => String(n).padStart(6);
  console.log('THE FILTER, BEFORE ANY SPEND');
  console.log(`  every record under comments/*                    ${pad(all)}`);
  console.log(`  − replies (never surface on a card)              ${pad(-replies)}`);
  console.log(`  − not a published story (Open Pages, drafts)     ${pad(-offIndex)}`);
  console.log(`  − story carries no trailer quote                 ${pad(-offCarousel)}`);
  console.log(`  − below the floor / @mention / URL               ${pad(-filtered)}`);
  console.log(`  − already carries a verdict                      ${pad(-already)}`);
  console.log(`  = calls this run will make                       ${pad(work.length)}\n`);

  if (work.length === 0) {
    console.log('Nothing to screen.\n');
    return;
  }

  const chars = work.reduce((a, w) => a + w.text.length, 0);
  // Per item, not per mean — a long comment costs more than a short one and the sum should
  // say so. The overhead inside estimateInputTokens dwarfs both, which is the whole finding.
  const projected = work.reduce((a, w) => a + estimateCallCost(w.text), 0);
  const estIn = work.reduce((a, w) => a + estimateInputTokens(w.text), 0) / work.length;
  console.log(`  mean comment ${Math.round(chars / work.length)} chars, longest ${Math.max(...work.map((w) => w.text.length))}`);
  console.log(`  prompt now ${promptChars()} chars (anchor cut at ${CALIBRATION.promptChars} on ${CALIBRATION.measuredAt})`);
  console.log(`  ESTIMATED ${estIn.toFixed(0)} in / ${estimateOutputTokens()} out per call: ${money(projected)}`);
  console.log(`  writing version ${SCREENING_VERSION} rows — categories from the closed list\n`);

  if (!APPLY) {
    console.log('DRY RUN — no model call made, nothing written. Re-run with --apply.\n');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Refusing to run.\n');
    process.exitCode = 1;
    return;
  }

  const queue = LIMIT ? work.slice(0, LIMIT) : work;
  let done = 0;
  let promotable = 0;
  let failed = 0;
  let inTok = 0;
  let outTok = 0;
  let estimated = 0;
  let measured = false;
  const categories = new Map();

  async function screenOne(item) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildScreeningRequest(item.text)),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json();

      // ⭑ The real number, from the response itself.
      inTok += (data.usage?.input_tokens || 0) + (data.usage?.cache_read_input_tokens || 0);
      outTok += data.usage?.output_tokens || 0;

      const verdict = parseScreeningResponse(data);
      await write(`${SCREENING_NODE}/${item.slug}/${item.id}`, screeningRow({ ...verdict, uid: item.uid, text: item.text }));
      if (verdict.promotable) promotable++;
      else for (const c of verdict.categories) categories.set(c, (categories.get(c) || 0) + 1);
      estimated += estimateCallCost(item.text);
    } catch (e) {
      // ⚠ FAIL CLOSED, exactly as the endpoint does: no verdict is written, so the comment
      // is simply not promotable. A failed screening is never a promotion.
      failed++;
      if (failed <= 5) console.error(`  ! ${item.slug}/${item.id}: ${e.message}`);
    } finally {
      done++;
      if (done === MEASURE_FIRST && !measured) {
        measured = true;
        const perIn = inTok / done;
        const perOut = outTok / done;
        const perCall = perIn * USD_PER_INPUT_TOKEN + perOut * USD_PER_OUTPUT_TOKEN;
        const estPerCall = estimated / Math.max(1, done);
        const off = perCall / Math.max(1e-12, estPerCall) - 1;
        console.log(`\n  ── MEASURED over the first ${done} calls ──────────────────────────`);
        console.log(`     input  ${perIn.toFixed(1)} tok/call   (estimated ${(estimateInputTokens('x'.repeat(Math.round(chars / work.length)))).toFixed(0)})`);
        console.log(`     output ${perOut.toFixed(1)} tok/call   (estimated ${estimateOutputTokens()})`);
        console.log(`     ${money(perCall)} per call → ${money(perCall * work.length)} for all ${work.length}`);
        console.log(`     estimate was ${money(estPerCall)} per call — ${(100 * off).toFixed(1)}% off`);
        if (Math.abs(off) > DRIFT_TOLERANCE) {
          // ⚠ The anchor has moved. This is the ONE thing to edit, and this line is the only
          // notice you get — the previous version of this script compared against a hardcoded
          // guess and printed "100% off" as though that were a normal result.
          console.log(`\n     ⚠ DRIFT > ${(DRIFT_TOLERANCE * 100).toFixed(0)}%. Re-cut the anchor in app/lib/voiceScreening.js:`);
          console.log(`         CALIBRATION = { measuredAt: '${new Date().toISOString().slice(0, 10)}', calls: ${done},`);
          console.log(`           promptChars: ${promptChars()}, meanTextChars: ${(chars / work.length).toFixed(1)},`);
          console.log(`           meanInputTokens: ${Math.round(perIn)}, meanOutputTokens: ${Math.round(perOut)} }`);
        }
        console.log('');
      } else if (done % 50 === 0) {
        console.log(`  ${done}/${queue.length}  promotable ${promotable}  failed ${failed}`);
      }
    }
  }

  // Small fixed concurrency. This is a one-off over a few hundred rows; there is nothing to
  // win by going faster and a rate limit to lose by.
  const iter = queue[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (const item of iter) await screenOne(item);
    })
  );

  const spent = inTok * USD_PER_INPUT_TOKEN + outTok * USD_PER_OUTPUT_TOKEN;
  console.log(`\nDONE. ${done} screened · ${promotable} promotable (${(100 * promotable / Math.max(1, done - failed)).toFixed(1)}%) · ${failed} failed closed`);
  if (failed) {
    // ⭑ NOT AN EXCLUSION. A failure writes no verdict, and the `already carries a verdict`
    // line of the funnel is the only thing that removes a comment from a later run. So every
    // one of these is queued again by the next invocation, for free, with no flag to set.
    console.log(`  the ${failed} that failed closed carry no verdict and are re-queued by the next run.`);
  }
  console.log(`  real tokens: ${inTok} in, ${outTok} out`);
  console.log(`  REAL COST: ${money(spent)}   (estimated ${money(estimated)})`);
  if (categories.size) {
    console.log('  reasons for refusal (closed list):');
    for (const [c, n] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${c}`);
    }
  }

  // The whole stored history in the closed vocabulary — version 1 rows folded, version 2 rows
  // native. This is the count that was impossible to produce before the list was closed.
  const census = new Map();
  let refusals = 0;
  for (const rows of Object.values((await read(SCREENING_NODE)) || {})) {
    for (const r of Object.values(rows || {})) {
      if (!r || r.promotable === true) continue;
      refusals++;
      for (const c of new Set((r.categories || []).map(foldCategory))) {
        census.set(c, (census.get(c) || 0) + 1);
      }
    }
  }
  if (refusals) {
    console.log(`\n  every refusal on record (${refusals}), folded to the closed list:`);
    for (const [c, n] of [...census.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${c}`);
    }
  }

  // How many stories actually end up with a voice — the number ruling 1 turns on.
  const after = await read(SCREENING_NODE);
  const withVoice = new Set();
  for (const [slug, rows] of Object.entries(after || {})) {
    if (!quoted.has(slug)) continue;
    if (Object.values(rows || {}).some((r) => r?.promotable === true)) withVoice.add(slug);
  }
  console.log(`\n  quoted stories with at least one promotable voice: ${withVoice.size} of ${quoted.size}`);
  console.log(`  the other ${quoted.size - withVoice.size} keep their card and carry no reader's line.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
