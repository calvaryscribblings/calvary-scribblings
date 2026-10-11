// THE WRITER ROSTER — one module for both admin screens (W38, ruling 140).
//
// Moved verbatim out of app/admin/page.js, where the story CMS built it inline, so the Series
// admin chooses a writer from the same list the CMS does and neither screen has its own idea of
// who counts as a writer. The CMS's behaviour is unchanged: same reads, same order, same fields,
// same error sentence. tests/ci/w38-series-admin.test.mjs holds that.
//
// WHO IS ON IT. The top-level users node is admin-read but enumerating it would list every
// reader on the island, so the roster is DERIVED: the authorUids actually used across
// cms_stories, each read per uid from users/<uid>. A writer who has never had a story is found
// by their @handle instead, through usernames/<handle>.
//
// Guests from cms_authors have no uid, so they are not here: the Series needs an account to key
// Voices, search and myStories on, and the CMS reads its guest list separately.
//
// The firebase functions are passed in, not imported, so a plain node test can drive both
// halves against a fake.

/** The distinct, trimmed authorUids used across a cms_stories value. */
export function rosterUids(stories) {
  const uidSet = new Set();
  Object.values(stories || {}).forEach((st) => {
    const u = (st && st.authorUid ? String(st.authorUid) : '').trim();
    if (u) uidSet.add(u);
  });
  return [...uidSet];
}

/**
 * [{ uid, displayName, username }], sorted by name. `stories` is the cms_stories value when the
 * caller already has it (the CMS reads it alongside cms_authors); otherwise it is read here.
 */
export async function loadWriterRoster({ db, ref, get, stories }) {
  let value = stories;
  if (value === undefined) {
    const snap = await get(ref(db, 'cms_stories'));
    value = snap.exists() ? snap.val() : {};
  }
  const roster = (await Promise.all(rosterUids(value).map(async (uid) => {
    try {
      const snap = await get(ref(db, `users/${uid}`));
      if (!snap.exists()) return null;
      const u = snap.val() || {};
      return { uid, displayName: u.displayName || '(unknown user)', username: u.username || '' };
    } catch (e) { return null; }
  }))).filter(Boolean);
  roster.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return roster;
}

/** "@Name " → "name": how a typed handle is looked up. */
export const normaliseHandle = (raw) => String(raw || '').trim().toLowerCase().replace(/^@+/, '');

/**
 * A typed @handle → { uid, displayName, username } through usernames/<handle> and users/<uid>,
 * or { error } in the CMS's own words. Throws only if a read itself fails.
 */
export async function findWriterByHandle({ db, ref, get }, typed) {
  const raw = normaliseHandle(typed);
  if (!raw) return { error: '' };
  const hSnap = await get(ref(db, `usernames/${raw}`));
  const uid = hSnap.exists() ? String(hSnap.val() || '').trim() : '';
  if (!uid) return { error: `No user found for @${raw}.` };
  const uSnap = await get(ref(db, `users/${uid}`));
  const u = uSnap.exists() ? (uSnap.val() || {}) : {};
  return { uid, displayName: u.displayName || '', username: u.username || raw };
}
