'use client';
// The Gesture — tap / hold / morph for a BoundBook in shelf context.
//
// KNOWN RISK + MANDATED FALLBACK: the hold gesture misbehaved on iPad Safari in sandboxed
// mockup testing (the modal opened mid-hold and interrupted the physical hold). This module
// is structured so a single flag switches the whole behaviour:
//
//   HOLD_ENABLED = true  (specced): touchstart flips the book; a QUICK release (<HOLD_MS)
//                         lets the back cover breathe (BREATHE_MS) then morphs the modal
//                         open; held PAST HOLD_MS keeps the back cover up while the finger
//                         is down and opens the modal on release.
//   HOLD_ENABLED = false (fallback): tap flips and the back cover stays; a SECOND tap
//                         anywhere opens the modal. No timers at all.
//
// Ship with true; the device test (see DEVICE TEST MATRIX in the R4b report) decides.
//
// IRON RULE: no timer may open the modal while a finger is down. Every open path here is
// reached only from touchend / pointerup / click — never from a timer that fires mid-touch.
import { useCallback, useEffect, useRef, useState } from 'react';

export const HOLD_ENABLED = true;

const HOLD_MS = 450;      // quick-release threshold
const BREATHE_MS = 1250;  // back-cover breathe before the modal opens on a quick release
const MOVE_CANCEL_PX = 14; // touchmove beyond this = the user is scrolling, not tapping

export function useBookGesture({ onOpen }) {
  const [flipped, setFlipped] = useState(false);
  const bookRef = useRef(null);

  const startXY = useRef(null);
  const startAt = useRef(0);
  const cancelled = useRef(false);
  const fingerDown = useRef(false);
  const breatheTimer = useRef(null);
  const armedSecondTap = useRef(false); // fallback mode only
  const touchedAt = useRef(0);          // suppress the synthetic click after a touch

  const clearBreathe = () => {
    if (breatheTimer.current) { clearTimeout(breatheTimer.current); breatheTimer.current = null; }
  };

  const rect = useCallback(() => {
    const el = bookRef.current;
    return el ? el.getBoundingClientRect() : null;
  }, []);

  const openNow = useCallback(() => {
    armedSecondTap.current = false;
    onOpen?.(rect());
  }, [onOpen, rect]);

  const reset = useCallback(() => {
    clearBreathe();
    armedSecondTap.current = false;
    fingerDown.current = false;
    setFlipped(false);
  }, []);

  // ── Touch (raw touch events — NOT pointer events: Safari's long-press recogniser ends
  // pointer streams early, so a hold read via pointerup is unreliable on iPad). ──
  const onTouchStart = useCallback((e) => {
    touchedAt.current = Date.now();
    const t = e.touches[0];
    startXY.current = { x: t.clientX, y: t.clientY };
    startAt.current = Date.now();
    cancelled.current = false;
    fingerDown.current = true;
    clearBreathe();

    if (!HOLD_ENABLED && armedSecondTap.current) {
      // Fallback: a second tap (this one) opens the modal. Do not re-flip.
      openNow();
      return;
    }
    setFlipped(true); // flip on touchstart in both modes
  }, [openNow]);

  const onTouchMove = useCallback((e) => {
    if (!fingerDown.current || cancelled.current || !startXY.current) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - startXY.current.x);
    const dy = Math.abs(t.clientY - startXY.current.y);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
      // Scroll intent — quietly un-flip, no modal.
      cancelled.current = true;
      fingerDown.current = false;
      clearBreathe();
      armedSecondTap.current = false;
      setFlipped(false);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!fingerDown.current) return; // already cancelled by a move
    fingerDown.current = false;
    if (cancelled.current) return;

    if (!HOLD_ENABLED) {
      // Fallback: leave it flipped; arm the next tap (anywhere) to open.
      armedSecondTap.current = true;
      return;
    }

    const dt = Date.now() - startAt.current;
    if (dt < HOLD_MS) {
      // Quick release: breathe, then open. Finger is UP — this timer honours the IRON RULE.
      clearBreathe();
      breatheTimer.current = setTimeout(() => { breatheTimer.current = null; openNow(); }, BREATHE_MS);
    } else {
      // Held past the threshold, now released: open immediately.
      openNow();
    }
  }, [openNow]);

  const onContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  // ── Desktop (mouse): hover lift is CSS-only; a click runs the tap sequence. Guard against
  // the synthetic click browsers fire ~after a touchend so touch devices don't double-run. ──
  const onClick = useCallback(() => {
    if (Date.now() - touchedAt.current < 700) return; // came from touch — already handled
    if (!HOLD_ENABLED && armedSecondTap.current) { openNow(); return; }
    setFlipped(true);
    if (!HOLD_ENABLED) { armedSecondTap.current = true; return; }
    clearBreathe();
    breatheTimer.current = setTimeout(() => { breatheTimer.current = null; openNow(); }, BREATHE_MS);
  }, [openNow]);

  // Fallback mode: a second tap ANYWHERE (not just on the book) opens the modal.
  useEffect(() => {
    if (HOLD_ENABLED) return undefined;
    if (!flipped) return undefined;
    const handler = (ev) => {
      // Ignore the touch/click that just armed it (same gesture); only later taps open.
      if (Date.now() - startAt.current < 60) return;
      if (armedSecondTap.current) openNow();
    };
    document.addEventListener('touchstart', handler, { passive: true });
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('mousedown', handler);
    };
  }, [flipped, openNow]);

  useEffect(() => () => clearBreathe(), []);

  const bind = { onTouchStart, onTouchMove, onTouchEnd, onContextMenu, onClick };
  return { flipped, bind, bookRef, reset, rect };
}
