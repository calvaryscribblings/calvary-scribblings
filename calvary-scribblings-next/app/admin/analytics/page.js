'use client';
import { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { BADGES } from '../../lib/badges';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

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
  page:        { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header:      { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub:         { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body:        { maxWidth: 1100, margin: '0 auto', padding: '2.5rem 2rem 4rem' },
  topBar:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', gap: '1rem', flexWrap: 'wrap' },
  h2:          { fontSize: '1.75rem', fontWeight: 700, color: '#fff', margin: 0, fontFamily: "'Cochin', Georgia, serif" },
  h2sub:       { fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', marginTop: 4, fontFamily: 'Inter, sans-serif' },
  rangeRow:    { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' },
  chip:        { background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.12)', padding: '0.4rem 0.85rem', borderRadius: 999, fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.08em' },
  chipActive:  { background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' },
  refreshBtn:  { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.4rem 0.95rem', borderRadius: 6, fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', marginLeft: '0.5rem' },
  section:     { marginBottom: '2rem' },
  sectionTitle:{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.45)', marginBottom: '0.85rem', fontFamily: 'Inter, sans-serif' },
  grid2:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem' },
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '1.25rem' },
  cardTitle:   { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.45)', marginBottom: '1rem', fontFamily: 'Inter, sans-serif' },
  empty:       { fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', padding: '0.75rem 0' },
  errBox:      { fontSize: '0.78rem', color: '#f87171', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '0.65rem 0.85rem', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 },
  errPath:     { fontFamily: 'monospace', fontSize: '0.72rem', color: '#fca5a5', background: 'rgba(220,38,38,0.1)', padding: '0.05rem 0.35rem', borderRadius: 3 },
  bigNum:      { fontFamily: "'Cochin', Georgia, serif", fontSize: '2.5rem', color: '#a78bfa', lineHeight: 1.1 },
  bigNumSub:   { fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.3rem', fontFamily: 'Inter, sans-serif' },
  gate:        { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  loadingBar:  { height: 22, borderRadius: 4, background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite', marginBottom: '0.5rem' },
};

function HBar({ label, value, max, suffix }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.45rem' }}>
      <div title={label} style={{ flex: '0 0 38%', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif', fontSize: '0.78rem' }}>{label}</div>
      <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #6b2fad, #a78bfa)', borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ flex: '0 0 60px', textAlign: 'right', fontFamily: "'Cochin', Georgia, serif", fontSize: '1.05rem', color: '#c4b5fd' }}>
        {value}{suffix || ''}
      </div>
    </div>
  );
}

function StackedTierBar({ label, total, tiers }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
        <span title={label} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter, sans-serif', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{label}</span>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif', fontSize: '0.7rem' }}>{total} attempt{total !== 1 ? 's' : ''}</span>
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
      <div title={label} style={{ flex: 1, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter, sans-serif', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: '0 0 50px', textAlign: 'right', fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>n={total}</div>
      <div style={{ flex: '0 0 60px', textAlign: 'right', fontFamily: "'Cochin', Georgia, serif", fontSize: '1.2rem', color }}>{pct}%</div>
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
      <text x={P} y={14} fill="rgba(255,255,255,0.3)" fontSize="11" fontFamily="Inter, sans-serif">peak: {max}</text>
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
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.78rem', fontFamily: 'Inter, sans-serif' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, flexShrink: 0 }} />
            <span style={{ color: 'rgba(255,255,255,0.6)', flex: 1 }}>{b.label}</span>
            <span style={{ color: '#c4b5fd', fontFamily: "'Cochin', Georgia, serif", fontSize: '1rem' }}>{b.count}</span>
          </div>
        ))}
      </div>
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
  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

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

    const [stories, submissions, streaks, badges, users, points, payouts] = await Promise.all([
      fetchPath('cms_stories'),
      fetchPath('quiz_submissions'),
      fetchPath('userStreaks'),
      fetchPath('userBadges'),
      fetchPath('users'),
      fetchPath('points'),
      fetchPath('payout_requests'),
    ]);

    const next = { stories, submissions, streaks, badges, users, points, payouts };
    const errs = {};
    for (const [k, v] of Object.entries(next)) {
      if (!v.ok) errs[k] = v.error;
    }
    setRaw({
      stories:     stories.ok     ? stories.data     : null,
      submissions: submissions.ok ? submissions.data : null,
      streaks:     streaks.ok     ? streaks.data     : null,
      badges:      badges.ok      ? badges.data      : null,
      users:       users.ok       ? users.data       : null,
      points:      points.ok      ? points.data      : null,
      payouts:     payouts.ok     ? payouts.data     : null,
    });
    setErrors(errs);
    setLastFetched(Date.now());
    setFetching(false);
  }

  const metrics = useMemo(() => {
    if (!raw) return null;
    const rangeMs = RANGES.find(r => r.value === range)?.ms ?? Infinity;
    const cutoff = rangeMs === Infinity ? 0 : Date.now() - rangeMs;
    const now = Date.now();

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

    const titleFor = (slug) => raw.stories?.[slug]?.title || slug;

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

    const completion = raw.stories
      ? Object.entries(raw.stories)
          .map(([slug, st]) => {
            const total = st.quizMeta?.attemptCount || 0;
            const completed = (subsBySlug[slug] || []).filter(x => x.hardballPassed === true).length;
            return { slug, title: st.title || slug, total, completed, ratio: total > 0 ? completed / total : 0 };
          })
          .filter(x => x.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      : null;

    let active7 = 0, active30 = 0;
    if (raw.streaks) {
      for (const u of Object.values(raw.streaks)) {
        const lr = u?.lastReadAt;
        if (!lr) continue;
        if (lr >= now - 7 * 86400000)  active7++;
        if (lr >= now - 30 * 86400000) active30++;
      }
    }

    let dau = null;
    if (raw.streaks) {
      const buckets = new Array(30).fill(0);
      const todayDay = Math.floor(now / 86400000);
      for (const u of Object.values(raw.streaks)) {
        const lr = u?.lastReadAt;
        if (!lr) continue;
        const day = Math.floor(lr / 86400000);
        const idx = 29 - (todayDay - day);
        if (idx >= 0 && idx < 30) buckets[idx]++;
      }
      dau = buckets;
    }

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
          return BADGES.map(def => ({
            id: def.id, label: def.name, icon: def.icon,
            count: counts[def.id] || 0,
          })).sort((a, b) => b.count - a.count);
        })()
      : null;

    const storiesPerUser = raw.users
      ? (() => {
          const counts = Object.values(raw.users)
            .map(u => u?.readCount || 0)
            .filter(x => x > 0);
          if (counts.length === 0) return { mean: 0, median: 0, max: 0, n: 0 };
          const sorted = [...counts].sort((a, b) => a - b);
          const sum = counts.reduce((a, b) => a + b, 0);
          return {
            n: counts.length,
            mean: Math.round((sum / counts.length) * 10) / 10,
            median: sorted[Math.floor(sorted.length / 2)],
            max: sorted[sorted.length - 1],
          };
        })()
      : null;

    const mostRead = raw.users
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
      ? Object.entries(raw.payouts)
          .filter(([, p]) => p?.status === 'pending')
          .map(([id, p]) => ({ id, ...p }))
      : [];

    return {
      attemptsPerStory, tierDist, hardballPassRate, completion,
      active7, active30, dau, streakDist, badgeDist,
      storiesPerUser, mostRead, totalScribbles, pendingPayouts,
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
  const maxAttempts = m?.attemptsPerStory?.[0]?.count || 0;
  const maxBadge    = m?.badgeDist?.[0]?.count || 0;
  const maxRead     = m?.mostRead?.[0]?.count || 0;

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
              <button
                key={r.value}
                style={{ ...s.chip, ...(range === r.value ? s.chipActive : {}) }}
                onClick={() => setRange(r.value)}
              >
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

        {m && (
          <>
            <div style={s.section}>
              <div style={s.sectionTitle}>Quiz Performance</div>
              <div style={s.grid2}>

                <div style={s.card}>
                  <div style={s.cardTitle}>Attempts per story · top 10 (all-time)</div>
                  {errors.stories ? <CardError msg={errors.stories} path="cms_stories" />
                   : !m.attemptsPerStory?.length ? <div style={s.empty}>No quiz attempts yet.</div>
                   : m.attemptsPerStory.map(x => (
                       <HBar key={x.slug} label={x.title} value={x.count} max={maxAttempts} />
                     ))}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Tier distribution · top 5 most-attempted</div>
                  {errors.submissions ? <CardError msg={errors.submissions} path="quiz_submissions" />
                   : !m.tierDist?.length ? <div style={s.empty}>No submissions in window.</div>
                   : (<>
                       {m.tierDist.map(x => (
                         <StackedTierBar key={x.slug} label={x.title} total={x.total} tiers={x.tiers} />
                       ))}
                       <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                         {TIER_ORDER.map(t => (
                           <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', fontFamily: 'Inter, sans-serif', color: 'rgba(255,255,255,0.5)' }}>
                             <span style={{ width: 9, height: 9, borderRadius: 2, background: TIER_COLORS[t] }} />
                             {t}
                           </span>
                         ))}
                       </div>
                     </>)}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Hardball pass rate · top 10 most-attempted</div>
                  {errors.submissions ? <CardError msg={errors.submissions} path="quiz_submissions" />
                   : !m.hardballPassRate?.length ? <div style={s.empty}>No completed attempts in window.</div>
                   : m.hardballPassRate.map(x => (
                       <PassRateRow key={x.slug} label={x.title} total={x.total} rate={x.rate} />
                     ))}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Attempt → completion ratio · top 10</div>
                  {errors.stories || errors.submissions
                    ? <CardError msg={errors.stories || errors.submissions} path={errors.stories ? 'cms_stories' : 'quiz_submissions'} />
                    : !m.completion?.length ? <div style={s.empty}>No quiz attempts yet.</div>
                    : m.completion.map(x => (
                        <PassRateRow key={x.slug} label={x.title} total={x.total} rate={x.ratio} />
                      ))}
                </div>

              </div>
            </div>

            <div style={s.section}>
              <div style={s.sectionTitle}>Engagement</div>
              <div style={s.grid2}>

                <div style={s.card}>
                  <div style={s.cardTitle}>Active readers</div>
                  {errors.streaks ? <CardError msg={errors.streaks} path="userStreaks" />
                   : (<div style={{ display: 'flex', gap: '2rem' }}>
                       <div>
                         <div style={s.bigNum}>{m.active7}</div>
                         <div style={s.bigNumSub}>Last 7 days</div>
                       </div>
                       <div>
                         <div style={s.bigNum}>{m.active30}</div>
                         <div style={s.bigNumSub}>Last 30 days</div>
                       </div>
                     </div>)}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Daily active readers · last 30 days</div>
                  {errors.streaks ? <CardError msg={errors.streaks} path="userStreaks" />
                   : !m.dau ? <div style={s.empty}>No data.</div>
                   : <LineChart data={m.dau} />}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Streak distribution · current</div>
                  {errors.streaks ? <CardError msg={errors.streaks} path="userStreaks" />
                   : !m.streakDist ? <div style={s.empty}>No streak data.</div>
                   : <Donut buckets={m.streakDist} />}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Badge earn distribution</div>
                  {errors.badges ? <CardError msg={errors.badges} path="userBadges" />
                   : !m.badgeDist?.length ? <div style={s.empty}>No badges earned in window.</div>
                   : m.badgeDist.map(b => (
                       <HBar key={b.id} label={`${b.icon}  ${b.label}`} value={b.count} max={maxBadge} />
                     ))}
                </div>

              </div>
            </div>

            <div style={s.section}>
              <div style={s.sectionTitle}>Content</div>
              <div style={s.grid2}>

                <div style={s.card}>
                  <div style={s.cardTitle}>Stories read per user · all-time</div>
                  {errors.users ? <CardError msg={errors.users} path="users" />
                   : !m.storiesPerUser ? <div style={s.empty}>No data.</div>
                   : (<div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                       <div><div style={s.bigNum}>{m.storiesPerUser.mean}</div><div style={s.bigNumSub}>Mean</div></div>
                       <div><div style={s.bigNum}>{m.storiesPerUser.median}</div><div style={s.bigNumSub}>Median</div></div>
                       <div><div style={s.bigNum}>{m.storiesPerUser.max}</div><div style={s.bigNumSub}>Max</div></div>
                       <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>
                         from {m.storiesPerUser.n} reader{m.storiesPerUser.n !== 1 ? 's' : ''}
                       </div>
                     </div>)}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Most-read stories · top 10</div>
                  {errors.users ? <CardError msg={errors.users} path="users" />
                   : !m.mostRead?.length ? <div style={s.empty}>No reads yet.</div>
                   : m.mostRead.map(x => (
                       <HBar key={x.slug} label={x.title} value={x.count} max={maxRead} />
                     ))}
                </div>

              </div>
            </div>

            <div style={s.section}>
              <div style={s.sectionTitle}>Rewards</div>
              <div style={s.grid2}>

                <div style={s.card}>
                  <div style={s.cardTitle}>Total Scribbles · all-time balance</div>
                  {errors.points ? <CardError msg={errors.points} path="points" />
                   : <>
                       <div style={s.bigNum}>{(m.totalScribbles ?? 0).toLocaleString('en-GB')}</div>
                       <div style={s.bigNumSub}>Sum of every reader's current balance</div>
                     </>}
                </div>

                <div style={s.card}>
                  <div style={s.cardTitle}>Active payout requests · pending</div>
                  {errors.payouts ? <CardError msg={errors.payouts} path="payout_requests" />
                   : (<>
                       <div style={s.bigNum}>{m.pendingPayouts.length}</div>
                       <div style={s.bigNumSub}>
                         {m.pendingPayouts.length === 0
                           ? '0 pending — payouts not yet enabled'
                           : `${m.pendingPayouts.length} awaiting review`}
                       </div>
                       {m.pendingPayouts.length > 0 && (
                         <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                           {m.pendingPayouts.slice(0, 5).map(p => (
                             <div key={p.id} style={{ fontSize: '0.78rem', fontFamily: 'Inter, sans-serif', color: 'rgba(255,255,255,0.65)' }}>
                               {p.username || p.uid?.slice(0, 10) || p.id} · {p.amount || 0} Scribbles
                             </div>
                           ))}
                         </div>
                       )}
                     </>)}
                </div>

              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
