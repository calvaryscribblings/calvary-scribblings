'use client';
// The end of a preview — what a reader sees where the rest of the story would be.
//
// Rendered only for `access: 'preview'`. Everything it says comes from the endpoint's
// response (STORY-SERVING-CONTRACT.md §4.5); this component invents no policy and
// asks no questions of its own about tiers, dates or windows.
//
// ── THE ONE RULE THAT IS NOT TASTE ───────────────────────────────────────────────
//
// NO UPSELL ON A DEGRADED RESPONSE. `degraded: true` means the server could not read
// the reader's membership. Selling a membership to somebody who may already have one,
// on the strength of a lookup we know failed, is precisely the mistake the 503 path
// exists to prevent — so that branch offers a retry and nothing else.
//
// ── AND ONE THAT IS TASTE, BUT DELIBERATE ────────────────────────────────────────
//
// It does not say "you have read 30% of this story". A percentage frames the prose
// as a ration. `previewOf` is carried so a surface CAN show a count, and this one
// chooses not to — it names what is behind the door instead, which is the honest
// pitch: the archive, not the remainder of this page.

// W9: drawn by ArchiveLock (app/components/ArchiveLock.js) in the April age gate's language;
// the words live in app/lib/archiveLock.js. The fade ends in the reading ground exactly and
// spans the article's full measure — this component adds no side padding of its own.

import ArchiveLock from './ArchiveLock';
import { STORY_LOCK_COPY as C, DEGRADED_LOCK_COPY as D } from '../lib/archiveLock';

export default function StoryGate({ gate, onSignIn, signedIn }) {
  if (!gate || gate.access !== 'preview') return null;

  if (gate.degraded === true) {
    return (
      <ArchiveLock theme="cream" fade eyebrow={D.eyebrow} headline={D.headline} body={D.body}
        cta={{ label: D.cta, onClick: () => window.location.reload() }} />
    );
  }

  // "Already a member? Sign in" only for a reader who is not signed in: a signed-in free reader
  // has already been identified, and telling them to sign in would be a dead end.
  return (
    <ArchiveLock theme="cream" fade eyebrow={C.eyebrow} headline={C.headline} body={C.body}
      cta={{ label: C.cta, href: '/membership' }}
      signIn={signedIn ? null : { label: C.signIn, onClick: onSignIn }} />
  );
}
