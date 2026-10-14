'use client';
// READERS' NOTES — THE DOOR (W46, §3). It stands beside (under 720px) or beneath (720px and up)
// each series' poster card on /series, and is drawn from PUBLIC data only: the series'
// instalment rows, series_notes_summary/{sid} and series_questions_public.
//
//   open:    READERS' NOTES · INSTALMENT {N} · the latest Sit with this (italic) · up to four
//            faces and "{n} answers" · "{n} new" since this device last stepped inside ·
//            the threshold, "Step inside" and an arrow.
//   no Sit question yet: the counts and "Step inside", without a question.
//   closed:  "Opens {weekday}" (or the date, past a week) · "The first three questions arrive
//            with instalment I, on {date}." · a gold keyhole · no light · no remind button.
//
// The light under the door follows the room's lastAt (doorLight), and breathes only within an
// hour of a note (doorBreathes), never under reduced motion (NOTES_CSS).
//
// While the door is on screen the room is prefetched: the route (router.prefetch) and the
// room's public reads (warmRoom), so stepping inside paints from cache.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NOTES_COPY, doorState, instName, newSince, lastVisitKey, roomHref, notesEnabled } from '../../lib/series/notes';
import { readLocal } from '../../lib/series/notesClient';
import { C, DISPLAY, labelStyle } from './tokens';
import { ArrowIcon, Faces, KeyholeIcon } from './Parts';
import { lightOpacity } from './roomModel';
import { warmRoom } from './roomData';

/** The door's stylesheet. Included once by the page that draws doors. */
export const DOOR_CSS = `
.sn-door { position: relative; display: block; box-sizing: border-box; text-decoration: none; color: inherit; border-radius: 12px; border: 1px solid rgba(201,168,76,0.32); background: #0d0a18; overflow: hidden; }
.sn-door-frame { position: absolute; inset: 6px; border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; pointer-events: none; }
.sn-door-light { position: absolute; left: 0; right: 0; bottom: 0; height: 62%; pointer-events: none; background: radial-gradient(130% 82% at 50% 100%, rgba(214,178,92,0.34), rgba(124,58,237,0.16), transparent); }
.sn-door-edge { position: absolute; left: 6px; right: 6px; bottom: 6px; height: 1px; background: rgba(240,212,140,0.75); pointer-events: none; }
.sn-door-in { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 16px 14px 12px; box-sizing: border-box; height: 100%; }
.sn-door-q { font-family: ${DISPLAY}; font-style: italic; font-weight: 500; font-size: 19px; line-height: 1.3; color: ${C.cream}; margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.sn-door-sill { margin-top: auto; border-top: 1px solid rgba(201,168,76,0.30); padding-top: 2px; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sn-door:hover { border-color: rgba(201,168,76,0.55); }
`;

export default function Door({ series, rows, summary, sitByInst }) {
  const router = useRouter();
  const ref = useRef(null);
  const [now] = useState(() => Date.now());
  const enabled = notesEnabled();
  // The device-kept last visit. Doors draw only after the shelf's client-side read, never in
  // the server's markup, so reading the device here cannot disagree with a hydrated render.
  const lastVisit = enabled && series?.id ? Number(readLocal(lastVisitKey(series.id))) || null : null;

  const state = enabled ? doorState({ rows, summary, sitByInst, now }) : null;
  const href = state?.phase === 'open' ? roomHref(series.slug, state.inst) : null;

  // Prefetch while the door is on screen.
  useEffect(() => {
    if (!href || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        try { router.prefetch(href); } catch { /* best effort */ }
        warmRoom(series.slug);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [href, router, series?.slug]);

  if (!enabled || !state) return null;

  if (state.phase === 'closed') {
    return (
      <div ref={ref} className="sn-door" data-door="closed" data-light="none">
        <span className="sn-door-frame" aria-hidden="true" />
        <div className="sn-door-in">
          <span style={labelStyle(C.gold, 9.5)}>{NOTES_COPY.kicker}</span>
          {state.opensLabel && <span style={{ ...labelStyle(C.goldTint, 9.5) }}>{NOTES_COPY.opensOn(state.opensLabel)}</span>}
          {state.firstDate && <p style={{ fontFamily: DISPLAY, fontSize: 16, lineHeight: 1.4, color: C.muted, margin: 0 }}>{NOTES_COPY.firstQuestions(state.firstDate)}</p>}
          <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', paddingBottom: 6 }}><KeyholeIcon /></span>
        </div>
      </div>
    );
  }

  const fresh = newSince(summary?.latestNotes, lastVisit);
  const op = lightOpacity(state.light);
  const lead = summary?.byInst?.[state.inst] || {};
  return (
    <Link ref={ref} href={href} prefetch className="sn-door" data-door="open" data-light={state.light} data-breathes={state.breathes ? 'true' : 'false'}>
      <span className="sn-door-frame" aria-hidden="true" />
      {op > 0 && (
        <>
          <span className={`sn-door-light${state.breathes ? ' sn-breathes' : ''}`} aria-hidden="true" style={{ opacity: op, '--sn-light': op }} />
          <span className="sn-door-edge" aria-hidden="true" style={{ opacity: op }} />
        </>
      )}
      <span className="sn-door-in">
        <span style={labelStyle(C.gold, 9.5)}>{NOTES_COPY.kicker}</span>
        <span style={labelStyle(C.muted, 9)}>{instName(state.ordinal).toUpperCase()}</span>
        {state.sit ? (
          <>
            <span className="sn-door-q" data-door-sit>{state.sit}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Faces faces={state.faces} />
              <span style={{ fontFamily: DISPLAY, fontSize: 15, color: C.muted }}>{NOTES_COPY.answers(state.answers)}</span>
            </span>
          </>
        ) : (
          <span style={{ fontFamily: DISPLAY, fontSize: 16, color: C.muted }}>{NOTES_COPY.heroCounts(Number(lead.notes) || 0, Number(lead.readers) || 0)}</span>
        )}
        {fresh > 0 && <span data-door-new style={{ ...labelStyle(C.goldTint, 9), letterSpacing: '0.2em' }}>{NOTES_COPY.newSince(fresh)}</span>}
        <span className="sn-door-sill">
          <span style={{ fontFamily: DISPLAY, fontSize: 17, color: C.cream }}>{NOTES_COPY.stepInside}</span>
          <ArrowIcon color={C.goldTint} />
        </span>
      </span>
    </Link>
  );
}
