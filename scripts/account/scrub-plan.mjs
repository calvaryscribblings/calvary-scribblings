// THE ACCOUNT SCRUB — the scattered half of an account deletion. Pure.
//
// functions/api/account/_deletion.js deletes everything KEYED by a reader and then their Auth
// account. This finds everything SCATTERED — under other stories, other posts, other readers'
// inboxes — and returns it as one plan: paths to null, counters to take down, fields to detach.
// scripts/account/scrub.mjs reads the nodes, calls this, and applies the plan.
//
// POLICY — RULED by Ikenna, 26 Sep 2026 (rulings 29–34; docs/ACCOUNT-SCRUB-PLAN.md). Every line
// below is one of those rulings, or was already settled before them.
//
//   DELETE  (29) their comments and replies, and their Square posts, live and archived. Nothing of
//           theirs stays up under "a deleted reader".
//   KEEP    (30) other readers' replies beneath them. A comment or post of theirs that still has a
//           reply by someone else under it becomes a TOMBSTONE: { deleted: true, deletedAt,
//           createdAt, parentId, replies } — no words, no author, no counts, no reactions. The
//           thread keeps its shape and draws "This response was deleted." (comments) or "This post
//           was deleted." (the Square). A node of theirs with nothing of anyone else's beneath it
//           is simply deleted. Both comment shapes: flat (parentId) and nested (replies/…, the
//           Open Pages threads, two levels deep).
//   DELETE  their Open Pages pieces, with the comments, likes and reports attached to them. Not
//           covered by rulings 29–34 — unchanged from the plan as written, and flagged there.
//   DELETE  their reactions, likes and poll votes on OTHER people's work — and take each counter
//           down by one, so "12 hearts" does not keep counting someone who is gone.
//   DELETE  notifications they caused in other readers' inboxes (they carry name and avatar).
//   DELETE  (31) their reading records (storyReads) and their seasonal-board rows, closed seasons
//           included.
//   DELETE  (32) the messages THEY sent in DMs. The other reader's messages and their pointer to
//           the conversation stay: those are the other reader's.
//   DELETE  (33) a reader voice (cms_voices) that quotes them — the record, and its card images
//           under Storage voices/{slug}/. Its static page goes with the next build, which the
//           runner summons. (Until W17 the voice stayed up with only its link removed.)
//   KEEP    (34) CMS stories and series they wrote, and their author page (story_authors), until
//           Ikenna makes the editorial call. Also kept: reports they filed and reports about them
//           (safety records, per the privacy policy) and rate-limit windows (self-cleaning).
//   SERIES  (W46, the same rulings applied to Readers' Notes) their notes come down; a note of
//           theirs with someone else's reply beneath it becomes a TOMBSTONE { deleted: true,
//           deletedAt, createdAt, kind, text: '' }, drawn "This note was deleted.", and the other
//           readers' replies stay. Their replies elsewhere keep their row, stripped (removed: true,
//           text: '', no author, no uid) — the room's own "This reply was removed." Their held
//           notes, sides (each tally down by one), room memberships and underlines go. Reports they
//           filed are KEPT (34). The touched series' public summaries are recomputed, so no face of
//           theirs stays on a door.
//   BACKSTOP  anything the endpoint deletes is re-checked here (usernames, follows, blocks, a
//           stub users/{uid} a webhook might have written), so a missed path is caught later.

import { instStats, foldSummary } from '../../app/lib/series/notes.js';

const isObj = (v) => v && typeof v === 'object';
const entries = (v) => (isObj(v) ? Object.entries(v) : []);

