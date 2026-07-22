// Analytics computation — the SINGLE source of truth for /admin/analytics.
//
// Pure functions only: no imports, no Firebase, no DOM. This lets the exact
// same code run in two places and never diverge:
//   - app/admin/analytics/page.js  (client, computes from wholesale raw nodes)
//   - scripts/compute-metrics.mjs  (Node, reads via service account)
//
// The spine is `storyReads/{slug}/{readerId} = <ms>` — the engagement-gated,
// server-written read ledger that covers BOTH signed-in readers (keyed by uid)
// and signed-out readers (keyed by a persisted localStorage UUID). Signed-in
// activity nodes (comments, square_posts, quiz_submissions, userBadges, points
// history, open_pages) are unioned in so a signed-in user who comments but
// doesn't trip the read gate still counts as active.
//
// Honesty is the point of this file. Every derived metric here is either
// event-derived (storyReads + timestamped activity) or a plain count of a
// rules-scoped node. The world-writable counters (stories/hits, top_stories)
// are deliberately NOT used. Coverage caveats travel with each metric as UI
// labels defined in the page.

const DAY = 86400000;

// day 0 (1970-01-01) was a Thursday; subtract 3 so week buckets start Monday.
export function dayIndex(ms) { return Math.floor(ms / DAY); }
export function weekIndex(ms) { return Math.floor((dayIndex(ms) - 3) / 7); }

// storyReads entries are written by the Worker as a bare ms-epoch number
// (ServerValue.timestamp). Tolerate a defensive {at:<ms>} object too, in case
// the rule's `at`-child shape is ever wired to a client writer.
export function readLedgerTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.at === 'number') return v.at;
  return null;
}

