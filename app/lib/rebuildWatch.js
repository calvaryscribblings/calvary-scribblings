// "PUBLISHED" ONLY WHEN THE SITE SAYS SO — W6 (ADM-10).
//
// The site is a static export: a publish, hide, unhide or delete writes a record that the built
// pages do not reflect until a build runs. /api/rebuild answering 202 means the deploy hook ACCEPTED
// the request — not that a build finished, and not that it succeeded. Before W6 the CMS said
// "✓ Story published." whatever the rebuild did (fireRebuild's verdict went to the console).
//
// So the CMS now waits for the evidence: every Next build stamps a fresh build id into the HTML it
// serves (`"b":"<id>"` in the flight data; next.config.mjs does not pin it, so it changes on every
// build, including a hook rebuild of the same commit). The admin notes the live id before it asks
// for the rebuild, then watches `/` until a different one is served. A new id means a build that
// started after our write is live. Nothing else can say that without a Cloudflare credential,
// which the browser must never hold.

export const WATCH_TIMEOUT_MS = 10 * 60 * 1000;
export const WATCH_INTERVAL_MS = 15 * 1000;

/** The build id in a page's HTML, or null. */
export function buildIdOf(html) {
  const m = /\\?"b\\?":\\?"([A-Za-z0-9_-]{6,})/.exec(String(html || ''));
  return m ? m[1] : null;
}

/** The build id the site is serving right now, or null if it could not be read. */
export async function liveBuildId({ fetchImpl = fetch, origin = '' } = {}) {
  try {
    const res = await fetchImpl(`${origin}/?_cs_build=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return buildIdOf(await res.text());
  } catch {
    return null;
  }
}

/**
 * Wait until the site serves a build id other than `before`.
 * @returns {Promise<{ live: boolean, buildId: string|null }>}
 */
export async function waitForNewBuild(before, {
  fetchImpl = fetch, origin = '', timeoutMs = WATCH_TIMEOUT_MS, intervalMs = WATCH_INTERVAL_MS,
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(intervalMs);
    const id = await liveBuildId({ fetchImpl, origin });
    if (id && id !== before) return { live: true, buildId: id };
  }
  return { live: false, buildId: null };
}

/**
 * The sentence for each stage of an action that needs a rebuild. `done` names what the RECORD
 * write did ("Published", "Hidden", "Unhidden", "Deleted"); the rest is the site's side.
 *
 *   stage 'building'   the write landed and the rebuild was accepted; waiting for the new build
 *   stage 'live'       a new build is being served
 *   stage 'refused'    the rebuild was not started (verdict.message says why)
 *   stage 'unverified' it was started, but the live build id could not be read to watch it
 *   stage 'timeout'    it was started, but no new build appeared within the watch
 */
export function rebuildLine(stage, { done, verdict, minutes = WATCH_TIMEOUT_MS / 60000 } = {}) {
  // requestRebuild's refusals end "The record is published either way." — written for the Book
  // Store, and false after a Hide or a Delete. The line below says what the record did instead.
  const why = String(verdict?.message || '').replace(/\s*The record is published either way\.\s*/g, ' ').trim();
  switch (stage) {
    case 'building':
      return `${done} in the database. Rebuilding the site — this says “live” when the new build is being served (usually 2–4 minutes). You can keep working.`;
    case 'live':
      return `✓ ${done} — and live on the site.`;
    case 'refused':
      return `${done} in the database, but the site was NOT rebuilt: ${why || 'the rebuild could not be started.'} Until it is, the site’s built pages still show the old state.`;
    case 'unverified':
      return `${done} in the database, and a rebuild was started — but the live build could not be read to confirm when it lands. Check the site in a few minutes.`;
    case 'timeout':
      return `${done} in the database, and a rebuild was requested, but no new build has gone live after ${minutes} minutes. The site’s built pages may still show the old state.`;
    default:
      return String(done || '');
  }
}
