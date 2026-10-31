// UNRELEASED-1 — the emulator's catalogue. Invented records only; nothing here is a real story.
export const NS = 'calvary-scribblings-default-rtdb';
export const EMU = 'http://127.0.0.1:9000';

const para = (n, words) => Array.from({ length: n }, (_, i) => `<p>${words} — paragraph ${i + 1}. ${'The tide came in over the stones and went out again. '.repeat(6)}</p>`).join('');

const story = (slug, title, extra) => ({
  title, author: 'Ada Fixture', authorUid: 'emu-author', category: 'short', categoryName: 'Short Stories',
  date: 'Oct 30, 2026', cover: '', trailerQuote: 'A line from the fixture.', readTime: '4 min read',
  content: para(14, title), ...extra,
});

/** The fresh story: scheduled at the first build, flipped live before the visit. */
export const FRESH = 'emu-fresh-tale';
/** Scheduled throughout: must stay not found. */
export const SCHEDULED = 'emu-scheduled-tale';
/** Scheduled at the first build for a date weeks past (held for a cover, say), flipped live:
 *  outside its free week, so a signed-out reader gets the preview and the gate. */
export const FRESH_ARCHIVED = 'emu-fresh-archived-tale';
/** Live throughout, so every story route has a page to build. */
export const STANDING = 'emu-standing-tale';

export function catalogue({ freshLive, now = Date.now() }) {
  const future = new Date(now + 7 * 864e5).toISOString();
  const recent = new Date(now - 60e3).toISOString();
  const weeksAgo = new Date(now - 30 * 864e5).toISOString();
  const stories = {
    [STANDING]: story(STANDING, 'The Standing Tale', { published: true }),
    [FRESH]: story(FRESH, 'The Fresh Tale', freshLive ? { published: true, publishAt: recent } : { published: false, publishAt: future }),
    [FRESH_ARCHIVED]: story(FRESH_ARCHIVED, 'The Fresh Archived Tale', freshLive ? { published: true, publishAt: weeksAgo } : { published: false, publishAt: weeksAgo, coverHold: true }),
    [SCHEDULED]: story(SCHEDULED, 'The Scheduled Tale', { published: false, publishAt: future }),
  };
  const bodies = Object.fromEntries(Object.entries(stories).map(([k, s]) => [k, { content: s.content }]));
  return { cms_stories: stories, story_bodies: bodies, users: { 'emu-author': { displayName: 'Ada Fixture', username: 'adafixture' } } };
}

export async function seed(data) {
  for (const [node, value] of Object.entries(data)) {
    const res = await fetch(`${EMU}/${node}.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(value) });
    if (!res.ok) throw new Error(`seed ${node}: HTTP ${res.status}`);
  }
}
