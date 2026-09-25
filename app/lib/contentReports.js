// THE REPORT QUEUE for story comments, DMs and profiles — content_reports/{contentKey}/{reporterUid}.
//
// W5 (25 Sep 2026). Before this, the app wrote these three kinds to the legacy reports/ node,
// which no admin page reads, so "our team will review" was not true for them. The queue's shape
// was specified by the app session; the rules are database.rules.json → content_reports, and this
// file is the one place the web builds or reads a record. Pure, no Firebase: tests/ci/content-
// reports.test.mjs drives it, and tests/rules/database.test.mjs asserts the rules against it.
//
// RULED by Ikenna (24–25 Sep): when a DM is reported, a moderator sees ONLY the reported message
// and the reporter's note, never the thread. So a DM record carries one message's text (the rules
// check it is a prefix of that message, sent by the offender, in the reporter's own conversation),
// and nothing in /admin/reports links to or reads dm_messages.
//
// THE WRITE SHAPE (handed to the app — docs/W5-SAFETY.md has the same table):
//   kind         'comment' | 'dm' | 'user'
//   reason       1–40 chars
//   reporterUid  the signed-in reader = the key
//   offenderUid  the author of the comment / sender of the message / the profile's uid; never the reporter
//   contextPath  comment → comments/{slug}/{commentId}   (a reply: comments/{slug}/{commentId}/replies/{replyId})
//                dm      → dm_messages/{convId}/{messageId}
//                user    → users/{uid}
//   snapshot     ≤ 200 chars. For a DM: snapshotOf(message.text), a VERBATIM prefix — no trim, no ellipsis.
//   note         optional, ≤ 300 chars, the reporter's own words
//   createdAt    ms, ≤ now + 5 min
// Write-once: a second report of the same content by the same reader is refused, not merged.

export const REPORT_KINDS = ['comment', 'dm', 'user'];
export const REASON_MAX = 40;
export const SNAPSHOT_MAX = 200;
export const NOTE_MAX = 300;
export const RECORD_FIELDS = ['kind', 'reason', 'reporterUid', 'offenderUid', 'contextPath', 'snapshot', 'note', 'createdAt'];
export const RESOLUTION_FIELDS = ['resolved', 'resolvedBy', 'resolvedAt'];

/** dm ids are [uidA, uidB].sort().join('_') — app/square/page.js. */
export const convIdFor = (a, b) => [a, b].sort().join('_');

/** The queue key. A reply is keyed by its own id: comment_{slug}_{replyId}. */
export function contentKeyFor(kind, ids) {
  if (kind === 'comment') return `comment_${ids.storySlug}_${ids.commentId}`;
  if (kind === 'dm') return `dm_${ids.convId}`;
  if (kind === 'user') return `user_${ids.uid}`;
  throw new Error(`Unknown report kind: ${kind}`);
}

/**
 * The first 200 UTF-16 units of the text, VERBATIM — the rules check the stored snapshot is a
 * prefix of the reported message. Never cut a surrogate pair in half: a lone surrogate does not
 * survive the JSON round trip, and the prefix check would then refuse the report.
 */
export function snapshotOf(text) {
  const s = String(text ?? '');
  if (s.length <= SNAPSHOT_MAX) return s;
  let cut = s.slice(0, SNAPSHOT_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** One record, in the rules' shape. `now` is handed in. */
export function buildReport({ kind, reason, reporterUid, offenderUid, contextPath, text, note, now }) {
  if (!REPORT_KINDS.includes(kind)) throw new Error(`Unknown report kind: ${kind}`);
  const rec = {
    kind,
    reason: String(reason || '').slice(0, REASON_MAX),
    reporterUid,
    offenderUid,
    contextPath,
    snapshot: snapshotOf(text),
    createdAt: now,
  };
  const n = String(note ?? '').trim();
  if (n) rec.note = n.slice(0, NOTE_MAX);
  return rec;
}

/**
 * Where "View in context" goes, or null. NULL FOR A DM, BY RULING: the moderator sees the one
 * message the record carries and nothing else.
 */
export function contextHrefFor(report) {
  if (!report) return null;
  if (report.kind === 'comment') {
    const m = /^comments\/([^/]+)\//.exec(report.contextPath || '');
    return m ? `/stories/${m[1]}` : null;
  }
  if (report.kind === 'user') return report.offenderUid ? `/user?id=${encodeURIComponent(report.offenderUid)}` : null;
  return null;
}

/**
 * content_reports as the admin page shows it: one row per piece of content, newest first (by its
 * newest report), resolved rows included and marked. Only the record's own fields survive.
 */
export function queueRows(tree, kindFilter = 'all') {
  const rows = [];
  for (const [contentKey, node] of Object.entries(tree || {})) {
    if (!node || typeof node !== 'object') continue;
    const reports = Object.entries(node)
      .filter(([k, v]) => !RESOLUTION_FIELDS.includes(k) && v && typeof v === 'object')
      .map(([uid, r]) => {
        const out = { reporterUid: uid };
        for (const f of RECORD_FIELDS) if (r[f] !== undefined) out[f] = r[f];
        return out;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!reports.length) continue;
    const kind = reports[0].kind;
    if (kindFilter !== 'all' && kind !== kindFilter) continue;
    rows.push({
      contentKey,
      kind,
      reports,
      latestAt: reports[0].createdAt || 0,
      resolved: node.resolved === true,
      resolvedBy: node.resolvedBy || null,
      resolvedAt: node.resolvedAt || null,
    });
  }
  rows.sort((a, b) => b.latestAt - a.latestAt);
  return rows;
}
