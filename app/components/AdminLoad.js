'use client';
// W6 (ADM-24) — THE ADMIN TELLS THE TRUTH. One drawn order for every admin read, so no screen can
// say "No submissions pending review" about a read that failed:
//
//   failed            → <Unavailable> with a Retry (compact when it is one section of a page)
//   loading, or null  → `loading` (null is the useReliableLoad convention for "not asked yet",
//                        e.g. before the admin check has passed — it is never an answer)
//   ready and empty   → `empty`, which is now the ONLY way to reach the empty copy
//   ready             → children(data)
//
//   const load = useReliableLoad(() => (isAdmin ? readThings() : null), [isAdmin]);
//   <AdminLoad load={load} subject="the submissions" loading={…} empty={…}>{(rows) => …}</AdminLoad>
//
// `isEmpty` defaults to "an array with no rows"; pass one for any other shape.
import Unavailable from './Unavailable';

const noRows = (data) => Array.isArray(data) && data.length === 0;

export default function AdminLoad({ load, subject, tone = 'ink', compact = false, loading = null, empty = null, isEmpty = noRows, children }) {
  if (load.phase === 'failed') {
    return <Unavailable kind={load.failure} onRetry={load.retry} refreshing={load.refreshing} subject={subject} tone={tone} compact={compact} />;
  }
  if (load.phase !== 'ready' || load.data == null) return loading;
  if (isEmpty(load.data)) return empty;
  return children(load.data);
}
