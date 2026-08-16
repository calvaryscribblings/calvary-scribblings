'use client';
// ONE INSTALMENT — the page a reader lands on before they open the file.
//
// ── EVERY WORD ON THE UPPER HALF COMES FROM THE DENIED NODE, AND THAT IS THE DESIGN ──────
//
// Title, logline, cover, author and sponsor all live on series_instalments_detail/{id}, which
// database.rules.json refuses to anybody until releaseAtMs has passed on the RTDB SERVER
// clock. This component never reads them from anywhere else and has no fallback that could
// supply them, so an unreleased instalment's logline and its sponsor are invisible for exactly
// the reason its title already was: there is no path from this file to those bytes.
//
// The loader helps rather than hopes — getInstalmentPage() skips the detail read entirely
// while isReleased() is false, so the request is not made rather than made and refused. That
// is a second, independent refusal in front of the rule, not a substitute for it; see the note
// on that function in app/lib/series/loader.js.
//
// WHAT IS RENDERED BEFORE RELEASE is built from the PUBLIC row alone — the ordinal, the date,
// and the parent series' own public title. Precisely what a locked row on the series page
// already prints, and nothing this page adds changes that set.
//
// ── SMALL CAPS APPEAR ONCE ───────────────────────────────────────────────────────────────
//
// The eyebrow, and nowhere else BELOW THE NAV. The three credit labels are plain sentence case
// and so is the sponsor line and the button, deliberately: the house style reaches for
// letterspaced caps for section kickers, and a page that used them for the kicker AND the
// three credits AND the button AND the sponsor preamble would read as five competing headers
// with no hierarchy between them. One kicker, then quiet text, then one gold action.
//
// The nav's own "Membership" link keeps its caps. That is site chrome, identical on /series
// and /series/{slug}, and re-styling it here would make this one page's header disagree with
// every other page's for the sake of a rule about this page's body.
//
// ── THIS COMPONENT DOES NOT DECIDE ENTITLEMENT ───────────────────────────────────────────
//
// Same contract as app/series/[slug]/page-detail.js. grantForInstalment() is consulted for one
// thing — which sentence goes under the button — and functions/api/series/stream.js is the
// only thing whose answer can produce a file. subscriptionTier, never `tier`: a £1 day pass
// lifts the second and the Series does not honour passes, so reading `tier` here would show an
// unlocked button that the endpoint then refuses.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/AuthContext';
import { useMembership } from '../../../lib/MembershipContext';
import { getInstalmentPage } from '../../../lib/series/loader';
import { grantForInstalment, refusalCopy } from '../../../lib/series/access';
import {
  formatRelease, instalmentLabel, instalmentEyebrow, readActionLabel,
  releaseCreditLabel, readingTimeLabel, SPONSOR_PREAMBLE,
} from '../../../lib/series/format';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

const GOLD = '#c9a84c';
const PAGE = '#080610';
const INK = '#f5f0e8';

