'use client';
// A SERIES AND ITS INSTALMENTS.
//
// The full list is rendered for everybody, signed out included, with the lock visible on each
// row. That is the design, not a leniency: a reader deciding whether Platinum is worth paying
// for needs to see what they would get and when the next one lands. What is never rendered is
// an unreleased instalment's title or author — those live in series_instalments_detail, which
// database.rules.json denies until releaseAtMs, so the loader simply gets null back and the
// row prints its ordinal and its date. See app/lib/series/loader.js on why a denial there is
// the gate working rather than an error.
//
// ── WHAT THIS COMPONENT MUST NOT DO ──────────────────────────────────────────────────────
//
// It must not decide entitlement. grantForInstalment() is called here ONLY to choose which
// sentence to print. The tap handler asks functions/api/series/stream.js, which runs the same
// function against the SERVER clock and its own admin-token read of the membership, and that
// answer is the only one that can produce a file. If the two disagree — a stale membership in
// context, a device clock an hour out — the reader sees a wrong lock and gets the right
// bytes, which is the correct direction for the two to fail in.
//
// ── WHY subscriptionTier AND NOT tier ────────────────────────────────────────────────────
//
// MembershipContext exposes both. `tier` is effectiveTier(), which folds in a day pass;
// `subscriptionTier` is the real membership. The Series reads the second, because
// app/lib/membershipPasses.js sets PASS_TIER = 'gold' and a £1 day pass therefore produces
// the same string a paid Gold membership does. Reading `tier` here would show an unlocked
// row to a pass-holder that the endpoint then refuses — the worst of both, since it advertises
// something and takes it away at the tap.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';
import { useMembership } from '../../lib/MembershipContext';
import { getSeriesPage } from '../../lib/series/loader';
import { useReliableLoad } from '../../lib/useReliable';
import Unavailable from '../../components/Unavailable';
import { grantForInstalment, refusalCopy, seriesGateOn } from '../../lib/series/access';
import { useGatePreview } from '../../lib/gatePreview';
import { formatRelease, shelfLine, instalmentLabel } from '../../lib/series/format';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

