// W16 — WHICH BUILD IS THIS PAGE RUNNING? Baked in at build time by next.config.mjs, from the
// same commit that names out/build.json and the service worker's cache generation.
//
// Why it is on the page at all: on 26 Sep Ikenna's iPhone showed the story bar misplaced, and the
// first question — "is his phone even running the fix?" — had no answer he could read off the
// screen. Now every walk can: the footer says the build, and /build.json says what is live.

export const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || 'dev';
export const BUILD_INFO_URL = '/build.json';

/** The live build, as /build.json names it. Resolves to null when it can't be read. */
export async function readLiveBuild() {
  try {
    const r = await fetch(BUILD_INFO_URL, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.commit === 'string' ? j.commit : null;
  } catch {
    return null;
  }
}

/** True only when both are known and they differ. A 'dev' page is never called stale. */
export const isStaleBuild = (running, live) => !!running && !!live && running !== 'dev' && running !== live;
