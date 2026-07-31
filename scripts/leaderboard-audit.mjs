// Certify a contest board's standings against each reader's verified activity.
//
//   node scripts/leaderboard-audit.mjs summer-2026
//
// READ-ONLY BY CONSTRUCTION. This file contains no write call of any kind —
// no set, update, push, remove, transaction or setPriority. There is no --apply
// flag because there is nothing to apply. Grep it and see. It is safe to run at
// any point mid-contest as a spot check, not only at close.
//
// WHY THIS EXISTS
//
// points/{uid}/total is the board's number, and it was writable by any signed-in
// user until R0 closed that. The board delta is therefore a display. This script
// is the result: it rebuilds each reader's in-window earnings from the records
// that actually evidence the activity, and reports where the two disagree.
//
// WINDOW  Taken from the board config in app/lib/leaderboards.js — one source of
// truth with the board page — and applied as a closed interval on ms epoch:
// 1 Aug 00:00:00.000 to 31 Aug 23:59:59.999 Europe/London (BST, UTC+1 all month).
//
// THE FOUR TERMS
//
//   quiz     Σ quiz_submissions/{uid}/{slug}.pointsAwarded where submittedAt is
//            in window. The strongest term — one record per slug, retakes are
//            locked out by the UI (QuizCard quizState 'D'), and on live data it
//            accounts for 96.4% of all points ever awarded.
//
//   comment  10 × the number of 50-comment milestones crossed inside the window,
//            computed as floor(total_by_window_end / 50) − floor(total_before_window / 50)
//            over that uid's dated comments.
//
//            Matched to what the awarding code actually counts
//            (app/stories/[slug]/page-client.js:691): every top-level child of
//            every comments/{threadId}, across story slugs AND open-pages post
//            ids alike, one level deep only — replies nested under a comment are
//            not counted there and are not counted here. ASSUMPTION: comments
//            deleted since being posted are gone from this count but did move the
//            counter at the time, so a reader who has deleted comments can audit
//            low. Flagged, not silently absorbed.
//
//   read     5 × (floor(readsNow / 10) − floor(snapshot.reads / 10)), the
//            milestone arithmetic over users/{uid}/readCount — the exact counter
//            the awarding code modulos. readStories has no timestamps, which is
//            precisely why the snapshot captures this scalar. `readsNow` comes
//            from the closing capture when one exists, so a certification run is
//            boundary-correct; mid-contest it uses the live counter and therefore
//            includes everything up to the moment of the run.
//
//   exercise Σ points/{uid}/history entries with type 'exercise' dated in window.
//
//            EXACT MATCHING AND ITS ASSUMPTIONS, stated plainly: there is no
//            admin-exclusive type in this schema. `type: 'exercise'` is written
//            by three call sites with the same string — the reader's own
//            auto-marked submit (app/stories/[slug]/page-client.js:269) and the
//            two admin marking screens (app/admin/exercises/page.js:86 and
//            app/admin/submissions/page.js:86). Admin awards cannot be isolated
//            from history alone. This term is therefore the one that leans on the
//            open-write ledger, so it is cross-checked against
//            exercise_submissions/{uid}/{slug}.totalScore — which all three call
//            sites also write — and any disagreement is reported per uid.
//            On live data this path has never fired: zero history entries of this
//            type, zero rows in exercise_submissions.
//
// ANYTHING ELSE in a reader's in-window history — a type this script does not
// know how to certify, including the one legacy 'convert' entry on live data —
// is reported separately as unclassified rather than folded into the certified
// total. That column is where a tampered balance would surface.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getBoard } from '../app/lib/leaderboards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const COMMENT_MILESTONE = 50;
const COMMENT_AWARD     = 10;
const READ_MILESTONE    = 10;
const READ_AWARD        = 5;

const CERTIFIABLE_TYPES = new Set(['quiz', 'read', 'comment', 'exercise', 'init']);

const boardId = process.argv.slice(2).find(a => !a.startsWith('--'));

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function londonStamp(ms) {
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'medium' });
}

