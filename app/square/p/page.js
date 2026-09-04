'use client';

// A POST'S REAL ADDRESS — R33.2.
//
// "Copy link" used to produce /square#<id>: a fragment on the main page. It only
// resolved if the room happened to be open, the reader was signed in, and the
// post was still in the feed — and under the horizon it would have resolved to
// nothing at all, silently, landing the reader in an empty Square with no
// explanation. A link people share has to outlive the room.
//
// ⚠ WHY ?id= AND NOT /square/p/<id>. next.config.mjs sets `output: 'export'`, so
// every dynamic segment must be enumerated at build time by generateStaticParams.
// A permalink for a post that does not exist yet cannot be — it would need a site
// rebuild per post, which is the same publish-to-deploy gap that had bookstore
// pages answering 404 for days. One static page reading a query string has no
// such gap and resolves any post ever written, including one archived tonight.
//
// READS THE ROOM, THEN THE ARCHIVE. Clearing is a horizon, not a deletion, so a
// post past the horizon is still there to be shown — with its replies, its
// identity, and a line saying plainly that it has left the Square and when.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Avatar, UserBadge, timeAgo } from '../../components/conversation/ConversationKit';
import { resolveIdentities, identityOf } from '../../lib/squareIdentity';
import PostBody from '../../components/conversation/PostBody';
import AttachmentCard from '../../components/conversation/AttachmentCard';
import { attachmentOf } from '../../lib/squarePostBody';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};
async function getDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase } = await import('firebase/database');
  return getDatabase(getApps().length ? getApps()[0] : initializeApp(FB));
}

const FF = 'Cormorant Garamond, Georgia, serif';
const GROUND = '#0a0a0a';

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: GROUND, color: '#f5f0e8', padding: '3rem 1.25rem 6rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <a href="/square" style={{ fontFamily: FF, fontSize: '0.8rem', color: '#9b6dff', textDecoration: 'none', letterSpacing: '0.06em' }}>← The Square</a>
        <div style={{ marginTop: '1.5rem' }}>{children}</div>
      </div>
    </div>
  );
}

function Row({ post, who, small }) {
  const id = who(post);
  return (
    <div style={{ display: 'flex', gap: 10, padding: small ? '10px 0' : '14px 0' }}>
      <Avatar uid={post.authorUid} initials={id.initials} size={small ? 26 : 34} isAuthor={id.isAuthor} avatarUrl={id.avatarUrl} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontFamily: FF, fontWeight: 500, fontSize: small ? '0.86rem' : '0.95rem' }}>{id.displayName}</span>
          {id.handle && <span style={{ fontFamily: FF, fontSize: '0.72rem', color: 'rgba(245,240,232,0.45)' }}>@{id.handle}</span>}
          <UserBadge uid={post.authorUid} readCount={id.readCount} isAuthor={id.isAuthor} />
          <span style={{ fontFamily: FF, fontSize: '0.72rem', color: 'rgba(245,240,232,0.3)' }}>{timeAgo(post.createdAt)}</span>
        </div>
        {/* R43 — this surface was the ONLY one of the eight that already rendered
            paragraphs, via whiteSpace: pre-wrap, and the only one that did NOT render
            @mentions. Both now come from the shared renderer, so the feed and the
            permalink stopped being wrong in opposite directions. Its tombstone, which
            was the only one that existed, moved into that renderer with it. */}
        <PostBody text={post.text} surface="permalink" withdrawn={post.withdrawn === true} style={small ? { fontSize: '0.9rem' } : null} />
        {!post.withdrawn && <AttachmentCard attachment={attachmentOf(post)} />}
      </div>
    </div>
  );
}

