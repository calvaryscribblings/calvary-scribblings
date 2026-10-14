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
import { useReleaseRecheck } from '../../../lib/series/releaseRecheck';
import ReadingRoom from '../../../reader/[slug]/ReadingRoom';
import ArchiveLock from '../../../components/ArchiveLock';
import AuthModal from '../../../components/AuthModal';
import { SERIES_LOCK_COPY, SERIES_FREE_LOCK_COPY } from '../../../lib/archiveLock';
import { getInstalmentRow, getSeriesBySlug } from '../../../lib/series/loader';
import { notesEnabled, LINE_MAX, NOTES_COPY, checkLine } from '../../../lib/series/notes';
import { markFinished, saveMargin } from '../../../lib/series/notesClient';
import EndSheet from '../../../components/seriesNotes/EndSheet';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

// ── W46 §5 — THE LAST PAGE (Readers' Notes) ──────────────────────────────────────────────
//
// Everything below is behind notesEnabled(). With it false this register mounts the Reading
// Room with exactly the props it had before W46: no line chip, no sheet, no finished write, no
// extra read, and ?at= is ignored. See docs/series-notes.md.
//
//   · THE END. Reaching the last page (the frame's fraction >= 0.999, the same threshold as its
//     `ended`) writes series_finished/{uid}/{inst} with the server clock and only THEN mounts
//     the EndSheet: the room's gated reads depend on that record. A failed write is retried
//     once, then logged, and no sheet rises; reading is never blocked. The sheet rises again on
//     a later return to the last page, never twice without the reader leaving it.
//   · THE LINE. The frame's opt-in "This is my line" chip (setLineChip) posts lineChosen; the
//     line is saved to series_margin with the file's version, and one quiet notice says so.
//   · IN ITS PLACE. /series/read/{inst}?at={cfi}&v={version} opens at that CFI only when v is
//     the version on screen. A CFI is only trusted in the bytes it was taken in
//     (docs/reading-position-pin.md); otherwise the reader opens at their own place.
const NOTES_ON = notesEnabled();
const END_AT = 0.999;
const LINE_CHIP = Object.freeze({ maxChars: LINE_MAX, label: NOTES_COPY.thisIsMyLine });
const LINE_SAVED = 'Saved as your line.';
const LINE_NOT_SAVED = 'Your line wasn’t saved. Please try again.';
const NOTICE_MS = 3200;

