'use client';
// ⤓ SAVE FOR OFFLINE — the save gesture, on the story page.
//
// ── WHY IT LIVES IN back-link-row ────────────────────────────────────────────────────────
// The row above the prose already holds "← {Category}" and, for reader-mode stories, the
// gold-outlined "📖 Read in Book Reader" pill. This is a sibling of that pill and borrows
// its exact visual language, so the affordance arrives in a place the page already uses for
// affordances rather than inventing chrome.
//
// It is fence-safe by construction, and both halves of that matter:
//
//   · It sits INSIDE .story-body-wrap, so it inherits the existing prose entrance and
//     arrives with the words. No new animation, no new timing, and nothing here touches
//     PROSE_ENTER_MS, PROSE_FONT_CAP_MS or the proseStarted ref-guard.
//   · It sits OUTSIDE .prose. The drop-cap tagger scopes its query to
//     `.prose.has-dropcap` and then to `p` within it (see app/lib/dropcap.js), so a button
//     in this row is invisible to it. The tagger's MutationObserver does watch the whole
//     article for childList changes and will re-run when this component's state changes the
//     DOM — but tagDropcap clears prior tags and recomputes from scratch on every pass, so
//     a re-run converges on the identical result. Saving a story cannot move a drop cap.
//
// Rejected placements, for the record: the sticky .story-nav auto-hides on scroll-down, so
// the affordance would vanish exactly when a reader decides to save; a floating action
// button collides with the existing back-to-top control and puts chrome over prose; and
// end-of-story reads as "save what you just read" when the reader wanting the tube wants it
// before the read, not after.
import { useCallback, useEffect, useState } from 'react';
import {
  isSaved, saveStory, removeSaved, listSaved, capFor, ShelfFullError,
} from '../lib/shelf';
import { sealShelf, registerShelfWorker } from '../lib/shelfWorker';
import { useOffline } from '../lib/useOffline';
import { useMembership } from '../lib/MembershipContext';

const SERIF = "'Cormorant Garamond', Georgia, serif";

const pill = {
  display: 'inline-flex', alignItems: 'center', gap: '0.4em',
  fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase',
  color: '#c9a44c', fontFamily: SERIF, background: 'transparent',
  border: '1px solid rgba(201,164,76,0.4)', padding: '0.3em 0.8em',
  borderRadius: '2px', cursor: 'pointer', transition: 'all 0.2s',
  lineHeight: 1.4,
};

