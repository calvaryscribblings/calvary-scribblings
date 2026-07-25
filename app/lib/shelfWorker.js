'use client';
// Registration and messaging for the offline shelf's service worker (public/sw.js).
//
// WHERE THIS RUNS — and where it deliberately does not.
//
// Registration is called from the shelf surfaces and the story page only: /my-library, the
// shelf reader, and /stories/<slug>. It is NOT called from the root layout, because the
// root layout also renders the gateway, and the gateway's zero-runtime contract is not
// spent on this. The worker's scope is '/' either way (it has to be — see the header of
// public/sw.js), so registering from a story page still controls the shelf; there is no
// coverage lost by keeping the call off the front door.

const SW_URL = '/sw.js';
const OPT_OUT_KEY = 'cs-nosw';

// The pre-Next static site shipped /service-worker.js at scope '/'. It was network-first
// over everything same-origin, cached indiscriminately, and called skipWaiting() on every
// install — the exact shape this round exists to avoid. It was deleted in e2d6f59, and a
// 404 on the script during an update check almost certainly unregistered it everywhere
// long ago. "Almost certainly" is not a guarantee, and a surviving copy of that worker
// would fight ours for every request on the site, so we close it by hand. Costs one
// getRegistrations() call and settles the question permanently.
async function unregisterLegacy() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(async (r) => {
      const script = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
      if (script && !script.endsWith(SW_URL)) {
        await r.unregister();
        // Its caches outlive its registration; the names are known, so take them too.
        try {
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith('calvary-scribblings-')).map((k) => caches.delete(k)));
        } catch {}
      }
    }));
  } catch {}
}

// Developer escape hatch. `?nosw=1` unregisters and remembers the choice on this device;
// `?nosw=0` clears it. Independent of the kill switch — that one is a deploy, this one is
// for debugging a single browser without shipping anything.
function checkOptOut() {
  try {
    const q = new URLSearchParams(location.search).get('nosw');
    if (q === '1') localStorage.setItem(OPT_OUT_KEY, '1');
    if (q === '0') localStorage.removeItem(OPT_OUT_KEY);
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export async function registerShelfWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  if (checkOptOut()) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
    return null;
  }

  await unregisterLegacy();

  try {
    // No updateViaCache override: /sw.js is served no-cache (public/_headers), so the
    // browser's own update check is already as fresh as it can be — which is what makes
    // the kill switch land within one navigation.
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch (e) {
    console.warn('[shelf] service worker registration failed', e);
    return null;
  }
}

// Ask the active worker to cache the shelf shell — the two shelf documents, their RSC
// payloads, and the chunks those documents name. Called after a save and on every visit to
// /my-library, so the shell tracks the current deploy without any explicit versioning here.
// Resolves either way: sealing is best-effort, and a failed seal must never fail a save.
export async function sealShelf() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active;
    if (!target) return null;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 15000);
      const onMsg = (e) => { if (e.data?.type === 'CS_SEALED') { cleanup(); resolve(e.data); } };
      const cleanup = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('message', onMsg); };
      navigator.serviceWorker.addEventListener('message', onMsg);
      target.postMessage({ type: 'SEAL_SHELF' });
    });
  } catch {
    return null;
  }
}

export function isShelfWorkerReady() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
}
