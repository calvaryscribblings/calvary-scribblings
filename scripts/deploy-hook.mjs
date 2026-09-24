// POST a Cloudflare Pages deploy hook from a NODE RUNNER (a GitHub Actions job), never a browser.
//
// The hook is an unauthenticated trigger — possession is authorisation — so the URL comes from
// the environment (an Actions secret) and is never printed, returned or thrown. Only the
// variable's NAME appears in a message. Same contract as scripts/bookstore/withdrawals.mjs's
// fireDeployHook, which predates this module and is left alone.
//
// LOUD, NEVER FATAL. By the time a runner fires this the records are already correct; failing
// the job because a build could not be summoned would hide that the writes worked. The miss is
// an ::error:: annotation, which turns the run's summary red without changing the exit code.

const TIMEOUT_MS = 15000;

/**
 * @param {string|undefined} url  the hook, from process.env[envName]
 * @param {{ envName: string, what: string, fetchImpl?: typeof fetch }} opts
 *        `what` finishes the sentence "… went live but …" in the log.
 * @returns {Promise<'fired'|'unconfigured'|'refused'|'unreachable'>}
 */
export async function fireDeployHook(url, { envName, what, fetchImpl = fetch }) {
  if (!url) {
    console.error(`::error::${envName} is not set — ${what} went live but the site was NOT rebuilt.`);
    return 'unconfigured';
  }
  try {
    const res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`::error::deploy hook refused: HTTP ${res.status} — ${what} went live but the site was NOT rebuilt.`);
      return 'refused';
    }
    return 'fired';
  } catch (e) {
    // The error's name, not its message: a fetch error can embed the request target.
    console.error(`::error::deploy hook unreachable (${e?.name || 'Error'}) — ${what} went live but the site was NOT rebuilt.`);
    return 'unreachable';
  }
}

/**
 * W3 — the first hook in `names` that is set, as { url, envName }; { url: undefined, envName:
 * names[0] } when none is. Every hook here rebuilds the SAME Pages project on `main`, so any of
 * them rebuilds the whole site, the shop included; the order only says which one is preferred.
 *
 * Written for the withdrawals job: BOOKSTORE_DEPLOY_HOOK_URL was never set as an Actions secret
 * (W1 found it empty), so a scheduled withdrawal flipped the record and rebuilt nothing. It now
 * falls back to CMS_DEPLOY_HOOK_URL, which is set.
 */
export function pickDeployHook(env, names) {
  for (const name of names) {
    const v = env[name];
    if (typeof v === 'string' && v.trim()) return { url: v.trim(), envName: name };
  }
  return { url: undefined, envName: names[0] };
}
