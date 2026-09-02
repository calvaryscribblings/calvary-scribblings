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
// WHY THIS RUNS ONCE AND THEN NEVER AGAIN
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Every comment written from now on is screened at write time by
// functions/api/comments/screen.js. This script exists to catch up the 2,371 records that
// pre-date that endpoint, and after that the ongoing cost is new comments only. It is safe
// to re-run — it skips anything already carrying a verdict, so a second run costs nothing
// but the reads.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⭑ THE TOKEN COUNTS ARE MEASURED HERE, NOT ESTIMATED
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The R32 report projected this run at about $0.43 from an ESTIMATED ~526 input and ~70
// output tokens per call, because there was no Anthropic key in the workspace to run
// count_tokens against. That estimate is not allowed to stand: this script accumulates the
// real `usage` block from the FIRST 50 CALLS and prints the measured per-call cost against
// the projection before it goes any further. If the two disagree materially, the run says so
// in the first few seconds rather than at the end.
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
} from '../app/lib/voiceScreening.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Number(process.argv[i + 1]) || null : null;
})();

// Haiku 4.5, first-party API rates. Stated here so the arithmetic below is auditable rather
// than a number somebody has to trust.
const USD_PER_INPUT_TOKEN = 1.0 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 5.0 / 1_000_000;
// The projection this run is checking itself against.
const PROJECTED_IN = 526;
const PROJECTED_OUT = 70;
const MEASURE_FIRST = 50;

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
  const projected = work.length * (PROJECTED_IN * USD_PER_INPUT_TOKEN + PROJECTED_OUT * USD_PER_OUTPUT_TOKEN);
  console.log(`  mean comment ${Math.round(chars / work.length)} chars, longest ${Math.max(...work.map((w) => w.text.length))}`);
  console.log(`  PROJECTED at ${PROJECTED_IN} in / ${PROJECTED_OUT} out per call: ${money(projected)}\n`);

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
        console.log(`\n  ── MEASURED over the first ${done} calls ──────────────────────────`);
        console.log(`     input  ${perIn.toFixed(1)} tok/call   (projected ${PROJECTED_IN})`);
        console.log(`     output ${perOut.toFixed(1)} tok/call   (projected ${PROJECTED_OUT})`);
        console.log(`     ${money(perCall)} per call → ${money(perCall * work.length)} for all ${work.length}`);
        console.log(`     projection was ${money(projected)} — ${(100 * (perCall * work.length) / projected - 100).toFixed(1)}% off\n`);
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
  console.log(`  real tokens: ${inTok} in, ${outTok} out`);
  console.log(`  REAL COST: ${money(spent)}   (projected ${money(projected * (done / work.length))})`);
  if (categories.size) {
    console.log('  reasons for refusal:');
    for (const [c, n] of [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
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
