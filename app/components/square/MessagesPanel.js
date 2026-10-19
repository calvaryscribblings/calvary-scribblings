'use client';

// THE SQUARE'S MESSAGES — moved out of app/square/page.js in W53, with:
//   · identity drawn by the live components, in the list and the conversation header (ruling 203)
//   · a face or name opens the reader card
//   · the block barrier (ruling 208): the blocker sees "You've blocked @handle." with Unblock in
//     place of the box; the blocked reader, whose message the rules refuse, sees "You can't
//     message this reader." and is never told why. Nothing here can see the other reader's list —
//     the lists are owner-only — so the blocked side learns it only when a send is refused.
//   · Report a message (the ⋯ menu): pick one message; it files through app/lib/contentReports.js
//     as kind 'dm', and a moderator sees only that message (W5's ruling).
// W55.1:
//   · the ⋯ menu is the designed sheet (ruling 217), at the foot of the panel at every width: their
//     face and name, View profile, Mute this conversation, Report a message, Block @handle, Cancel
//   · Mute this conversation (218): dm_muted/{uid}/{convId} = true. Its unread count is never shown
//     or counted (unreadShown). Its messages still arrive; the other reader isn't told
//   · the report step shows the picked message under "THE MESSAGE A MODERATOR WILL SEE" (220)
// W51's find-by-handle (user_search, never the founder-only users root) is kept as it was.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ref, get, push, set, update, remove, onValue } from 'firebase/database';
import { db } from '../../lib/firebaseCore';
import { Avatar, UserBadge } from '../conversation/ConversationKit';
import PostBody from '../conversation/PostBody';
import { resolveIdentities, identityOf } from '../../lib/squareIdentity';
import { matchReaders } from '../../lib/squareHandles';
import { SAFETY_COPY, isPermissionDenied, unreadShown } from '../../lib/squareSafety';
import { buildReport, contentKeyFor, convIdFor } from '../../lib/contentReports';

const FF = 'Cormorant Garamond, Georgia, serif';
const INK = (a) => `rgba(245,240,232,${a})`;
const HANDLE = '#a989d9';
const GOLD = '#c9a84c';
const BLOCK = '#e0868f';

// The sheet's 20px icons, in the reader card's line (ReaderCard.js).
const Icon = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{children}</svg>
);
const ProfileIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></Icon>;
const MuteConvIcon = () => <Icon><path d="M18 8a6 6 0 0 0-9.33-5" /><path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /><line x1="2" y1="2" x2="22" y2="22" /></Icon>;
const ReportIcon = () => <Icon><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></Icon>;
const BlockIcon = () => <Icon><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /></Icon>;

const REASONS = [
  ['harassment', 'Harassment'],
  ['abuse', 'Abusive or hateful'],
  ['spam', 'Spam or a scam'],
  ['explicit', 'Explicit or graphic'],
  ['other', 'Something else'],
];