export default function SeriesReaderClient({ instalmentId, sentinel }) {
  const { user, loading: authLoading } = useAuth() || {};

  const [epubUrl, setEpubUrl] = useState(null);
  const [epubVersion, setEpubVersion] = useState(null);
  // The sentinel is knowable from the prop on the first render, so it is resolved in the
  // initialiser rather than from the effect — no flash of "one moment" for an id that was
  // never going to open.
  const [gate, setGate] = useState(instalmentId === sentinel ? 'failed' : 'checking');
  const [gateMessage, setGateMessage] = useState(
    instalmentId === sentinel ? 'That instalment couldn’t be found.' : null,
  );
  const [releaseAtMs, setReleaseAtMs] = useState(null);
  // W40 — the endpoint says when a signed-out refusal is of a FREE instalment.
  const [openToFree, setOpenToFree] = useState(false);
  // Title and author for the reader's top bar. Read from series_instalments_detail, which the
  // rule opens only once the instalment has released — so this can only ever succeed for a
  // reader who is about to be shown the file anyway. A null here costs a fallback label, not
  // a failed open, which is why it is fetched alongside rather than awaited before.
  const [detail, setDetail] = useState(null);

  const retriedRef = useRef(false);

  // W37 — Sign in on the lock opens the same sign-in prompt as the instalment page, in place.
  // fetchUrl depends on `user`, so a sign-in asks the endpoint again and the lock gives way to
  // the instalment. The prompt is drawn beside whichever branch renders, so a new reader's
  // completion step is not unmounted when the lock does.
  const [showAuth, setShowAuth] = useState(false);
  const authPrompt = showAuth && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget) setShowAuth(false); }}>
      <AuthModal onClose={() => setShowAuth(false)} />
    </div>
  );

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
        setOpenToFree(e?.openToFree === true);
        setGate('signedout');
      } else if (code === 'tier_too_low') {
        setGate('locked');
        setGateMessage(e?.message || null);
      } else if (code === 'not_found') {
        setGate('failed');
        setGateMessage('That instalment couldn’t be found.');
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

  // W35 — "arrives on …" asks the endpoint again at that minute and when the tab comes back.
  // The endpoint decides on the server's clock; this only knocks.
  useReleaseRecheck(gate === 'notyet' && releaseAtMs ? [releaseAtMs] : [], fetchUrl);

  const handleHostError = useCallback(() => {
    if (retriedRef.current) { setGate('failed'); setGateMessage(null); return; }
    retriedRef.current = true;
    console.warn('[series-reader] reading room could not open the file — re-minting once');
    setEpubUrl(null);
    fetchUrl();
  }, [fetchUrl]);

  // ── W46 §5 — the last page, the line, the place. All inert unless NOTES_ON. ──────────────
  // { seriesId, ordinal, slug } for the sheet: the public row has the first two, the series
  // record the slug. Read alongside the detail, and only when the feature is on.
  const [notesCtx, setNotesCtx] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lineNotice, setLineNotice] = useState(null);
  // ?at=&v= — read once on the client (a static export has no request to read it from). An
  // initialiser rather than an effect: it only ever feeds the Reading Room's props, which are
  // never part of the server render, so there is nothing for hydration to disagree with.
  const [placeParam] = useState(() => {
    if (!NOTES_ON || typeof window === 'undefined') return null;
    try {
      const q = new URLSearchParams(window.location.search);
      const at = q.get('at');
      return at ? { at, v: q.get('v') || null } : null;
    } catch { return null; }
  });
  const endArmedRef = useRef(true);      // false from raising the sheet until the reader leaves the last page
  const atEndRef = useRef(false);
  const finishedRef = useRef(false);     // series_finished written by this mount
  const noticeTimer = useRef(null);
  // Read by raiseEnd, which is called from the frame's relocates and from the context load.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const ctxRef = useRef(null);

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const raiseEnd = useCallback(async () => {
    const u = userRef.current;
    if (!NOTES_ON || !u || !ctxRef.current || !endArmedRef.current) return;
    endArmedRef.current = false;
    if (!finishedRef.current) {
      // Before the sheet, always: the sheet's reads are gated on this record (§5).
      for (let attempt = 0; attempt < 2 && !finishedRef.current; attempt++) {
        try {
          await markFinished(u.uid, instalmentId);
          finishedRef.current = true;
        } catch (e) {
          if (attempt === 1) console.warn('[series-reader] series_finished not written; no sheet', e);
        }
      }
      if (!finishedRef.current) return;
    }
    // The reader may have turned back while the write was in flight.
    if (!atEndRef.current) return;
    setSheetOpen(true);
  }, [instalmentId]);

  useEffect(() => {
    if (!NOTES_ON || instalmentId === sentinel) return undefined;
    let cancelled = false;
    (async () => {
      const row = await getInstalmentRow(instalmentId);
      if (!row?.seriesId) return;
      const series = await getSeriesBySlug(row.seriesId);
      if (cancelled || !series) return;
      const ctx = { seriesId: row.seriesId, ordinal: row.ordinal ?? null, slug: series.slug || series.id };
      ctxRef.current = ctx;
      setNotesCtx(ctx);
      // The context can arrive after the reader is already on the last page (opened there).
      if (atEndRef.current) raiseEnd();
    })();
    return () => { cancelled = true; };
  }, [instalmentId, sentinel, raiseEnd]);

  const handleRelocate = useCallback(({ fraction }) => {
    const atEnd = typeof fraction === 'number' && fraction >= END_AT;
    atEndRef.current = atEnd;
    if (!atEnd) { endArmedRef.current = true; return; }
    raiseEnd();
  }, [raiseEnd]);
  const handleEnded = useCallback(() => { atEndRef.current = true; raiseEnd(); }, [raiseEnd]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const notice = useCallback((text) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setLineNotice(text);
    noticeTimer.current = setTimeout(() => setLineNotice(null), NOTICE_MS);
  }, []);

  const handleLineChosen = useCallback(async ({ text, cfi }) => {
    // No version, no line: a CFI without the bytes it was taken in cannot be trusted later.
    if (!user || !epubVersion) return;
    const checked = checkLine({ text, cfi, epubVersion });
    if (!checked.ok) return;
    try {
      await saveMargin(user.uid, instalmentId, checked.line);
      notice(LINE_SAVED);
    } catch (e) {
      console.warn('[series-reader] series_margin not written', e);
      notice(LINE_NOT_SAVED);
    }
  }, [user, epubVersion, instalmentId, notice]);

  const notesProps = NOTES_ON ? {
    lineChip: user && epubVersion ? LINE_CHIP : null,
    onLineChosen: handleLineChosen,
    openAt: placeParam?.at && placeParam.v && epubVersion && placeParam.v === epubVersion ? placeParam.at : null,
    keepChromeAtEnd: true,
    onRelocate: handleRelocate,
    onEnded: handleEnded,
  } : null;

  if (gate === 'reading' && epubUrl) {
    return (
      <>
      <ReadingRoom
        // 'book', not 'story': an instalment is a complete EPUB served from a gated bucket
        // behind a signed URL, which is the book register's shape in every respect that
        // matters to the Reading Room.
        register="book"
        // W15, ruling 21: indented paragraphs at the stories' 1.5em, not the files' 0.5cm.
        indent="series"
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
        {...notesProps}
      />
      {NOTES_ON && (
        // The room's one quiet word in the book. The live region is always mounted so the
        // notice is announced; the pill wears the Reading Room's own notice styling.
        <div role="status" aria-live="polite" data-line-notice="">
          {lineNotice && <div className="rr-resume-toast in rr-notice">{lineNotice}</div>}
        </div>
      )}
      {NOTES_ON && sheetOpen && notesCtx && user && (
        // series_finished is already written (raiseEnd) by the time this mounts.
        <div data-series-endsheet="open" data-inst={instalmentId} style={{ position: 'relative', zIndex: 85 }}>
          <EndSheet inst={instalmentId} ordinal={notesCtx.ordinal} slug={notesCtx.slug}
            seriesId={notesCtx.seriesId} user={user} onClose={closeSheet} />
        </div>
      )}
      {authPrompt}
      </>
    );
  }

  return (
    <>
      <Interstitial gate={gate} message={gateMessage} releaseAtMs={releaseAtMs} instalmentId={instalmentId} openToFree={openToFree} onSignIn={() => setShowAuth(true)} />
      {authPrompt}
    </>
  );
}

