// The liveness DECISION, separated from the I/O that feeds it.
//
// Pure so the thresholds can be tested against archive lists that do not exist —
// a bucket that has stopped, one that is shrinking, one carrying a corrupt archive.
// None of those states can be produced on demand against the real bucket, and a
// check whose failure path has never run is the same class of thing as a backup
// nobody has restored.

export const MAX_AGE_HOURS = 30;   // daily backup + a 6h grace for a late run
export const MIN_FRACTION = 0.5;   // of the median of recent archives

// Nodes whose loss would be unrecoverable and expensive. Named rather than counted,
// because "76 nodes" stays true while the one holding the money goes missing.
export const MUST_CARRY = Object.freeze([
  'users', 'open_pages', 'comments', 'bookstore_titles',
  'bookstore_purchases', 'points', 'wallet',
]);

/**
 * @param {Array<{name:string,size:string|number,timeCreated:string}>} objects  Bucket listing.
 * @param {number} now  Date.now().
 * @param {{treeKeys?: string[]|null, inflateError?: string|null, downloadStatus?: number|null}} probe
 *        What was learned by actually opening the newest archive. treeKeys null means
 *        it was not opened; inflateError set means it would not parse.
 * @param {{maxAgeHours?: number, minFraction?: number}} [opts]
 * @returns {{problems: string[], newest: object|null, ageHours: number|null, median: number|null}}
 */
export function assess(objects, now, probe = {}, opts = {}) {
  const maxAgeHours = opts.maxAgeHours ?? MAX_AGE_HOURS;
  const minFraction = opts.minFraction ?? MIN_FRACTION;
  const problems = [];

  const archives = (objects || [])
    .filter((o) => o && typeof o.name === 'string' && o.name.endsWith('_data.json.gz'))
    .sort((a, b) => (a.timeCreated < b.timeCreated ? 1 : -1));

  if (!archives.length) {
    return { problems: ['EMPTY: the backup bucket holds no data archives at all. Scheduled backups are not running.'], newest: null, ageHours: null, median: null };
  }

  const newest = archives[0];
  const ageHours = (now - new Date(newest.timeCreated).getTime()) / 3600e3;
  if (ageHours > maxAgeHours) {
    problems.push(`STALE: the newest backup is ${ageHours.toFixed(1)}h old, over the ${maxAgeHours}h limit. Scheduled backups have stopped — check Firebase console → Realtime Database → Backups.`);
  }

  const recent = archives.slice(0, 8).map((a) => Number(a.size)).sort((a, b) => a - b);
  const median = recent[Math.floor(recent.length / 2)];
  const newestSize = Number(newest.size);
  if (median > 0 && newestSize < median * minFraction) {
    problems.push(`SHRUNK: the newest backup is ${((newestSize / median) * 100).toFixed(0)}% of the recent median. A job that keeps running while backing up less and less is still green — this is the check that is not fooled.`);
  }

  if (probe.downloadStatus && probe.downloadStatus !== 200) {
    problems.push(`UNREADABLE: the newest archive would not download (HTTP ${probe.downloadStatus}).`);
  } else if (probe.inflateError) {
    problems.push(`CORRUPT: the newest archive does not inflate and parse (${probe.inflateError}). It would fail on the day it is needed, not before.`);
  } else if (Array.isArray(probe.treeKeys)) {
    const missing = MUST_CARRY.filter((n) => !probe.treeKeys.includes(n));
    if (missing.length) {
      problems.push(`INCOMPLETE: the newest archive is missing ${missing.join(', ')} — the backup is running but not carrying what it is for.`);
    }
  }

  return { problems, newest, ageHours, median };
}
