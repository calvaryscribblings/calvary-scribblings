'use client';
import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { BADGES } from '../../lib/badges';
import {
  extractActivity, computeActives, computeCohorts,
  computeActivation, computeHonestReads,
} from '../../lib/analyticsMetrics';

const ADMIN_EMAIL = 'ikennaworksfromhome@gmail.com';

const TIER_COLORS = {
  platinum: '#c8daea',
  gold:     '#c9a44c',
  silver:   '#c0c0c8',
  bronze:   '#c97c2f',
  none:     '#5a5a5a',
  locked:   '#9f4747',
};

const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze', 'none', 'locked'];

const STREAK_BUCKETS = [
  { label: '0 (none)',     min: 0,   max: 0,        color: '#3a3a3a' },
  { label: '1–6 days',     min: 1,   max: 6,        color: '#7c3aed' },
  { label: '7–29 days',    min: 7,   max: 29,       color: '#a78bfa' },
  { label: '30–99 days',   min: 30,  max: 99,       color: '#c4b5fd' },
  { label: '100–364 days', min: 100, max: 364,      color: '#fcd34d' },
  { label: '365+ days',    min: 365, max: Infinity, color: '#f87171' },
];

const RANGES = [
  { value: '7d',  label: 'Last 7 days',  ms: 7 * 86400000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86400000 },
  { value: 'all', label: 'All time',     ms: Infinity },
];

