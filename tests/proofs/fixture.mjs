// PROOFS — invented records only. No real story, writer or text.
export const NOW = Date.parse('2026-11-01T00:00:00Z');
const day = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
export const WRITER_A = 'proofs-writer-a';
export const WRITER_B = 'proofs-writer-b';
export const READER = 'proofs-reader-c';

const rec = (uid, extra) => ({ title: 'An Invented Title', author: 'Invented Writer', authorUid: uid, category: 'short', categoryName: 'Short Story', date: 'Nov 2, 2026', cover: 'https://example.test/cover.png', ...extra });

export const STORIES = {
  'pf-a-one':     rec(WRITER_A, { published: false, publishAt: iso(NOW + day) }),
  'pf-a-two':     rec(WRITER_A, { published: false, publishAt: iso(NOW + 2 * day) }),
  'pf-a-live':    rec(WRITER_A, { published: true, publishAt: iso(NOW - day) }),
  'pf-a-hidden':  rec(WRITER_A, { published: false, publishAt: iso(NOW + day), hiddenAt: iso(NOW - day) }),
  'pf-a-held':    rec(WRITER_A, { published: false, publishAt: iso(NOW - day), coverHold: true }),
  'pf-a-retired': rec(WRITER_A, { published: false, publishAt: iso(NOW + day) }),
  'pf-b-one':     rec(WRITER_B, { published: false, publishAt: iso(NOW + 3 * day) }),
  'pf-nobody':    { ...rec(null, { published: false, publishAt: iso(NOW + 4 * day) }), authorUid: null },
};
// A stray public copy on one record: the proof must NOT use it (ruling 255: what publishes is story_bodies).
STORIES['pf-a-one'].content = '<p>STALE PUBLIC COPY</p>';
export const BODY = (slug) => ({ content: `<p>Invented body of ${slug}, first paragraph.</p><p>Second paragraph.</p>`, extractedText: 'invented' });
export const RETIRED = { 'pf-a-retired': { reason: 'test', at: NOW - day } };
