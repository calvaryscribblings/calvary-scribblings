'use client';
// ─────────────────────────────────────────────────────────────────────────────
// THE BOOK REGISTER (R7.1) — an adapter, not a reader.
//
// It resolves ENTITLEMENT and hands ./ReadingRoom.js an epubSource. Three cases for a
// published bookstore title:
//   1. ?sample=1 AND the title has a samplePath  → the PUBLIC sample EPUB, opened in the
//      Reading Room with a sample banner riding on the chrome.
//   2. no ?sample=1, and the reader OWNS the book → /api/bookstore/stream mints a
//      short-lived signed URL to the master EPUB, opened in the same Reading Room.
//   3. no ?sample=1 and no purchase → a clean interstitial carrying the real buy button.
//
// The master EPUB is `allow read: if false` in storage.rules and stays that way. Case 2
// does not relax anything: functions/api/bookstore/stream.js checks the purchase
// server-side and returns a GCS V4 signed URL, which is a Cloud-Storage-level grant
// evaluated before Firebase's rule layer. The browser never holds a credential that could
// reach the file on its own.
//
// WHAT R7.1 CHANGED HERE
//   • The duplicate src builder and paper map are gone — ReadingRoom owns the one of each.
//   • The bare fixed night bar is gone. Chrome is the Reading Room's, coloured by the
//     reader's paper on this register exactly as on the story register.
//   • Both cases now get the FULL room: Contents, Search, the Typesetter, the footer and
//     the gold thread. Purchased books additionally get working ribbons
//     (readerBookmarks is owner-only per database.rules.json:81) — samples do not, because
//     a sample shares its slug with the purchased copy and the two would collide until
//     R7.2 namespaces them.
//
// WHAT IT DELIBERATELY DID NOT CHANGE
//   • Zero writes to any public-library node: no read hits, no streaks, no badges, no
//     readStories/readCount, no quiz. A bookstore read is not a Story Island read.
//   • No progress save or restore. users/{uid}/readerProgress sits under a world-readable
//     node (database.rules.json:117-119); a purchased reading position waits for R7.2's
//     private node and its rules change. Writing nothing beats writing it there.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import AuthModal from '../../components/AuthModal';
import BuyButton from '../../bookstore/components/BuyButton';
import { requestStreamUrl } from '../../lib/bookstore/stream';
import { formatCatalogueNumber } from '../../bookstore/components/fields';
import ReadingRoom from './ReadingRoom';

function readSampleFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sample') === '1';
}