const s = {
  page:        { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "Cormorant Garamond, Georgia, serif" },
  header:      { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub:         { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body:        { maxWidth: 1100, margin: '0 auto', padding: '2.5rem 2rem 4rem' },
  topBar:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', gap: '1rem', flexWrap: 'wrap' },
  h2:          { fontSize: '1.75rem', fontWeight: 700, color: '#fff', margin: 0, fontFamily: "Cormorant Garamond, Georgia, serif" },
  h2sub:       { fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', marginTop: 4, fontFamily: 'Cormorant Garamond, Georgia, serif' },
  rangeRow:    { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' },
  chip:        { background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.12)', padding: '0.4rem 0.85rem', borderRadius: 999, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'Cormorant Garamond, Georgia, serif', textTransform: 'uppercase', letterSpacing: '0.08em' },
  chipActive:  { background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' },
  refreshBtn:  { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.4rem 0.95rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'Cormorant Garamond, Georgia, serif', marginLeft: '0.5rem' },
  section:     { marginBottom: '2rem' },
  sectionTitle:{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.45)', marginBottom: '0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  grid2:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem' },
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '1.25rem' },
  cardTitle:   { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.45)', marginBottom: '0.35rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  coverage:    { fontSize: '0.72rem', fontWeight: 500, fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', marginBottom: '0.9rem', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.4 },
  empty:       { fontSize: '0.9rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', fontFamily: 'Cormorant Garamond, Georgia, serif', padding: '0.75rem 0' },
  waiting:     { fontSize: '0.85rem', fontWeight: 500, color: '#fcd34d', background: 'rgba(252,211,77,0.06)', border: '1px solid rgba(252,211,77,0.18)', borderRadius: 6, padding: '0.65rem 0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.5 },
  errBox:      { fontSize: '0.85rem', fontWeight: 500, color: '#f87171', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '0.65rem 0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.5 },
  errPath:     { fontFamily: 'monospace', fontSize: '0.72rem', color: '#fca5a5', background: 'rgba(220,38,38,0.1)', padding: '0.05rem 0.35rem', borderRadius: 3 },
  bigNum:      { fontFamily: "Cormorant Garamond, Georgia, serif", fontSize: '2.5rem', color: '#a78bfa', lineHeight: 1.1 },
  bigNumSub:   { fontSize: '0.78rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', marginTop: '0.3rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  gate:        { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  loadingBar:  { height: 22, borderRadius: 4, background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', marginBottom: '0.5rem' },
  banner:      { fontSize: '0.82rem', fontWeight: 500, color: 'rgba(255,255,255,0.55)', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.75rem', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.55 },
  th:          { textAlign: 'right', fontSize: '0.72rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', padding: '0.3rem 0.4rem', fontFamily: 'Cormorant Garamond, Georgia, serif', textTransform: 'uppercase', letterSpacing: '0.06em' },
  td:          { textAlign: 'right', fontSize: '0.95rem', padding: '0.3rem 0.4rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
};

// coverage-caption text reused as the dashboard's honesty layer
const COVERAGE = {
  active:      'Active = a timestamped action: read (signed-in, via streak), quiz, comment, Square post, badge or reward. Rolling window; range selector does not apply. Read-ledger empty → pure signed-out readers not yet counted.',
  dau:         'Distinct active identities per UTC day, last 30 days. Signed-in reads contribute only their most-recent day until the read-ledger populates, so early days are a floor.',
  registered:  'Every record under users/. Includes users with no joinDate (pre-dating signup stamping).',
  signups:     'users.joinDate within the selected range. Only email/password registrations carry joinDate; others are not counted here.',
  activation:  'joinDate vs the reader’s first entry in the storyReads ledger. Computes once the read-ledger populates (see banner).',
  cohortReg:   'Registered users grouped by signup week; retention = any timestamped activity in each later week. Denominator counts only members whose week has fully elapsed. Read-only activity is under-weighted until the ledger populates.',
  cohortAnon:  'Signed-out readers keyed by their storyReads UUID, grouped by first read. Fills once the read-ledger populates.',
  streak:      'userStreaks.current — signed-in readers only.',
  ledgerReads: 'Distinct readerIds in the storyReads ledger (signed-in uid + signed-out UUID). The honest, engagement-gated read count. Empty until a client build sends readerId (see banner).',
  selfReads:   'Distinct signed-in readers with the story flagged in users.readStories. Owner-scoped (not world-writable) but signed-in only, and re-reads are not counted.',
  perUser:     'users.readCount — signed-in readers only; a client transaction, so forgeable per own record but not world-writable.',
  badges:      'userBadges.earnedAt within range — signed-in only.',
  breadth:     'comments.createdAt / square_posts.createdAt within range — signed-in only.',
  attempts:    'cms_stories.quizMeta.attemptCount — server-incremented (record-attempt Worker). Trustworthy. All-time.',
  submissions: 'quiz_submissions within range — one record per user per story; pass/tier is client-written but owner-scoped.',
  completion:  'Completed passes ÷ all-time attempt counter. The attempt counter carries no timestamps, so this is shown at All-time only.',
  scribbles:   'INTEGRITY-LIMITED: points/{uid} is writable by any signed-in user (no owner check). Do not present as truth — shown for operational awareness only.',
  payouts:     'DORMANT: no in-repo writer for payout_requests; payouts are not yet enabled. Node is also open-write — treat as a stub.',
};

function HBar({ label, value, max, suffix }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.45rem' }}>
      <div title={label} style={{ flex: '0 0 38%', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.85rem', fontWeight: 500 }}>{label}</div>
      <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #6b2fad, #a78bfa)', borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ flex: '0 0 60px', textAlign: 'right', fontFamily: "Cormorant Garamond, Georgia, serif", fontSize: '1.05rem', color: '#c4b5fd' }}>
        {value}{suffix || ''}
      </div>
    </div>
  );
}

function StackedTierBar({ label, total, tiers }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
        <span title={label} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{label}</span>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.78rem', fontWeight: 500 }}>{total} attempt{total !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', background: '#1a1a1a' }}>
        {TIER_ORDER.map(tier => {
          const v = tiers[tier] || 0;
          if (v === 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={tier}
              title={`${tier}: ${v} (${Math.round(pct)}%)`}
              style={{ width: `${pct}%`, background: TIER_COLORS[tier], transition: 'width 0.4s ease' }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PassRateRow({ label, total, rate }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 70 ? '#86efac' : pct >= 40 ? '#fcd34d' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
      <div title={label} style={{ flex: 1, color: 'rgba(255,255,255,0.7)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: '0 0 50px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>n={total}</div>
      <div style={{ flex: '0 0 60px', textAlign: 'right', fontFamily: "Cormorant Garamond, Georgia, serif", fontSize: '1.2rem', color }}>{pct}%</div>
    </div>
  );
}

function LineChart({ data, height = 130 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const W = 600, H = height, P = 6;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (W - P * 2) + P;
    const y = H - P - (v / max) * (H - P * 2);
    return [x, y];
  });
  const line = points.map(p => p.join(',')).join(' ');
  const area = `${P},${H - P} ${line} ${W - P},${H - P}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polygon points={area} fill="rgba(124,58,237,0.18)" />
      <polyline points={line} fill="none" stroke="#a78bfa" strokeWidth="2" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="#c4b5fd" opacity={i === points.length - 1 ? 1 : 0.5} />
      ))}
      <text x={P} y={14} fill="rgba(255,255,255,0.3)" fontSize="12" fontWeight="500" fontFamily="Cormorant Garamond, Georgia, serif">peak: {max}</text>
    </svg>
  );
}

function Donut({ buckets, size = 170 }) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return <div style={s.empty}>No streak data.</div>;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let cumulative = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a1a" strokeWidth="20" />
        {buckets.map((b, i) => {
          if (b.count === 0) return null;
          const dash = (b.count / total) * c;
          const offset = -cumulative;
          cumulative += dash;
          return (
            <circle
              key={i} cx={size/2} cy={size/2} r={r}
              fill="none" stroke={b.color} strokeWidth="20"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={offset}
            >
              <title>{b.label}: {b.count}</title>
            </circle>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 160 }}>
        {buckets.map(b => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, flexShrink: 0 }} />
            <span style={{ color: 'rgba(255,255,255,0.6)', flex: 1 }}>{b.label}</span>
            <span style={{ color: '#c4b5fd', fontFamily: "Cormorant Garamond, Georgia, serif", fontSize: '1rem' }}>{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohortTable({ rows, emptyNote }) {
  if (!rows || rows.length === 0) return <div style={s.waiting}>{emptyNote}</div>;
  const cell = (v) => {
    if (v == null) return <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>;
    const pct = Math.round(v * 100);
    const color = pct >= 40 ? '#86efac' : pct >= 15 ? '#fcd34d' : '#f87171';
    return <span style={{ color }}>{pct}%</span>;
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...s.th, textAlign: 'left' }}>Cohort</th>
            <th style={s.th}>n</th>
            <th style={s.th}>W1</th>
            <th style={s.th}>W2</th>
            <th style={s.th}>W3</th>
            <th style={s.th}>W4</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={{ ...s.td, textAlign: 'left', color: 'rgba(255,255,255,0.6)' }}>{r.label}</td>
              <td style={{ ...s.td, color: 'rgba(255,255,255,0.4)' }}>{r.size}</td>
              <td style={s.td}>{cell(r.w1)}</td>
              <td style={s.td}>{cell(r.w2)}</td>
              <td style={s.td}>{cell(r.w3)}</td>
              <td style={s.td}>{cell(r.w4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, coverage, err, errPath, children }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      {coverage && <div style={s.coverage}>{coverage}</div>}
      {err ? <CardError msg={err} path={errPath} /> : children}
    </div>
  );
}

function CardError({ msg, path }) {
  return (
    <div style={s.errBox}>
      <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>Failed to read <span style={s.errPath}>{path}</span></div>
      <div style={{ color: '#fca5a5', opacity: 0.8 }}>{msg}</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: '0.45rem', fontSize: '0.72rem' }}>
        Likely missing admin root-read rule. Update Firebase Realtime Database rules and refresh.
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && (user.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL));

  const [range, setRange]               = useState('30d');
  const [raw, setRaw]                   = useState(null);
  const [errors, setErrors]             = useState({});
  const [fetching, setFetching]         = useState(false);
  const [lastFetchedAt, setLastFetched] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function fetchAll() {
    setFetching(true);
    const { ref, get } = await import('firebase/database');

    const fetchPath = async (path) => {
      try {
        const snap = await get(ref(db, path));
        return { ok: true, data: snap.exists() ? snap.val() : null };
      } catch (e) {
        return { ok: false, error: e.message || 'Read denied' };
      }
    };

    const keys = ['stories', 'submissions', 'streaks', 'badges', 'users', 'points', 'payouts', 'storyReads', 'comments', 'squarePosts', 'openPages'];
    const paths = ['cms_stories', 'quiz_submissions', 'userStreaks', 'userBadges', 'users', 'points', 'payout_requests', 'storyReads', 'comments', 'square_posts', 'open_pages'];
    const results = await Promise.all(paths.map(fetchPath));

    const next = {}, errs = {};
    keys.forEach((k, i) => {
      next[k] = results[i].ok ? results[i].data : null;
      if (!results[i].ok) errs[k] = results[i].error;
    });
    setRaw(next);
    setErrors(errs);
    setLastFetched(Date.now());
    setFetching(false);
  }

  const metrics = useMemo(() => {
    if (!raw) return null;
    const rangeMs = RANGES.find(r => r.value === range)?.ms ?? Infinity;
    const now = Date.now();
    const cutoff = rangeMs === Infinity ? 0 : now - rangeMs;
    const titleFor = (slug) => raw.stories?.[slug]?.title || slug;

    // ── Honest spine (shared module) ──────────────────────────────────────
    const activity   = extractActivity(raw);
    const actives     = computeActives(activity.byIdentity, now);
    const cohorts     = computeCohorts(raw, activity, now);
    const activation  = computeActivation(raw, activity);
    const honestReads = computeHonestReads(activity, titleFor);
    const ledgerEmpty = honestReads.storyCount === 0;

    const registeredTotal = raw.users ? Object.keys(raw.users).length : null;
    const newSignups = raw.users
      ? Object.values(raw.users).filter(u => typeof u?.joinDate === 'number' && u.joinDate >= cutoff).length
      : null;

    // ── Engagement breadth (range-scoped counts) ──────────────────────────
    const countInRange = (node, tsField, nested) => {
      if (!node) return null;
      let n = 0;
      const walk = (obj) => { for (const v of Object.values(obj)) { if (v && typeof v[tsField] === 'number' && v[tsField] >= cutoff) n++; } };
      if (nested) { for (const grp of Object.values(node)) { if (grp && typeof grp === 'object') walk(grp); } }
      else walk(node);
      return n;
    };
    const commentsInRange = countInRange(raw.comments, 'createdAt', true);
    const squarePostsInRange = countInRange(raw.squarePosts, 'createdAt', false);

    // ── quiz_submissions windowed index ───────────────────────────────────
    const subsBySlug = {};
    if (raw.submissions) {
      for (const userSubs of Object.values(raw.submissions)) {
        if (!userSubs) continue;
        for (const [slug, sub] of Object.entries(userSubs)) {
          if (!sub) continue;
          if ((sub.submittedAt || 0) < cutoff) continue;
          (subsBySlug[slug] ||= []).push(sub);
        }
      }
    }

    const attemptsPerStory = raw.stories
      ? Object.entries(raw.stories)
          .map(([slug, st]) => ({ slug, title: st.title || slug, count: st.quizMeta?.attemptCount || 0 }))
          .filter(x => x.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
      : null;

    const tierDist = raw.submissions
      ? Object.entries(subsBySlug)
          .map(([slug, subs]) => {
            const tiers = {};
            for (const sub of subs) {
              const key = sub.hardballPassed === false
                ? 'locked'
                : (sub.tier && TIER_COLORS[sub.tier] ? sub.tier : 'none');
              tiers[key] = (tiers[key] || 0) + 1;
            }
            return { slug, title: titleFor(slug), total: subs.length, tiers };
          })
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
      : null;

    const hardballPassRate = raw.submissions
      ? Object.entries(subsBySlug)
          .map(([slug, subs]) => {
            const passed = subs.filter(x => x.hardballPassed === true).length;
            const failed = subs.filter(x => x.hardballPassed === false).length;
            const tot = passed + failed;
            return { slug, title: titleFor(slug), total: tot, rate: tot > 0 ? passed / tot : 0 };
          })
          .filter(x => x.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      : null;

    // Completion: all-time only (attemptCount carries no timestamps to window).
    const allSubsBySlug = {};
    if (raw.submissions) {
      for (const userSubs of Object.values(raw.submissions)) {
        if (!userSubs) continue;
        for (const [slug, sub] of Object.entries(userSubs)) {
          if (sub) (allSubsBySlug[slug] ||= []).push(sub);
        }
      }
    }
    const completion = raw.stories
      ? Object.entries(raw.stories)
          .map(([slug, st]) => {
            const total = st.quizMeta?.attemptCount || 0;
            const completed = (allSubsBySlug[slug] || []).filter(x => x.hardballPassed === true).length;
            return { slug, title: st.title || slug, total, completed, ratio: total > 0 ? completed / total : 0 };
          })
          .filter(x => x.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      : null;

    const streakDist = raw.streaks
      ? STREAK_BUCKETS.map(b => {
          let count = 0;
          for (const u of Object.values(raw.streaks)) {
            const c = u?.current || 0;
            if (c >= b.min && c <= b.max) count++;
          }
          return { ...b, count };
        })
      : null;

    const badgeDist = raw.badges
      ? (() => {
          const counts = {};
          for (const userBadges of Object.values(raw.badges)) {
            if (!userBadges) continue;
            for (const [bid, b] of Object.entries(userBadges)) {
              if ((b?.earnedAt || 0) < cutoff) continue;
              counts[bid] = (counts[bid] || 0) + 1;
            }
          }
          return BADGES.map(def => ({ id: def.id, label: def.name, icon: def.icon, count: counts[def.id] || 0 }))
            .sort((a, b) => b.count - a.count);
        })()
      : null;

    const storiesPerUser = raw.users
      ? (() => {
          const counts = Object.values(raw.users).map(u => u?.readCount || 0).filter(x => x > 0);
          if (counts.length === 0) return { mean: 0, median: 0, max: 0, n: 0 };
          const sorted = [...counts].sort((a, b) => a - b);
          const sum = counts.reduce((a, b) => a + b, 0);
          const mid = Math.floor(sorted.length / 2);
          const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
          return { n: counts.length, mean: Math.round((sum / counts.length) * 10) / 10, median, max: sorted[sorted.length - 1] };
        })()
      : null;

    // Signed-in distinct readers per story (self-reported readStories) — has
    // data today; kept as the honest-ish interim until the ledger populates.
    const selfReads = raw.users
      ? (() => {
          const counts = {};
          for (const u of Object.values(raw.users)) {
            const rs = u?.readStories;
            if (!rs) continue;
            for (const slug of Object.keys(rs)) counts[slug] = (counts[slug] || 0) + 1;
          }
          return Object.entries(counts)
            .map(([slug, count]) => ({ slug, title: titleFor(slug), count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        })()
      : null;

    const totalScribbles = raw.points
      ? Object.values(raw.points).reduce((sum, p) => sum + (p?.total || 0), 0)
      : null;

    const pendingPayouts = raw.payouts
      ? Object.entries(raw.payouts).filter(([, p]) => p?.status === 'pending').map(([id, p]) => ({ id, ...p }))
      : [];

    return {
      actives, cohorts, activation, honestReads, ledgerEmpty,
      registeredTotal, newSignups, commentsInRange, squarePostsInRange,
      attemptsPerStory, tierDist, hardballPassRate, completion,
      streakDist, badgeDist, storiesPerUser, selfReads, totalScribbles, pendingPayouts,
    };
  }, [raw, range]);

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!user) return (
    <div style={s.gate}>
      <div style={{ fontSize: '1.1rem', color: '#a78bfa', fontWeight: 700 }}>Calvary Scribblings</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>Sign in to access analytics.</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );
  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 700 }}>Access Denied</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>This area is restricted.</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );

  const m = metrics;
  const maxBadge = m?.badgeDist?.[0]?.count || 0;
  const maxSelf  = m?.selfReads?.[0]?.count || 0;
  const maxLedger = m?.honestReads?.rows?.[0]?.readers || 0;
  const maxAttempts = m?.attemptsPerStory?.[0]?.count || 0;
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

  return (
    <div style={s.page}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Analytics</div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← CMS</a>
          <a href="/" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← Site</a>
        </div>
      </header>

      <div style={s.body}>
        <div style={s.topBar}>
          <div>
            <h2 style={s.h2}>Analytics</h2>
            <div style={s.h2sub}>
              {fetching
                ? 'Loading…'
                : lastFetchedAt
                  ? `Last updated ${new Date(lastFetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Awaiting fetch'}
            </div>
          </div>
          <div style={s.rangeRow}>
            {RANGES.map(r => (
              <button key={r.value} style={{ ...s.chip, ...(range === r.value ? s.chipActive : {}) }} onClick={() => setRange(r.value)}>
                {r.label}
              </button>
            ))}
            <button style={s.refreshBtn} onClick={fetchAll} disabled={fetching}>
              {fetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {fetching && !m && (
          <div style={s.grid2}>
            {[0,1,2,3].map(i => (
              <div key={i} style={s.card}>
                <div style={{ ...s.loadingBar, width: '40%', height: 14, marginBottom: '1rem' }} />
                {[0,1,2,3,4].map(j => <div key={j} style={s.loadingBar} />)}
              </div>
            ))}
          </div>
        )}

        {m && m.ledgerEmpty && (
          <div style={s.banner}>
            <strong style={{ color: '#c4b5fd' }}>Read-ledger not yet populating.</strong> The <code style={s.errPath}>storyReads</code> ledger is empty,
            so active-user, cohort and per-story-read metrics currently draw only on signed-in activity (reads via streaks, quizzes, comments,
            Square, badges, rewards). Signed-out readers and pure signed-in readers who never trip a reward are not yet counted. This fills once a
            client build sends <code style={s.errPath}>readerId</code> to <code style={s.errPath}>/api/hit</code> (app OTA). Numbers below are a
            floor, not a ceiling — safe to quote as minimums.
          </div>
        )}

        {m && (
          <>
            {/* ─── A. GROWTH & ACTIVE USERS ─────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>A · Growth & Active Users</div>
              <div style={s.grid2}>
                <Card title="Weekly / Monthly active" coverage={COVERAGE.active}>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    <div><div style={s.bigNum}>{m.actives.wau}</div><div style={s.bigNumSub}>WAU · last 7 days</div></div>
                    <div><div style={s.bigNum}>{m.actives.mau}</div><div style={s.bigNumSub}>MAU · last 30 days</div></div>
                    <div><div style={s.bigNum}>{m.actives.avg7}</div><div style={s.bigNumSub}>DAU · 7-day average</div></div>
                  </div>
                </Card>

                <Card title="Registered readers" coverage={COVERAGE.registered} err={errors.users} errPath="users">
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    <div><div style={s.bigNum}>{(m.registeredTotal ?? 0).toLocaleString('en-GB')}</div><div style={s.bigNumSub}>Total accounts</div></div>
                    <div><div style={s.bigNum}>{m.newSignups ?? '—'}</div><div style={s.bigNumSub}>New signups · {RANGES.find(r => r.value === range)?.label.toLowerCase()}</div></div>
                  </div>
                </Card>

                <Card title="Daily active · last 30 days" coverage={COVERAGE.dau}>
                  <LineChart data={m.actives.line} />
                </Card>

                <Card title="Activation · signup → first read" coverage={COVERAGE.activation} err={errors.users} errPath="users">
                  {m.activation && m.activation.activated > 0
                    ? (<div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div><div style={s.bigNum}>{pct(m.activation.rate)}</div><div style={s.bigNumSub}>{m.activation.activated}/{m.activation.eligible} activated</div></div>
                        <div><div style={s.bigNum}>{m.activation.medianDays ?? '—'}</div><div style={s.bigNumSub}>median days to first read</div></div>
                      </div>)
                    : <div style={s.waiting}>Awaiting read-ledger data — activation is measured from the first <code style={s.errPath}>storyReads</code> entry per user, which is empty until the readerId build ships.</div>}
                </Card>
              </div>
            </div>

            {/* ─── B. RETENTION & HABIT ─────────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>B · Retention & Habit</div>
              <div style={s.grid2}>
                <Card title="Registered cohort retention" coverage={COVERAGE.cohortReg} err={errors.users} errPath="users">
                  <CohortTable rows={m.cohorts.registered} emptyNote="No cohortable users (need joinDate)." />
                </Card>
                <Card title="Anonymous reader retention" coverage={COVERAGE.cohortAnon}>
                  <CohortTable rows={m.cohorts.anonymous} emptyNote="Awaiting read-ledger data — anonymous cohorts derive entirely from the storyReads UUID ledger, which is empty until the readerId build ships." />
                </Card>
                <Card title="Streak distribution · current" coverage={COVERAGE.streak} err={errors.streaks} errPath="userStreaks">
                  {m.streakDist ? <Donut buckets={m.streakDist} /> : <div style={s.empty}>No streak data.</div>}
                </Card>
              </div>
            </div>

            {/* ─── C. CONTENT & READS ───────────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>C · Content & Reads</div>
              <div style={s.grid2}>
                <Card title="Verified unique reads · per story" coverage={COVERAGE.ledgerReads} err={errors.storyReads} errPath="storyReads">
                  {m.honestReads.rows.length
                    ? m.honestReads.rows.map(x => <HBar key={x.slug} label={x.title} value={x.readers} max={maxLedger} />)
                    : <div style={s.waiting}>Ledger empty — no verified reads recorded yet. See the interim signed-in count in the next card.</div>}
                </Card>
                <Card title="Distinct signed-in readers · per story (interim)" coverage={COVERAGE.selfReads} err={errors.users} errPath="users">
                  {m.selfReads?.length
                    ? m.selfReads.map(x => <HBar key={x.slug} label={x.title} value={x.count} max={maxSelf} />)
                    : <div style={s.empty}>No reads recorded yet.</div>}
                </Card>
                <Card title="Stories read per user" coverage={COVERAGE.perUser} err={errors.users} errPath="users">
                  {m.storiesPerUser
                    ? (<div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div><div style={s.bigNum}>{m.storiesPerUser.mean}</div><div style={s.bigNumSub}>Mean</div></div>
                        <div><div style={s.bigNum}>{m.storiesPerUser.median}</div><div style={s.bigNumSub}>Median</div></div>
                        <div><div style={s.bigNum}>{m.storiesPerUser.max}</div><div style={s.bigNumSub}>Max</div></div>
                        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: '0.78rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>
                          from {m.storiesPerUser.n} reader{m.storiesPerUser.n !== 1 ? 's' : ''}
                        </div>
                      </div>)
                    : <div style={s.empty}>No data.</div>}
                </Card>
              </div>
            </div>

            {/* ─── D. ENGAGEMENT BREADTH ────────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>D · Engagement Breadth</div>
              <div style={s.grid2}>
                <Card title="Social activity · in range" coverage={COVERAGE.breadth}>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    <div><div style={s.bigNum}>{m.commentsInRange ?? '—'}</div><div style={s.bigNumSub}>Comments</div></div>
                    <div><div style={s.bigNum}>{m.squarePostsInRange ?? '—'}</div><div style={s.bigNumSub}>Square posts</div></div>
                  </div>
                </Card>
                <Card title="Badge earn distribution" coverage={COVERAGE.badges} err={errors.badges} errPath="userBadges">
                  {m.badgeDist?.length
                    ? m.badgeDist.map(b => <HBar key={b.id} label={`${b.icon}  ${b.label}`} value={b.count} max={maxBadge} />)
                    : <div style={s.empty}>No badges earned in window.</div>}
                </Card>
                <Card title="Platform split · web / iOS / Android" coverage="Ships with Phase B instrumentation (metrics/daily/platform via /api/hit). No platform data is captured today.">
                  <div style={s.waiting}>Awaiting instrumentation — platform attribution is not stored yet. Arrives once the /api/hit piggyback + app OTA land.</div>
                </Card>
              </div>
            </div>

            {/* ─── E. QUIZ PERFORMANCE ──────────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>E · Quiz Performance</div>
              <div style={s.grid2}>
                <Card title="Attempts per story · top 10" coverage={COVERAGE.attempts} err={errors.stories} errPath="cms_stories">
                  {m.attemptsPerStory?.length
                    ? m.attemptsPerStory.map(x => <HBar key={x.slug} label={x.title} value={x.count} max={maxAttempts} />)
                    : <div style={s.empty}>No quiz attempts yet.</div>}
                </Card>
                <Card title="Tier distribution · top 5 attempted" coverage={COVERAGE.submissions} err={errors.submissions} errPath="quiz_submissions">
                  {m.tierDist?.length
                    ? (<>
                        {m.tierDist.map(x => <StackedTierBar key={x.slug} label={x.title} total={x.total} tiers={x.tiers} />)}
                        <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                          {TIER_ORDER.map(t => (
                            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: TIER_COLORS[t] }} />{t}
                            </span>
                          ))}
                        </div>
                      </>)
                    : <div style={s.empty}>No submissions in window.</div>}
                </Card>
                <Card title="Hardball pass rate · top 10 attempted" coverage={COVERAGE.submissions} err={errors.submissions} errPath="quiz_submissions">
                  {m.hardballPassRate?.length
                    ? m.hardballPassRate.map(x => <PassRateRow key={x.slug} label={x.title} total={x.total} rate={x.rate} />)
                    : <div style={s.empty}>No completed attempts in window.</div>}
                </Card>
                <Card title="Attempt → completion ratio · top 10" coverage={COVERAGE.completion} err={errors.stories || errors.submissions} errPath={errors.stories ? 'cms_stories' : 'quiz_submissions'}>
                  {range !== 'all'
                    ? <div style={s.waiting}>Shown at <strong>All time</strong> only — the attempt counter (cms_stories.quizMeta.attemptCount) carries no timestamps, so a windowed denominator would be dishonest. Switch the range to All time.</div>
                    : !m.completion?.length ? <div style={s.empty}>No quiz attempts yet.</div>
                    : m.completion.map(x => <PassRateRow key={x.slug} label={x.title} total={x.total} rate={x.ratio} />)}
                </Card>
              </div>
            </div>

            {/* ─── F. REWARDS ECONOMY ───────────────────────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>F · Rewards Economy</div>
              <div style={s.grid2}>
                <Card title="Total Scribbles · balance sum" coverage={COVERAGE.scribbles} err={errors.points} errPath="points">
                  <div style={{ ...s.bigNum, color: '#fcd34d' }}>{(m.totalScribbles ?? 0).toLocaleString('en-GB')}</div>
                  <div style={s.bigNumSub}>Sum of balances · not integrity-verified</div>
                </Card>
                <Card title="Payout requests · pending" coverage={COVERAGE.payouts} err={errors.payouts} errPath="payout_requests">
                  <div style={s.bigNum}>{m.pendingPayouts.length}</div>
                  <div style={s.bigNumSub}>{m.pendingPayouts.length === 0 ? 'Dormant — payouts not yet enabled' : `${m.pendingPayouts.length} awaiting review`}</div>
                </Card>
              </div>
            </div>

            {/* ─── G. MEMBERSHIP & CONVERSION (reserved) ────────────────── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>G · Membership & Conversion</div>
              <div style={s.grid2}>
                <Card title="Reserved · ships with paid tiers" coverage="No membership/subscription model exists yet. This section is a stub reserving free→paid conversion, MRR, and churn for when tiers ship (users/{uid}/membership).">
                  <div style={s.waiting}>Not yet built — reserved for conversion, MRR and churn once memberships exist.</div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