export default function SaveForOffline({ slug, story, user, readingTime = 0, onSignIn }) {
  const offline = useOffline();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // null | 'saved' | 'full'
  const [shelf, setShelf] = useState([]);
  const [error, setError] = useState('');

  const uid = user?.uid || null;

  // THE CAP IS THE READER'S, NOT THE BUILD'S. Free 2 · Gold 20 · Platinum unlimited, resolved
  // from the live entitlement — a day pass raises it for the hours it is alive and this button
  // follows it down again when it lapses, because the provider recomputes at expiry.
  //
  // `tierLoading` is true for exactly one beat after a signed-in mount, while the membership
  // record is in flight, and during that beat `tier` is the 'free' default. A Gold reader
  // holding two stories would be told their shelf was full — a lie, and the one lie this
  // button must never tell. So the cap verdict waits: the button is inert until the tier is
  // known, and both the pre-flight check and the save itself are gated on it below. A beat of
  // unavailability is honest; a wrong "full" is not.
  const { tier, loading: tierLoading } = useMembership();
  const cap = capFor('story', tier);

  const refresh = useCallback(async () => {
    if (!uid) { setSaved(false); setShelf([]); return; }
    const [is, all] = await Promise.all([isSaved(uid, slug), listSaved(uid, 'story')]);
    setSaved(is);
    setShelf(all);
  }, [uid, slug]);

  useEffect(() => { refresh(); }, [refresh]);

  // Register on mount rather than on first save. Sealing the shelf shell needs an ACTIVE
  // worker, and registering at save time would race the very first save against its own
  // installation. This is also the only registration call the story page makes — the root
  // layout deliberately makes none, so the gateway never runs it.
  useEffect(() => { registerShelfWorker(); }, []);

  // Close the popover on outside click / Escape, the way the rest of the page's transient
  // surfaces behave.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    const onDown = (e) => { if (!e.target.closest?.('[data-shelf-pop]')) setOpen(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const doSave = async () => {
    if (!uid) { onSignIn?.(); return; }
    setError('');
    setBusy(true);
    try {
      await saveStory({ uid, slug, story, readingTime, tier });
      // Cache the shelf shell so /my-library and the reader work with no signal. Best
      // effort and deliberately not awaited into the button state — a slow seal must not
      // make a completed save look unfinished.
      sealShelf();
      await refresh();
    } catch (e) {
      if (e instanceof ShelfFullError) { await refresh(); setOpen('full'); }
      else setError(offline ? 'You need a connection to save.' : (e?.message || 'Could not save that.'));
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (targetSlug) => {
    if (!uid) return;
    setBusy(true);
    try {
      await removeSaved(uid, targetSlug);
      await refresh();
      if (targetSlug === slug) setOpen(null);
    } finally {
      setBusy(false);
    }
  };

  // Offline and unsaved: honest rather than hopeful. The save fetches the cover, so there
  // is nothing useful this button can do without a connection.
  //
  // `tierLoading` joins it for the reason above — but only for a SIGNED-IN reader, which is
  // the only case where it is ever true (the signed-out shape carries loading: false). The
  // signed-out button stays live so it can still open the sign-in sheet.
  const disabled = busy || tierLoading || (offline && !saved);

  const label = busy ? '⤓ Saving…'
    : saved ? '✓ On your shelf'
    : offline ? '⤓ Needs a connection'
    : '⤓ Save for offline';

  return (
    <span data-shelf-pop style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open ? true : undefined}
        onClick={() => {
          if (saved) { setOpen(open === 'saved' ? null : 'saved'); return; }
          if (shelf.length >= cap && uid) { setOpen('full'); return; }
          doSave();
        }}
        style={{
          ...pill,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
          borderColor: saved ? 'rgba(201,164,76,0.75)' : 'rgba(201,164,76,0.4)',
          background: saved ? 'rgba(201,164,76,0.10)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(201,164,76,0.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = saved ? 'rgba(201,164,76,0.10)' : 'transparent'; }}
      >
        {label}
      </button>

      {error && (
        <span role="alert" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, whiteSpace: 'nowrap',
          fontFamily: SERIF, fontSize: '0.75rem', color: '#8a4b3a',
        }}>{error}</span>
      )}

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 20,
            minWidth: 240, maxWidth: 300, padding: '14px 14px 12px',
            background: '#06040e', borderRadius: 10,
            border: '1px solid rgba(201,168,76,0.28)',
            boxShadow: '0 18px 44px -18px rgba(6,4,14,0.6)',
            fontFamily: SERIF, textAlign: 'left',
          }}
        >
          {open === 'saved' ? (
            <>
              <div style={{ fontSize: 14, color: '#f5f0e8', lineHeight: 1.4 }}>On your shelf</div>
              {/* The honesty line, at the exact moment the promise is made. */}
              <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'rgba(245,240,232,0.55)' }}>
                Saved to this device. It stays readable with no signal.
              </p>
              <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'center' }}>
                <a href="/my-library" style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', textDecoration: 'none' }}>My Library</a>
                <button type="button" disabled={busy} onClick={() => doRemove(slug)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: SERIF, fontSize: 12, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: 'rgba(245,240,232,0.5)',
                }}>Remove</button>
              </div>
            </>
          ) : (
            <>
              {/* TWO WAYS TO BE UNABLE TO SAVE, AND THEY ARE NOT THE SAME SENTENCE.
                  At the cap: remove one, save one. OVER the cap — the reader filled twenty
                  slots on a day pass and the pass ended — "remove one to make room" would be
                  a lie, because one is not enough and nothing here took the other stories
                  away. The ruling above CAPS in app/lib/shelf.js is that those saves persist;
                  this is where the reader is told so, in the place they discover it. */}
              <div style={{ fontSize: 14, color: '#f5f0e8', lineHeight: 1.4 }}>
                {shelf.length > cap ? 'More saved than your plan holds' : 'Your shelf is full'}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'rgba(245,240,232,0.55)' }}>
                {shelf.length > cap ? (
                  <>Your plan holds {cap}, and you have {shelf.length} — kept from when your pass was live. Nothing has been removed. Remove {shelf.length - cap + 1} to save another.</>
                ) : (
                  <>It holds {cap} {cap === 1 ? 'story' : 'stories'}. Remove one to make room.</>
                )}
              </p>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shelf.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: 'rgba(245,240,232,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                    <button type="button" disabled={busy} onClick={() => doRemove(r.slug)} style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                      fontFamily: SERIF, fontSize: 11, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'rgba(201,168,76,0.8)',
                    }}>Remove</button>
                  </div>
                ))}
              </div>
              {/* R11.7 — THE HONEST MOMENT, not a nag. This is the one instant where a bigger
                  shelf is a real answer to a problem the reader actually has, so the route to
                  it is offered here and nowhere else on the story page. It sits BELOW the
                  remove list on purpose: removing a story is free and stays the first option.
                  Never shown to a reader who is already over the cap on a lapsed pass — they
                  had the bigger shelf, it is a sore point, and selling it back to them at the
                  moment they notice would be crass. */}
              {shelf.length <= cap && (
                <a href="/membership" style={{
                  display: 'inline-block', marginTop: 12,
                  fontFamily: SERIF, fontSize: 12, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#c9a84c', textDecoration: 'none',
                }}>Room for more →</a>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
