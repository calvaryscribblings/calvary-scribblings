// NOTIF-B2 — telling readers, from the browser, after an event has landed.
//
// Every web writer that used to push a note into library_notifications/{uid} or notifications/{uid}
// itself now calls this instead, once its own write is saved. POST /api/notify reads the event,
// checks it is the caller's, works out who hears (blocks, mutes, the mention cap, grouping) and
// writes their records: the new inbox, and the old note the app's two bells still read
// (functions/api/notify.js). The client names WHAT happened, never WHO hears.
//
// ⚠ FIRE AND FORGET, LIKE requestScreening. Telling someone is a courtesy after the event, never a
// part of it: nothing here is awaited at a call site, nothing is shown, nothing throws. If the
// endpoint is down, the comment, reply, reaction, follow or message stays saved.
//
//   event              subjectId
//   comment            {slug}/{commentId}
//   comment_reaction   {slug}/{commentId}/{type}
//   story_reaction     {slug}/{type}               (the app's; the web has no story-reaction writer)
//   follow             {targetUid}
//   square_post        {postId}                    a post, a reply or a quote
//   square_reaction    {postId}/{type}
//   message            {convId}/{messageId}
//   open_pages_reply   {pieceId}/{commentPath}

export const NOTIFY_EVENTS = Object.freeze([
  'comment', 'comment_reaction', 'story_reaction', 'follow', 'square_post', 'square_reaction', 'message', 'open_pages_reply',
]);

/**
 * @param {{ getIdToken?: () => Promise<string> }|null} user   the signed-in Firebase user
 * @param {string} event
 * @param {string} subjectId
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<boolean>} true only if the endpoint answered 200. Never throws.
 */
export async function notifyEvent(user, event, subjectId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    if (!user?.getIdToken || !NOTIFY_EVENTS.includes(event) || typeof subjectId !== 'string' || !subjectId) return false;
    const token = await user.getIdToken();
    if (!token) return false;
    const res = await fetchImpl('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event, subjectId }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
