'use client';

// Client-side forwarder for /u/[handle] -> /user?handle=<handle>.
//
// In a static export there is no server at request time to issue a real HTTP
// redirect, so we forward in the browser on mount. `replace` (not `push`) keeps
// the shorthand URL out of history. In normal production traffic the Cloudflare
// edge _redirects rule resolves /u/<handle> before this page is ever served —
// this is the fallback path.

import { use, useEffect } from 'react';

export default function UHandleRedirect({ params }) {
  const { handle } = use(params);

  useEffect(() => {
    if (!handle) return;
    window.location.replace(`/user?handle=${encodeURIComponent(handle)}`);
  }, [handle]);

  return null;
}
