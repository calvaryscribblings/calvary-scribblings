'use client';
// READERS' NOTES — ONE NOTE, AND ITS REPLIES (W46, §4).
//
// Every note shows the question it answers ABOVE the reader. The writer's notes carry the
// WRITER mark. Identity is resolved live, the Square's way (app/lib/squareIdentity.js), with the
// note's stored author snapshot as the fallback. Long notes fold after six lines behind
// "Read more"; replies are one level, oldest first, folded after two.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTES_COPY, NOTE_FOLD_LINES, REPLY_MAX, foldReplies, lineHref } from '../../lib/series/notes';
import { identityOf } from '../../lib/squareIdentity';
import { Avatar, UserBadge, timeAgo } from '../conversation/ConversationKit';
import { C, DISPLAY, LABEL, labelStyle, questionStyle } from './tokens';
import { MoreIcon, QuoteMark } from './Parts';
import { asPost } from './roomModel';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// The note's avatar is the Square's (a 44px link to the reader's page, a full target). A reply's
// is smaller and is not a link — the name beside it says who it is — so no target falls under 44px.
function Who({ note, identities, size = 44 }) {
  const id = identityOf(asPost(note), identities?.get?.(note.uid));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {size >= 44
        ? <Avatar uid={note.uid} initials={id.initials} avatarUrl={id.avatarUrl} size={size} isAuthor={note.writer === true} />
        : (
          <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: id.avatarUrl ? `center/cover no-repeat url(${JSON.stringify(id.avatarUrl)})` : '#2a1d47', fontFamily: LABEL, fontSize: size * 0.36, color: C.cream }}>
            {id.avatarUrl ? null : id.initials}
          </span>
        )}
      <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px' }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, color: C.cream }}>{id.displayName}</span>
        {note.writer === true
          ? <span data-writer-mark style={{ ...labelStyle(C.goldTint, 9), border: '1px solid rgba(201,168,76,0.5)', borderRadius: 999, padding: '2px 8px' }}>{NOTES_COPY.writerMark}</span>
          : <UserBadge readCount={id.readCount} isAuthor={false} />}
        {note.createdAt > 0 && <span style={{ fontFamily: DISPLAY, fontSize: 14, color: C.quiet }}>{timeAgo(note.createdAt)}</span>}
      </div>
    </div>
  );
}

/** The note's words, folded after six lines. */
function Folded({ text, size = 18 }) {
  const box = useRef(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useIsoLayout(() => {
    const el = box.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight - el.clientHeight > 2);
  }, [text, open]);
  return (
    <div>
      <p ref={box} data-note-text style={{
        fontFamily: DISPLAY, fontSize: size, lineHeight: 1.5, color: C.cream, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: NOTE_FOLD_LINES, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
      }}>{text}</p>
      {overflows && !open && (
        <button type="button" className="sn-text sn-link" style={{ padding: 0, color: C.link }} onClick={() => setOpen(true)}>{NOTES_COPY.readMore}</button>
      )}
    </div>
  );
}