/** The nodes the scrub reads, whole. The runner fetches exactly these. */
export const SCAN_NODES = [
  'comments', 'comment_reactions', 'commentReactions', 'comment_likes', 'comment_screening',
  'storyReads', 'series_read_ledger', 'storyReactionUsers', 'leaderboards', 'notifications', 'library_notifications',
  'square_posts', 'square_likes', 'square_reactions', 'square_archive', 'square_archive_reactions',
  'open_pages', 'open_pages_reactions', 'open_pages_pending', 'open_pages_reports',
  'dm_messages', 'dm_muted', 'blocked_users', 'muted_users', 'followers', 'following', 'usernames', 'cms_voices',
  'user_comments', 'user_square_posts',
  // W46 — Readers' Notes
  'series_notes', 'series_notes_held', 'series_note_replies', 'series_sides', 'series_room_members',
  'series_note_underlines', 'series_instalments', 'series_notes_summary',
];

const authoredBy = (rec, uid) => isObj(rec) && (rec.authorUid === uid || rec.uid === uid);

/** A comment of theirs that still has someone else's reply beneath it (ruling 30). */
export function commentTombstone(orig, keptReplies, now) {
  const t = { deleted: true, deletedAt: now };
  if (typeof orig?.createdAt === 'number') t.createdAt = orig.createdAt;
  if (orig?.parentId) t.parentId = orig.parentId;
  if (keptReplies && Object.keys(keptReplies).length) t.replies = keptReplies;
  return t;
}
/** A Square post of theirs with someone else's reply beneath it (ruling 30). */
export function postTombstone(orig, now) {
  const t = { deleted: true, deletedAt: now, parentId: orig?.parentId || null };
  if (typeof orig?.createdAt === 'number') t.createdAt = orig.createdAt;
  if (orig?.pinned === true) t.pinned = true;
  return t;
}

/**
 * @param uid the deleted reader
 * @param snap { [node]: value } for every SCAN_NODES entry, plus snap.userNode (users/{uid})
 * @param opts.now the tombstones' deletedAt
 * @returns {{ nulls: string[], sets: object, decrements: string[], counts: object, voices: object[] }}
 *   nulls       paths to remove
 *   sets        { path: value } — the tombstones (ruling 30), written after the nulls
 *   decrements  counter paths to take down by one each (floored at 0 by the runner). One
 *               reader adds at most one to any counter, so each path appears at most once —
 *               which is also what makes a reaction recorded in BOTH legacy shapes count once.
 *   voices      [{ id, storagePrefixes }] — reader voices removed (ruling 33): the runner deletes
 *               their card images and summons a rebuild so their static pages go
 */
