'use client';
// THE DESIDERATA ROOM — W22 §5. Rulings 75, 76 and 79–81, drawn from the canvas "Book Store rooms".
//
// Every row has its own BUY on the checkout already proven: there is no basket before a real
// two-book purchase works on both rails. A book the reader holds never shows, and loading the
// room quietly removes its entry. A title no longer on the shelves does not show, but its entry
// stays. Newest first. Nothing flashes before the list has loaded: until the reader's list, their
// library and the shelves are all in, the room shows its head and nothing under it.

import { useEffect, useRef, useState } from 'react';
import RoomFrame from '../components/RoomFrame';
import { RoomRow, ROOM_ROW_CSS } from '../components/RoomRow';
import { DESIDERATA_CSS } from '../components/Desiderata';
import AuthModal from '../../components/AuthModal';
import Unavailable from '../../components/Unavailable';
import { useReliableLoad } from '../../lib/useReliable';
import { getAllPublishedTitles, getGenres } from '../../lib/bookstore/loader';
import { genreLabel as labelOf } from '../../lib/bookstore/genres';
import { DESIDERATA_COPY as COPY, roomRows, titlesLabel } from '../../lib/bookstore/desiderata';
import { useDesiderata, sweepDesiderata } from '../../lib/bookstore/desiderataStore';

export default function DesiderataRoom() {
  return (
    <RoomFrame room={COPY.name} css={`${DESIDERATA_CSS}${ROOM_ROW_CSS}${ROOM_CSS}`}>
      <DesiderataList />
    </RoomFrame>
  );
}

function DesiderataList() {
  const d = useDesiderata();
  const [showAuth, setShowAuth] = useState(false);
  // The shelves: the storefront's own visibility (published, publisher not suspended).
  const shelf = useReliableLoad(async () => {
    const [titles, genres] = await Promise.all([getAllPublishedTitles({ throwOnError: true }), getGenres()]);
    const byId = {};
    for (const t of titles) byId[t.id] = t;
    return { byId, genres };
  }, []);

  const signedOut = d.status === 'signed-out';
  const ready = d.status === 'ready' && !!shelf.data;
  const { rows, sweep } = ready ? roomRows(d.entries, shelf.data.byId, d.owned) : { rows: [], sweep: [] };

  // The quiet clean-up, once per reader per visit: a held book's entry goes. No toast.
  const swept = useRef(null);
  const sweepKey = ready ? `${d.uid}:${sweep.join(',')}` : null;
  useEffect(() => {
    if (!sweepKey || !sweep.length || swept.current === sweepKey) return;
    swept.current = sweepKey;
    sweepDesiderata(sweep);
  }, [sweepKey, sweep]);

  return (
    <>
      <header className="dr-head">
        <h1 className="dr-h1">{COPY.name}</h1>
        <p className="dr-sub">{COPY.subline}</p>
        {/* The count's line is reserved from the first frame, so nothing moves when it lands. */}
        <div className="dr-count" data-testid="desiderata-count" aria-hidden={!(ready && rows.length) || undefined}
          style={{ visibility: ready && rows.length ? 'visible' : 'hidden' }}>
          {ready && rows.length ? titlesLabel(rows.length) : ' '}
        </div>
      </header>

      {signedOut && (
        <div className="dr-note" data-testid="desiderata-signed-out">
          <p>{COPY.signedOut}</p>
          <button type="button" className="rr-buy dr-signin" onClick={() => setShowAuth(true)}>{COPY.signIn}</button>
        </div>
      )}

      {!signedOut && shelf.phase === 'failed' && (
        <Unavailable kind={shelf.failure} onRetry={shelf.retry} refreshing={shelf.refreshing} subject="your Desiderata" />
      )}

      {ready && rows.length === 0 && (
        <p className="dr-note" data-testid="desiderata-empty">{COPY.empty}</p>
      )}

      {ready && rows.length > 0 && (
        <>
          <div className="dr-list" data-testid="desiderata-list">
            {rows.map(({ title }) => (
              <RoomRow key={title.id} title={title} genre={labelOf(shelf.data.genres, title.genre)} shop />
            ))}
          </div>
          <p className="dr-foot">{COPY.foot}</p>
        </>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

// ── THE HEAD, THE LIST, THE FOOT — the canvas at 641px and up, the app's numbers at 640 ─────
// ⚠ Template literal: no backticks in these comments.
const ROOM_CSS = `
  /* 30px under the breadcrumb: CHOSEN on the canvas. */
  .dr-head{margin-top:30px}
  .dr-h1{margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:64px;line-height:64px;color:#c9a44c}
  .dr-sub{margin:12px 0 0;font-style:italic;font-size:18px;line-height:23px;color:rgba(240,234,216,.5)}
  /* .hero-edition's type: Cinzel .6rem, .28em, gold .6 — "1 TITLE" / "N TITLES", the hero's rule. */
  .dr-count{margin-top:16px;font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.28em;text-transform:uppercase;color:rgba(201,164,76,.6)}
  .dr-list{margin-top:24px;border-top:1px solid rgba(201,164,76,.14)}
  .dr-foot{margin:24px 0 0;font-style:italic;font-size:16px;line-height:22px;color:rgba(240,234,216,.5)}
  /* The empty and signed-out states take the foot line's voice, where the list would begin. */
  .dr-note{margin:24px 0 0;font-style:italic;font-size:16px;line-height:22px;color:rgba(240,234,216,.5)}
  .dr-note p{margin:0}
  .dr-signin{margin-top:16px}
  @media(max-width:640px){
    .dr-h1{font-size:44px;line-height:44px}
    .dr-sub{margin-top:10px;font-size:17px;line-height:22px}
    .dr-count{margin-top:14px;font-size:8.3px;line-height:12px;letter-spacing:2.5px}
  }
`;