export default function BookstoreReaderClient({ slug, title }) {
  const isSample = readSampleFlag() && !!title.samplePath;
  const { user, loading: authLoading } = useAuth();

  const [epubUrl, setEpubUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // Purchased path only. 'checking' covers both the auth resolution and the stream request,
  // so the reader sees one continuous beat rather than a spinner that stutters between two.
  //   checking → reading | signedout | not_purchased | revoked | failed
  const [gate, setGate] = useState('checking');
  const [gateMessage, setGateMessage] = useState(null);

  // The signed URL lives ~300s, which only has to cover the Reading Room's single fetch at
  // load. If that fetch fails — expired token, dropped connection, a cold bucket — we
  // re-mint ONCE and let the iframe try again. A retry loop on a genuinely missing file
  // would hammer both the endpoint and the bucket, so the latch is one-way per mount.
  const retriedRef = useRef(false);

  const fetchStreamUrl = useCallback(async () => {
    setGate('checking');
    setGateMessage(null);
    try {
      const { url } = await requestStreamUrl(user, title.id);
      setEpubUrl(url);
      setGate('reading');
      return true;
    } catch (e) {
      const code = e?.code;
      if (code === 'not_purchased') setGate('not_purchased');
      else if (code === 'revoked') setGate('revoked');
      else if (code === 'signed_out') setGate('signedout');
      else {
        console.error('[book-reader] stream request failed', e);
        setGate('failed');
        setGateMessage(e?.message || null);
      }
      return false;
    }
  }, [user, title.id]);

  // The iframe's own open-failure report is the only place a dead signed URL surfaces.
  // The Reading Room forwards it here; samples ignore it, exactly as before.
  const handleHostError = useCallback(() => {
    if (isSample) return;
    if (retriedRef.current) {
      setGate('failed');
      setGateMessage(null);
      return;
    }
    retriedRef.current = true;
    console.warn('[book-reader] reading room could not open the file — re-minting once');
    setEpubUrl(null);
    fetchStreamUrl();
  }, [isSample, fetchStreamUrl]);

  // R7.4 — the house glossary is passed on BOTH paths below, sample included. A sample
  // reader meeting the book's own vocabulary is the selling moment, not a privilege of
  // purchase; withholding it would withhold the best evidence that this book was made by
  // people who care about its words.
  //
  // ── Sample: the public sample EPUB, straight from Storage. ──
  useEffect(() => {
    if (!isSample) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { storage } = await import('../../lib/firebase');
        const { ref, getDownloadURL } = await import('firebase/storage');
        const url = await getDownloadURL(ref(storage, title.samplePath));
        if (!cancelled) setEpubUrl(url);
      } catch (e) {
        console.error('[book-reader] sample download URL failed', e);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isSample, title.samplePath]);

  // ── Purchased: entitlement check + signed URL. ──
  useEffect(() => {
    if (isSample) return undefined;
    if (authLoading) { setGate('checking'); return undefined; }
    if (!user) { setGate('signedout'); return undefined; }
    let cancelled = false;
    (async () => {
      // fetchStreamUrl owns the state transitions; the guard only stops a resolved request
      // from writing state after an unmount or a fast user swap.
      if (!cancelled) await fetchStreamUrl();
    })();
    return () => { cancelled = true; };
  }, [isSample, authLoading, user, fetchStreamUrl]);

  // Styles for the PRE-READING frame only — the gates below. Everything inside the Reading
  // Room is styled by the room.
  const styles = (
    <style>{`
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%;background:#1a0f0a}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      .br-center{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(107,47,173,.18) 0%,transparent 68%),#1a0f0a}
      .br-spin{width:34px;height:34px;border:2px solid rgba(201,164,76,.2);border-top-color:#c9a44c;border-radius:50%;animation:spin .9s linear infinite}
      .br-wait{margin-top:1.4rem;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,164,76,.5)}
      /* The interstitial's buy button, matching the storefront's face. BuyButton renders its
         own failure line beneath, in the catalogue's voice. */
      .br-buy{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#1a0f0a;background:#c9a44c;border:1px solid #c9a44c;border-radius:3px;padding:.85rem 2rem;cursor:pointer}
      .br-buy:hover:not(:disabled){background:#e0bb63;border-color:#e0bb63}
      .br-buy:disabled{opacity:.6;cursor:default}
      .br-alt{margin-top:1.1rem;font-family:'Cinzel',serif;font-size:.55rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(201,164,76,.6);text-decoration:none}
      .br-alt:hover{color:#c9a44c}
      .br-kicker{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.28em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.4rem}
      .br-orn{font-size:.9rem;letter-spacing:.4em;color:rgba(201,164,76,.35);margin-bottom:1.5rem}
      .br-h1{font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(1.5rem,4vw,2.2rem);font-weight:300;font-style:italic;color:#f5efe0;line-height:1.2;margin-bottom:.6rem;max-width:520px}
      .br-p{font-size:1rem;color:rgba(240,234,216,.5);font-style:italic;max-width:440px;line-height:1.7;margin-bottom:2.2rem}
      .br-link{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;text-decoration:none;border:1px solid rgba(201,164,76,.4);border-radius:3px;padding:.85rem 2rem;background:rgba(201,164,76,.04)}
    `}</style>
  );

  const gateShell = (children) => (
    <div style={{ width: '100vw', height: '100dvh', background: '#1a0f0a', overflow: 'hidden', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
      {styles}
      {children}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );

  // ── The endings ─────────────────────────────────────────────────────────────
  // Purchased: the colophon. A printer's last page — the book closing on itself, not a
  // shop window. Rendered as an OVERLAY by the Reading Room, so the frame underneath keeps
  // its place and 'Back to book' is never a reload.
  // R7.2: the mark the whole catalogue now shows — 'CS 007'. No isbn/id fallback: an ISBN
  // is a different number for a different purpose, and a push key is not a catalogue mark.
  // Absent catalogueNumber ⇒ the line is simply not printed.
  const catalogueMark = formatCatalogueNumber(title.catalogueNumber);
  const colophon = () => (
    <div className="rr-colo">
      <div className="rr-colo-fleuron">&#10086;</div>
      <div className="rr-colo-title">{title.title}</div>
      <div className="rr-colo-rule" />
      <div className="rr-colo-cat">
        {catalogueMark && <>{catalogueMark}<br /></>}
        Calvary Scribblings
      </div>
      <p className="rr-colo-note">Set in the Reading Room.<br />Thank you for reading.</p>
      <a href="/my-library" className="rr-ebtn">Return to your Library</a>
    </div>
  );

  // Sample: the purchase moment the sample never had. R7.0's matrix recorded the host
  // firing 'ended' into a void here — the reader simply stopped at the last page.
  const sampleEnding = ({ close }) => (
    <div className="rr-colo">
      <div className="rr-colo-fleuron">&#10086;</div>
      <div className="rr-colo-cat">End of sample</div>
      <div className="rr-colo-rule" />
      <div className="rr-colo-title">{title.title}</div>
      <p className="rr-colo-note">That is as far as the sample goes. The rest is waiting in the Book Store.</p>
      <BuyButton title={title} className="br-buy" align="center" />
      <div style={{ marginTop: '1.6rem', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="rr-ebtn" onClick={close}>← Back to the sample</button>
        <a href={`/bookstore/${slug}`} className="rr-ebtn">View in the Book Store</a>
      </div>
      {/* The buy button's face, carried into the ending. The gate stylesheet is not
          mounted while reading — it paints the pre-reading frame's night ground, which
          has no business behind a paper-coloured room. */}
      <style>{`
        .br-buy{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#1a0f0a;background:#c9a44c;border:1px solid #c9a44c;border-radius:3px;padding:.85rem 2rem;cursor:pointer;margin-top:.4rem}
        .br-buy:hover:not(:disabled){background:#e0bb63;border-color:#e0bb63}
        .br-buy:disabled{opacity:.6;cursor:default}
      `}</style>
    </div>
  );

  // ── The cover splash ────────────────────────────────────────────────────────
  // The same bound-book opening a story gets: fleuron, the bound cover at its own ratio,
  // title, author, and a one-way tap to begin. The binding treatment is the Reading Room's
  // (.rr-cbind / .rr-cimg), so a book and a story open with the same gesture and the same
  // object. coverUrl is required on published titles; the guard is for drafts previewed by
  // an admin, where the splash degrades to type alone rather than a broken image.
  const coverSplash = (
    <>
      <div className="rr-corn">&#10022; &#10022; &#10022;</div>
      {title.coverUrl && (
        <div className="rr-cbind"><img src={title.coverUrl} alt={title.title} className="rr-cimg" /></div>
      )}
      <div className="rr-ctitle">{title.title}</div>
      <div className="rr-cauthor">by {title.author}</div>
      <div className="rr-ccta">{isSample ? 'Open the sample' : 'Open to begin reading'}</div>
    </>
  );

  // PRIVATE reading position. bookstore_reading_progress/{uid}/{titleId} is owner-only and
  // shape-validated (R7.2 rules). Keyed by titleId — the bookstore_titles push key — not by
  // slug: a slug can be re-pointed by an editor, a purchase never can. Samples pass nothing.
  const bookProgress = useMemo(
    () => ({ path: (uid) => `bookstore_reading_progress/${uid}/${title.id}` }),
    [title.id],
  );

  // ── Sample mode ─────────────────────────────────────────────────────────────
  if (isSample) {
    if (loadError) {
      return gateShell(
        <div className="br-center">
          <p className="br-p">We couldn&rsquo;t load this sample just now.</p>
          <a href={`/bookstore/${slug}`} className="br-link">Back to the Book Store →</a>
        </div>
      );
    }
    if (!epubUrl) {
      return gateShell(<div className="br-center"><div className="br-spin" /></div>);
    }
    return (
      <>
        <ReadingRoom
          register="book"
          sample
          epubSource={epubUrl}
          meta={{ slug, title: title.title, author: title.author }}
          escape={{ href: `/bookstore/${slug}`, label: '← Store' }}
          user={user}
          coverSplash={coverSplash}
          glossary={title.glossary || null}
          banner={(
            <div className="rr-banner">
              <span className="rr-banner-label">Sample · {title.title}</span>
              <a href={`/bookstore/${slug}`} className="rr-banner-cta">Get the full book →</a>
            </div>
          )}
          renderEnding={sampleEnding}
        />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  // ── Purchased path ──────────────────────────────────────────────────────────
  if (gate === 'reading' && epubUrl) {
    return (
      <>
        <ReadingRoom
          register="book"
          epubSource={epubUrl}
          meta={{ slug, title: title.title, author: title.author }}
          escape={{ href: '/my-library', label: '← Library' }}
          user={user}
          ribbons
          progress={bookProgress}
          coverSplash={coverSplash}
          glossary={title.glossary || null}
          renderEnding={colophon}
          onError={handleHostError}
          onRequireAuth={() => setShowAuth(true)}
        />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  if (gate === 'checking') {
    return gateShell(
      <div className="br-center">
        <div className="br-spin" />
        <div className="br-wait">Unlocking your copy</div>
      </div>
    );
  }

  if (gate === 'signedout') {
    return gateShell(
      <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
        <div className="br-orn">&#10086;</div>
        <div className="br-kicker">Your Library</div>
        <h1 className="br-h1">{title.title}</h1>
        <p className="br-p">Sign in to open the copy on your shelf.</p>
        <button type="button" className="br-buy" onClick={() => setShowAuth(true)}>Sign in</button>
        <a className="br-alt" href={`/bookstore/${slug}`}>View in the Book Store →</a>
      </div>
    );
  }

  if (gate === 'revoked') {
    return gateShell(
      <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
        <div className="br-orn">&#10086;</div>
        <div className="br-kicker">Access Withdrawn</div>
        <h1 className="br-h1">{title.title}</h1>
        <p className="br-p">
          Access to this book was withdrawn — usually after a refund or a disputed payment. If that
          looks wrong, do get in touch.
        </p>
        <a href={`/bookstore/${slug}`} className="br-link">View in the Book Store →</a>
      </div>
    );
  }

  if (gate === 'failed') {
    return gateShell(
      <div className="br-center">
        <p className="br-p" style={{ marginBottom: '1.6rem' }}>
          {gateMessage || 'We couldn’t open your copy just now.'}
        </p>
        <button
          type="button"
          className="br-buy"
          onClick={() => { retriedRef.current = false; setEpubUrl(null); fetchStreamUrl(); }}
        >
          Try again
        </button>
        <a className="br-alt" href="/my-library">Back to My Library →</a>
      </div>
    );
  }

  // gate === 'not_purchased' — the interstitial, carrying the working buy button rather
  // than a link to the page that has one. Same copy, one fewer tap to a sale.
  return gateShell(
    <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
      <div className="br-orn">&#10086;</div>
      <div className="br-kicker">In the Book Store</div>
      <h1 className="br-h1">{title.title}</h1>
      <p className="br-p">This book is available in the Book Store.</p>
      <BuyButton title={title} className="br-buy" align="center" />
      <a className="br-alt" href={`/bookstore/${slug}`}>View in the Book Store →</a>
    </div>
  );
}
