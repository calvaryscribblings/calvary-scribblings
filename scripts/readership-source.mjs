// THE SOURCE OF TRUTH FOR READERSHIP, computed from the purchase records themselves.
//
// One function, three consumers: the backfill (writes it), the reconciler (compares against
// it) and the test suite (asserts it over a synthetic set including a refund and a
// repurchase). A backfill and a reconciler that each carry their own idea of what the count
// SHOULD be is how a reconciler ends up certifying its own bug.
//
// ⭑ THE DEFINITION, and it is the same sentence functions/api/bookstore/_lib.js states beside
// the write path:
//
//   readership(titleId) = the number of (uid, titleId) records whose status is exactly
//                         'active'.
//
// `status === 'active'` verbatim — the same test functions/api/bookstore/stream.js applies
// before it will serve the file and the same one app/my-library/page.js applies to decide
// whether a shelf row can be opened. A missing status is NOT active: a record that does not
// say it is live is not counted, which is the fail-closed direction for a public number.

/**
 * @param purchases  the whole bookstore_purchases node: { [uid]: { [titleId]: record } }
 * @returns Map<titleId, count>, containing ONLY titles with at least one active record.
 *
 * Titles with a count of zero are ABSENT from the map rather than present with 0. That is the
 * ruling — absent is absent — and it means the backfill writes nothing for a title nobody has
 * bought, so the node stays empty until it has something true to say.
 */
export function readershipFromPurchases(purchases) {
  const counts = new Map();
  if (!purchases || typeof purchases !== 'object') return counts;

  for (const byTitle of Object.values(purchases)) {
    if (!byTitle || typeof byTitle !== 'object') continue;
    for (const [titleId, record] of Object.entries(byTitle)) {
      if (!record || typeof record !== 'object') continue;
      // One record per (uid, titleId) by construction — the node is keyed that way — so a
      // reader who bought, refunded and bought again leaves ONE record, and it counts once.
      // That is the same "once per live entitlement" the delta arithmetic produces
      // incrementally, arrived at from the other direction, which is what makes the
      // reconciler worth running.
      if (record.status !== 'active') continue;
      counts.set(titleId, (counts.get(titleId) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Compare the computed truth against what is stored. REPORTS; never repairs.
 *
 * @param computed  Map<titleId, count> from readershipFromPurchases
 * @param stored    the bookstore_readership node: { [titleId]: { count } }
 * @returns { rows, drift } — rows is every title either side knows about, sorted; drift is
 *          the subset that disagrees.
 *
 * ⚠ IT DOES NOT PATCH, and that is the brief's instruction and the right one. A reconciler
 * that silently corrects is a reconciler that hides the bug it exists to find: the counter is
 * written inside the purchase's own atomic operation, so a discrepancy means either that
 * atomicity broke or that something wrote the node which should not have. Both are worth
 * waking up for; neither is worth papering over. Repair is a human running a one-line PATCH
 * with the number this printed.
 */
export function reconcile(computed, stored) {
  const ids = new Set([
    ...computed.keys(),
    ...Object.keys(stored && typeof stored === 'object' ? stored : {}),
  ]);

  const rows = [...ids].sort().map((titleId) => {
    const want = computed.get(titleId) || 0;
    const node = stored?.[titleId];
    const raw = (node && typeof node === 'object' && !Array.isArray(node)) ? node.count : node;
    const have = (typeof raw === 'number' && Number.isInteger(raw)) ? raw : null;
    return { titleId, want, have, ok: have === want || (have === null && want === 0) };
  });

  return { rows, drift: rows.filter((r) => !r.ok) };
}
