'use client';
// THE HELD-BOOK READER — /my-library/book?t=<titleId>. W33.
//
// The door for a book a reader holds when /reader/<slug> cannot open it: a title withdrawn from
// sale that an owner still holds, or a book held with no catalogue record at all. /reader/<slug>
// is exported only for published titles and its gate opens only a published one, so both of
// those used to 404 — which takes back a book the reader owns.
//
// ONE STATIC PAGE, shaped like /my-library/read: it reads window.location.search, and the export
// holds no per-title file. There is nothing here to enumerate, and nothing in the built output
// that names a held title.
//
// IT MUST NOT DIFFER BY WHETHER THE TITLE EXISTS.
//   signed out                        → the ordinary sign-in prompt (HeldSignIn)
//   signed in, no ACTIVE record at
//   bookstore_purchases/{uid}/<t>,
//   or a malformed id                 → one generic page that names nothing (HeldNotOnShelf)
//   signed in, an active record       → BookstoreReaderClient's purchased path, `held`
// The catalogue record is read ONLY AFTER the reader's own active record is found, so a reader
// without a copy causes the same reads, and sees the same page, for every id. And if the stream
// refuses, the held path shows HeldNotOnShelf — never the buy interstitial.
//
// The display fields come through app/lib/bookstore/heldBook.js, the same fallbacks My Library
// draws its tile with: the catalogue record where one exists, the purchase's own fields after.
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebaseCore';
import BookstoreReaderClient from '../../reader/[slug]/book-reader';
import { HeldSignIn, HeldNotOnShelf } from '../../components/HeldBookStates';
import { parseHeldId, isActiveHold, heldBookView, heldReaderTitle } from '../../lib/bookstore/heldBook';

function Waiting() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 34, height: 34, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );
}

export default function HeldBookPage() {
  const { user, loading } = useAuth();
  // Read once, at first render on the client — the shelf reader's pattern. The server has no
  // location, and `state` starts at 'checking' on both sides, so hydration agrees.
  const [id] = useState(() => (typeof window === 'undefined' ? null : parseHeldId(window.location.search)));
  // checking | signedout | none | { title }
  const [state, setState] = useState('checking');

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const settle = (s) => { if (!cancelled) setState(s); };
    (async () => {
      if (!user) return settle('signedout');
      if (!id) return settle('none');
      try {
        const { ref, get } = await import('firebase/database');
        const mine = await get(ref(db, `bookstore_purchases/${user.uid}/${id}`));
        const rec = mine.exists() ? mine.val() : null;
        if (!isActiveHold(rec)) return settle('none');
        // Only now, for a reader who holds it: the catalogue record, where one exists.
        let titleDoc = null;
        try {
          const t = await get(ref(db, `bookstore_titles/${id}`));
          if (t.exists()) titleDoc = t.val();
        } catch { /* the purchase's own fields stand */ }
        settle({ title: heldReaderTitle(heldBookView(id, rec, titleDoc), titleDoc) });
      } catch {
        // Could not ask. The generic page names nothing either way, and the stream would make
        // the same refusal — so a failed read and an absent copy look the same here.
        settle('none');
      }
    })();
    return () => { cancelled = true; };
  }, [id, user, loading]);

  useEffect(() => {
    document.title = typeof state === 'object' ? `${state.title.title} — Calvary Scribblings` : 'My Library — Calvary Scribblings';
  }, [state]);

  if (state === 'checking') return <Waiting />;
  if (state === 'signedout') return <HeldSignIn />;
  if (state === 'none') return <HeldNotOnShelf />;
  return <BookstoreReaderClient slug={state.title.slug} title={state.title} held />;
}