// ISO-ish "YYYY-Www" label for a week bucket, derived purely from the week
// index (no Date needed on the hot path — used only for display grouping).
export function weekLabel(wIdx) {
  // Anchor: weekIndex(0) covers the week containing 1970-01-05 (first Monday).
  const mondayMs = (wIdx * 7 + 3) * DAY;
  const d = new Date(mondayMs);
  const year = d.getUTCFullYear();
  // Rough ISO week number for display only.
  const jan1 = Date.UTC(year, 0, 1);
  const wk = Math.floor((mondayMs - jan1) / (7 * DAY)) + 1;
  return `${year}-W${String(Math.max(1, wk)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Activity extraction — flatten every timestamped node into (identity, ts)
// events, plus a per-identity sorted timestamp list for cohort/activation math.
// ---------------------------------------------------------------------------

function pushEvent(map, identity, ts) {
  if (!identity || typeof ts !== 'number' || !isFinite(ts)) return;
  (map[identity] ||= []).push(ts);
}

// Returns { byIdentity: {id: [ts,...]}, readerFirst: {readerId: firstTs} }.
// readerFirst is storyReads-only (used for anon cohorts + honest reads).
export function extractActivity(raw) {
  const byIdentity = {};              // identity -> [ts]
  const readerFirst = {};             // readerId -> earliest storyReads ts
  const readsPerStory = {};           // slug -> Set(readerId)

  // storyReads — the spine. Covers signed-in (uid) and anon (UUID).
  if (raw.storyReads) {
    for (const [slug, readers] of Object.entries(raw.storyReads)) {
      if (!readers || typeof readers !== 'object') continue;
      for (const [readerId, v] of Object.entries(readers)) {
        const ts = readLedgerTs(v);
        if (ts == null) continue;
        pushEvent(byIdentity, readerId, ts);
        if (readerFirst[readerId] == null || ts < readerFirst[readerId]) readerFirst[readerId] = ts;
        (readsPerStory[slug] ||= new Set()).add(readerId);
      }
    }
  }

  // Signed-in activity nodes (keyed by / carrying a uid) — union in.
  if (raw.comments) {
    for (const bySlug of Object.values(raw.comments)) {
      if (!bySlug) continue;
      for (const c of Object.values(bySlug)) {
        if (c && typeof c.createdAt === 'number') pushEvent(byIdentity, c.authorUid, c.createdAt);
      }
    }
  }
  if (raw.squarePosts) {
    for (const p of Object.values(raw.squarePosts)) {
      if (p && typeof p.createdAt === 'number') pushEvent(byIdentity, p.authorUid, p.createdAt);
    }
  }
  if (raw.openPages) {
    for (const p of Object.values(raw.openPages)) {
      if (p && typeof p.createdAt === 'number') pushEvent(byIdentity, p.authorUid, p.createdAt);
    }
  }
  if (raw.submissions) {
    for (const [uid, bySlug] of Object.entries(raw.submissions)) {
      if (!bySlug) continue;
      for (const sub of Object.values(bySlug)) {
        if (sub && typeof sub.submittedAt === 'number') pushEvent(byIdentity, uid, sub.submittedAt);
      }
    }
  }
  if (raw.badges) {
    for (const [uid, byBadge] of Object.entries(raw.badges)) {
      if (!byBadge) continue;
      for (const b of Object.values(byBadge)) {
        if (b && typeof b.earnedAt === 'number') pushEvent(byIdentity, uid, b.earnedAt);
      }
    }
  }
  if (raw.points) {
    for (const [uid, rec] of Object.entries(raw.points)) {
      const hist = rec?.history;
      if (!hist) continue;
      for (const h of Object.values(hist)) {
        if (h && typeof h.createdAt === 'number') pushEvent(byIdentity, uid, h.createdAt);
      }
    }
  }
  // userStreaks.lastReadAt — the ONE signed-in reading signal available while
  // the storyReads ledger is empty. The streak engine overwrites lastReadAt to
  // the latest read day, so this contributes at most ONE event per user (their
  // most-recent read day). That is a strict floor for DAU history — it never
  // fabricates an active day — and it is exact for "active within a window".
  if (raw.streaks) {
    for (const [uid, st] of Object.entries(raw.streaks)) {
      if (st && typeof st.lastReadAt === 'number') pushEvent(byIdentity, uid, st.lastReadAt);
    }
  }

  for (const id of Object.keys(byIdentity)) byIdentity[id].sort((a, b) => a - b);
  return { byIdentity, readerFirst, readsPerStory };
}

// ---------------------------------------------------------------------------
// DAU / WAU / MAU
// ---------------------------------------------------------------------------

export function computeActives(byIdentity, now) {
  const perDay = {};                  // dayIndex -> Set(identity)
  const wau = new Set(), mau = new Set(), dau = new Set();
  const todayDay = dayIndex(now);
  for (const [id, times] of Object.entries(byIdentity)) {
    for (const ts of times) {
      const d = dayIndex(ts);
      (perDay[d] ||= new Set()).add(id);
      if (ts > now - 30 * DAY) mau.add(id);
      if (ts > now - 7 * DAY)  wau.add(id);
      if (d === todayDay)      dau.add(id);
    }
  }
  // 30-day line of distinct actives per day (index 29 = today).
  const line = new Array(30).fill(0);
  for (let i = 0; i < 30; i++) {
    const d = todayDay - (29 - i);
    line[i] = perDay[d] ? perDay[d].size : 0;
  }
  const last7 = line.slice(23);
  const avg7 = Math.round(last7.reduce((a, b) => a + b, 0) / 7);
  return { dau: dau.size, wau: wau.size, mau: mau.size, line, avg7 };
}

// ---------------------------------------------------------------------------
// Cohort retention — W1..W4 relative to each identity's own start ts.
// wN denominator only counts members whose week-N window has fully elapsed.
// ---------------------------------------------------------------------------

function retentionRow(members, byIdentity, startOf, now) {
  // members: array of identities. startOf(id) -> start ts (signup / first read).
  const size = members.length;
  const num = [0, 0, 0, 0];       // active counts, W1..W4
  const den = [0, 0, 0, 0];       // members whose window elapsed
  for (const id of members) {
    const start = startOf(id);
    const times = byIdentity[id] || [];
    for (let w = 1; w <= 4; w++) {
      const lo = start + w * 7 * DAY;
      const hi = start + (w + 1) * 7 * DAY;
      if (now >= hi) den[w - 1]++;              // window fully elapsed
      if (times.some(t => t >= lo && t < hi)) num[w - 1]++;
    }
  }
  const pct = (i) => (den[i] > 0 ? num[i] / den[i] : null);
  return { size, w1: pct(0), w2: pct(1), w3: pct(2), w4: pct(3) };
}

export function computeCohorts(raw, activity, now, { maxRows = 10 } = {}) {
  const { byIdentity, readerFirst } = activity;
  const userIds = raw.users ? new Set(Object.keys(raw.users)) : new Set();

  // Registered cohorts: bucket users with a joinDate by signup week.
  const regBuckets = {};              // weekIdx -> [uid]
  const startReg = {};                // uid -> joinDate
  if (raw.users) {
    for (const [uid, u] of Object.entries(raw.users)) {
      const jd = u?.joinDate;
      if (typeof jd !== 'number') continue;     // only users we can cohort
      startReg[uid] = jd;
      (regBuckets[weekIndex(jd)] ||= []).push(uid);
    }
  }
  const registered = Object.keys(regBuckets)
    .map(Number).sort((a, b) => b - a).slice(0, maxRows)
    .map(w => ({ label: weekLabel(w), ...retentionRow(regBuckets[w], byIdentity, id => startReg[id], now) }));

  // Anonymous cohorts: readerIds in storyReads that are NOT registered uids,
  // bucketed by first-touch week. Anon identities only have storyReads events.
  const anonBuckets = {};
  const startAnon = {};
  for (const [readerId, firstTs] of Object.entries(readerFirst)) {
    if (userIds.has(readerId)) continue;        // that's a signed-in reader
    startAnon[readerId] = firstTs;
    (anonBuckets[weekIndex(firstTs)] ||= []).push(readerId);
  }
  const anonymous = Object.keys(anonBuckets)
    .map(Number).sort((a, b) => b - a).slice(0, maxRows)
    .map(w => ({ label: weekLabel(w), ...retentionRow(anonBuckets[w], byIdentity, id => startAnon[id], now) }));

  return { registered, anonymous };
}

// ---------------------------------------------------------------------------
// Activation — signed-up users who then produced a first read (storyReads[uid]).
// ---------------------------------------------------------------------------

export function computeActivation(raw, activity) {
  const { readerFirst } = activity;
  if (!raw.users) return null;
  let eligible = 0, activated = 0;
  const daysToFirst = [];
  for (const [uid, u] of Object.entries(raw.users)) {
    const jd = u?.joinDate;
    if (typeof jd !== 'number') continue;
    eligible++;
    const first = readerFirst[uid];             // first read keyed by this uid
    if (first != null && first >= jd) {
      activated++;
      daysToFirst.push((first - jd) / DAY);
    }
  }
  daysToFirst.sort((a, b) => a - b);
  const medianDays = daysToFirst.length
    ? Math.round(daysToFirst[Math.floor(daysToFirst.length / 2)] * 10) / 10
    : null;
  return { eligible, activated, rate: eligible ? activated / eligible : 0, medianDays };
}

// ---------------------------------------------------------------------------
// Honest unique reads per story — distinct readerIds in the storyReads ledger.
// ---------------------------------------------------------------------------

export function computeHonestReads(activity, titleFor, { top = 10 } = {}) {
  const { readsPerStory } = activity;
  const rows = Object.entries(readsPerStory)
    .map(([slug, set]) => ({ slug, title: titleFor(slug), readers: set.size }))
    .sort((a, b) => b.readers - a.readers);
  const total = rows.reduce((sum, r) => sum + r.readers, 0);
  return { rows: rows.slice(0, top), total, storyCount: rows.length };
}
