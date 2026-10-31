'use client';
// UNRELEASED-1 — READABLE THE MOMENT IT GOES LIVE.
//
// A story that is not live has no page in the export (app/lib/storyAccess.js, hasStaticPage), so
// its page arrives with the deploy that follows its go-live — 1.4 to 5 minutes, measured 17–30
// Oct. For those minutes the story is already on Home while /stories/<slug> has no file, and
// Cloudflare serves this site's 404. So on a /stories/<slug> address, and only there, the 404
// asks /api/story — the one thing that decides whether a story is live, on the server clock:
//
//   · 200 (or the 503 that still carries a preview): the story is live. It is drawn by the story
//     page's own component, from the public record and the endpoint's answer, as the built page
//     will draw it — the same hero, byline, prose and gate, and the same read counting, because it
//     IS the same component.
//   · anything else: the ordinary 404, exactly as now. A scheduled, held or hidden story answers
//     404 like a slug that never existed, and the record is never read until the endpoint has
//     said 200 — so a story that is not live shows nothing more than any missing page does.
//
// Until the answer the 404's words are held back (the attribute set before first paint), as the
// deleted-piece address does, so a live story never flashes "nothing at this address" first.
// A reader-mode story is not served here: its home is /reader/<slug>, which this does not cover.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import NotFoundPage from './NotFoundPage';
import { requestStory, bodyOf } from '../lib/story';

const StoryPageClient = dynamic(() => import('../stories/[slug]/page-client'), { ssr: false });

const RECORD_DEADLINE_MS = 8000;
export const STORY_PATH_RE = /^\/stories\/([a-z0-9][a-z0-9-]*)\/?$/;
const STORY_PATH_SCRIPT = `try{if(${STORY_PATH_RE}.test(location.pathname))document.documentElement.setAttribute('data-story-path','')}catch(e){}`;
const STORY_PATH_STYLE = 'html[data-story-path] [data-nf-general]{visibility:hidden}';

export function storySlugFromPath(pathname) {
  const m = STORY_PATH_RE.exec(pathname || '');
  return m ? m[1] : null;
}

/** The live story for `slug`, as the static page's initialStory, or null for "not found". */
export async function liveStory(slug) {
  let data;
  try { data = await requestStory(null, slug); } catch { return null; }   // 404, 5xx, offline
  if (!data || (data.access !== 'full' && data.access !== 'preview')) return null;
  // Only now, with the endpoint's 200 in hand, is the public record read. Its body is dropped on
  // the way in, as the story page drops it: the body is the endpoint's to give.
  // Through the app's own client (app/lib/firebase.js), loaded only now, so the 404 every other
  // address gets carries none of it.
  let rec;
  try {
    const [{ db }, { ref, get }] = await Promise.all([import('../lib/firebase'), import('firebase/database')]);
    // get() never settles against a database it cannot reach (PL-12), and the 404's words are
    // held back until this answers — so it gets a deadline, past which the page is not found.
    const snap = await Promise.race([
      get(ref(db, `cms_stories/${slug}`)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), RECORD_DEADLINE_MS)),
    ]);
    rec = snap.val();
  } catch { return null; }
  if (!rec || typeof rec !== 'object') return null;
  const { content: _body, extractedText: _text, ...meta } = rec;
  return {
    id: slug, ...meta,
    content: bodyOf(data), contentIsPreview: data.access === 'preview',
    // The page's own refusal (W4) carries a build-time instant; this answer is the server's, now.
    lockAtMs: null, previewLockAtMs: null, previewHtml: null,
  };
}

export default function NotFoundOrLiveStory() {
  const [live, setLive] = useState(null);
  useEffect(() => {
    const slug = storySlugFromPath(window.location.pathname);
    if (!slug) return undefined;
    let current = true;
    liveStory(slug).then((initialStory) => {
      if (!current) return;
      if (initialStory) {
        if (initialStory.title) document.title = `${initialStory.title} — Calvary Scribblings`;
        // The attribute stays: it hides only the 404's words, which are about to unmount, and
        // lifting it first would flash them for a frame.
        setLive({ params: Promise.resolve({ slug }), initialStory });
      } else {
        document.documentElement.removeAttribute('data-story-path');
      }
    });
    return () => { current = false; };
  }, []);

  if (live) return <StoryPageClient params={live.params} initialStory={live.initialStory} />;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: STORY_PATH_SCRIPT }} />
      <style dangerouslySetInnerHTML={{ __html: STORY_PATH_STYLE }} />
      <NotFoundPage />
    </>
  );
}
