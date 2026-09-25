// W6 — WHAT A VOICES ACTION ACTUALLY DID, IN WORDS. The admin tells the truth.
//
// Audit ADM-10: every action on /admin/voices awaited fireRebuild() — a 10s settle wait and then
// the request — before saying anything, so a save sat on "Saving…" for ten seconds or more, and
// then said "✓ Voice saved and published" whether or not the rebuild had started. fireRebuild's
// verdict was logged to the console and dropped.
//
// Now the notice has two halves that arrive separately:
//
//   1. THE WRITE — shown the moment the database answers. A failed write says nothing changed
//      and that no rebuild was asked for.
//   2. THE REBUILD — 'waiting' while the settle runs, then requestRebuild's verdict. The success
//      line ("Rebuild started…") appears ONLY when the write succeeded and the endpoint answered
//      202. Anything else says the site was not rebuilt and offers "Retry the rebuild".
//
// There is no follower notification on this surface (the audit's "N notified / N failed" is the
// story CMS's, app/admin/page.js). Voices has nobody to notify.
//
// Pure: no React, no Firebase, no fetch, so tests/ci/w6-voices.test.mjs runs it directly.

export const ACTIONS = Object.freeze(['save', 'publish', 'unpublish', 'delete', 'reorder']);

/**
 * Does this change reach anything a reader can see? A voice that was a draft and is still a
 * draft is not on the static /voices export, so saving it owes no build. Everything else does —
 * including an edit to a published voice, whose publishedness did not change but whose page did.
 */
export function voiceRebuildNeeded(wasPublished, isPublished) {
  return wasPublished === true || isPublished === true;
}

/** What the rebuild will change, said per action. Captured when the rebuild is requested. */
export function rebuildEffect(action, { slug, published } = {}) {
  switch (action) {
    case 'delete': return `/voices/${slug} comes down`;
    case 'unpublish': return 'the card leaves /voices';
    case 'reorder': return '/voices shows the new order';
    case 'publish': return `/voices/${slug} is live`;
    default: return published ? `/voices/${slug} is live` : 'the card leaves /voices';
  }
}

// rebuild.js's failure sentences end "The record is published either way." — true for a
// publish, false for a delete or an unpublish. That module is shared (and not this round's to
// change), so the clause is removed here and this notice says what is true for the action.
export function rebuildReason(message) {
  return String(message || '').replace(/\s*The record is published either way\.\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function doneLine(action, published) {
  switch (action) {
    case 'save': return published ? 'Voice saved and published.' : 'Voice saved as a draft.';
    case 'publish': return 'Voice published.';
    case 'unpublish': return 'Voice unpublished.';
    case 'delete': return 'Voice deleted.';
    case 'reorder': return 'Order saved.';
    default: return 'Saved.';
  }
}

function failLine(action) {
  switch (action) {
    case 'save': return 'The voice was not saved';
    case 'publish': return 'The voice was not published';
    case 'unpublish': return 'The voice was not unpublished';
    case 'delete': return 'The voice was not deleted';
    case 'reorder': return 'The new order was not saved';
    default: return 'Nothing was saved';
  }
}

/**
 * The notice for one action.
 *
 * @param outcome.action     one of ACTIONS
 * @param outcome.published  the voice's published flag AFTER the action
 * @param outcome.write      { ok: true } | { ok: false, error: string }
 * @param outcome.rebuild    null (none needed) | { phase: 'waiting', effect }
 *                           | { phase: 'done', effect, verdict: { ok, status, message } }
 * @returns {{ tone: 'ok' | 'pending' | 'bad', text: string, canRetryRebuild: boolean }}
 */
export function voiceNotice({ action, published, write, rebuild } = {}) {
  if (!write || write.ok !== true) {
    const why = write?.error ? `: ${write.error}` : '';
    return { tone: 'bad', text: `${failLine(action)}${why}. Nothing was changed, and no rebuild was asked for.`, canRetryRebuild: false };
  }
  const done = doneLine(action, published);
  if (!rebuild) {
    const tail = action === 'save' && !published ? ' It stays off /voices until you publish it.' : '';
    return { tone: 'ok', text: `${done}${tail}`, canRetryRebuild: false };
  }
  if (rebuild.phase === 'waiting') {
    return { tone: 'pending', text: `${done} Asking for a rebuild — the live site does not show this yet.`, canRetryRebuild: false };
  }
  const v = rebuild.verdict;
  if (v && v.ok === true) {
    return { tone: 'ok', text: `${done} Rebuild started — ${rebuild.effect} in about two minutes.`, canRetryRebuild: false };
  }
  const reason = rebuildReason(v?.message) || 'The rebuild did not start.';
  return {
    tone: 'bad',
    text: `${done} But the site was not rebuilt, so the live site does not show it yet. ${reason}`,
    canRetryRebuild: true,
  };
}
