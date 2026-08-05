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
// THIS COMMIT IS THE MIRROR AS FOUND. Everything below the header is the deployed
// source verbatim, including the hardcoded FIREBASE_AUTH that does not work — the
// mirror's job is to record what IS running, not what it should be. The repair is
// the next commit, so the diff between them is exactly the fix and nothing else.
//
// WHAT IT OWNS, and why that matters to the rules:
//   · stories/{slug}/hits           — cumulative, also written by functions/api/hit.js
//   · stories/{slug}/hitsByDay/{d}  — UTC day buckets. NOTHING ELSE WRITES THESE.
//   · top_stories/weekly            — rebuilt on the cron below.
// app/public-library/page.js:1093 reads top_stories/weekly. If this Worker stops,
// that surface goes stale silently — which is precisely what happened on 3 Aug.
//
// THE 3 AUG STOPPAGE. `stories` was open (.write:true) until f8f547d closed it at
// 2026-08-03 22:50:56Z. FIREBASE_AUTH below is the Firebase WEB API KEY, which is
// not RTDB credentials at all — RTDB ignored it and treated every call here as
// unauthenticated. That worked only for as long as the node was world-writable.
// From the moment it closed, every write from this Worker was denied, and the last
// day bucket written anywhere is 2026-08-03. top_stories kept regenerating because
// top_stories still carries .write:true — same Worker, one node closed, one open.
// ─────────────────────────────────────────────────────────────────────────────

const FIREBASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_AUTH = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';

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

async function readCount(slug) {
  const url = `${FIREBASE_URL}/stories/${slug}/hits.json?auth=${FIREBASE_AUTH}&nc=${Date.now()}`;
  try {
    const res = await fetch(url, { cf: { cacheTtl: -1, cacheEverything: false } });
    const n = parseInt(await res.text(), 10);
    return Number.isNaN(n) ? null : n;
  } catch (_) {
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

    // GET (or anything not POST) is read-only — returns the current count, never increments.
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ count: await readCount(slug) }), { headers });
    }

    // POST increments both the cumulative counter and today's bucket atomically,
    // in one multi-path PATCH using RTDB increment server values.
    const patchUrl = `${FIREBASE_URL}/stories/${slug}.json?auth=${FIREBASE_AUTH}`;
    const today = utcDay(0);
    const patchBody = JSON.stringify({
      hits: { '.sv': { increment: 1 } },
      [`hitsByDay/${today}`]: { '.sv': { increment: 1 } },
    });

    try {
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        body: patchBody,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        return new Response(JSON.stringify({ error: 'increment failed', status: patchRes.status, detail }), { status: 502, headers });
      }
      // Increment sentinels don't return the resolved value, so read it back for display.
      return new Response(JSON.stringify({ count: await readCount(slug) }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(rebuildTopStories());
  },
};

async function rebuildTopStories() {
  const res = await fetch(`${FIREBASE_URL}/stories.json?auth=${FIREBASE_AUTH}&nc=${Date.now()}`);
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

  await fetch(`${FIREBASE_URL}/top_stories/weekly.json?auth=${FIREBASE_AUTH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, generatedAt: Date.now(), windowDays: WINDOW_DAYS, items }),
  });

  if (Object.keys(prunePatch).length > 0) {
    await fetch(`${FIREBASE_URL}/stories.json?auth=${FIREBASE_AUTH}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prunePatch),
    });
  }
}
