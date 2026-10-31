'use client';
// PROOFS-R1 (ruling 255) — IS THIS STORY LIVE? The Square draws a story card only once it knows.
//
// A post written before the write Function refused one (or by an app build that writes directly)
// can carry a card for a story that is scheduled, held, hidden or deleted. Drawing it would print an
// unreleased title and cover in the room, and link to a page that isn't there. So the card waits for
// the answer, and a story that is not live, or whose answer never comes, draws no card. The post's
// own words are drawn either way.
//
// The answer is the story's index entry: cms_stories_index holds exactly the live stories
// (isIndexed is isReadableStory), a few hundred bytes each, where the record would carry the whole
// text. One read per story per page load, shared by every card that asks, as pieceGone.js does.
// firebase is imported inside the read, so AttachmentCard stays importable by a node test.
import { useEffect, useState } from 'react';
import { isReadableStory } from './storyAccess.js';
import { INDEX_PATH } from './storyIndex.js';

const answers = new Map(); // slug -> Promise<boolean>
const settled = new Map(); // slug -> boolean, once the read has answered

/** Record an answer, so the next card for this story starts from it (and a test can seed it). */
export function rememberStory(slug, live) { settled.set(slug, live === true); }

export function storyLive(slug) {
  if (!answers.has(slug)) {
    answers.set(slug, (async () => {
      const [{ db }, { ref, get }] = await Promise.all([import('./firebaseCore.js'), import('firebase/database')]);
      const live = isReadableStory((await get(ref(db, `${INDEX_PATH}/${slug}`))).val());
      rememberStory(slug, live);
      return live;
    })().catch(() => false));
  }
  return answers.get(slug);
}

/** true once a read has shown the story is live; false until then, if it isn't, or with no slug. */
export function useStoryLive(slug) {
  const [live, setLive] = useState(() => (slug ? settled.get(slug) === true : false));
  useEffect(() => {
    if (!slug) return undefined;
    let on = true;
    storyLive(slug).then((v) => { if (on) setLive(v); });
    return () => { on = false; };
  }, [slug]);
  return live;
}

/** Its children only once `slug` is known to be live — for the profile pages' own small cards. */
export function LiveStoryOnly({ slug, children }) {
  return useStoryLive(slug) ? children : null;
}