export function planScrub(uid, snap, { now = Date.now() } = {}) {
  const nulls = new Set();
  const sets = {};
  const decrements = new Set();
  decrements.push = decrements.add;
  const counts = {
    comments: 0, commentTombstones: 0, replies: 0, repliesByOthersKept: 0, commentReactions: 0,
    squarePosts: 0, squareArchived: 0, squareTombstones: 0, squareRepliesByOthersKept: 0, squareReactions: 0,
    openPages: 0, openPagesCommentsByOthers: 0, openPagesReactions: 0,
    storyReads: 0, seriesReads: 0, storyReactions: 0, leaderboardRows: 0,
    notificationsInOthersInboxes: 0, dmMessagesSent: 0, voicesRemoved: 0, backstop: 0,
  };
  const del = (p) => nulls.add(p);
  const voices = [];

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

  // ── Comments (rulings 29 and 30) ───────────────────────────────────────────────────────
  // A comment node's `rel` is its path under comments/{slug}: "cid", or "cid/replies/rid/…" for
  // the nested shape. `gone` holds every rel that is deleted OR tombstoned — its words, its
  // reactions and its likes are gone either way.
  const gone = new Set();   // `${slug}/${rel}`
  const tombed = new Set(); // `${slug}/${rel}`
  const likesRel = (slug, rel) => `comment_likes/${slug}/${rel}`;
  for (const [slug, thread] of entries(snap.comments)) {
    if (deadPieces.has(slug)) continue;
    const byId = Object.fromEntries(entries(thread));
    const kids = {};
    for (const [cid, c] of Object.entries(byId)) if (isObj(c) && c.parentId) (kids[c.parentId] ||= []).push(cid);

    // Nested: rebuild a node's replies. Returns the replies that survive and the ops to get there.
    const nested = (node, rel) => {
      const kept = {};
      const ops = [];
      for (const [rid, r] of entries(node?.replies)) {
        const res = nodeFate(r, `${rel}/replies/${rid}`);
        if (res.value !== null) kept[rid] = res.value;
        ops.push(...res.ops);
      }
      return { kept, ops };
    };
    const flatSurvives = new Map();
    const survivesFlat = (cid, seen = new Set()) => {
      if (flatSurvives.has(cid)) return flatSurvives.get(cid);
      if (seen.has(cid)) return false;
      seen.add(cid);
      const c = byId[cid];
      const own = authoredBy(c, uid);
      const nestedLive = Object.keys(nested(c, cid).kept).length > 0;
      const v = !own || nestedLive || (kids[cid] || []).some((k) => survivesFlat(k, seen));
      flatSurvives.set(cid, v);
      return v;
    };
    // One node, either shape. ops: ['del', rel] | ['set', rel, value]; value: what the node becomes.
    function nodeFate(node, rel, flatKids = false) {
      const { kept, ops } = nested(node, rel);
      const own = authoredBy(node, uid);
      const othersBelow = Object.keys(kept).length > 0 || (flatKids && (kids[rel] || []).some((k) => survivesFlat(k)));
      if (!own) {
        if (!isObj(node)) return { value: node, ops: [] };
        return { value: node.replies ? { ...node, replies: kept } : node, ops };
      }
      gone.add(`${slug}/${rel}`);
      if (othersBelow) {
        tombed.add(`${slug}/${rel}`);
        const t = commentTombstone(node, kept, now);
        return { value: t, ops: [['set', rel, t]] };
      }
      return { value: null, ops: [['del', rel]] };
    }
    for (const [cid, c] of Object.entries(byId)) {
      const { ops } = nodeFate(c, cid, true);
      for (const op of ops) {
        const key = `${slug}/${op[1]}`;
        if (op[0] === 'set') { sets[`comments/${key}`] = op[2]; counts.commentTombstones++; }
        else {
          del(`comments/${key}`);
          if (op[1].includes('/replies/')) counts.replies++; else counts.comments++;
        }
        // Reactions and likes ON a node that is gone go with it — theirs and everyone else's.
        if (!op[1].includes('/')) {
          for (const n of ['comment_screening', 'commentReactions']) if (snap[n]?.[slug]?.[op[1]] !== undefined) del(`${n}/${key}`);
          for (const [who, byC] of entries(snap.comment_reactions?.[slug])) if (byC?.[op[1]] !== undefined && who !== uid) del(`comment_reactions/${slug}/${who}/${op[1]}`);
        }
        const likes = op[1].split('/').reduce((o, k) => (o == null ? undefined : o[k]), snap.comment_likes?.[slug]);
        if (likes !== undefined) del(likesRel(slug, op[1]));
      }
    }
    // The replies by others that stay, for the record.
    for (const [cid, c] of Object.entries(byId)) if (isObj(c) && !authoredBy(c, uid) && c.parentId && gone.has(`${slug}/${c.parentId}`)) counts.repliesByOthersKept++;
    const countNested = (node, rel) => { for (const [rid, r] of entries(node?.replies)) { const rr = `${rel}/replies/${rid}`; if (!authoredBy(r, uid) && gone.has(`${slug}/${rel}`)) counts.repliesByOthersKept++; countNested(r, rr); } };
    for (const [cid, c] of Object.entries(byId)) countNested(c, cid);
  }
  const commentAlive = (slug, cid) => !deadPieces.has(slug) && !gone.has(`${slug}/${cid}`) && isObj(snap.comments?.[slug]?.[cid]);

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
      if (!isObj(byUser?.[uid]) || gone.has(`${slug}/${cid}`)) continue;
      del(`commentReactions/${slug}/${cid}/${uid}`);
      for (const [t, on] of entries(byUser[uid])) if (on) reacted.add(`${slug}|${cid}|${t}`);
    }
  }
  for (const k of reacted) {
    const [slug, cid, t] = k.split('|');
    counts.commentReactions++;
    if (commentAlive(slug, cid)) decrements.push(`comments/${slug}/${cid}/${t}Count`);
  }
  // Their likes (Open Pages comment likes, any depth) — counted by children, no counter to move.
  const likesWalk = (node, path, rel, slug) => {
    if (!isObj(node) || gone.has(`${slug}/${rel}`)) return;
    if (node[uid] !== undefined) del(`${path}/${uid}`);
    for (const [rid, r] of entries(node.replies)) likesWalk(r, `${path}/replies/${rid}`, `${rel}/replies/${rid}`, slug);
  };
  for (const [a, byComment] of entries(snap.comment_likes)) {
    if (deadPieces.has(a)) continue;
    for (const [cid, likes] of entries(byComment)) likesWalk(likes, `comment_likes/${a}/${cid}`, cid, a);
  }
  for (const [slug, rows] of entries(snap.comment_screening)) {
    for (const [cid, row] of entries(rows)) if (isObj(row) && row.uid === uid) del(`comment_screening/${slug}/${cid}`);
  }

  // ── Story reading and reactions ────────────────────────────────────────────────────────
  for (const [slug, byUser] of entries(snap.storyReads)) if (byUser?.[uid] !== undefined) { del(`storyReads/${slug}/${uid}`); counts.storyReads++; }
  // W49 — the instalment-read ledger. The endpoint clears it per instalment; this catches an
  // instalment the endpoint could not see (one deleted since). The count keeps their read.
  for (const [inst, byUser] of entries(snap.series_read_ledger)) if (byUser?.[uid] !== undefined) { del(`series_read_ledger/${inst}/${uid}`); counts.seriesReads++; }
  for (const [slug, byUser] of entries(snap.storyReactionUsers)) {
    if (!isObj(byUser?.[uid])) continue;
    del(`storyReactionUsers/${slug}/${uid}`);
    for (const [t, on] of entries(byUser[uid])) if (on) { decrements.push(`storyReactions/${slug}/${t}`); counts.storyReactions++; }
  }
  // (31) Every season's boards, closed seasons included.
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

  // ── Square: live posts and the archive (rulings 29 and 30) ─────────────────────────────
  const scrubSquare = (postsNode, reactNode, counterFor, countKey) => {
    const posts = Object.fromEntries(entries(snap[postsNode]));
    const kids = {};
    for (const [id, p] of Object.entries(posts)) if (p?.parentId) (kids[p.parentId] ||= []).push(id);
    const memo = new Map();
    const survives = (id, seen = new Set()) => {
      if (memo.has(id)) return memo.get(id);
      if (seen.has(id)) return false;
      seen.add(id);
      const v = !authoredBy(posts[id], uid) || (kids[id] || []).some((k) => survives(k, seen));
      memo.set(id, v);
      return v;
    };
    const gonePosts = new Set();
    for (const [id, p] of Object.entries(posts)) {
      if (!authoredBy(p, uid)) continue;
      gonePosts.add(id);
      if (survives(id)) {
        sets[`${postsNode}/${id}`] = postTombstone(p, now);
        counts.squareTombstones++;
        counts.squareRepliesByOthersKept += (kids[id] || []).filter((k) => !authoredBy(posts[k], uid)).length;
      } else {
        del(`${postsNode}/${id}`);
        counts[countKey]++;
      }
      // Reactions on a post that is gone go with it.
      if (snap[reactNode]?.[id] !== undefined) del(`${reactNode}/${id}`);
    }
    for (const [id, byType] of entries(snap[reactNode])) {
      if (gonePosts.has(id)) continue;
      for (const [t, users] of entries(byType)) {
        if (users?.[uid] === undefined) continue;
        del(`${reactNode}/${id}/${t}/${uid}`);
        counts.squareReactions++;
        if (isObj(posts[id])) decrements.push(counterFor(id, t));
      }
    }
    // poll votes inside posts that stay
    for (const [id, p] of Object.entries(posts)) if (!gonePosts.has(id) && p?.poll?.votes?.[uid] !== undefined) del(`${postsNode}/${id}/poll/votes/${uid}`);
    return gonePosts;
  };
  const goneLive = scrubSquare('square_posts', 'square_reactions', (id, t) => `square_posts/${id}/${t}Count`, 'squarePosts');
  scrubSquare('square_archive', 'square_archive_reactions', (id, t) => `square_archive/${id}/${t}Count`, 'squareArchived');
  for (const [id, byUser] of entries(snap.square_likes)) {
    if (goneLive.has(id)) { del(`square_likes/${id}`); continue; }
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

  // ── DMs (ruling 32): the messages they sent ────────────────────────────────────────────
  for (const [convId, msgs] of entries(snap.dm_messages)) {
    if (!convId.split('_').includes(uid)) continue;
    for (const [mid, m] of entries(msgs)) if (isObj(m) && m.senderUid === uid) { del(`dm_messages/${convId}/${mid}`); counts.dmMessagesSent++; }
  }

  // ── Reader voices (ruling 33): the voice comes down ────────────────────────────────────
  for (const [id, v] of entries(snap.cms_voices)) {
    if (!isObj(v) || v.matchUid !== uid) continue;
    del(`cms_voices/${id}`);
    counts.voicesRemoved++;
    voices.push({ id, storagePrefixes: [...new Set([id, v.slug].filter((x) => typeof x === 'string' && x && !x.includes('/')))].map((x) => `voices/${x}/`) });
  }

  // ── Readers' Notes (W46): rulings 29, 30 and 34 applied to the Series rooms ─────────────
  const touchedInst = new Set();
  const notesAfter = {};   // inst -> the notes node as it will be
  const membersAfter = {};
  const sidesAfter = {};
  const copy = (v) => (isObj(v) ? { ...v } : {});
  for (const [inst, notes] of entries(snap.series_notes)) {
    notesAfter[inst] = copy(notes);
    for (const [nid, n] of entries(notes)) {
      if (!authoredBy(n, uid)) continue;
      touchedInst.add(inst);
      counts.seriesNotes = (counts.seriesNotes || 0) + 1;
      const replies = snap.series_note_replies?.[inst]?.[nid];
      const others = entries(replies).filter(([, r]) => isObj(r) && r.uid !== uid);
      del(`series_note_underlines/${inst}/${nid}`);
      if (others.length) {
        const t = { deleted: true, deletedAt: now, kind: n.kind, text: '' };
        if (typeof n.createdAt === 'number') t.createdAt = n.createdAt;
        sets[`series_notes/${inst}/${nid}`] = t;
        notesAfter[inst][nid] = t;
        counts.seriesNoteTombstones = (counts.seriesNoteTombstones || 0) + 1;
      } else {
        del(`series_notes/${inst}/${nid}`);
        del(`series_note_replies/${inst}/${nid}`);
        delete notesAfter[inst][nid];
      }
    }
  }
  for (const [inst, byNote] of entries(snap.series_note_replies)) {
    for (const [nid, replies] of entries(byNote)) {
      for (const [rid, r] of entries(replies)) {
        if (!authoredBy(r, uid)) continue;
        touchedInst.add(inst);
        counts.seriesReplies = (counts.seriesReplies || 0) + 1;
        const t = { removed: true, text: '' };
        if (typeof r.createdAt === 'number') t.createdAt = r.createdAt;
        if (typeof r.replyTo === 'string') t.replyTo = r.replyTo;
        sets[`series_note_replies/${inst}/${nid}/${rid}`] = t;
      }
    }
  }
  for (const [inst, held] of entries(snap.series_notes_held)) {
    for (const [id, h] of entries(held)) if (authoredBy(h, uid)) { del(`series_notes_held/${inst}/${id}`); counts.seriesHeld = (counts.seriesHeld || 0) + 1; }
  }
  for (const [inst, sides] of entries(snap.series_sides)) {
    sidesAfter[inst] = copy(sides);
    const opt = sides?.[uid];
    if (typeof opt !== 'string') continue;
    touchedInst.add(inst);
    del(`series_sides/${inst}/${uid}`);
    decrements.push(`series_side_tallies/${inst}/${opt}`);
    delete sidesAfter[inst][uid];
  }
  for (const [inst, members] of entries(snap.series_room_members)) {
    membersAfter[inst] = copy(members);
    if (members?.[uid] === undefined) continue;
    touchedInst.add(inst);
    del(`series_room_members/${inst}/${uid}`);
    delete membersAfter[inst][uid];
  }
  for (const [inst, byNote] of entries(snap.series_note_underlines)) {
    for (const [nid, who] of entries(byNote)) if (who?.[uid] !== undefined) del(`series_note_underlines/${inst}/${nid}/${uid}`);
  }
  // The doors: recompute every touched instalment into its series' public summary.
  const summaries = {};
  for (const inst of touchedInst) {
    const row = snap.series_instalments?.[inst];
    const sid = row?.seriesId;
    if (!sid) continue;
    const prev = summaries[sid] || snap.series_notes_summary?.[sid] || null;
    if (!prev) continue;
    const stats = instStats({ ordinal: row.ordinal, notes: notesAfter[inst] || {}, members: membersAfter[inst] || {}, sides: sidesAfter[inst] || {} });
    summaries[sid] = foldSummary(prev, { inst, stats, notes: notesAfter[inst] || {} });
  }
  for (const [sid, s] of Object.entries(summaries)) sets[`series_notes_summary/${sid}`] = s;

  // ── Backstop: what the endpoint should already have removed ────────────────────────────
  const backstop = (p) => { if (!nulls.has(p)) { del(p); counts.backstop++; } };
  for (const [h, v] of entries(snap.usernames)) if (v === uid) backstop(`usernames/${h}`);
  for (const [who, list] of entries(snap.followers)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `followers/${uid}` : `followers/${who}/${uid}`);
  for (const [who, list] of entries(snap.following)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `following/${uid}` : `following/${who}/${uid}`);
  for (const [who, list] of entries(snap.blocked_users)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `blocked_users/${uid}` : `blocked_users/${who}/${uid}`);
  // W53 — the Square's mute list: theirs goes whole, and another reader's mute of them with it.
  for (const [who, list] of entries(snap.muted_users)) if (who === uid || list?.[uid] !== undefined) backstop(who === uid ? `muted_users/${uid}` : `muted_users/${who}/${uid}`);
  // W55.1 — the conversations they muted go whole. Another reader's mute of a conversation with
  // them stays, like that reader's half of it (ruling 32).
  if (snap.dm_muted?.[uid] !== undefined && snap.dm_muted?.[uid] !== null) backstop(`dm_muted/${uid}`);
  if (snap.userNode !== null && snap.userNode !== undefined) backstop(`users/${uid}`);

  // A tombstone is written whole: nothing may be removed beneath it separately, and nothing
  // beneath a removed path may be set.
  const kept = dropCovered([...nulls]);
  const setPaths = Object.keys(sets);
  const underA = (p, list) => list.some((a) => p === a || p.startsWith(`${a}/`));
  const nullsOut = kept.filter((p) => !setPaths.some((sp) => p.startsWith(`${sp}/`)));
  for (const sp of setPaths) if (underA(sp, nullsOut)) delete sets[sp];
  const finalSets = Object.keys(sets);
  return {
    nulls: nullsOut,
    sets,
    decrements: [...decrements].filter((d) => !underA(d, nullsOut) && !underA(d, finalSets)),
    counts,
    voices,
  };
}

/** RTDB refuses a multi-path update in which one path contains another. Keep the ancestor. */
export function dropCovered(paths) {
  const sorted = [...new Set(paths)].sort();
  const out = [];
  for (const p of sorted) if (!out.some((a) => p.startsWith(`${a}/`))) out.push(p);
  return out;
}