export default function SeriesDetailClient({ slug, sentinel }) {
  const router = useRouter();
  const { user } = useAuth() || {};
  // W4: the founder-only preview draws the rows as they will read after 30 Sept.
  const gatePreview = useGatePreview(user);
  const membership = useMembership() || {};
  // W2 / SER-01 — under a deadline, and a failed read is DRAWN (see page-instalment.js).
  // null still means not found; a failure is <Unavailable>, never "No such series."
  const page = useReliableLoad(
    () => (slug === sentinel ? null : getSeriesPage(slug, Date.now(), { throwOnError: true })),
    [slug, sentinel],
  );
  if (page.phase === 'loading') {
    return <Shell><p style={{ padding: '3rem 4%', color: 'rgba(245,240,232,0.62)', fontSize: 14 }}>Loading…</p></Shell>;
  }
  if (page.phase === 'failed') {
    return <Shell><Unavailable kind={page.failure} onRetry={page.retry} refreshing={page.refreshing} subject="this series" /></Shell>;
  }
  const data = page.data;
  if (data === null) {
    return (
      <Shell>
        <section style={{ padding: '5rem 4%', textAlign: 'center' }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: '1.8rem', color: '#f5f0e8', marginBottom: '0.75rem' }}>No such series.</h1>
          <Link href="/series" style={{ color: '#c9a84c', fontSize: 14 }}>← Back to The Series</Link>
        </section>
      </Shell>
    );
  }

  const { series, instalments } = data;
  // The REAL membership, never the pass-lifted one. See the header.
  // W4b: under the founder preview, the NON-MEMBER view — judged at 'free', as the endpoint does.
  const subscriptionTier = gatePreview ? 'free' : (membership.subscriptionTier || 'free');

  return (
    <Shell>
      <section style={{ padding: '2.5rem 4% 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(180deg, #14082a 0%, #080610 85%)' }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Decorative fill — the series title sits beside it in real text. */}
          {series.coverUrl && (
            <div
              role="presentation"
              style={{
                width: 132, aspectRatio: '2 / 3', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundImage: `url(${series.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
              }}
            />
          )}
          <div style={{ flex: '1 1 260px' }}>
            <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', display: 'block', marginBottom: 8 }}>The Series</span>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.7rem, 6vw, 2.5rem)', fontWeight: 600, color: '#f5f0e8', lineHeight: 1.1, margin: '0 0 8px' }}>{series.title}</h1>
            <p style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(245,240,232,0.45)', margin: '0 0 12px' }}>{shelfLine(instalments)}</p>
            <p style={{ fontFamily: DISPLAY, fontSize: 15, color: 'rgba(245,240,232,0.62)', lineHeight: 1.65, margin: 0, maxWidth: 520 }}>{series.synopsis}</p>
          </div>
        </div>
      </section>

      <ul style={{ listStyle: 'none', margin: 0, padding: '8px 4% 40px' }}>
        {instalments.map((inst) => (
          <InstalmentRow
            key={inst.id}
            inst={inst}
            subscriptionTier={subscriptionTier}
            effectiveTier={gatePreview ? 'free' : (membership.tier || 'free')}
            signedIn={!!user}
            forceGate={gatePreview}
            // R12.4: the row now opens the INSTALMENT PAGE, not the reader. The file is one
            // tap further away and that is the point — an instalment has a logline, a writer,
            // a reading time and a sponsor credit, and a row that jumped straight into the
            // EPUB gave none of them anywhere to live. The gate is unmoved either way: the
            // page renders from the same denied detail node, and the reader route still asks
            // functions/api/series/stream.js for every byte.
            onOpen={() => router.push(`/series/instalment/${inst.id}`)}
          />
        ))}
        {instalments.length === 0 && (
          <li style={{ padding: '2.5rem 0', color: 'rgba(245,240,232,0.35)', fontSize: 14 }}>
            No instalments listed yet.
          </li>
        )}
      </ul>
    </Shell>
  );
}

function InstalmentRow({ inst, subscriptionTier, effectiveTier, signedIn, onOpen, forceGate = false }) {
  // Advisory only — this picks a sentence, it does not open a file. See the header.
  const grant = grantForInstalment(inst, { subscriptionTier, effectiveTier, signedIn, forceGate });
  const open = grant.access === 'granted';
  const detail = inst.detail;

  // An unreleased instalment has NO detail record to read from, by rule. The row shows what
  // the public row knows — its number and its date — and nothing more.
  const heading = detail?.title || instalmentLabel(inst.ordinal);
  const sub = detail?.title ? instalmentLabel(inst.ordinal) : null;

  return (
    <li style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        type="button"
        onClick={open ? onOpen : undefined}
        disabled={!open}
        style={{
          display: 'flex', width: '100%', gap: 14, alignItems: 'center', textAlign: 'left',
          background: 'none', border: 'none', padding: '16px 0',
          cursor: open ? 'pointer' : 'default', fontFamily: BODY,
        }}
      >
        <span style={{
          fontFamily: LABEL, fontSize: 13, minWidth: 34, textAlign: 'center',
          color: open ? '#c9a84c' : 'rgba(245,240,232,0.25)',
        }}>{inst.ordinal}</span>

        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: DISPLAY, fontSize: 16, color: open ? '#f5f0e8' : 'rgba(245,240,232,0.55)', lineHeight: 1.3 }}>
            {heading}
          </span>
          {sub && (
            <span style={{ display: 'block', fontSize: 11, color: 'rgba(245,240,232,0.32)', marginTop: 2 }}>{sub}</span>
          )}
          {!open && (
            <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(245,240,232,0.42)', marginTop: 4 }}>
              {grant.reason === 'not_released'
                ? `Arrives ${formatRelease(inst.releaseAtMs) || 'soon'}`
                : refusalCopy(grant)}
            </span>
          )}
          {/* The Gold badge is a statement about the TIER gate, so it only means anything
              while that gate is up. With the flag off every instalment is open to everyone
              and badging one of them "Open to Gold" would read as a restriction on the
              others — the opposite of what is true. */}
          {open && (seriesGateOn() || forceGate) && inst.freeForGold && (
            <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: LABEL, color: '#c9a84c', marginTop: 4 }}>
              Open to Gold
            </span>
          )}
        </span>

        <span aria-hidden style={{ fontSize: 15, color: open ? '#c9a84c' : 'rgba(245,240,232,0.28)' }}>
          {open ? '›' : '🔒'}
        </span>
      </button>
    </li>
  );
}

function Shell({ children }) {
  return (
    <div style={{ background: '#080610', minHeight: '100vh', fontFamily: BODY }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,6,16,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/series" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <span
            role="presentation"
            style={{ width: 38, height: 38, borderRadius: 7, backgroundImage: 'url(/logo-header.jpg)', backgroundSize: 'cover', display: 'block' }}
          />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </Link>
        <Link href="/membership" style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', textDecoration: 'none' }}>Membership</Link>
      </nav>
      {children}
    </div>
  );
}
