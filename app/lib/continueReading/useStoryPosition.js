'use client';
// CONTINUE READING on the story page (CR-2): where a signed-in reader stopped, saved; and, when they
// arrive from a card, the jump back there. docs/CONTINUE-READING.md §3–§4.
//
// SAVING. Nothing until the visit passes the read counter's own thresholds (12 s of foreground
// dwell, or 25% of the way through), whether or not the read was already counted. Then one write;
// after it, only when the fraction has moved SAVE_MIN_STEP and SAVE_MIN_INTERVAL_MS has passed; and
// one best-effort write when the tab is hidden or closed. The fraction is the reading thread's own
// measure (threadFraction), clamped 0..1. At the end-of-story marker the record is removed, and
// nothing more is written in that visit.
//
// NOTHING when signed out, on a proof page, or while the page shows the archive PREVIEW: the
// fraction of a preview is not a place in the story, and its end is not the story's end.
//
// RESUMING happens only from a card (RESUME_HASH). The hash is taken off the address at once, so a
// reload or a shared link opens at the top like any visit. Once the reader is known and the body
// has settled (the gate has answered, the fonts are in, two frames have laid out), the page jumps
// to the saved place: instantly, never smoothly (the site's CSS sets smooth scrolling, so the call
// says 'instant').
//
// EVERY FAILURE IS QUIET. Firebase is imported lazily, as the page's own reads are, and a refused
// write changes nothing on the page.
import { useEffect, useRef } from 'react';
import { STARTED_DWELL_MS, STARTED_SCROLL, RESUME_HASH } from './schema';
import { threadFraction, scrollForFraction, shouldSave } from './model';

const client = () => import('./client');

export function useStoryPosition({ slug, uid, getDB, proof, hasStory, preview, articleRef, articleMetrics, endSentinelRef, endReached, settled }) {
  const ended = useRef(false);
  const wantResume = useRef(false);

  // The card's hash: read once, then taken off the address.
  useEffect(() => {
    if (proof || typeof window === 'undefined') return;
    if (window.location.hash === RESUME_HASH) {
      wantResume.current = true;
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); } catch {}
    }
  }, [proof]);

  // The end-of-story marker: the record goes, and nothing more is written this visit. Only the
  // STORY's end counts — a preview's end is not. Two ways in: the page's own endReached (its
  // IntersectionObserver), and the saving loop below seeing the marker reached OR PASSED, because
  // one fast fling can carry the marker from below the screen to above it between two frames, and
  // an observer never sees it on screen at all.
  const finish = useRef(() => {});
  useEffect(() => {
    finish.current = () => {
      if (ended.current || preview || proof || !uid) return;
      ended.current = true;
      (async () => { try { const c = await client(); await c.clearPosition(await getDB(), uid, slug); } catch {} })();
    };
  });
  useEffect(() => { if (endReached) finish.current(); }, [endReached, preview, proof, uid]);

  // Saving.
  useEffect(() => {
    if (!uid || proof || !hasStory || preview || !slug) return undefined;
    let started = false;
    let last = null;          // { fraction, at } of the last write this visit
    let writing = false;
    let dwellMs = 0;
    let lastTick = document.visibilityState === 'visible' ? Date.now() : null;

    const fraction = () => threadFraction(articleMetrics.current, window.scrollY, window.innerHeight);
    // The marker reached or passed: its top at or above the line the page's own observer uses
    // (10% up from the viewport's foot).
    const atEnd = () => {
      const el = endSentinelRef?.current;
      return !!el && el.getBoundingClientRect().top <= window.innerHeight * 0.9;
    };
    const save = (opts) => {
      if (ended.current) return;
      if (atEnd()) { finish.current(); return; }
      if (!started || writing) return;
      const f = fraction();
      const now = Date.now();
      if (!shouldSave(f, last, now, opts)) return;
      writing = true;
      last = { fraction: f, at: now };
      (async () => {
        try { const c = await client(); await c.savePosition(await getDB(), uid, slug, f); } catch {} finally { writing = false; }
      })();
    };
    const start = () => { if (!started && !ended.current) { started = true; save(); } };

    const onScroll = () => {
      if (ended.current) return;
      if (atEnd()) { finish.current(); return; }
      if (!started) {
        const { top, height } = articleMetrics.current;
        const range = height - window.innerHeight;
        if (range > 0 && (window.scrollY - top) / range >= STARTED_SCROLL) start();
        return;
      }
      save();
    };
    const tick = () => {
      if (document.visibilityState !== 'visible') { lastTick = null; return; }
      const now = Date.now();
      if (lastTick != null) dwellMs += now - lastTick;
      lastTick = now;
      if (!started && dwellMs >= STARTED_DWELL_MS) start();
      else save();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') { lastTick = Date.now(); return; }
      lastTick = null;
      save({ force: true });
    };
    const onHide = () => save({ force: true });

    const interval = setInterval(tick, 1000);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [uid, proof, hasStory, preview, slug, getDB, articleMetrics, endSentinelRef]);

  // Resuming: once the reader is known and the body has settled.
  useEffect(() => {
    if (!wantResume.current || !uid || proof || !settled || !hasStory) return undefined;
    wantResume.current = false;
    let cancelled = false;
    (async () => {
      try {
        const c = await client();
        const rec = await c.readPosition(await getDB(), uid, slug);
        if (!rec || cancelled) return;
        try { await document.fonts?.ready; } catch {}
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const a = articleRef.current;
        if (!a || cancelled) return;
        const rect = a.getBoundingClientRect();
        const metrics = { top: rect.top + window.scrollY, height: rect.height };
        window.scrollTo({ top: scrollForFraction(metrics, window.innerHeight, rec.fraction), left: 0, behavior: 'instant' });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [uid, proof, settled, hasStory, slug, getDB, articleRef]);
}
