// Author profile shorthand route — /u/[handle]
//
// Open Pages feed cards and detail pages link authors to /u/<handle>. The real
// profile page is /user?handle=<handle>. The primary forwarding happens at the
// Cloudflare edge via public/_redirects (/u/:handle -> /user?handle=:handle);
// this Next.js route is belt-and-braces so the link still resolves in contexts
// where the edge rule isn't applied (e.g. `next start` of the export, local dev).
//
// The site is a static export (next.config.mjs: output:'export'), so a dynamic
// segment must enumerate its paths at BUILD time via generateStaticParams and a
// true server-side redirect() is not available at request time — the redirect
// itself runs client-side (see page-client.js), mirroring the established
// app/open-pages/[id] pattern.

import { buildReadOptional } from '../../lib/build-read.mjs';
import UHandleRedirect from './page-client';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

// ⛔ PL-12 — THE OTHER OF EXACTLY TWO READS ALLOWED TO DEGRADE, AND THE ARGUMENT IS HERE.
//
// This route is the one place in the tree where a missing static page is genuinely covered,
// because there is a REAL EDGE FALLBACK rather than a hope. public/_redirects carries
//
//     /u/:handle    /user?handle=:handle    301
//
// and a static page at /u/<handle> SHADOWS that rule. So the failure mode is inverted here:
// when the page is missing the rule applies, and the reader lands on the profile they asked
// for. Emitting fewer pages costs a redirect hop, not a destination.
//
// That is the whole argument, and it is why this is an exception rather than a precedent. The
// question to answer before adding a third caller of buildReadOptional is: WHAT DOES A READER
// SEE WHEN THIS DATA IS MISSING? Here they see their profile. On the bookstore, the library,
// the voices, the series and Open Pages they see a 404 at the end of a link the site is still
// drawing, which is the failure PL-12 exists to prevent.
//
// ⚠ THE DEADLINE AND THE RETRIES STILL APPLY — see the note in gateway-build.js. An
// unreachable database does not make get() reject, it makes it never return, and a read that
// never returns hangs the build whatever its failure policy says it would have done.
export async function generateStaticParams() {
  const names = await buildReadOptional(
    'usernames',
    null,
    'a handle with no static page falls through to the /u/:handle → /user?handle=:handle edge '
      + 'rule that the static page would otherwise shadow — the reader reaches their profile',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const snap = await get(ref(getDatabase(app), 'usernames'));
      return snap.exists() ? snap.val() || {} : {};
    },
  );
  const handles = names ? Object.keys(names) : [];
  if (handles.length) return handles.map((handle) => ({ handle }));
  // output:'export' requires a dynamic segment to emit at least one path. Any handle created
  // after the last build is covered by the same edge rule, and by the client redirect once
  // this page loads.
  return [{ handle: 'none' }];
}

export default function UHandlePage({ params }) {
  return <UHandleRedirect params={params} />;
}
