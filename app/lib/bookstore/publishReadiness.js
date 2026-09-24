// W1 / ADM-01 — WHAT A TITLE NEEDS BEFORE IT MAY GO ON SALE, as one pure function.
//
// The requirement already existed in two places and was enforced in one of them. validateTitle
// (schema.js, locked) refuses `status: 'published'` without coverUrl and epubPath, and the
// edit form checks the same pair before it saves. But the titles table's one-tap Publish button
// calls setTitleStatus(), a bare status PATCH that ran neither — so a draft with no EPUB could
// be put on sale from the table in one tap, with nothing to deliver to the buyer.
//
// This module holds no Firebase import so node tests can load it; admin-writes.js calls it
// before the write, and the refusal names what is missing and what to do.
//
// THE SAMPLE IS NOT REQUIRED. samplePath is optional by design (admin-writes.js buildTitleDoc):
// a title with no sample simply shows no "Read a sample" button. So it is not on this list.

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/** The things a title still lacks before it may be published, in the words the admin reads. */
export function missingForPublish(title) {
  const t = title || {};
  const missing = [];
  if (!isStr(t.coverUrl)) missing.push('cover image');
  if (!isStr(t.epubPath)) missing.push('EPUB');
  return missing;
}

/** The refusal, or null when the title is ready. */
export function publishRefusal(title) {
  const missing = missingForPublish(title);
  if (!missing.length) return null;
  const name = title && title.title ? `“${title.title}”` : 'This title';
  return `${name} can't be published yet: it has no ${missing.join(' or ')}. `
    + `Open Edit, add the ${missing.join(' and the ')}, then publish.`;
}
