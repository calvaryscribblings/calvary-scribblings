// INSTALMENT READS — the contract (W49, rulings 176–178). Pure: no Firebase, no window.
//
//   series_reads/{inst}                 = count     public read, no client write
//   series_read_ledger/{inst}/{uid}     = ms        no client read or write (the endpoint's alone)
//   users/{uid}/readInstalments/{inst}  = true      the reader's own credit marker (ruling 179)
//
// Writers: functions/api/series/read.js (one read per reader, the first time they open it) and,
// once, scripts/series/seed-reads.mjs (ruling 178: the readers who already had a saved place).
// Readers: the Readers' Notes room's strip, rail and count line (app/series/[slug]/notes/).
export const SERIES_READS = 'series_reads';
export const SERIES_READ_LEDGER = 'series_read_ledger';
export const READ_INSTALMENTS = 'readInstalments';

export const readsPath = (inst) => `${SERIES_READS}/${inst}`;
export const ledgerPath = (inst, uid) => `${SERIES_READ_LEDGER}/${inst}/${uid}`;

/** A stored count as a number: anything else is 0. */
export const readsOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Reads across a set of instalments, for the room's count line. */
export function totalReads(byInst, ids) {
  let n = 0;
  for (const id of ids || []) n += readsOf(byInst?.[id]);
  return n;
}
