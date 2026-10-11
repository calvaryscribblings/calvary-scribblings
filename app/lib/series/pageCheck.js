// W38 — "CHECKING THE PAGE OPENS". After a publish asks for one rebuild, the Series admin waits for
// the instalment's own page to answer 200, so "Live" on the screen means a reader can open it and
// not merely that the database says so. W34 is why: Diary i2 was published on 7 Oct and its page
// answered 404 until something unrelated rebuilt the site.
//
// no-store, every time: the question is what the site serves NOW, and a cached 404 from the
// first poll would make every later poll repeat it.

export const PAGE_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
export const PAGE_CHECK_INTERVAL_MS = 10 * 1000;

export const instalmentPagePath = (instalmentId) => `/series/instalment/${instalmentId}`;
export const seriesPagePath = (slug) => `/series/${slug}`;

/** One look. True only for a 200; a network failure is a no, never a throw. */
export async function pageAnswers(path, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(path, { cache: 'no-store', redirect: 'follow' });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Poll every path until all answer 200, for up to about five minutes. → { ok } */
export async function waitForPages(paths, {
  fetchImpl = fetch, timeoutMs = PAGE_CHECK_TIMEOUT_MS, intervalMs = PAGE_CHECK_INTERVAL_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), isCancelled = () => false,
} = {}) {
  const deadline = now() + timeoutMs;
  const waiting = new Set(paths);
  for (;;) {
    for (const p of [...waiting]) if (await pageAnswers(p, { fetchImpl })) waiting.delete(p);
    if (!waiting.size) return { ok: true };
    if (isCancelled() || now() >= deadline) return { ok: false };
    await sleep(intervalMs);
  }
}
