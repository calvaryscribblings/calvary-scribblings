'use client';
// ─────────────────────────────────────────────────────────────────────────────
// THE READER GATE — which register does this slug belong to?
//
//   a published bookstore title  → BookstoreReaderClient (sample / purchased / interstitial)
//   anything else                → StoryReaderClient      (cms_stories)
//
// R7.3 §C — WHAT WENT, AND WHY IT HAD TO.
//
// There used to be a third case in front of these two: `stories.some(s => s.id === slug)`,
// a synchronous hit against the hardcoded array in app/lib/stories.js, which returned the
// story reader on the very first render with no fetch and no spinner. That array has been
// `[]` since the CMS migration on 2026-05-18. So the branch was not a fast path — it was a
// test that could never pass, guarding a comment that claimed a speed-up nothing could
// reach. It is gone, along with the rationale that outlived its data.
//
// THE REAL PATH IS NOW THE ONLY PATH, AND IT RUNS IN PARALLEL.
// Both registers need one RTDB read to decide anything: the bookstore needs the indexed
// bookstore_titles lookup, the story register needs cms_stories/{slug}. They used to be
// SERIAL by construction — the gate resolved the bookstore lookup, then mounted
// StoryReaderClient, whose own effect only then began fetching the story — so a story open
// paid for two round trips end to end when it needed to pay for the longer of the two. They
// are fired together here and the resolved story is handed down as a prop, so
// StoryReaderClient's fallback fetch never runs.
//
// ── SLUG-COLLISION PRECEDENCE (recon §8.2) ───────────────────────────────────
// A slug can, in principle, exist in BOTH namespaces: cms_stories keys and
// bookstore_titles.slug values are written by different admin surfaces with no shared
// uniqueness check. Now that both are read at once, the tie has to be decided explicitly
// rather than falling out of which fetch was started first.
//
//   THE PUBLISHED BOOKSTORE TITLE WINS.
//
// Because the two mistakes are not equal. Serving the free story reader for a slug that is
// also a title on sale hands out something that was meant to be bought, and no later fix
// un-gives it. Serving the store's interstitial for a slug that is also a free story shows
// a buy button to someone who could have read for nothing — irritating, visible, and
// recoverable by one tap on the link the interstitial already carries. When one branch of a
// collision is unrecoverable, precedence belongs to the other. The bookstore side is also
// the smaller and newer namespace, editorially controlled and validated at publish time,
// which makes it the cheaper one to keep clean.
//
// Note the asymmetry this leaves on purpose: only a PUBLISHED title takes precedence. A
// draft bookstore title sharing a slug with a live story does not shadow it.
// ─────────────────────────────────────────────────────────────────────────────
import { use, useEffect, useState } from 'react';
import { getTitleBySlug } from '../../lib/bookstore/loader';
import { resolveAuthorNames, currentAuthorName } from '../../lib/resolveAuthorNames';
import StoryReaderClient from './page-reader';
import BookstoreReaderClient from './book-reader';

// The story half of the race. Returns null on anything at all — a missing record, a network
// failure, a permission problem — because the gate's job is to pick a register, and "no
// story" and "could not ask" lead to the same one.
//
// It reads through app/lib/firebase's `db`, which is the SAME database handle the bookstore
// loader uses. That matters for §C: RTDB multiplexes over one connection per handle, so the
// two reads travel down a socket that is already being opened for the other, instead of the
// story fetch paying for a second handshake behind the first.
async function fetchStory(slug) {
  try {
    const { db } = await import('../../lib/firebase');
    const { ref, get } = await import('firebase/database');
    const snap = await get(ref(db, 'cms_stories/' + slug));
    if (!snap.exists()) return null;
    const data = { id: slug, ...snap.val() };
    // The author's CURRENT display name, resolved here rather than in the register, so the
    // record arrives complete and nothing downstream needs a second round trip.
    try {
      const nameMap = await resolveAuthorNames([data]);
      data.author = currentAuthorName(data, nameMap);
    } catch (e) { /* the frozen copy on the record is an acceptable fallback */ }
    return data;
  } catch (e) {
    return null;
  }
}

function ReaderSpinner() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );
}

export default function ReaderGate({ params }) {
  const { slug } = use(params);
  // undefined = still resolving; then { book, story } with either or both null.
  const [resolved, setResolved] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Promise.all, not two awaits: the whole point of §C. allSettled is unnecessary
      // because both helpers already absorb their own failures and resolve to null.
      const [title, story] = await Promise.all([
        getTitleBySlug(slug).catch(() => null),
        fetchStory(slug),
      ]);
      if (cancelled) return;
      setResolved({ book: title && title.status === 'published' ? title : null, story });
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (resolved === undefined) return <ReaderSpinner />;
  // THE FORK. Precedence is stated in the header above: a published bookstore title wins a
  // slug collision, because the mistake in the other direction cannot be undone.
  if (resolved.book) return <BookstoreReaderClient slug={slug} title={resolved.book} />;
  return <StoryReaderClient params={params} initialStory={resolved.story} />;
}
