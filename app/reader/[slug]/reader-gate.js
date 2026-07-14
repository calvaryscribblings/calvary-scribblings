'use client';
// Reader gate — decides, on the client, whether a slug is:
//   (a) hardcoded Story Island content  → existing StoryReaderClient, mounted IMMEDIATELY & unchanged
//   (b) a published bookstore title      → BookstoreReaderClient (sample / interstitial, Part 3)
//   (c) anything else (cms_stories, unknown) → existing StoryReaderClient (its own resolution path)
//
// Regression guard: for hardcoded stories the gate returns StoryReaderClient on the very first
// render with NO extra fetch and NO spinner — identical to the previous `return <StoryReaderClient/>`.
// The bookstore lookup only runs for NON-hardcoded slugs, so free Story Island reading is untouched.
// The one behavioural change is for cms_stories: they incur a single indexed lookup on
// bookstore_titles (returns empty) before handing off to the existing reader.
import { use, useEffect, useState } from 'react';
import { stories } from '../../lib/stories';
import { getTitleBySlug } from '../../lib/bookstore/loader';
import StoryReaderClient from './page-reader';
import BookstoreReaderClient from './book-reader';

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
  const isStory = stories.some((s) => s.id === slug);
  const [book, setBook] = useState(undefined); // undefined = checking, null = not a book, object = published title

  useEffect(() => {
    if (isStory) { setBook(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const t = await getTitleBySlug(slug);
        if (!cancelled) setBook(t && t.status === 'published' ? t : null);
      } catch {
        if (!cancelled) setBook(null);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, isStory]);

  if (isStory) return <StoryReaderClient params={params} />;
  if (book === undefined) return <ReaderSpinner />;
  if (book) return <BookstoreReaderClient slug={slug} title={book} />;
  return <StoryReaderClient params={params} />;
}