function Permalink() {
  const id = useSearchParams().get('id');
  const [state, setState] = useState({ phase: 'loading' });
  const [identities, setIdentities] = useState({});

  useEffect(() => {
    if (!id) { setState({ phase: 'missing' }); return; }
    let cancelled = false;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get, query, orderByChild, equalTo } = await import('firebase/database');
        // The room first, then the archive. A post is in exactly one of them.
        let where = 'square_posts';
        let snap = await get(ref(db, `square_posts/${id}`));
        if (!snap.exists()) { where = 'square_archive'; snap = await get(ref(db, `square_archive/${id}`)); }
        if (!snap.exists()) { if (!cancelled) setState({ phase: 'gone' }); return; }

        const post = { id, ...snap.val() };
        // Replies live beside their parent in whichever node holds the thread —
        // the horizon moves a thread whole, so they are never split across the two.
        const rootId = post.parentId || id;
        const sibs = await get(query(ref(db, where), orderByChild('parentId'), equalTo(rootId)));
        const replies = sibs.exists()
          ? Object.entries(sibs.val()).map(([k, v]) => ({ id: k, ...v })).sort((a, b) => a.createdAt - b.createdAt)
          : [];
        let root = post;
        if (post.parentId) {
          const rs = await get(ref(db, `${where}/${rootId}`));
          if (rs.exists()) root = { id: rootId, ...rs.val() };
        }
        if (!cancelled) setState({ phase: 'ok', root, replies, archived: where === 'square_archive', focusId: id });
      } catch {
        if (!cancelled) setState({ phase: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (state.phase !== 'ok') return;
    let cancelled = false;
    (async () => {
      const db = await getDB();
      const uids = [state.root, ...state.replies].map(p => p.authorUid).filter(Boolean);
      const map = await resolveIdentities(db, uids);
      if (!cancelled) setIdentities(Object.fromEntries(map));
    })();
    return () => { cancelled = true; };
  }, [state]);

  const who = (p) => identityOf(p, identities[p.authorUid]);

  if (state.phase === 'loading') return <Shell><p style={{ fontFamily: FF, color: 'rgba(245,240,232,0.4)' }}>Finding it…</p></Shell>;
  if (state.phase === 'missing') return <Shell><p style={{ fontFamily: FF, color: 'rgba(245,240,232,0.6)' }}>That link is missing a post.</p></Shell>;
  if (state.phase === 'error') return <Shell><p style={{ fontFamily: FF, color: 'rgba(245,240,232,0.6)' }}>Something went wrong reading that post. Try again in a moment.</p></Shell>;
  if (state.phase === 'gone') {
    return (
      <Shell>
        <h1 style={{ fontFamily: FF, fontWeight: 400, fontSize: '1.6rem', margin: '0 0 10px' }}>This post is gone</h1>
        <p style={{ fontFamily: FF, fontSize: '0.95rem', lineHeight: 1.65, color: 'rgba(245,240,232,0.55)' }}>
          It was deleted by its author or removed by a moderator. Posts that simply pass the
          48-hour horizon are kept and still open here — this one is not among them.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {state.archived && (
        <div style={{ border: '1px solid rgba(201,168,76,0.3)', background: 'rgba(201,168,76,0.06)', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
          <div style={{ fontFamily: FF, fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 4 }}>Past the horizon</div>
          <div style={{ fontFamily: FF, fontSize: '0.9rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.6)' }}>
            This thread has left the Square. The room holds 48 hours; nothing is deleted, so it is
            still readable here — just no longer in the room.
          </div>
        </div>
      )}
      <Row post={state.root} who={who} />
      {state.replies.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 14, borderLeft: '1px solid rgba(245,240,232,0.08)' }}>
          {state.replies.map(r => (
            <div key={r.id} style={{ background: r.id === state.focusId ? 'rgba(155,109,255,0.07)' : 'transparent', borderRadius: 6, paddingLeft: r.id === state.focusId ? 8 : 0 }}>
              <Row post={r} who={who} small />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary under `output: 'export'`.
  return (
    <Suspense fallback={<Shell><p style={{ fontFamily: FF, color: 'rgba(245,240,232,0.4)' }}>Finding it…</p></Shell>}>
      <Permalink />
    </Suspense>
  );
}