export default function MessagesPanel({ user, safety, onClose, onOpenReader, startWith = null, getStorageApp = null }) {
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [dmText, setDmText] = useState('');
  const [sending, setSending] = useState(false);
  const [dmImageFile, setDmImageFile] = useState(null);
  const [newMsgSearch, setNewMsgSearch] = useState('');
  const [newMsgResults, setNewMsgResults] = useState([]);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [identities, setIdentities] = useState({});
  const [refused, setRefused] = useState({});          // convId → true once the rules refused a send
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reportMsg, setReportMsg] = useState(null);
  const [reason, setReason] = useState('harassment');
  const [note, setNote] = useState('');
  const [reportState, setReportState] = useState('');  // '' | 'sending' | 'sent' | 'failed'
  const [mutedConvs, setMutedConvs] = useState({});     // W55.1: dm_muted/{uid}, convId → true
  const messagesEndRef = useRef(null);
  const dmFileRef = useRef(null);
  const startedWith = useRef(null);

  // ── the list ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const off = onValue(ref(db, `dm_conversations/${user.uid}`), async (snap) => {
      const convData = snap.val() || {};
      const list = await Promise.all(Object.keys(convData).map(async (convId) => {
        const otherUid = convId.split('_').find((u) => u !== user.uid);
        let lastMsg = null;
        try {
          const ms = await get(ref(db, `dm_messages/${convId}`));
          if (ms.exists()) { const all = Object.values(ms.val()); lastMsg = all[all.length - 1]; }
        } catch {}
        return { convId, otherUid, lastMsg, unread: convData[convId].unread || 0 };
      }));
      if (cancelled) return;
      setConversations(list.sort((a, b) => (b.lastMsg?.createdAt || 0) - (a.lastMsg?.createdAt || 0)));
      setLoadingConvs(false);
    }, () => { if (!cancelled) setLoadingConvs(false); });
    return () => { cancelled = true; off(); };
  }, [user]);

  // W55.1 — this reader's muted conversations. Unreadable is treated as none muted: the reader
  // sees every count, never fewer.
  useEffect(() => {
    if (!user) return undefined;
    return onValue(ref(db, `dm_muted/${user.uid}`), (s) => setMutedConvs(s.val() || {}), () => setMutedConvs({}));
  }, [user]);
  const toggleMuteConv = async (convId) => {
    const on = mutedConvs[convId] !== true;
    const flip = (add) => setMutedConvs((m) => { const n = { ...m }; if (add) n[convId] = true; else delete n[convId]; return n; });
    flip(on);
    try {
      const r = ref(db, `dm_muted/${user.uid}/${convId}`);
      if (on) await set(r, true); else await remove(r);
    } catch (e) { console.error('Conversation mute failed:', e?.code || e); flip(!on); }
  };

  // The sheet closes on Escape, as the reader card does.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Identity at render, for every reader in the list and the open conversation.
  const uidKey = useMemo(() => [...new Set([...conversations.map((c) => c.otherUid), activeConv?.otherUid].filter(Boolean))].sort().join(','), [conversations, activeConv]);
  useEffect(() => {
    if (!uidKey) return undefined;
    let cancelled = false;
    (async () => {
      const map = await resolveIdentities(db, uidKey.split(','));
      if (!cancelled) setIdentities(Object.fromEntries(map));
    })();
    return () => { cancelled = true; };
  }, [uidKey]);
  const who = (uid) => identityOf({ authorUid: uid }, identities[uid]);

  const open = (otherUid) => {
    setActiveConv({ convId: convIdFor(user.uid, otherUid), otherUid });
    setShowNewMsg(false); setNewMsgSearch(''); setNewMsgResults([]);
    setMenuOpen(false); setPicking(false); setReportMsg(null); setReportState('');
  };

  // The reader card's Message button opens here, straight into the conversation.
  useEffect(() => {
    if (!user || !startWith || startedWith.current === startWith || startWith === user.uid) return;
    startedWith.current = startWith;
    open(startWith);
    // open() only sets state from its argument and the signed-in reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, startWith]);

  // ── the conversation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeConv) return undefined;
    const off = onValue(ref(db, `dm_messages/${activeConv.convId}`), (snap) => {
      setMessages(Object.entries(snap.val() || {}).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.createdAt - b.createdAt));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, () => setMessages([]));
    update(ref(db, `dm_conversations/${user.uid}/${activeConv.convId}`), { unread: 0 }).catch(() => {});
    return () => off();
  }, [activeConv, user]);

  useEffect(() => {
    if (!newMsgSearch.trim()) return undefined;
    let cancelled = false;
    (async () => {
      // W51 — user_search, not the founder-only users root: "+ New" threw for every reader.
      try {
        const snap = await get(ref(db, 'user_search'));
        if (!cancelled) setNewMsgResults(matchReaders(snap.val(), newMsgSearch, { fields: ['displayName', 'username'], exclude: user.uid, limit: 6 }));
      } catch (e) { console.error('Message search error:', e); if (!cancelled) setNewMsgResults([]); }
    })();
    return () => { cancelled = true; };
  }, [newMsgSearch, user]);

  const sendDM = async () => {
    if ((!dmText.trim() && !dmImageFile) || !activeConv || sending) return;
    setSending(true);
    const { convId, otherUid } = activeConv;
    try {
      let imageUrl = null;
      if (dmImageFile && getStorageApp) {
        const { getStorage, ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage(await getStorageApp());
        const storageRef = sRef(storage, `dm_images/${convId}/${Date.now()}`);
        await uploadBytes(storageRef, dmImageFile);
        imageUrl = await getDownloadURL(storageRef);
      }
      const msg = { text: dmText.trim(), senderUid: user.uid, createdAt: Date.now() };
      if (imageUrl) msg.imageUrl = imageUrl;
      await push(ref(db, `dm_messages/${convId}`), msg);
      setDmText(''); setDmImageFile(null);
      await update(ref(db, `dm_conversations/${user.uid}/${convId}`), { unread: 0, lastAt: Date.now() });
      await update(ref(db, `dm_conversations/${otherUid}/${convId}`), { unread: 1, lastAt: Date.now() });
    } catch (e) {
      // Refused by the rules: a block stands between the two readers (ruling 208).
      if (isPermissionDenied(e)) setRefused((r) => ({ ...r, [convId]: true }));
      else console.error('DM send error:', e);
    }
    setSending(false);
  };

  // ── Report a message ────────────────────────────────────────────────────────
  const fileReport = async () => {
    if (!reportMsg || !activeConv) return;
    setReportState('sending');
    try {
      const contextPath = `dm_messages/${activeConv.convId}/${reportMsg.id}`;
      const rec = buildReport({ kind: 'dm', reason, reporterUid: user.uid, offenderUid: reportMsg.senderUid, contextPath, text: reportMsg.text, note, now: Date.now() });
      await set(ref(db, `content_reports/${contentKeyFor('dm', { convId: activeConv.convId })}/${user.uid}`), rec);
      setReportState('sent');
    } catch (e) {
      console.error('Message report error:', e);
      setReportState('failed');
    }
  };

  const other = activeConv ? who(activeConv.otherUid) : null;
  const otherHandle = other?.handle || other?.displayName || 'reader';
  const iBlocked = activeConv ? safety?.isBlocked(activeConv.otherUid) : false;
  const theyRefuse = activeConv ? !!refused[activeConv.convId] : false;

  const sheetBtn = { background: 'none', border: 'none', color: INK(0.95), cursor: 'pointer', fontFamily: FF };
  const convMuted = activeConv ? mutedConvs[activeConv.convId] === true : false;

  // A message's words as the conversation draws them — in the list and, once picked, in the
  // report step (220), so the reader sees exactly what a moderator will.
  const bubble = (msg, { isMine = false, pickable = false } = {}) => (
    <div style={{ padding: '8px 12px', borderRadius: isMine ? '12px 12px 3px 12px' : '12px 12px 12px 3px', background: isMine ? '#6b2fad' : 'rgba(255,255,255,0.06)', color: isMine ? '#f5f0e8' : 'rgba(232,224,212,0.85)', outline: pickable ? '1px dashed rgba(169,137,217,0.6)' : 'none' }}>
      <PostBody text={msg.text} surface="dm-bubble" />
    </div>
  );

  // ── the conversation's sheet (ruling 217) ───────────────────────────────────
  const HAIR = `1px solid ${INK(0.08)}`;
  const sheetRow = ({ key, icon, title, hint, color = '#f5f0e8', onClick }) => (
    <button key={key} type="button" onClick={onClick} data-conv-action={key}
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', boxSizing: 'border-box', minHeight: 52, padding: hint ? '12px 0' : 0, background: 'none', border: 'none', borderTop: HAIR, color, textAlign: 'left', cursor: 'pointer', fontFamily: FF }}>
      {icon}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 16.5, fontWeight: 500, lineHeight: '20px' }}>{title}</span>
        {hint && <span data-conv-hint style={{ display: 'block', fontStyle: 'italic', fontSize: 14.5, lineHeight: '18px', color: INK(0.55) }}>{hint}</span>}
      </span>
    </button>
  );
  const sheet = activeConv && menuOpen ? (
    <>
      <div data-conv-dim onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(4,3,8,0.6)' }} />
      <div role="dialog" aria-modal="true" aria-label="Conversation menu" data-conv-sheet
        style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 2101, width: '100%', maxWidth: 520, boxSizing: 'border-box',
          background: '#0e0b18', borderTop: `1px solid ${INK(0.1)}`, borderRadius: '12px 12px 0 0', padding: '8px 24px calc(34px + var(--cs-cookie-space, 0px))', fontFamily: FF, color: '#f5f0e8' }}>
        <div data-conv-grabber aria-hidden="true" style={{ width: 36, height: 5, borderRadius: 3, background: INK(0.25), margin: '0 auto' }} />
        <div data-conv-header style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, paddingBottom: 14 }}>
          <Avatar uid={activeConv.otherUid} initials={other.initials} size={36} isAuthor={other.isAuthor} avatarUrl={other.avatarUrl} link={false} />
          <span style={{ minWidth: 0 }}>
            <span data-conv-name style={{ display: 'block', fontSize: 17, lineHeight: '21px', fontWeight: 500 }}>{other.displayName}</span>
            {other.handle && <span data-conv-handle style={{ display: 'block', fontSize: 14.5, color: 'rgba(169,137,217,0.85)' }}>@{other.handle}</span>}
          </span>
        </div>
        {sheetRow({ key: 'profile', icon: <ProfileIcon />, title: SAFETY_COPY.viewProfile,
          onClick: () => { setMenuOpen(false); onOpenReader?.(activeConv.otherUid); } })}
        {sheetRow({ key: 'mute', icon: <MuteConvIcon />, title: convMuted ? SAFETY_COPY.unmuteConversation : SAFETY_COPY.muteConversation,
          onClick: () => { setMenuOpen(false); toggleMuteConv(activeConv.convId); } })}
        {sheetRow({ key: 'report', icon: <ReportIcon />, title: SAFETY_COPY.reportMessage, hint: SAFETY_COPY.reportMessageHint,
          onClick: () => { setMenuOpen(false); setPicking(true); setReportMsg(null); setReportState(''); } })}
        {sheetRow({ key: 'block', icon: <BlockIcon />, color: BLOCK,
          title: iBlocked ? SAFETY_COPY.unblock(otherHandle) : SAFETY_COPY.block(otherHandle), hint: iBlocked ? '' : SAFETY_COPY.blockHint,
          onClick: () => { setMenuOpen(false); safety?.setBlock(activeConv.otherUid, !iBlocked).catch(() => {}); } })}
        <button type="button" onClick={() => setMenuOpen(false)} data-conv-cancel
          style={{ display: 'block', width: '100%', height: 50, marginTop: 10, boxSizing: 'border-box', borderRadius: 999, border: `1px solid ${INK(0.14)}`, background: 'none', color: '#f5f0e8', fontFamily: FF, fontSize: 16.5, cursor: 'pointer' }}>
          {SAFETY_COPY.cancel}
        </button>
      </div>
    </>
  ) : null;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div data-messages-panel style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 'var(--cs-cookie-space, 0px)', boxSizing: 'border-box' }}>
        <div style={{ padding: '10px 14px 10px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          {activeConv ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <button onClick={() => { setActiveConv(null); setPicking(false); setReportMsg(null); }} aria-label="Back to messages" style={{ ...sheetBtn, width: 44, height: 44, fontSize: '1rem', padding: 0, marginLeft: -12 }}>←</button>
              <Avatar uid={activeConv.otherUid} initials={other.initials} size={32} isAuthor={other.isAuthor} avatarUrl={other.avatarUrl} onOpen={onOpenReader} label={`Open ${other.displayName}`} />
              <button type="button" onClick={() => onOpenReader?.(activeConv.otherUid)} data-reader-open={activeConv.otherUid}
                style={{ ...sheetBtn, padding: 0, textAlign: 'left', minWidth: 0, minHeight: 44 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#f5f0e8' }}>{other.displayName}</span>
                  <UserBadge uid={activeConv.otherUid} readCount={other.readCount} isAuthor={other.isAuthor} />
                </span>
                {other.handle && <span style={{ display: 'block', fontSize: '0.78rem', color: HANDLE }}>@{other.handle}</span>}
              </button>
            </div>
          ) : (
            <div style={{ fontFamily: FF, fontSize: '1.2rem', color: '#f5f0e8' }}>Messages</div>
          )}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
            {!activeConv && (
              <button onClick={() => setShowNewMsg(!showNewMsg)} style={{ minHeight: 44, background: 'rgba(107,47,173,0.12)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 7, padding: '0 12px', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(155,109,255,0.85)', cursor: 'pointer', fontFamily: FF }}>+ New</button>
            )}
            {activeConv && (
              <button onClick={() => setMenuOpen((v) => !v)} aria-label="Conversation menu" aria-expanded={menuOpen} style={{ ...sheetBtn, width: 44, height: 44, fontSize: '1.1rem' }}>⋯</button>
            )}
            <button onClick={onClose} aria-label="Close messages" style={{ ...sheetBtn, width: 44, height: 44, fontSize: '1.3rem' }}>×</button>
          </div>
        </div>

        {showNewMsg && !activeConv && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <input autoFocus placeholder="Search by name or @handle…" value={newMsgSearch} onChange={(e) => { setNewMsgSearch(e.target.value); if (!e.target.value.trim()) setNewMsgResults([]); }}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 12px', color: '#f5f0e8', fontSize: 16, fontFamily: FF, outline: 'none', boxSizing: 'border-box' }} />
            {newMsgResults.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {newMsgResults.map((u) => (
                  <button key={u.uid} onClick={() => open(u.uid)} style={{ ...sheetBtn, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, textAlign: 'left', minHeight: 44 }}>
                    <Avatar uid={u.uid} initials={(u.displayName || 'R')[0]} size={36} avatarUrl={u.avatarUrl} link={false} />
                    <span>
                      <span style={{ display: 'block', fontSize: '0.92rem', fontWeight: 500, color: '#f5f0e8' }}>{u.displayName || 'Reader'}</span>
                      {u.username && <span style={{ display: 'block', fontSize: '0.78rem', color: 'rgba(167,139,250,0.6)' }}>@{u.username}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!activeConv ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
            {loadingConvs ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#f5f0e8', fontFamily: FF, fontSize: '0.9rem' }}>Loading…</div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#f5f0e8', fontFamily: FF, fontSize: '0.95rem', fontStyle: 'italic' }}>No messages yet. Tap + New to start a conversation.</div>
            ) : conversations.map((conv) => {
              const w = who(conv.otherUid);
              return (
                <div key={conv.convId} data-conversation={conv.convId} onClick={() => open(conv.otherUid)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(conv.otherUid); }}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Avatar uid={conv.otherUid} initials={w.initials} size={40} isAuthor={w.isAuthor} avatarUrl={w.avatarUrl} onOpen={onOpenReader} label={`Open ${w.displayName}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#f5f0e8', fontFamily: FF }}>{w.displayName}</span>
                      <UserBadge uid={conv.otherUid} readCount={w.readCount} isAuthor={w.isAuthor} />
                    </div>
                    <div style={{ fontSize: '0.78rem', color: INK(0.7), fontFamily: FF, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.lastMsg?.text || (conv.lastMsg?.imageUrl ? 'Image' : '')}</div>
                  </div>
                  {unreadShown(conv, mutedConvs) > 0 && <div data-unread style={{ width: 18, height: 18, borderRadius: '50%', background: '#6b2fad', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#f5f0e8', flexShrink: 0 }}>{unreadShown(conv, mutedConvs)}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {picking && !reportMsg && (
              <div data-report-picking style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 14px 6px 20px', background: 'rgba(107,47,173,0.12)', fontFamily: FF, fontSize: '0.88rem', color: INK(0.8), flexShrink: 0 }}>
                <span>{SAFETY_COPY.reportMessageHint}</span>
                <button onClick={() => setPicking(false)} style={{ ...sheetBtn, minHeight: 44, color: HANDLE }}>Cancel</button>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.map((msg) => {
                const isMine = msg.senderUid === user.uid;
                const pickable = picking && !reportMsg && !isMine && typeof msg.text === 'string' && msg.text;
                return (
                  <div key={msg.id} data-message={msg.id} onClick={pickable ? () => setReportMsg(msg) : undefined}
                    role={pickable ? 'button' : undefined} aria-label={pickable ? 'Report this message' : undefined}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: isMine ? 'row-reverse' : 'row', cursor: pickable ? 'pointer' : undefined, opacity: picking && !pickable ? 0.4 : 1 }}>
                    {!isMine && <Avatar uid={msg.senderUid} initials={other.initials} size={24} isAuthor={other.isAuthor} avatarUrl={other.avatarUrl} link={false} />}
                    <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                      {msg.imageUrl && <img src={msg.imageUrl} alt="shared" style={{ maxWidth: 180, borderRadius: 10, display: 'block' }} />}
                      {msg.text && bubble(msg, { isMine, pickable })}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {reportMsg ? (
              <div data-report-sheet style={{ padding: '12px 20px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontFamily: FF, flexShrink: 0 }}>
                {reportState === 'sent' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span role="status" style={{ fontSize: '0.95rem', color: '#f5f0e8' }}>{SAFETY_COPY.reported}</span>
                    <button onClick={() => { setReportMsg(null); setPicking(false); setReportState(''); setNote(''); }} style={{ ...sheetBtn, minHeight: 44, color: HANDLE }}>Done</button>
                  </div>
                ) : (
                  <>
                    {/* 220 — the message as it appeared, under the thread's "REPLIES" heading style. */}
                    <div data-report-heading style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <span style={{ fontFamily: FF, fontSize: '0.8rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD }}>{SAFETY_COPY.reportHeading}</span>
                      <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'rgba(201,168,76,0.45)' }} />
                    </div>
                    <div data-report-message style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, maxHeight: '30vh', overflowY: 'auto' }}>
                      <Avatar uid={reportMsg.senderUid} initials={other.initials} size={24} isAuthor={other.isAuthor} avatarUrl={other.avatarUrl} link={false} />
                      <div style={{ maxWidth: '72%' }}>{bubble(reportMsg)}</div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: INK(0.55), marginBottom: 6 }}>Why are you reporting it?</div>
                    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
                      {REASONS.map(([v, label]) => (
                        <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, fontSize: '0.92rem', color: reason === v ? '#f5f0e8' : INK(0.65), cursor: 'pointer' }}>
                          <input type="radio" name="dm-report" value={v} checked={reason === v} onChange={() => setReason(v)} style={{ accentColor: '#6b2fad' }} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Anything a moderator should know (optional)"
                      style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 12px', color: '#f5f0e8', fontFamily: FF, fontSize: 16, resize: 'none', outline: 'none' }} />
                    {reportState === 'failed' && <div role="alert" style={{ fontSize: '0.85rem', color: '#d4537e', marginTop: 4 }}>That didn’t go through. Nothing was sent.</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                      <button onClick={() => { setReportMsg(null); setReportState(''); }} style={{ ...sheetBtn, minHeight: 44, color: INK(0.7) }}>Cancel</button>
                      <button onClick={fileReport} disabled={reportState === 'sending'} style={{ minHeight: 44, background: '#b03636', border: 'none', color: '#fff', padding: '0 18px', borderRadius: 8, fontFamily: FF, fontSize: '0.92rem', cursor: 'pointer' }}>{reportState === 'sending' ? 'Sending…' : 'Report'}</button>
                    </div>
                  </>
                )}
              </div>
            ) : iBlocked ? (
              <div data-dm-barrier="blocker" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', fontFamily: FF, flexShrink: 0 }}>
                <span style={{ fontSize: '0.95rem', color: INK(0.75) }}>{SAFETY_COPY.youBlocked(otherHandle)}</span>
                <button onClick={() => safety.setBlock(activeConv.otherUid, false).catch(() => {})} style={{ ...sheetBtn, minHeight: 44, color: HANDLE, fontSize: '0.95rem' }}>Unblock</button>
              </div>
            ) : theyRefuse ? (
              <div data-dm-barrier="blocked" style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', fontFamily: FF, fontSize: '0.95rem', color: INK(0.65), flexShrink: 0 }}>
                {SAFETY_COPY.cantMessage}
              </div>
            ) : (
              <>
                <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {getStorageApp && (
                    <>
                      <button onClick={() => dmFileRef.current?.click()} aria-label="Add an image" style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.12)', border: '1px solid rgba(107,47,173,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(155,109,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                      </button>
                      <input ref={dmFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setDmImageFile(e.target.files[0])} />
                    </>
                  )}
                  <input value={dmText} onChange={(e) => setDmText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendDM()}
                    placeholder={`Message ${other.displayName || 'Reader'}…`}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '9px 14px', fontSize: 16, color: INK(0.9), fontFamily: FF, outline: 'none', minWidth: 0 }} />
                  <button onClick={sendDM} disabled={sending || (!dmText.trim() && !dmImageFile)} aria-label="Send message"
                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#6b2fad', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, opacity: (!dmText.trim() && !dmImageFile) ? 0.4 : 1 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#f5f0e8" /></svg>
                  </button>
                </div>
                {dmImageFile && (
                  <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={URL.createObjectURL(dmImageFile)} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
                    <button onClick={() => setDmImageFile(null)} style={{ ...sheetBtn, fontSize: '0.82rem' }}>Remove</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      {sheet}
    </div>
  );
}
