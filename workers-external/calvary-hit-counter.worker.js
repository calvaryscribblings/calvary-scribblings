// ─────────────────────────────────────────────────────────────────────────────
// calvary-hit-counter — Cloudflare Worker
// (per-story hit counter + daily buckets, and the scheduled top_stories rebuild).
//
// DASHBOARD-MANAGED: the live source is edited in the Cloudflare dashboard, not in
// this repo's CI. THIS FILE is the deployable mirror — keep it byte-identical to
// what is pasted into the dashboard. Edit here, paste to the dashboard (or paste
// the dashboard source back here), and commit, so this Worker is never unversioned
// again. Prove it with:
//
//   node scripts/worker-mirror-check.mjs <dashboard-source> hit-counter
//
// WHAT IT OWNS, and why that matters to the rules:
//   · stories/{slug}/hits           — cumulative, also written by functions/api/hit.js
//   · stories/{slug}/hitsByDay/{d}  — UTC day buckets. NOTHING ELSE WRITES THESE.
//   · top_stories/weekly            — rebuilt on the cron below.
// app/public-library/page.js:1093 reads top_stories/weekly. If this Worker stops,
// that surface goes stale silently — which is precisely what happened on 3 Aug.
//
// ── R9.6: THE 3 AUG STOPPAGE, AND THE TWO THINGS THAT CAUSED IT ──────────────
//
// 1. THE CREDENTIAL WAS NEVER A CREDENTIAL. This Worker used to send the Firebase
//    WEB API KEY as ?auth=. That is not RTDB credentials in any form — not a
//    database secret, not an ID token — so RTDB ignored it and treated every call
//    from here as UNAUTHENTICATED. It worked only because `stories` was
//    world-writable. f8f547d closed it (.write:true -> false) at
//    2026-08-03 22:50:56Z and every write from this Worker has been denied since.
//    The last day bucket written anywhere is 2026-08-03. It now sends
//    env.FIREBASE_SECRET, the same legacy database secret calvary-newsletter uses,
//    which authenticates as admin — so the writes work WITHOUT reopening the node.
//
//    The key is gone from this file entirely and must never come back. Every RTDB
//    URL is built by dbUrl() below for exactly that reason: there is one place
//    where auth is attached, so "did every call get fixed?" is answerable by
//    grepping for FIREBASE_URL and finding it only there.
//
// 2. NOTHING SAID A WORD. Two days of total rejection produced no signal at all,
//    and that was not one bug but five, in ascending order of harm:
//
//      · the increment PATCH   — DID check res.ok and DID return 502 to its
//                                caller, but never logged. Nothing reached
//                                `wrangler tail`, so the only witness was a
//                                caller that discards it.
//      · readCount()           — no res.ok check. A denied read returns the body
//                                {"error":"Permission denied"}, parseInt gives
//                                NaN, and the function returns null exactly as it
//                                does for "no hits yet". Failure was indistinguish-
//                                able from an empty counter.
//      · the top_stories PUT   — response ignored entirely.
//      · the prune PATCH       — response ignored entirely.
//      · the stories.json read — WORST. No res.ok check, and a denied read's error
//                                body is an OBJECT, so Object.entries walked it,
//                                found one string-valued key, skipped it as
//                                "not a record", and carried on to rebuild
//                                top_stories from ZERO stories. A permission
//                                failure would have been written out as a
//                                legitimately empty top-10, destroying the live
//                                surface with no error anywhere. It now aborts.
//
//    Every RTDB call is now checked and logged with its status and a slice of the
//    response body, and the scheduled handler catches so a throw inside the cron
//    cannot vanish into waitUntil.
// ─────────────────────────────────────────────────────────────────────────────

const FIREBASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const WINDOW_DAYS = 7;  // rolling window counted as "weekly"
const KEEP_DAYS = 9;    // prune day-buckets older than this
const TOP_N = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonHeaders() {
  return { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
}

function utcDay(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// THE ONLY PLACE auth is attached to an RTDB URL. Keep it that way: if a new call
// site builds its own URL, the next credential change will miss it, which is the
// shape of the bug this round exists to fix.
function dbUrl(env, path, extra = '') {
  return `${FIREBASE_URL}/${path}.json?auth=${env.FIREBASE_SECRET}${extra}`;
}

// Loud, not silent. A missing secret must never again look like a working Worker:
// this is the same failure mode that made every auth mail vanish when
// AUTH_WORKER_SECRET was unset (see functions/api/auth/send-verification.js).
function assertSecret(env) {
  if (!env || !env.FIREBASE_SECRET) {
    console.error('[hit-counter] FIREBASE_SECRET is not set in this Worker\'s variables — every RTDB call will be unauthenticated and denied');
    return false;
  }
  return true;
}

// One reporter for every RTDB response, so no call site can quietly decide not to
// care. Returns true when the call actually succeeded.
async function ok(res, label) {
  if (res.ok) return true;
  let body = '';
  try { body = (await res.text()).slice(0, 300); } catch { /* body already consumed or unreadable */ }
  console.error(`[hit-counter] ${label} FAILED ${res.status} ${res.statusText} ${body}`);
  return false;
}

async function readCount(slug, env) {
  try {
    const res = await fetch(dbUrl(env, `stories/${slug}/hits`, `&nc=${Date.now()}`), {
      cf: { cacheTtl: -1, cacheEverything: false },
    });
    // Checked BEFORE parsing: a denied read's body parses to NaN and used to be
    // returned as null, which is also what "no hits yet" looks like.
    if (!(await ok(res, `readCount(${slug})`))) return null;
    const n = parseInt(await res.text(), 10);
    return Number.isNaN(n) ? null : n;
  } catch (e) {
    console.error(`[hit-counter] readCount(${slug}) threw: ${e.message}`);
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    const headers = jsonHeaders();

    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400, headers });
    if (!assertSecret(env)) {
      return new Response(JSON.stringify({ error: 'Worker misconfigured' }), { status: 500, headers });
    }

    // GET (or anything not POST) is read-only — returns the current count, never increments.
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ count: await readCount(slug, env) }), { headers });
    }

    // POST increments both the cumulative counter and today's bucket atomically,
    // in one multi-path PATCH using RTDB increment server values.
    const today = utcDay(0);
    const patchBody = JSON.stringify({
      hits: { '.sv': { increment: 1 } },
      [`hitsByDay/${today}`]: { '.sv': { increment: 1 } },
    });

    try {
      const patchRes = await fetch(dbUrl(env, `stories/${slug}`), {
        method: 'PATCH',
        body: patchBody,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        // The 502 to the caller was always here; the log is what was missing, and
        // the log is the half anyone investigating can actually see.
        console.error(`[hit-counter] increment(${slug}, ${today}) FAILED ${patchRes.status} ${detail.slice(0, 300)}`);
        return new Response(JSON.stringify({ error: 'increment failed', status: patchRes.status, detail }), { status: 502, headers });
      }
      // Increment sentinels don't return the resolved value, so read it back for display.
      return new Response(JSON.stringify({ count: await readCount(slug, env) }), { headers });
    } catch (e) {
      console.error(`[hit-counter] increment(${slug}) threw: ${e.message}`);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  },

  async scheduled(event, env, ctx) {
    // waitUntil swallows a rejection: without this catch, a throw anywhere in the
    // rebuild is invisible and the cron simply appears to have done nothing.
    ctx.waitUntil(
      rebuildTopStories(env).catch((e) => {
        console.error(`[hit-counter] rebuildTopStories threw: ${e.message}`);
      }),
    );
  },
};

async function rebuildTopStories(env) {
  if (!assertSecret(env)) return;

  const res = await fetch(dbUrl(env, 'stories', `&nc=${Date.now()}`));
  // ABORT, do not continue. A denied read hands back an error OBJECT, which the
  // loop below happily walks as "zero valid stories" — and the PUT further down
  // would then overwrite a live top-10 with an empty one.
  if (!(await ok(res, 'read stories'))) return;

  const data = (await res.json()) || {};

  const windowDays = [];
  for (let i = 0; i < WINDOW_DAYS; i++) windowDays.push(utcDay(i));
  const cutoff = utcDay(KEEP_DAYS);

  let earliestBucket = null;
  const weekly = [];
  const alltime = [];
  const prunePatch = {};

  for (const [slug, rec] of Object.entries(data)) {
    if (!rec || typeof rec !== 'object') continue;

    const cumulative = typeof rec.hits === 'number' ? rec.hits : 0;
    alltime.push({ slug, count: cumulative });

    let windowSum = 0;
    const byDay = rec.hitsByDay || {};
    for (const [day, n] of Object.entries(byDay)) {
      if (typeof n !== 'number') continue;
      if (windowDays.includes(day)) windowSum += n;
      if (earliestBucket === null || day < earliestBucket) earliestBucket = day;
      if (day < cutoff) prunePatch[`${slug}/hitsByDay/${day}`] = null;
    }
    weekly.push({ slug, count: windowSum });
  }

  // Show all-time until a full window of history exists, then switch to weekly automatically.
  const haveFullWindow = earliestBucket !== null && earliestBucket <= utcDay(WINDOW_DAYS - 1);
  const mode = haveFullWindow ? 'weekly' : 'alltime';

  const items = (mode === 'weekly' ? weekly : alltime)
    .filter((x) => x.count > 0)
    .sort((a, b) => (b.count - a.count) || (a.slug < b.slug ? -1 : 1))
    .slice(0, TOP_N);

  const putRes = await fetch(dbUrl(env, 'top_stories/weekly'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, generatedAt: Date.now(), windowDays: WINDOW_DAYS, items }),
  });
  if (await ok(putRes, 'write top_stories/weekly')) {
    // The success line is not decoration: it is how the next person confirms the
    // cron ran at all, and its cadence, without guessing from generatedAt.
    console.log(`[hit-counter] top_stories/weekly written | mode=${mode} items=${items.length}`);
  }

  if (Object.keys(prunePatch).length > 0) {
    const pruneRes = await fetch(dbUrl(env, 'stories'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prunePatch),
    });
    await ok(pruneRes, `prune ${Object.keys(prunePatch).length} old day-bucket(s)`);
  }
}
