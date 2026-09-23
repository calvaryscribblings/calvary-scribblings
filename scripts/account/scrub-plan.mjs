// THE ACCOUNT SCRUB — the scattered half of an account deletion. Pure.
//
// functions/api/account/_deletion.js deletes everything KEYED by a reader and then their Auth
// account. This finds everything SCATTERED — under other stories, other posts, other readers'
// inboxes — and returns it as one plan: paths to null, counters to take down, fields to detach.
// scripts/account/scrub.mjs reads the nodes, calls this, and applies the plan.
//
// POLICY — DRAFT FOR IKENNA where marked. Every line of it is a choice, stated where it is made.
//
//   DELETE  their comments and replies, and the thread under a comment of theirs (replies are
//           part of the conversation that comment started; left behind they would hang off
//           nothing). DRAFT: the alternative is to keep the text as "a deleted reader".
//   DELETE  their Square posts (live and archived) and the replies under them. DRAFT, as above.
//   DELETE  their Open Pages pieces, with the comments, likes and reports attached to them. DRAFT.
//   DELETE  their reactions, likes and poll votes on OTHER people's work — and take each counter
//           down by one, so "12 hearts" does not keep counting someone who is gone.
//   DELETE  notifications they caused in other readers' inboxes (they carry name and avatar).
//   DELETE  their reading records (storyReads), their seasonal-board rows. DRAFT for the closed
//           seasons: a finished contest's standings lose a row.
//   DELETE  the messages THEY sent in DMs. The other reader's messages and their pointer to the
//           conversation stay: those are the other reader's. DRAFT.
//   DETACH  cms_voices matchUid — the published reader voice is editorial and stays; only its
//           link to the account goes. DRAFT: whether the voice itself should come down.
//   KEEP    reports they filed and reports about them (safety records, per the privacy policy),
//           rate-limit windows (self-cleaning), CMS stories and series they authored, and their
//           author page (story_authors) — the last three are an editorial ruling owed.
//   BACKSTOP  anything the endpoint deletes is re-checked here (usernames, follows, blocks, a
//           stub users/{uid} a webhook might have written), so a missed path is caught later.

const isObj = (v) => v && typeof v === 'object';
const entries = (v) => (isObj(v) ? Object.entries(v) : []);

/** The nodes the scrub reads, whole. The runner fetches exactly these. */
export const SCAN_NODES = [
  'comments', 'comment_reactions', 'commentReactions', 'comment_likes', 'comment_screening',
  'storyReads', 'storyReactionUsers', 'leaderboards', 'notifications', 'library_notifications',
  'square_posts', 'square_likes', 'square_reactions', 'square_archive', 'square_archive_reactions',
  'open_pages', 'open_pages_reactions', 'open_pages_pending', 'open_pages_reports',
  'dm_messages', 'blocked_users', 'followers', 'following', 'usernames', 'cms_voices',
  'user_comments', 'user_square_posts',
];

const authoredBy = (rec, uid) => isObj(rec) && (rec.authorUid === uid || rec.uid === uid);

/**
 * @param uid the deleted reader
 * @param snap { [node]: value } for every SCAN_NODES entry, plus snap.userNode (users/{uid})
 * @returns {{ nulls: string[], decrements: string[], counts: object }}
 *   nulls       paths to remove
 *   decrements  counter paths to take down by one each (floored at 0 by the runner). One
 *               reader adds at most one to any counter, so each path appears at most once —
 *               which is also what makes a reaction recorded in BOTH legacy shapes count once.
 */