/**
 * The five non-reading states, each with its own sentence and its own next step.
 *
 * `notyet` deliberately offers NO action. There is nothing a reader can do about a release
 * date, and putting an upgrade button under it would be selling a membership against
 * something the membership does not accelerate.
 */
function Interstitial({ gate, message, releaseAtMs, instalmentId, onSignIn, openToFree = false }) {
  const copy = {
    checking: { head: 'One moment…', body: null, cta: null },
    notyet: {
      head: 'Not yet',
      body: releaseAtMs
        ? `This instalment arrives on ${formatRelease(releaseAtMs)}. Nobody can read it before then.`
        : 'This instalment hasn’t arrived yet.',
      cta: ['Back to The Series', '/series'],
    },
    signedout: {
      head: 'Sign in to read.',
      body: SERIES_LOCK_COPY.signedOutBody,
      cta: ['Sign in', '/account'],
    },
    locked: {
      head: 'Locked',
      body: message || 'The Series is a Platinum membership benefit.',
      cta: ['See memberships', '/membership'],
    },
    failed: {
      head: 'Couldn’t open this instalment.',
      body: message || 'Please try again in a moment.',
      cta: ['Back to The Series', '/series'],
    },
  }[gate] || { head: 'One moment…', body: null, cta: null };

  // W40 — free, signed out: the free lock, whose one button is the sign-in.
  if (gate === 'signedout' && openToFree) {
    return (
      <div style={{ background: '#080610', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 4%' }}>
        <div style={{ width: '100%' }} data-free-lock="">
          <ArchiveLock theme="dark" eyebrow={SERIES_FREE_LOCK_COPY.eyebrow} headline={SERIES_FREE_LOCK_COPY.headline}
            body={SERIES_FREE_LOCK_COPY.body} cta={{ label: SERIES_FREE_LOCK_COPY.cta, onClick: onSignIn }} />
        </div>
      </div>
    );
  }

  // W9: the two refusals are THE LOCK — the same component as the story archive, dark.
  if (gate === 'locked' || gate === 'signedout') {
    return (
      <div style={{ background: '#080610', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 4%' }}>
        <div style={{ width: '100%' }}>
          <ArchiveLock theme="dark" eyebrow={SERIES_LOCK_COPY.eyebrow} headline={SERIES_LOCK_COPY.headline}
            body={copy.body} cta={{ label: SERIES_LOCK_COPY.cta, href: '/membership' }}
            signIn={gate === 'signedout' ? { label: SERIES_LOCK_COPY.signIn, onClick: onSignIn } : null} />
        </div>
      </div>
    );
  }

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
