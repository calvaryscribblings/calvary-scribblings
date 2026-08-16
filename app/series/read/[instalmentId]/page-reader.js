'use client';
// THE INSTALMENT READER — the third register on the existing Reading Room.
//
// Structurally the bookstore's purchased path (app/reader/[slug]/book-reader.js): a gate
// machine in front of one <ReadingRoom epubSource={signedUrl} />. Reusing that component
// rather than writing a reader is the whole reason an instalment is "its own separate,
// complete EPUB" — a complete EPUB is exactly what the Reading Room already opens.
//
// ── THE GATE MACHINE ─────────────────────────────────────────────────────────────────────
//
//   checking → reading | notyet | signedout | locked | failed
//
// FIVE STATES, NOT THREE, and the two extra ones are the Series' own. `notyet` is a release
// that has not happened and is shown to EVERYONE including a Platinum member; `locked` is a
// membership that does not cover this instalment. The bookstore has no analogue of the first
// and only one flavour of the second. Collapsing them would tell a paying member that next
// month's instalment is not for their tier — see app/lib/series/access.js on why release is
// evaluated before tier everywhere, including here.
//
// ── THE ONE-SHOT RE-MINT ─────────────────────────────────────────────────────────────────
//
// The signed URL lives ~300s, which only has to cover the Reading Room's single fetch at
// load. If that fetch fails — an expired signature, a dropped connection, a cold bucket — we
// re-mint ONCE. A retry loop against a genuinely missing file would hammer the endpoint and
// the bucket, so the latch is one-way per mount, exactly as in book-reader.js.
//
// ── THE POSITION PIN ─────────────────────────────────────────────────────────────────────
//
// `version` from the endpoint is the Cloud Storage generation of THIS instalment's
// master.epub, held in state rather than read once: the re-mint above can legitimately return
// a different version (the object was replaced between the failed fetch and the retry) and a
// position saved afterwards must be pinned to the copy on screen, not the one that failed to
// open. Positions are keyed per instalment at series_reading_progress/{uid}/{instalmentId} —
// see app/lib/series/reading-position.js for why they could not share the bookstore's node.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../lib/AuthContext';
import { requestInstalmentUrl } from '../../../lib/series/stream';
import { getInstalmentDetail } from '../../../lib/series/loader';
import { positionPath } from '../../../lib/series/reading-position';
import { formatRelease } from '../../../lib/series/format';
import ReadingRoom from '../../../reader/[slug]/ReadingRoom';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

