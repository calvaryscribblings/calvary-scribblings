'use client';

// Open Pages — the drafts list. /open-pages/drafts   (R37)
//
// WHY A DEDICATED ROUTE AND NOT A SECTION OF THE PROFILE. The obvious home is the
// writer's Open Pages section on their profile — one place for "my writing". But that
// component renders on a PUBLIC profile (/user?id=…, /u/{handle}) and would have to
// hide drafts behind `profileUid === user.uid`. A conditional is a thing that can be
// got wrong once; a route that only ever reads `open_pages_drafts/{myUid}` cannot leak
// someone else's unfinished work however it is rendered, because it never reads theirs.
// Unfinished writing is the most private thing on the platform — the rules deny even a
// founder — so the shape that cannot fail is worth a separate page.
//
// THE ROW, per Ikenna's read, with one addition: title-or-first-line, when it was last
// touched, and a length. Length is in WORDS rather than characters, because writers
// think in words and characters are a database unit. The addition is a STATUS CHIP,
// shown only when something needs saying — a conflict copy, or a draft this device has
// not managed to sync. A row with nothing to say shows no chip.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { draftLabel, draftWords, MAX_DRAFTS } from '../../lib/openPagesDrafts';
import { readLocal, writeLocal, readSyncedRevs, planSync, draftPath, pruneEmpty } from '../../lib/openPagesDraftStore';

const INK = '#080610';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const CREAM_MUTE = 'rgba(245,240,232,0.55)';
const SERIF = 'Cormorant Garamond, Georgia, serif';
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DraftsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) { setDrafts({}); return; }
    const local = pruneEmpty(readLocal(user.uid));
    setDrafts(local);
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `open_pages_drafts/${user.uid}`));
        if (cancelled) return;
        const remote = snap.exists() ? (snap.val() || {}) : {};
        // Read-only reconcile: this page shows what exists on both sides. It never
        // resolves a conflict, because resolving one is the composer's job and doing it
        // from a list would decide something the writer has not looked at yet.
        const plan = planSync(local, remote, readSyncedRevs(user.uid));
        writeLocal(user.uid, plan.merged);
        setDrafts(plan.merged);
      } catch (e) { console.warn('[open-pages/drafts] list sync failed:', e); }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  async function del(slot) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    setBusy(slot);
    const next = { ...readLocal(user.uid) }; delete next[slot];
    writeLocal(user.uid, next);
    setDrafts(next);
    try {
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, draftPath(user.uid, slot)));
    } catch (e) { console.warn('[open-pages/drafts] delete failed:', e); }
    setBusy('');
  }

  const rows = Object.entries(drafts || {})
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));

  return (
    <div style={{ minHeight: '100vh', background: INK, color: CREAM }}>
      <Navbar />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 96px' }}>
        <div style={{ fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: GOLD, opacity: 0.8, marginBottom: 10 }}>
          Open Pages
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: '2.6rem', fontWeight: 600, margin: '0 0 6px', lineHeight: 1.1 }}>Your drafts</h1>
        <p style={{ color: CREAM_MUTE, margin: '0 0 32px', fontSize: '1rem' }}>
          Only you can see these — not other readers, not us.{' '}
          {rows.length ? `${rows.length} of ${MAX_DRAFTS}.` : ''}
        </p>

        {loading || drafts === null ? (
          <div style={{ color: CREAM_MUTE }}>Loading…</div>
        ) : !user ? (
          <div style={{ color: CREAM_MUTE }}>Sign in to see your drafts.</div>
        ) : rows.length === 0 ? (
          <div style={{ border: '1px solid rgba(245,240,232,0.1)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: SERIF, fontSize: '1.3rem', marginBottom: 8 }}>Nothing in progress</div>
            <div style={{ color: CREAM_MUTE, marginBottom: 20 }}>Anything you start writing is kept here automatically.</div>
            <Link href="/open-pages/new" style={{ fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD, textDecoration: 'none', border: `1px solid ${GOLD}`, borderRadius: 999, padding: '9px 20px' }}>
              Start writing
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(([slot, d]) => (
              <div key={slot} data-draft-row={slot} style={{ border: '1px solid rgba(245,240,232,0.1)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: SERIF, fontSize: '1.25rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {draftLabel(d)}
                    </div>
                    {d.forkedFrom ? (
                      <span title="Kept when two devices had edited this draft differently" style={{ fontFamily: CINZEL, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e8b87b', border: '1px solid rgba(232,184,123,0.35)', background: 'rgba(232,184,123,0.1)', borderRadius: 999, padding: '2px 8px' }}>
                        Other device
                      </span>
                    ) : null}
                  </div>
                  <div style={{ color: CREAM_MUTE, fontSize: '0.85rem', marginTop: 4 }}>
                    {ago(d.updatedAt)} · {draftWords(d).toLocaleString()} {draftWords(d) === 1 ? 'word' : 'words'}
                  </div>
                </div>
                <Link href={`/open-pages/new?draft=${slot}`} style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Continue
                </Link>
                <button type="button" onClick={() => del(slot)} disabled={busy === slot}
                  style={{ background: 'transparent', border: 'none', padding: 0, color: CREAM_MUTE, fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  {busy === slot ? '…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 32 }}>
          <button type="button" onClick={() => router.push('/open-pages')} style={{ background: 'transparent', border: 'none', padding: 0, color: CREAM_MUTE, fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
            ← Back to Open Pages
          </button>
        </div>
      </div>
    </div>
  );
}