export default function InstalmentDetailClient({ instalmentId, sentinel }) {
  const router = useRouter();
  const { user } = useAuth() || {};
  const membership = useMembership() || {};
  // undefined = loading, null = no such instalment. Resolved in the INITIALISER for the
  // sentinel, which is knowable from the props on the first render — painting a loading state
  // for an id that was never going to resolve is a flash of nothing.
  const [data, setData] = useState(instalmentId === sentinel ? null : undefined);

  useEffect(() => {
    if (instalmentId === sentinel) return undefined;
    let cancelled = false;
    (async () => {
      const page = await getInstalmentPage(instalmentId);
      if (!cancelled) setData(page);
    })();
    return () => { cancelled = true; };
  }, [instalmentId, sentinel]);

  if (data === undefined) {
    return <Shell><p style={{ padding: '3rem 6%', color: 'rgba(245,240,232,0.35)', fontSize: 14 }}>Loading…</p></Shell>;
  }
  if (data === null) return <Missing />;

  const { row, series, detail, released } = data;

  // The unreleased page. No detail record exists to render from and none was asked for.
  if (!released) return <NotYet series={series} row={row} />;

  // Advisory only — this picks a sentence and a destination, it does not open a file.
  const grant = grantForInstalment(row, {
    subscriptionTier: membership.subscriptionTier || 'free',
    effectiveTier: membership.tier || 'free',
    signedIn: !!user,
  });
  const open = grant.access === 'granted';

  const reading = readingTimeLabel(detail?.wordCount);

  return (
    <Shell>
      <Hero
        coverUrl={detail?.coverUrl}
        eyebrow={instalmentEyebrow(series.title, row.ordinal)}
        title={detail?.title || instalmentLabel(row.ordinal)}
        logline={detail?.logline}
      />

      {/* The three credits. Each is a plain sentence-case label over its value — see the
          header on why none of these are small caps. `reading time` is omitted rather than
          zeroed when the EPUB has not been counted: readingTimeLabel() returns null and a
          missing credit is honest where "0 min" would be a confident lie. */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '1.5rem 6% 0' }}>
        <Credit label="written by" value={detail?.author} />
        <Credit label={releaseCreditLabel(row.releaseAtMs)} value={formatRelease(row.releaseAtMs)} />
        <Credit label="reading time" value={reading} />
      </div>

      {/* THE ONE ACTION. Gold, full width, and the only button on the page. When the tier gate
          is up and this reader is not covered, it becomes the honest button instead — showing
          "Read Instalment 2" over a file the endpoint will refuse advertises something and
          then takes it away at the tap. */}
      <div style={{ padding: '1.75rem 6% 0' }}>
        <button
          type="button"
          onClick={() => router.push(open ? `/series/read/${row.id}` : '/membership')}
          style={{
            display: 'block', width: '100%', border: 'none', cursor: 'pointer',
            borderRadius: 5, padding: '0.95rem 1rem',
            fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, letterSpacing: '0.01em',
            background: open ? GOLD : 'transparent',
            color: open ? PAGE : GOLD,
            boxShadow: open ? 'none' : `inset 0 0 0 1px ${GOLD}`,
          }}
        >
          {open ? readActionLabel(row.ordinal) : 'See memberships'}
        </button>
        {!open && (
          <p style={{ fontFamily: BODY, fontSize: 12.5, color: 'rgba(245,240,232,0.42)', margin: '10px 0 0', textAlign: 'center' }}>
            {refusalCopy(grant)}
          </p>
        )}
      </div>

      <Sponsor name={detail?.sponsorName} logoUrl={detail?.sponsorLogoUrl} />
    </Shell>
  );
}

/**
 * The band. The instalment's own art, fading to the page background at the bottom, with the
 * eyebrow, title and logline sitting over the faded part.
 *
 * The gradient's LAST STOP IS THE PAGE COLOUR EXACTLY. Anything else — a near-black, an alpha
 * that stops at 0.95 — leaves a visible seam where the band meets the page, which on a dark
 * layout reads as a rendering fault rather than as a design.
 *
 * padding-top rather than a fixed height, so the art gets a predictable share of the viewport
 * and the text block below it is free to be one line or four without cropping the face in the
 * cover or leaving a gap under a short logline.
 */
function Hero({ coverUrl, eyebrow, title, logline }) {
  return (
    <header
      style={{
        position: 'relative',
        paddingTop: 'clamp(190px, 42vh, 400px)',
        // Decorative fill, not a content image: the title is directly beneath it in real text,
        // so there is nothing for alt to say. Same call as the series poster and the shelf.
        backgroundImage: coverUrl ? `url(${coverUrl})` : 'linear-gradient(160deg, #1a0f2e, #0d0a18)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(180deg, rgba(8,6,16,0.10) 0%, rgba(8,6,16,0.40) 42%, rgba(8,6,16,0.88) 74%, ${PAGE} 100%)`,
        }}
      />
      <div style={{ position: 'relative', padding: '0 6% 0.25rem' }}>
        {/* THE ONE PLACE CAPS ARE USED ON THIS PAGE. */}
        <span style={{
          display: 'block', fontFamily: LABEL, fontSize: 9.5, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: GOLD, marginBottom: 10,
        }}>
          {eyebrow}
        </span>
        <h1 style={{
          fontFamily: DISPLAY, fontSize: 'clamp(1.9rem, 7.5vw, 3rem)', fontWeight: 600,
          color: INK, lineHeight: 1.08, margin: 0,
        }}>
          {title}
        </h1>
        {logline && (
          <p style={{
            fontFamily: DISPLAY, fontStyle: 'italic', fontSize: 'clamp(15px, 4vw, 17px)',
            color: 'rgba(245,240,232,0.62)', lineHeight: 1.55, margin: '10px 0 0', maxWidth: 540,
          }}>
            {logline}
          </p>
        )}
      </div>
    </header>
  );
}

/** One credit: a small plain-sentence-case label over its value. Renders nothing with no
 *  value, so a missing reading time leaves two credits rather than a labelled blank. */