export default function SeriesReaderClient({ instalmentId, sentinel }) {
  const { user, loading: authLoading } = useAuth() || {};

  const [epubUrl, setEpubUrl] = useState(null);
  const [epubVersion, setEpubVersion] = useState(null);
  // The sentinel is knowable from the prop on the first render, so it is resolved in the
  // initialiser rather than from the effect — no flash of "one moment" for an id that was
  // never going to open.
  const [gate, setGate] = useState(instalmentId === sentinel ? 'failed' : 'checking');
  const [gateMessage, setGateMessage] = useState(
    instalmentId === sentinel ? 'That instalment could not be found.' : null,
  );
  const [releaseAtMs, setReleaseAtMs] = useState(null);
  // Title and author for the reader's top bar. Read from series_instalments_detail, which the
  // rule opens only once the instalment has released — so this can only ever succeed for a
  // reader who is about to be shown the file anyway. A null here costs a fallback label, not
  // a failed open, which is why it is fetched alongside rather than awaited before.
  const [detail, setDetail] = useState(null);

  const retriedRef = useRef(false);

  const fetchUrl = useCallback(async () => {
    setGate('checking');
    setGateMessage(null);
    try {
      const { url, version } = await requestInstalmentUrl(user, instalmentId);
      setEpubUrl(url);
      setEpubVersion(version || null);
      setGate('reading');
      return true;
    } catch (e) {
      const code = e?.code;
      if (code === 'not_released') {
        setReleaseAtMs(e.releaseAtMs || null);
        setGate('notyet');
      } else if (code === 'signed_out') {
        setGate('signedout');
      } else if (code === 'tier_too_low') {
        setGate('locked');
        setGateMessage(e?.message || null);
      } else if (code === 'not_found') {
        setGate('failed');
        setGateMessage('That instalment could not be found.');
      } else {
        console.error('[series-reader] stream request failed', e);
        setGate('failed');
        setGateMessage(e?.message || null);
      }
      return false;
    }
  }, [user, instalmentId]);

  useEffect(() => {
    if (instalmentId === sentinel) return;
    // Waits for auth to settle. Firing while `user` is still resolving would ask the endpoint
    // as a signed-out reader and produce a spurious sign-in prompt for a Platinum member —
    // the same beat book-reader.js folds into its own 'checking' state.
    if (authLoading) return undefined;
    let cancelled = false;
    // Both requests fire together and neither waits on the other: the detail read only
    // supplies a title for the top bar, and making the open wait on it would put an RTDB
    // round-trip in front of every instalment for a label the reader can live without.
    (async () => {
      await fetchUrl();
      const d = await getInstalmentDetail(instalmentId);
      if (!cancelled) setDetail(d);
    })();
    return () => { cancelled = true; };
  }, [authLoading, fetchUrl, instalmentId, sentinel]);

  const handleHostError = useCallback(() => {
    if (retriedRef.current) { setGate('failed'); setGateMessage(null); return; }
    retriedRef.current = true;
    console.warn('[series-reader] reading room could not open the file — re-minting once');
    setEpubUrl(null);
    fetchUrl();
  }, [fetchUrl]);

  if (gate === 'reading' && epubUrl) {
    return (
      <ReadingRoom
        // 'book', not 'story': an instalment is a complete EPUB served from a gated bucket
        // behind a signed URL, which is the book register's shape in every respect that
        // matters to the Reading Room.
        register="book"
        epubSource={epubUrl}
        meta={{ slug: instalmentId, title: detail?.title || instalmentId, author: detail?.author || '' }}
        escape={{ href: '/series', label: 'The Series' }}
        user={user || null}
        ribbons={!!user}
        // The register's own node, with the pin. `pin` is the Cloud Storage generation of THIS
        // instalment's file — see app/lib/series/reading-position.js for why an instalment
        // could not share the bookstore's progress node, and docs/reading-position-pin.md for
        // what the pin is doing.
        progress={{ path: (uid) => positionPath(uid, instalmentId), pin: epubVersion }}
        // No renderFailure, deliberately — same choice the book register makes. Supplying one
        // would show the reader an error overlay; we would rather spend the first failure on
        // a silent re-mint and only surface it if that fails too.
        onError={handleHostError}
      />
    );
  }

  return <Interstitial gate={gate} message={gateMessage} releaseAtMs={releaseAtMs} instalmentId={instalmentId} />;
}

/**
 * The five non-reading states, each with its own sentence and its own next step.
 *
 * `notyet` deliberately offers NO action. There is nothing a reader can do about a release
 * date, and putting an upgrade button under it would be selling a membership against
 * something the membership does not accelerate.
 */
function Interstitial({ gate, message, releaseAtMs, instalmentId }) {
  const copy = {
    checking: { head: 'One moment…', body: null, cta: null },
    notyet: {
      head: 'Not yet.',
      body: releaseAtMs
        ? `This instalment arrives on ${formatRelease(releaseAtMs)}. Nobody can read it before then.`
        : 'This instalment has not arrived yet.',
      cta: ['Back to The Series', '/series'],
    },
    signedout: {
      head: 'Sign in to read.',
      body: 'The Series comes with a Gold or Platinum membership.',
      cta: ['Sign in', '/account'],
    },
    locked: {
      head: 'Locked.',
      body: message || 'The Series is a Platinum membership benefit.',
      cta: ['See memberships', '/membership'],
    },
    failed: {
      head: 'Could not open this instalment.',
      body: message || 'Please try again in a moment.',
      cta: ['Back to The Series', '/series'],
    },
  }[gate] || { head: 'One moment…', body: null, cta: null };

  return (
    <div style={{ background: '#080610', minHeight: '100vh', fontFamily: BODY, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4%' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', display: 'block', marginBottom: 14 }}>
          The Series
        </span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.9rem', fontWeight: 600, color: '#f5f0e8', margin: '0 0 10px' }}>{copy.head}</h1>
        {copy.body && (
          <p style={{ fontFamily: DISPLAY, fontSize: 15, color: 'rgba(245,240,232,0.55)', lineHeight: 1.65, margin: '0 0 22px' }}>{copy.body}</p>
        )}
        {copy.cta && (
          <a
            href={copy.cta[1]}
            style={{ display: 'inline-block', fontFamily: LABEL, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#080610', background: '#c9a84c', padding: '0.8rem 1.6rem', borderRadius: 4, textDecoration: 'none' }}
          >
            {copy.cta[0]}
          </a>
        )}
        <p style={{ marginTop: 26, fontSize: 10, color: 'rgba(245,240,232,0.2)' }}>{instalmentId}</p>
      </div>
    </div>
  );
}
