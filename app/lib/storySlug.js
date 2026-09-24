// W1 / ADM-08 — A NEW STORY NEVER TAKES AN ADDRESS THAT IS ALREADY SOMEONE'S.
//
// A story's slug is its RTDB key (cms_stories/{slug}) and its web address (/stories/{slug}).
// The CMS derived it from the title and wrote with a per-field multi-path update, which MERGES:
// a "New Story" titled like an existing one landed its fields over the old record — title,
// author, body, cover — and kept whatever the form does not own (quiz, reads). No warning, no
// undo. A title of only punctuation or non-Latin letters slugged to '' and wrote
// `cms_stories/title`, `cms_stories/content` … as top-level children of the node.
//
// This module is the decision; app/admin/page.js asks it before every NEW-story write, against
// a live read, and offers the first free address when the natural one is taken. An EDIT keeps
// its own slug and never comes here. No Firebase import, so node tests load it directly.

/** The address a title would take. Unchanged from the CMS's original rule, so no live story moves. */
export function slugify(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** How many numbered addresses to try before giving up and asking for a different title. */
export const MAX_SUFFIX = 50;

/**
 * The first free address at or after `base`: base, base-2, base-3 … base-50.
 * `isTaken` may be sync or async; it is asked once per candidate, in order.
 * Returns null if every candidate is taken (the admin is then told to change the title).
 */
export async function firstFreeSlug(base, isTaken) {
  if (!base) return null;
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return null;
}

/**
 * The verdict for a NEW story.
 *   { ok: true, slug }                          write here
 *   { ok: false, reason: 'empty' }              the title makes no address
 *   { ok: false, reason: 'taken', slug, offer } `slug` belongs to another story; `offer` is free (or null)
 * `chosen` is an address the admin already accepted from an earlier offer; it is checked like
 * any other, so an offer that was taken in the meantime is refused too.
 */
export async function newStorySlug({ title, chosen, isTaken }) {
  const slug = chosen || slugify(title);
  if (!slug) return { ok: false, reason: 'empty' };
  if (!(await isTaken(slug))) return { ok: true, slug };
  return { ok: false, reason: 'taken', slug, offer: await firstFreeSlug(slugify(title) || slug, isTaken) };
}