function Credit({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ flex: '1 1 90px', minWidth: 90 }}>
      <span style={{
        display: 'block', fontFamily: BODY, fontSize: 11, color: 'rgba(245,240,232,0.33)',
        marginBottom: 3, textTransform: 'none', letterSpacing: 0,
      }}>
        {label}
      </span>
      <span style={{ display: 'block', fontFamily: DISPLAY, fontSize: 15, color: 'rgba(245,240,232,0.85)', lineHeight: 1.3 }}>
        {value}
      </span>
    </div>
  );
}

/**
 * The sponsor credit. LAST, and quieter than everything above it.
 *
 * A magazine's sponsor line, not a website's ad slot: a hairline rule, a small tile, two short
 * lines of dim text, and no background band, no border box, no colour of its own. If it ever
 * starts looking like a banner, it has stopped being a credit.
 *
 * A name with NO logo renders as the two lines alone — perfectly good. The reverse cannot
 * happen: validateInstalmentDetail() refuses a sponsorLogoUrl with no sponsorName, because an
 * unattributed mark over a blank second line is indistinguishable from a bug.
 */
function Sponsor({ name, logoUrl }) {
  if (!name) return null;
  return (
    <aside style={{
      display: 'flex', alignItems: 'center', gap: 12,
      margin: '2.75rem 6% 3.5rem', paddingTop: '1.15rem',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      {logoUrl && (
        <span
          role="presentation"
          style={{
            flex: '0 0 auto', width: 42, height: 42, borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.035)',
            backgroundImage: `url(${logoUrl})`, backgroundSize: 'contain',
            backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: BODY, fontSize: 11, color: 'rgba(245,240,232,0.28)', lineHeight: 1.4 }}>
          {SPONSOR_PREAMBLE}
        </span>
        <span style={{ display: 'block', fontFamily: DISPLAY, fontSize: 13.5, color: 'rgba(245,240,232,0.55)', lineHeight: 1.4 }}>
          {name}
        </span>
      </span>
    </aside>
  );
}

/**
 * The page before release. Built from the PUBLIC row and the PUBLIC parent series — an
 * ordinal, a date, and the series' own title. No cover, because the cover is on the denied
 * node too; no logline, no sponsor, no author, and no code path here that could produce one.
 *
 * NO ACTION, deliberately, matching the reader's `notyet` interstitial. There is nothing a
 * reader can do about a release date and an upgrade button under one would be selling a
 * membership against something no membership accelerates.
 */
function NotYet({ series, row }) {
  const when = formatRelease(row.releaseAtMs);
  return (
    <Shell>
      <section style={{ padding: '4.5rem 6% 4rem', maxWidth: 520 }}>
        <span style={{
          display: 'block', fontFamily: LABEL, fontSize: 9.5, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: GOLD, marginBottom: 12,
        }}>
          {instalmentEyebrow(series.title, row.ordinal)}
        </span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.9rem, 7.5vw, 3rem)', fontWeight: 600, color: INK, lineHeight: 1.08, margin: '0 0 12px' }}>
          Not yet.
        </h1>
        <p style={{ fontFamily: DISPLAY, fontSize: 16, color: 'rgba(245,240,232,0.55)', lineHeight: 1.6, margin: '0 0 22px' }}>
          {when
            ? `This instalment arrives on ${when}. Nobody can read it before then.`
            : 'This instalment has not arrived yet.'}
        </p>
        <Link href={`/series/${series.slug}`} style={{ fontFamily: BODY, fontSize: 14, color: GOLD, textDecoration: 'none' }}>
          ← {series.title}
        </Link>
      </section>
    </Shell>
  );
}

function Missing() {
  return (
    <Shell>
      <section style={{ padding: '5rem 6%', textAlign: 'center' }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.8rem', color: INK, marginBottom: '0.75rem' }}>No such instalment.</h1>
        <Link href="/series" style={{ color: GOLD, fontSize: 14 }}>← Back to The Series</Link>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ background: PAGE, minHeight: '100vh', fontFamily: BODY }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,6,16,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/series" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <span
            role="presentation"
            style={{ width: 38, height: 38, borderRadius: 7, backgroundImage: 'url(/logo-header.jpg)', backgroundSize: 'cover', display: 'block' }}
          />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </Link>
        <Link href="/membership" style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, textDecoration: 'none' }}>Membership</Link>
      </nav>
      {children}
    </div>
  );
}
