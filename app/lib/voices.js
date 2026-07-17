// Shared reads for Voices of the Island (cms_voices).
// The roster is deliberately its own node: cms_authors holds guest records keyed by
// push-id, and users/{uid} is reader-editable — neither can back a curated, ordered
// card gallery. See the Phase 1 commit message for the full reasoning.

// RTDB returns a plain object rather than an array whenever stored indices are not
// contiguous from 0, and omits the key entirely when the array was empty. Never
// assume Array here.
export function readMatchNames(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

// Published voices, in roster order. Ties fall back to name so the grid never
// reshuffles between builds when two voices share an order value.
export function publishedVoices(node) {
  return Object.entries(node || {})
    .map(([slug, v]) => ({ ...v, slug }))
    .filter((v) => v.published === true)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.displayName || '').localeCompare(b.displayName || ''));
}

export function firstNameOf(displayName) {
  return (displayName || '').trim().split(/\s+/)[0] || '';
}

// cms_stories.date is a display string ("Jan 15, 2026"), not a timestamp, so RTDB
// cannot sort on it — newest-first has to happen here, after the query. Every one of
// the 148 rows parses cleanly today; an unparseable one sorts last rather than NaN-ing
// the comparator.
function dateValue(d) {
  const t = Date.parse(d);
  return Number.isNaN(t) ? -Infinity : t;
}

// A voice's published works, newest first.
//
// Server-filtered: one indexed equalTo per identity, never a wholesale cms_stories
// fetch (1.18 MB today). Identity is authorUid because three writers publish under two
// name spellings each — matching on the display string would silently drop half of
// each catalogue. matchNames is the fallback for the handful of rows saved with no uid
// (guest and collaboration pieces), which the uid match cannot reach.
//
// Requires "cms_stories": { ".indexOn": ["authorUid", "author"] }.
export async function loadWorks(db, voice) {
  const { ref, query, orderByChild, equalTo, get } = await import('firebase/database');
  const seen = new Map();

  // Only the four fields a row renders are retained. RTDB has no field projection, so
  // the snapshot itself carries content/extractedText; keeping the projection to this
  // one place means the heavy fields are never held past the loop.
  const collect = (snap) => {
    if (!snap.exists()) return;
    Object.entries(snap.val() || {}).forEach(([slug, s]) => {
      if (!s || s.published !== true || seen.has(slug)) return;
      seen.set(slug, {
        slug,
        title: s.title || '(untitled)',
        categoryName: s.categoryName || '',
        date: s.date || '',
      });
    });
  };

  const uid = (voice?.matchUid || '').trim();
  if (uid) {
    collect(await get(query(ref(db, 'cms_stories'), orderByChild('authorUid'), equalTo(uid))));
  }
  for (const name of readMatchNames(voice?.matchNames)) {
    collect(await get(query(ref(db, 'cms_stories'), orderByChild('author'), equalTo(name))));
  }

  return [...seen.values()].sort((a, b) => dateValue(b.date) - dateValue(a.date));
}
