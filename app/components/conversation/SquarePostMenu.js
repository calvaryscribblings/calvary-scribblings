'use client';

// W52 — the Square's post menu and report sheet, moved out of app/square/page.js unchanged so the
// thread page (/square/p) draws the same menu on a reply that the feed draws on a post.
// Edit appears only where the caller passes onEdit; Pin and Strip quote only with their switches.

import { useEffect, useRef, useState } from 'react';
import { useKeyboardInset } from '../useKeyboard';

export function PinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3 7h5l-4 3 1.5 7L12 16l-5.5 3L8 12 4 9h5z"/>
    </svg>
  );
}

// ── Post Menu ─────────────────────────────────────────────────────────────────
export function PostMenu({ post, user, onEdit, onDelete, onPin, onStripQuote, onReport, canPin, canRemove }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const isOwn = user?.uid === post.authorUid;
  const canEdit = isOwn && (Date.now() - post.createdAt) < 5 * 60 * 1000;
  const isPinned = post.pinned || false;

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const copyLink = () => {
    // R33.2 — a real address. `/square#id` only resolved while the post was
    // still in the feed and the room was open; under the horizon it would have
    // resolved to nothing at all. /square/p?id= reads the room, then the archive.
    navigator.clipboard.writeText(`${window.location.origin}/square/p?id=${post.id}`);
    setOpen(false);
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: '#f5f0e8', cursor: 'pointer', padding: '2px 4px', fontSize: 14, lineHeight: 1, transition: 'color 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#f5f0e8'}
        onMouseLeave={e => e.currentTarget.style.color = '#f5f0e8'}>···</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#1a1a2e', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 10, minWidth: 160, zIndex: 200, overflow: 'hidden' }}>
          {isOwn && canEdit && onEdit && (
            <button onClick={() => { onEdit(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: '#f5f0e8', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {post.parentId ? 'edit reply' : 'edit post'}
            </button>
          )}
          {canPin && onPin && (
            <button onClick={() => { onPin(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: isPinned ? '#fcd34d' : '#f5f0e8', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <PinIcon size={12} />
              {isPinned ? 'Unpin post' : 'Pin post'}
            </button>
          )}
          {canRemove && post.quotedPostId && onStripQuote && (
            <button onClick={() => { onStripQuote(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: '#f5f0e8', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
              Strip quote attribution
            </button>
          )}
          {(isOwn || canRemove) && (
            <button onClick={() => { onDelete(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: '#f87171', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              {post.parentId ? (isOwn ? 'Withdraw reply' : 'Remove reply') : (isOwn ? 'Withdraw post' : 'Remove post')}
            </button>
          )}
          <button onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: '#f5f0e8', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Copy link
          </button>
          {!isOwn && (
            <button onClick={() => { onReport(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: 'rgba(232,224,212,0.5)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              Report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// R33.2 — the report surface. There was none: the menu item closed the menu.
export function ReportModal({ post, onSubmit, onClose }) {
  const REASONS = [
    ['abuse', 'Abusive or hateful'],
    ['harassment', 'Harassment of a reader'],
    ['spam', 'Spam or advertising'],
    ['explicit', 'Explicit or graphic'],
    ['offtopic', 'Not about reading'],
    ['other', 'Something else'],
  ];
  const [reason, setReason] = useState('abuse');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const kb = useKeyboardInset();
  const go = async () => { setBusy(true); try { await onSubmit(post, reason, note); setSent(true); } catch { setSent(true); } setBusy(false); };
  // W55.2 — the overlay is the glass the phone keyboard leaves (useKeyboardInset), so the note field
  // at the dialog's foot is never under the keyboard; a dialog taller than that glass scrolls.
  const box = { background: '#141018', border: '1px solid rgba(107,47,173,0.3)', borderRadius: 12, padding: '20px 22px', maxWidth: 420, width: '100%', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' };
  const ff = 'Cormorant Garamond, Georgia, serif';
  return (
    <div onClick={onClose} data-report-overlay style={{ position: 'fixed', left: 0, right: 0, top: kb.top, bottom: kb.inset, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20, boxSizing: 'border-box' }}>
      <div onClick={e => e.stopPropagation()} style={box}>
        {sent ? (
          <>
            <div style={{ fontFamily: ff, fontSize: '1.25rem', color: '#f5f0e8', marginBottom: 8 }}>Reported</div>
            <p style={{ fontFamily: ff, fontSize: '0.9rem', color: 'rgba(245,240,232,0.6)', lineHeight: 1.6, margin: '0 0 16px' }}>
              A moderator will see this. Thank you for telling us — the room only works if people do.
            </p>
            <button onClick={onClose} style={{ background: '#6b2fad', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 8, fontFamily: ff, fontSize: '0.9rem', cursor: 'pointer' }}>Close</button>
          </>
        ) : (
          <>
            <div style={{ fontFamily: ff, fontSize: '1.25rem', color: '#f5f0e8', marginBottom: 4 }}>Report this post</div>
            <p style={{ fontFamily: ff, fontSize: '0.85rem', color: 'rgba(245,240,232,0.45)', margin: '0 0 14px' }}>Only moderators see reports. The author isn&apos;t told who reported them.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {REASONS.map(([v, label]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: ff, fontSize: '0.9rem', color: reason === v ? '#f5f0e8' : 'rgba(245,240,232,0.6)', cursor: 'pointer' }}>
                  <input type="radio" name="sq-report" value={v} checked={reason === v} onChange={() => setReason(v)} style={{ accentColor: '#6b2fad' }} />
                  {label}
                </label>
              ))}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 300))} rows={3} placeholder="Anything a moderator should know (optional)"
              className="sq-textarea" style={{ width: '100%', fontFamily: ff, fontSize: '0.88rem', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(245,240,232,0.2)', color: 'rgba(245,240,232,0.7)', padding: '8px 16px', borderRadius: 8, fontFamily: ff, fontSize: '0.9rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={go} disabled={busy} style={{ background: '#b03636', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 8, fontFamily: ff, fontSize: '0.9rem', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sending…' : 'Report'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