async function main() {
  if (!boardId) fail('Board id required.\n    node scripts/leaderboard-audit.mjs <boardId>');

  const board = getBoard(boardId);
  if (!board) fail(`Unknown board "${boardId}". Known boards live in app/lib/leaderboards.js.`);

  const { startsAt, endsAt } = board;
  const inWindow = (t) => typeof t === 'number' && t >= startsAt && t <= endsAt;

  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const [boardSnap, pointsSnap, usersSnap, quizSnap, commentsSnap, exerciseSnap, displaySnap] =
    await Promise.all([
      db.ref(`leaderboards/${boardId}`).get(),
      db.ref('points').get(),
      db.ref('users').get(),
      db.ref('quiz_submissions').get(),
      db.ref('comments').get(),
      db.ref('exercise_submissions').get(),
      db.ref('leaderboard').get(),
    ]);

  const boardData = boardSnap.val();
  if (!boardData?.snapshot) {
    fail(`leaderboards/${boardId}/snapshot does not exist — nothing to audit yet.\n` +
         `    Capture it with: node scripts/leaderboard-snapshot.mjs ${boardId} --apply`);
  }

  const snapshot  = boardData.snapshot;
  const final     = boardData.final ?? null;
  const points    = pointsSnap.val()   || {};
  const users     = usersSnap.val()    || {};
  const quizzes   = quizSnap.val()     || {};
  const comments  = commentsSnap.val() || {};
  const exercises = exerciseSnap.val() || {};
  const display   = displaySnap.val()  || {};

  const hasFinal = !!final && Object.keys(final).length > 0;

  // ── Comment timeline per uid ───────────────────────────────────────────────
  // One pass over every thread, one level deep, mirroring the awarding code.
  const commentTimes = new Map();
  for (const thread of Object.values(comments)) {
    if (!thread || typeof thread !== 'object') continue;
    for (const c of Object.values(thread)) {
      if (!c || typeof c !== 'object') continue;
      const author = c.authorUid ?? c.uid;
      if (!author || typeof c.createdAt !== 'number') continue;
      if (!commentTimes.has(author)) commentTimes.set(author, []);
      commentTimes.get(author).push(c.createdAt);
    }
  }

  // ── Per-uid certification ──────────────────────────────────────────────────
  const universe = [...new Set([...Object.keys(snapshot), ...Object.keys(points), ...Object.keys(display)])];
  const results = [];

  for (const uid of universe) {
    const base      = typeof snapshot[uid]?.points === 'number' ? snapshot[uid].points : 0;
    const baseReads = typeof snapshot[uid]?.reads  === 'number' ? snapshot[uid].reads  : 0;

    const liveTotal = typeof points[uid]?.total === 'number' ? points[uid].total : 0;
    const endTotal  = hasFinal && typeof final[uid]?.points === 'number' ? final[uid].points : liveTotal;
    const boardDelta = endTotal - base;
    if (boardDelta <= 0) continue;

    // quiz
    let quiz = 0;
    for (const rec of Object.values(quizzes[uid] || {})) {
      if (inWindow(rec?.submittedAt) && typeof rec?.pointsAwarded === 'number') quiz += rec.pointsAwarded;
    }

    // comment milestones
    const times = commentTimes.get(uid) || [];
    const before = times.filter(t => t < startsAt).length;
    const byEnd  = times.filter(t => t <= endsAt).length;
    const crossings = Math.floor(byEnd / COMMENT_MILESTONE) - Math.floor(before / COMMENT_MILESTONE);
    const comment = crossings * COMMENT_AWARD;

    // read milestones
    const readsNow = hasFinal && typeof final[uid]?.reads === 'number'
      ? final[uid].reads
      : (typeof users[uid]?.readCount === 'number' ? users[uid].readCount : 0);
    const readCrossings = Math.floor(readsNow / READ_MILESTONE) - Math.floor(baseReads / READ_MILESTONE);
    const read = Math.max(0, readCrossings) * READ_AWARD;

    // exercise / admin awards, from history, cross-checked
    const history = Object.values(points[uid]?.history || {});
    let exercise = 0, unclassified = 0;
    const unclassifiedTypes = new Set();
    for (const h of history) {
      if (!inWindow(h?.createdAt)) continue;
      const amount = Number(h?.amount) || 0;
      const type = h?.type;
      if (type === 'exercise') exercise += amount;
      else if (!CERTIFIABLE_TYPES.has(type)) {
        unclassified += amount;
        unclassifiedTypes.add(type ?? '(untyped)');
      }
    }
    let exerciseEvidence = 0;
    for (const sub of Object.values(exercises[uid] || {})) {
      const at = typeof sub?.markedAt === 'number' ? sub.markedAt : sub?.submittedAt;
      if (inWindow(at) && typeof sub?.totalScore === 'number') exerciseEvidence += sub.totalScore;
    }

    const certified = quiz + comment + read + exercise;
    const d = display[uid] || {};

    results.push({
      uid,
      name: d.displayName || users[uid]?.displayName || users[uid]?.handle || 'Reader',
      optedOut: d.leaderboardVisible === false,
      deleted: users[uid]?.isDeleted === true,
      boardDelta, certified,
      discrepancy: boardDelta - certified,
      quiz, comment, read, exercise, exerciseEvidence,
      unclassified, unclassifiedTypes: [...unclassifiedTypes],
      joinDate: typeof d.joinDate === 'number' ? d.joinDate : Infinity,
    });
  }

  // Board order: the same ranking the page renders — delta desc, joinDate asc,
  // equal deltas sharing a rank — so a row here lines up with a row there.
  const eligible = results.filter(r => !r.optedOut && !r.deleted);
  eligible.sort((a, b) => (b.boardDelta - a.boardDelta) || (a.joinDate - b.joinDate));
  let lastDelta = null, lastRank = 0;
  eligible.forEach((r, i) => {
    r.rank = r.boardDelta === lastDelta ? lastRank : i + 1;
    lastDelta = r.boardDelta; lastRank = r.rank;
  });

  const prizePlaces = board.prizes.length;

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n  AUDIT — ${board.title} (${boardId})`);
  console.log(`  ${'═'.repeat(96)}`);
  console.log(`  window        ${londonStamp(startsAt)}  →  ${londonStamp(endsAt)}  (${board.timeZone})`);
  console.log(`  run at        ${londonStamp(Date.now())}`);
  console.log(`  end balance   ${hasFinal ? 'leaderboards/' + boardId + '/final (closing capture)' : 'points/{uid}/total (LIVE — mid-contest spot check)'}`);
  if (!hasFinal) {
    console.log(`                ⚠ no closing capture yet, so read milestones count everything up to now,`);
    console.log(`                  not to the window boundary. Quiz and comment terms are boundary-exact.`);
  }
  console.log(`  ${'═'.repeat(96)}\n`);

  console.log(`  ${pad('#', 4)}${pad('reader', 26)}${lpad('board', 8)}${lpad('certified', 11)}${lpad('discrep', 9)}  ${lpad('quiz', 6)}${lpad('cmnt', 6)}${lpad('read', 6)}${lpad('exer', 6)}${lpad('unclass', 9)}`);
  console.log(`  ${'─'.repeat(96)}`);

  let flagged = 0;
  for (const r of eligible) {
    const inPrizes = r.rank <= prizePlaces;
    const bad = r.discrepancy !== 0;
    if (bad) flagged++;
    const mark = inPrizes ? '★' : ' ';
    const disc = r.discrepancy === 0 ? '·' : (r.discrepancy > 0 ? `+${r.discrepancy}` : `${r.discrepancy}`);
    console.log(
      `  ${pad(mark + r.rank, 4)}${pad(r.name.slice(0, 24), 26)}` +
      `${lpad(r.boardDelta, 8)}${lpad(r.certified, 11)}${lpad(disc, 9)}  ` +
      `${lpad(r.quiz, 6)}${lpad(r.comment, 6)}${lpad(r.read, 6)}${lpad(r.exercise, 6)}${lpad(r.unclassified || '·', 9)}` +
      (bad ? '   ⚠' : '')
    );
  }

  console.log(`  ${'─'.repeat(96)}`);
  console.log(`  ★ = inside the ${prizePlaces} prize places\n`);

  // ── Loud section: anything that does not reconcile ─────────────────────────
  const problems = eligible.filter(r => r.discrepancy !== 0 || r.unclassified !== 0 || r.exercise !== r.exerciseEvidence);
  if (problems.length === 0) {
    console.log(`  ✓ Every standing reconciles exactly. ${eligible.length} readers certified.\n`);
  } else {
    console.log(`  ${'!'.repeat(96)}`);
    console.log(`  ${problems.length} READER(S) DO NOT RECONCILE — ${flagged} with a board/certified discrepancy`);
    console.log(`  ${'!'.repeat(96)}\n`);
    for (const r of problems) {
      console.log(`  #${r.rank}  ${r.name}  (${r.uid})`);
      if (r.discrepancy !== 0) {
        console.log(`      board delta ${r.boardDelta} vs certified ${r.certified} → ${r.discrepancy > 0 ? '+' : ''}${r.discrepancy} unaccounted for`);
        console.log(`      quiz ${r.quiz} · comments ${r.comment} · reads ${r.read} · exercise ${r.exercise}`);
      }
      if (r.unclassified !== 0) {
        console.log(`      ⚠ ${r.unclassified} points from history types this script cannot certify: ${r.unclassifiedTypes.join(', ')}`);
      }
      if (r.exercise !== r.exerciseEvidence) {
        console.log(`      ⚠ exercise history says ${r.exercise} but exercise_submissions evidences ${r.exerciseEvidence}`);
      }
      if (r.rank <= prizePlaces) console.log(`      ★ THIS READER IS IN A PRIZE PLACE — resolve before paying out.`);
      console.log('');
    }
    console.log(`  A positive discrepancy is points on the balance with no activity behind them.`);
    console.log(`  A negative one usually means deleted comments, which moved the counter when posted`);
    console.log(`  but are no longer there to count. Neither is automatically fraud; both need a look.\n`);
  }

  console.log(`  READ-ONLY: this script performed no writes.\n`);
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
