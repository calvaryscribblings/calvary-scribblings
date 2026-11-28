'use client';
// CONTINUE READING (CR-2) — the row under the hero on /public-library. Design approved 24 Nov 2026;
// rulings 28 Nov 2026. The contract the app reads and writes by is docs/CONTINUE-READING.md.
//
// IT DRAWS NOTHING UNTIL IT HAS CARDS. The page mounts it only for a signed-in reader, and it renders
// null while its reads are in flight, while the membership is still settling (a card must never
// flash a lock it doesn't have), and when nothing is started. No skeleton, no reserved space: it
// arrives below the first screen, so arriving late moves nothing the reader is looking at.
//
// THE READS: reading_position/{uid}, series_reading_progress/{uid}, series_finished/{uid}; story
// facts from the index the page already holds (`allStories`); per started instalment at most its
// row, its detail and its series (app/lib/continueReading/client.js).
//
// THE CARD, as drawn: 300 × 146, the cover 96 × 144 flush left, the text block padded 14/16, the
// kind line, the title (two lines at most), the writer, the minutes (or the lock and "Members"),
// and the shared bar (app/components/ReadingBar.js) pinned to the foot so every bar in the row sits
// level. The ✕ is a real button BESIDE the card's link, not inside it: shown on hover and on
// keyboard focus, and always on a touch screen, where there is no hover.
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/firebaseCore';
import { useMembership } from '../lib/MembershipContext';
import CoverImage from './CoverImage';
import ReadingBar from './ReadingBar';
import { SHELF_SECTION_STYLE, SHELF_STRIP_STYLE, ShelfRowHeader, justAddedWriterStyle, DISPLAY, LABEL } from './libraryShelf';
import { loadEntries, loadInstalments, hideCard } from '../lib/continueReading/client';
import { resolveCards, minutesLine } from '../lib/continueReading/model';
import { RESUME_HASH } from '../lib/continueReading/schema';

export const CR_KICKER = 'Where you left off';
export const CR_TITLE = 'Continue Reading';

const CSS = `
  .cr-card { position: relative; flex: 0 0 auto; width: 300px; height: 146px; box-sizing: border-box; border-radius: 12px; overflow: hidden;
    background: rgba(107,47,173,0.08); border: 1px solid rgba(107,47,173,0.28); box-shadow: 0 4px 20px rgba(107,47,173,0.15); transition: border-color 0.2s; }
  .cr-card:hover, .cr-card:focus-within { border-color: rgba(107,47,173,0.6); }
  .cr-link { display: flex; height: 100%; text-decoration: none; color: inherit; outline-offset: -3px; border-radius: 11px; }
  .cr-cover { position: relative; flex: 0 0 96px; width: 96px; height: 144px; overflow: hidden; background: linear-gradient(160deg, #1a0f2e, #0d0a18); }
  .cr-text { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 14px 16px; box-sizing: border-box; }
  .cr-kind { font-family: ${LABEL}; font-size: 8px; letter-spacing: 0.2em; text-transform: uppercase; color: #c9a84c; line-height: 1.2; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-title { font-family: ${DISPLAY}; font-weight: 600; font-size: 17px; line-height: 1.15; color: #f5f0e8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cr-writer { margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-mins { margin-top: 3px; font-family: ${DISPLAY}; font-style: italic; font-size: 12.5px; color: rgba(245,240,232,0.55); }
  .cr-lock { margin-top: 5px; display: flex; align-items: center; gap: 5px; font-family: ${LABEL}; font-size: 7.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #c9a84c; line-height: 1; }
  .cr-text .cr-bar { margin-top: auto; }
  /* 8px from the card's OUTER edge, counting its 1px border, as drawn: 7px inside the border. */
  .cr-x { position: absolute; top: 7px; right: 7px; width: 28px; height: 28px; box-sizing: border-box; padding: 0; border-radius: 50%;
    border: 1px solid rgba(245,240,232,0.25); background: rgba(10,10,10,0.7); color: #f5f0e8; cursor: pointer;
    display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.15s; }
  .cr-card:hover .cr-x, .cr-card:focus-within .cr-x { opacity: 1; pointer-events: auto; }
  @media (hover: none) { .cr-x { opacity: 1; pointer-events: auto; } }
`;

function Lock() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
      <rect x="0.6" y="4.4" width="7.8" height="5" rx="1" fill="#c9a84c" />
      <path d="M2.3 4.4V3a2.2 2.2 0 0 1 4.4 0v1.4" stroke="#c9a84c" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

function Cross() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1L9 9M9 1L1 9" stroke="#f5f0e8" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ContinueCard({ card, onHide }) {
  // An open story opens where the reader stopped: the hash tells its page to jump, once, without
  // animation (ruling, 28 Nov 2026). A locked one opens its page as any visit does. An instalment
  // opens the Series reader, which resumes on its own.
  const href = card.kind === 'story' && card.state === 'open' ? `${card.href}${RESUME_HASH}` : card.href;
  return (
    <div className="cr-card" data-cr-card={card.kind} data-state={card.state}>
      <a className="cr-link" href={href}>
        <span className="cr-cover">
          {card.cover ? (
            <CoverImage fill cover={card.cover} coverSizes={card.coverSizes} coverHash={card.coverHash} alt="" sizes="96px" />
          ) : null}
        </span>
        <span className="cr-text">
          <span className="cr-kind">{card.kindLine}</span>
          <span className="cr-title">{card.title}</span>
          {card.writer ? <span className="cr-writer" style={justAddedWriterStyle}>{card.writer}</span> : null}
          {card.state === 'locked' ? (
            <span className="cr-lock"><Lock />Members</span>
          ) : card.minutes ? (
            <span className="cr-mins">{minutesLine(card.minutes)}</span>
          ) : null}
          <ReadingBar progress={card.fraction} className="cr-bar" />
        </span>
      </a>
      <button type="button" className="cr-x" aria-label={`Remove ${card.title} from Continue Reading`} onClick={() => onHide(card)}>
        <Cross />
      </button>
    </div>
  );
}

export default function ContinueReadingRow({ uid, allStories }) {
  const membership = useMembership();
  const [entries, setEntries] = useState(null);
  const [instalments, setInstalments] = useState({});
  const [hidden, setHidden] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadEntries(db, uid);
        const inst = list.some((e) => e.kind === 'instalment') ? await loadInstalments(db, list) : {};
        if (cancelled) return;
        setInstalments(inst);
        setEntries(list);
      } catch {
        // A missing row, never a broken page.
        if (!cancelled) setEntries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const cards = useMemo(() => {
    if (!entries || !entries.length || !allStories?.length) return [];
    return resolveCards(entries.filter((e) => !hidden.has(`${e.kind}:${e.id}`)), {
      liveStories: allStories, instalments,
      tier: membership.tier, subscriptionTier: membership.subscriptionTier,
    });
  }, [entries, instalments, allStories, membership.tier, membership.subscriptionTier, hidden]);

  if (membership.loading || !cards.length) return null;

  const onHide = (card) => {
    setHidden((prev) => new Set(prev).add(card.key));
    hideCard(db, uid, card.kind, card.id);
  };

  return (
    <section data-continue-reading="" style={SHELF_SECTION_STYLE}>
      <style href="cs-continue-reading" precedence="default">{CSS}</style>
      <ShelfRowHeader kicker={CR_KICKER} title={CR_TITLE} />
      <div className="cr-strip" style={SHELF_STRIP_STYLE}>
        {cards.map((c) => <ContinueCard key={c.key} card={c} onHide={onHide} />)}
      </div>
    </section>
  );
}