export function planScrub(uid, snap) {
  const nulls = new Set();
  const decrements = new Set();
  decrements.push = decrements.add;
  const counts = {
    comments: 0, replies: 0, threadRepliesByOthers: 0, commentReactions: 0,
    squarePosts: 0, squareArchived: 0, squareRepliesByOthers: 0, squareReactions: 0,
    openPages: 0, openPagesCommentsByOthers: 0, openPagesReactions: 0,
    storyReads: 0, storyReactions: 0, leaderboardRows: 0,
    notificationsInOthersInboxes: 0, dmMessagesSent: 0, voicesDetached: 0, backstop: 0,
  };
  const del = (p) => nulls.add(p);

  // ── Open Pages pieces first: their comments live at comments/{pieceId} ──────────────────
  const deadPieces = new Set();
  for (const [id, piece] of entries(snap.open_pages)) {
    if (!authoredBy(piece, uid)) continue;
    deadPieces.add(id);
    counts.openPages++;
    for (const node of ['open_pages', 'open_pages_reactions', 'open_pages_pending', 'open_pages_reports',
      'comments', 'comment_likes', 'comment_screening', 'commentReactions', 'comment_reactions']) {
      if (node === 'open_pages' || isObj(snap[node]?.[id])) del(`${node}/${id}`);
    }
    for (const [, c] of entries(snap.comments?.[id])) if (isObj(c) && !authoredBy(c, uid)) counts.openPagesCommentsByOthers++;
  }

  // ── Comments ───────────────────────────────────────────────────────────────────────────
  const deadComments = new Set(); // `${slug}/${cid}`
  for (const [slug, thread] of entries(snap.comments)) {
    if (deadPieces.has(slug)) continue;
    const byId = Object.fromEntries(entries(thread));
    // Theirs, and — iteratively — any flat reply whose parent is dead.
    for (const [cid, c] of Object.entries(byId)) if (authoredBy(c, uid)) deadComments.add(`${slug}/${cid}`);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [cid, c] of Object.entries(byId)) {
        const key = `${slug}/${cid}`;
        if (!deadComments.has(key) && isObj(c) && c.parentId && deadComments.has(`${slug}/${c.parentId}`)) {
          deadComments.add(key); grew = true; counts.threadRepliesByOthers++;
        }
      }
    }
    for (const [cid, c] of Object.entries(byId)) {
      const key = `${slug}/${cid}`;
      if (deadComments.has(key)) {
        if (authoredBy(c, uid)) counts.comments++;
        const author = c?.authorUid || c?.uid;
        if (author && author !== uid && snap.user_comments?.[author]?.[cid] !== undefined) del(`user_comments/${author}/${cid}`);
        del(`comments/${key}`);
        for (const n of ['comment_likes', 'comment_screening', 'commentReactions']) if (snap[n]?.[slug]?.[cid] !== undefined) del(`${n}/${key}`);
        continue;
      }
      // Legacy nested replies inside someone else's comment.
      for (const [rid, r] of entries(c?.replies)) {
        if (!authoredBy(r, uid)) continue;
        counts.replies++;
        del(`comments/${key}/replies/${rid}`);
        if (snap.comment_likes?.[slug]?.[cid]?.replies?.[rid] !== undefined) del(`comment_likes/${key}/replies/${rid}`);
      }
    }
  }
  const commentAlive = (slug, cid) => !deadPieces.has(slug) && !deadComments.has(`${slug}/${cid}`) && isObj(snap.comments?.[slug]?.[cid]);

  // ── Their reactions on comments that stay: two shapes on the wire, one counter each ──────
  const reacted = new Set(); // `${slug}|${cid}|${type}`
  for (const [slug, byUser] of entries(snap.comment_reactions)) {
    if (!isObj(byUser?.[uid]) || deadPieces.has(slug)) continue;
    del(`comment_reactions/${slug}/${uid}`);
    for (const [cid, types] of entries(byUser[uid])) for (const [t, on] of entries(types)) if (on) reacted.add(`${slug}|${cid}|${t}`);
  }
  for (const [slug, byComment] of entries(snap.commentReactions)) {
    if (deadPieces.has(slug)) continue;
    for (const [cid, byUser] of entries(byComment)) {
      if (!isObj(byUser?.[uid]) || deadComments.has(`${slug}/${cid}`)) continue;
      del(`commentReactions/${slug}/${cid}/${uid}`);
      for (const [t, on] of entries(byUser[uid])) if (on) reacted.add(`${slug}|${cid}|${t}`);
    }
  }
  for (const k of reacted) {
    const [slug, cid, t] = k.split('|');
    counts.commentReactions++;
    if (commentAlive(slug, cid)) decrements.push(`comments/${slug}/${cid}/${t}Count`);
  }
  // Likes (Open Pages comment likes) — counted by children, no counter to move.
  for (const [a, byComment] of entries(snap.comment_likes)) {
    if (deadPieces.has(a)) continue;
    for (const [cid, likes] of entries(byComment)) {
      if (deadComments.has(`${a}/${cid}`)) continue;
      if (likes?.[uid] !== undefined) del(`comment_likes/${a}/${cid}/${uid}`);
      for (const [rid, rl] of entries(likes?.replies)) if (rl?.[uid] !== undefined) del(`comment_likes/${a}/${cid}/replies/${rid}/${uid}`);
    }
  }
  for (const [slug, rows] of entries(snap.comment_screening)) {
    for (const [cid, row] of entries(rows)) if (isObj(row) && row.uid === uid) del(`comment_screening/${slug}/${cid}`);
  }

  // ── Story reading and reactions ────────────────────────────────────────────────────────
  for (const [slug, byUser] of entries(snap.storyReads)) if (byUser?.[uid] !== undefined) { del(`storyReads/${slug}/${uid}`); counts.storyReads++; }
  for (const [slug, byUser] of entries(snap.storyReactionUsers)) {
    if (!isObj(byUser?.[uid])) continue;
    del(`storyReactionUsers/${slug}/${uid}`);
    for (const [t, on] of entries(byUser[uid])) if (on) { decrements.push(`storyReactions/${slug}/${t}`); counts.storyReactions++; }
  }
  for (const [season, boards] of entries(snap.leaderboards)) {
    for (const [board, rows] of entries(boards)) if (isObj(rows) && rows[uid] !== undefined) { del(`leaderboards/${season}/${board}/${uid}`); counts.leaderboardRows++; }
  }

  // ── Notifications they caused ──────────────────────────────────────────────────────────
  for (const node of ['notifications', 'library_notifications']) {
    for (const [owner, inbox] of entries(snap[node])) {
      if (owner === uid) { del(`${node}/${uid}`); continue; }
      for (const [id, n] of entries(inbox)) if (isObj(n) && n.fromUid === uid) { del(`${node}/${owner}/${id}`); counts.notificationsInOthersInboxes++; }
    }
  }

  // ── Square: live posts and the archive ─────────────────────────────────────────────────
  const scrubSquare = (postsNode, reactNode, counterFor, countKey) => {
    const posts = Object.fromEntries(entries(snap[postsNode]));
    const dead = new Set(Object.keys(posts).filter((id) => authoredBy(posts[id], uid)));
    counts[countKey] += dead.size;
    let grew = true;
    while (grew) {
      grew = false;
      for (const [id, p] of Object.entries(posts)) if (!dead.has(id) && p?.parentId && dead.has(p.parentId)) { dead.add(id); grew = true; counts.squareRepliesByOthers++; }
    }
    for (const id of dead) {
      del(`${postsNode}/${id}`);
      if (snap[reactNode]?.[id] !== undefined) del(`${reactNode}/${id}`);
      const author = posts[id]?.authorUid;
      if (author && author !== uid && snap.user_square_posts?.[author]?.[id] !== undefined) del(`user_square_posts/${author}/${id}`);
    }
    for (const [id, byType] of entries(snap[reactNode])) {
      if (dead.has(id)) continue;
      for (const [t, users] of entries(byType)) {
        if (users?.[uid] === undefined) continue;
        del(`${reactNode}/${id}/${t}/${uid}`);
        counts.squareReactions++;
        if (isObj(posts[id])) decrements.push(counterFor(id, t));
      }
    }
    // poll votes inside posts that stay
    for (const [id, p] of Object.entries(posts)) if (!dead.has(id) && p?.poll?.votes?.[uid] !== undefined) del(`${postsNode}/${id}/poll/votes/${uid}`);
    return dead;
  };
  const deadLive = scrubSquare('square_posts', 'square_reactions', (id, t) => `square_posts/${id}/${t}Count`, 'squarePosts');
  scrubSquare('square_archive', 'square_archive_reactions', (id, t) => `square_archive/${id}/${t}Count`, 'squareArchived');
  for (const [id, byUser] of entries(snap.square_likes)) {
    if (deadLive.has(id)) { del(`square_likes/${id}`); continue; }
    if (byUser?.[uid] !== undefined) {
      del(`square_likes/${id}/${uid}`);
      counts.squareReactions++;
      if (isObj(snap.square_posts?.[id])) decrements.push(`square_posts/${id}/likeCount`);
    }
  }

  // ── Open Pages likes on pieces that stay ───────────────────────────────────────────────
  for (const [id, byUser] of entries(snap.open_pages_reactions)) {
    if (!deadPieces.has(id) && byUser?.[uid] !== undefined) { del(`open_pages_reactions/${id}/${uid}`); counts.openPagesReactions++; }
  }

  // ── DMs: the messages they sent ────────────────────────────────────────────────────────
  for (const [convId, msgs] of entries(snap.dm_messages)) {
    if (!convId.split('_').includes(uid)) continue;
    for (const [mid, m] of entries(msgs)) if (isObj(m) && m.senderUid === uid) { del(`dm_messages/${convId}/${mid}`); counts.dmMessagesSent++; }
  }

  // ── Detach ─────────────────────────────────────────────────────────────────────────────
  for (const [id, v] of entries(snap.cms_voices)) if (isObj(v) && v.matchUid === uid) { del(`cms_voices/${id}/matchUid`); counts.voicesDetached++; }

  // ── Backstop: what the endpoint should already have removed ────────────────────────────
  const backstop = (p) => { if (!nulls.has(p)) { del(p); counts.backstop++; } };
  for (const [h, v] of entries(snap.usernames)) if (v === uid) backstop(`usernames/${h}`);
  for (const [who, list] of entries(snap.followers)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `followers/${uid}` : `followers/${who}/${uid}`);
  for (const [who, list] of entries(snap.following)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `following/${uid}` : `following/${who}/${uid}`);
  for (const [who, list] of entries(snap.blocked_users)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `blocked_users/${uid}` : `blocked_users/${who}/${uid}`);
  if (snap.userNode !== null && snap.userNode !== undefined) backstop(`users/${uid}`);

  const kept = dropCovered([...nulls]);
  const underDeleted = (p) => kept.some((a) => p === a || p.startsWith(`${a}/`));
  return { nulls: kept, decrements: [...decrements].filter((d) => !underDeleted(d)), counts };
}

/** RTDB refuses a multi-path update in which one path contains another. Keep the ancestor. */
export function dropCovered(paths) {
  const sorted = [...new Set(paths)].sort();
  const out = [];
  for (const p of sorted) if (!out.some((a) => p.startsWith(`${a}/`))) out.push(p);
  return out;
}