function Overflow({ items }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    wrap.current?.querySelector('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!items.length) return null;
  return (
    <span ref={wrap} style={{ position: 'relative', marginLeft: 'auto' }}>
      <button type="button" className="sn-text" aria-haspopup="menu" aria-expanded={open} aria-label="More" onClick={() => setOpen((o) => !o)}><MoreIcon /></button>
      {open && (
        <span role="menu" style={{ position: 'absolute', right: 0, bottom: '100%', zIndex: 20, minWidth: 170, background: '#15102a', border: `1px solid ${C.border}`, borderRadius: 12, padding: 6, display: 'grid' }}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="sn-text" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{ justifyContent: 'flex-start', color: it.danger ? '#fda4af' : C.cream, width: '100%' }}>{it.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

function ReplyRow({ reply, byId, identities, own, canRemove, onRemove, onRetry, onDrop, onReplyTo }) {
  const parent = reply.replyTo ? byId.get(reply.replyTo) : null;
  const parentHandle = parent ? (identityOf(asPost(parent), identities?.get?.(parent.uid)).handle || parent.author?.handle) : null;
  if (reply.removed) {
    return <li data-reply="removed" style={{ listStyle: 'none', padding: '10px 0', fontFamily: DISPLAY, fontStyle: 'italic', fontSize: 16, color: C.quiet }}>{NOTES_COPY.replyRemoved}</li>;
  }
  return (
    <li data-reply={reply.local || 'live'} style={{ listStyle: 'none', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <Who note={reply} identities={identities} size={28} />
      {parentHandle && <p style={{ fontFamily: DISPLAY, fontSize: 15, color: C.quiet, margin: '6px 0 0' }}>{NOTES_COPY.replyingTo(parentHandle)}</p>}
      <div style={{ marginTop: 6 }}><Folded text={reply.text} size={17} /></div>
      {reply.status === 'held' && <p data-held style={{ ...labelStyle(C.goldTint, 9), margin: '6px 0 0' }}>{NOTES_COPY.waitingReview}</p>}
      {reply.local === 'failed' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 15, color: '#fda4af' }}>{NOTES_COPY.notSent}</span>
          <button type="button" className="sn-text sn-link" style={{ color: C.link }} onClick={onRetry}>{NOTES_COPY.tryAgain}</button>
          <button type="button" className="sn-text" onClick={onDrop}>{NOTES_COPY.remove}</button>
        </div>
      ) : reply.local !== 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button type="button" className="sn-text" onClick={onReplyTo} style={{ paddingLeft: 0 }}>{NOTES_COPY.reply}</button>
          {(own || canRemove) && !reply.local && (
            <button type="button" className="sn-text" onClick={onRemove}>{own ? NOTES_COPY.delete : NOTES_COPY.remove}</button>
          )}
        </div>
      )}
    </li>
  );
}

function ReplyBox({ replyingTo, onSend, onCancel }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const len = Array.from(text.trim()).length;
  return (
    <div style={{ marginTop: 10 }}>
      {replyingTo && <p style={{ fontFamily: DISPLAY, fontSize: 15, color: C.quiet, margin: '0 0 6px' }}>{NOTES_COPY.replyingTo(replyingTo)}</p>}
      <textarea ref={ref} value={text} rows={3} aria-label={NOTES_COPY.reply} maxLength={REPLY_MAX}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: DISPLAY, fontSize: 18, lineHeight: 1.5, color: C.cream, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', outline: 'none', resize: 'vertical' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="button" className="sn-text" onClick={onCancel}>{NOTES_COPY.notNow}</button>
        <button type="button" className="sn-btn sn-primary" disabled={len < 1} onClick={() => { onSend(text); setText(''); }}>{NOTES_COPY.post}</button>
      </div>
    </div>
  );
}

/**
 * <NoteCard note heading identities count underlined user isOwn canRemove replies
 *           onUnderline onRemove onReport onCopy onSendReply onRetryReply onDropReply onRemoveReply
 *           lineLink onRetry onDrop />
 * `note.local` is 'pending' | 'failed' for the reader's own unsent note.
 */
export default function NoteCard({
  note, heading, identities, count = 0, underlined = false, user, isOwn = false, canRemove = false, replies = [],
  onUnderline, onRemove, onReport, onCopy, onSendReply, onRetryReply, onDropReply, onRemoveReply, onRetry, onDrop, reported = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(null); // null | { replyTo?: id, handle? }
  const { shown, hidden } = foldReplies(replies, expanded);
  const byId = new Map(replies.map((r) => [r.id, r]));
  const live = !note.local && note.status !== 'held';

  const menu = [];
  if (live) {
    menu.push({ label: NOTES_COPY.copyLink, onClick: onCopy });
    if (!isOwn) menu.push({ label: NOTES_COPY.report, onClick: onReport, disabled: reported });
  }
  if (!note.local && isOwn) menu.push({ label: NOTES_COPY.delete, onClick: onRemove, danger: true });
  else if (!note.local && canRemove) menu.push({ label: NOTES_COPY.remove, onClick: onRemove, danger: true });

  return (
    <article id={`note-${note.id}`} data-note={note.id} data-kind={note.kind} data-local={note.local || undefined} className="sn-card"
      style={{ padding: '16px 16px 6px', scrollMarginTop: 90 }}>
      <header style={{ marginBottom: 12 }}>
        <span style={{ ...labelStyle(C.gold, 9.5), display: 'block', marginBottom: 5 }}>{heading.label}</span>
        {heading.question && <p style={{ ...questionStyle(19), color: 'rgba(245,240,232,0.86)' }}>{heading.question}</p>}
      </header>
      {heading.quote?.text && (
        <figure style={{ position: 'relative', margin: '0 0 14px', padding: '2px 0 0 34px' }}>
          <span style={{ position: 'absolute', left: 0, top: 0 }}><QuoteMark /></span>
          <blockquote style={{ margin: 0, fontFamily: DISPLAY, fontStyle: 'italic', fontSize: 19, lineHeight: 1.45, color: C.goldTint }}>{heading.quote.text}</blockquote>
          <a className="sn-text sn-link" href={lineHref(note.inst, heading.quote)} style={{ color: C.link, paddingLeft: 0 }}>{NOTES_COPY.readInPlace}</a>
        </figure>
      )}
      <Who note={note} identities={identities} />
      <div style={{ marginTop: 10 }}><Folded text={note.text} /></div>
      {note.status === 'held' && <p data-held style={{ ...labelStyle(C.goldTint, 9), margin: '10px 0 0' }}>{NOTES_COPY.waitingReview}</p>}

      {note.local === 'failed' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 16, color: '#fda4af' }}>{NOTES_COPY.notSent}</span>
          <button type="button" className="sn-text sn-link" style={{ color: C.link }} onClick={onRetry}>{NOTES_COPY.tryAgain}</button>
          <button type="button" className="sn-text" onClick={onDrop}>{NOTES_COPY.remove}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 4 }}>
          {live && (
            <button type="button" className="sn-text" aria-pressed={underlined} onClick={onUnderline} data-underline={underlined ? 'mine' : 'none'}
              style={{ paddingLeft: 0, color: underlined ? C.goldTint : C.quiet }}>
              <span style={underlined ? { textDecoration: 'underline', textDecorationColor: C.gold, textDecorationThickness: 2, textUnderlineOffset: 5 } : undefined}>
                {underlined ? NOTES_COPY.underlined : NOTES_COPY.underline(count)}
              </span>
            </button>
          )}
          {live && <button type="button" className="sn-text" onClick={() => setReplying({})}>{NOTES_COPY.reply}</button>}
          <Overflow items={menu} />
        </div>
      )}

      {(shown.length > 0 || replying) && (
        <div style={{ margin: '4px 0 10px 12px', paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
          <ul style={{ margin: 0, padding: 0 }}>
            {shown.map((r) => (
              <ReplyRow key={r.id} reply={r} byId={byId} identities={identities} own={r.uid === user?.uid} canRemove={canRemove}
                onRemove={() => onRemoveReply?.(r)} onRetry={() => onRetryReply?.(r)} onDrop={() => onDropReply?.(r)}
                onReplyTo={() => setReplying({ replyTo: r.local ? undefined : r.id, handle: identityOf(asPost(r), identities?.get?.(r.uid)).handle || r.author?.handle || null })} />
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" className="sn-text sn-link" style={{ color: C.link, paddingLeft: 0 }} onClick={() => setExpanded(true)}>{NOTES_COPY.moreReplies(hidden)}</button>
          )}
          {replying && (
            <ReplyBox replyingTo={replying.handle} onCancel={() => setReplying(null)}
              onSend={(text) => { onSendReply?.(text, replying.replyTo); setReplying(null); setExpanded(true); }} />
          )}
        </div>
      )}
    </article>
  );
}

/** A placeholder the size of a real note, so nothing shifts when the notes land. */
export function NoteSkeleton() {
  return (
    <div className="sn-card" aria-hidden="true" data-skeleton style={{ padding: '16px 16px 14px', minHeight: 196, boxSizing: 'border-box' }}>
      <div className="sn-skel" style={{ width: 110, height: 10, marginBottom: 10 }} />
      <div className="sn-skel" style={{ width: '80%', height: 18, marginBottom: 16 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <div className="sn-skel" style={{ width: 34, height: 34, borderRadius: '50%' }} />
        <div className="sn-skel" style={{ width: 120, height: 14 }} />
      </div>
      <div className="sn-skel" style={{ width: '100%', height: 14, marginBottom: 8 }} />
      <div className="sn-skel" style={{ width: '92%', height: 14, marginBottom: 8 }} />
      <div className="sn-skel" style={{ width: '60%', height: 14 }} />
    </div>
  );
}
