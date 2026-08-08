// Client half of story serving. The endpoint is functions/api/story.js and the
// contract is STORY-SERVING-CONTRACT.md — read that, not this, for what the fields
// mean; this file only speaks the wire.
//
// Thin by the same rule as app/lib/bookstore/stream.js: who you are and what you may
// read are decided server-side, because neither can be trusted from here. What comes
// back is either the whole body or a preview of it, and WHICH is not this module's
// business to second-guess.
//
// ── THE THREE THINGS A CALLER MUST NOT DO ────────────────────────────────────────
//
//   1. Do not compute the window. `freeUntilMs` is for rendering a date, never for
//      deciding access — the device clock is settable and the server's is not.
//   2. Do not cache `access`. It is a property of a RESPONSE, not of a story: the
//      same slug answers 'preview' at 10:00 and 'full' at 10:01 when the reader
//      signs in, with nothing about the story having changed.
//   3. Do not render an upsell when `degraded` is true. That flag means we could not
//      check the reader's membership — selling a membership to somebody who may
//      already have one, on the strength of a read we know failed, is the one
//      mistake this endpoint's 503 path exists to prevent.
//
// /api/ is in PASS_THROUGH_PATHS in public/sw.js, so the service worker never caches
// or replays this. That matters here for the same reason it matters for a signed
// URL: a cached response is somebody else's entitlement.

export class StoryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StoryError';
    this.code = code || null;
  }
}

/**
 * Ask for a story body.
 *
 * `user` may be null — a signed-out reader is entitled to the free window, the five
 * newest, all poetry, and a preview of everything else, so this deliberately does
 * NOT require a session. That is the first thing this endpoint does differently from
 * requestStreamUrl(), which refuses without one.
 *
 * Resolves to the endpoint's 200 payload. Throws StoryError on a real failure.
 *
 * A 503 `entitlement_unavailable` RESOLVES rather than throws, because it carries a
 * usable preview: the reader sees the opening and the caller shows a retry. Treating
 * it as an error would replace readable prose with an error page over a membership
 * lookup that failed.
 */
export async function requestStory(user, slug, { client = 'web', clientVersion = '' } = {}) {
  if (!slug) throw new StoryError('That story could not be opened.', 'bad_request');

  const payload = { slug, client, clientVersion };

  if (user) {
    try {
      // Forces a refresh when the cached token is near expiry; cheap otherwise.
      payload.idToken = await user.getIdToken();
    } catch {
      // Deliberately NOT fatal. A token we cannot mint is the same situation as no
      // token at all, and a signed-out reader still gets a preview — failing here
      // would turn a refresh hiccup into a blank story.
      console.warn('[story] could not refresh the ID token; asking as a signed-out reader');
    }
  }

  let res;
  try {
    res = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new StoryError('No connection. Please check your network and try again.', 'offline');
  }

  const data = await res.json().catch(() => null);

  // The degraded path: a 503 that still carries prose. See the note above.
  if (res.status === 503 && data?.preview) return data;

  if (!res.ok) {
    throw new StoryError(
      data?.error || 'Could not open that story just now. Please try again.',
      data?.code || (res.status === 401 ? 'signed_out' : 'unavailable'),
    );
  }
  if (!data?.access) {
    throw new StoryError('Could not open that story just now. Please try again.', 'unavailable');
  }

  return data;
}

/**
 * The body to render, whichever the endpoint sent.
 *
 * One place that knows `content` and `preview` are alternatives, so no component has
 * to remember which key it is looking at. Returns '' for access:'reader', which has
 * neither and belongs at readerHref instead.
 */
export function bodyOf(data) {
  if (!data) return '';
  if (data.access === 'full') return typeof data.content === 'string' ? data.content : '';
  if (data.access === 'preview') return typeof data.preview === 'string' ? data.preview : '';
  return '';
}
