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

const SERIF = "'Cormorant Garamond', Georgia, serif";

export default function StoryGate({ gate, onSignIn, signedIn }) {
  if (!gate || gate.access !== 'preview') return null;

  const degraded = gate.degraded === true;

  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', padding: '0 2rem 3rem',
      fontFamily: SERIF, textAlign: 'center',
    }}>
      {/* The fade is the only thing that says "this continues" without words. It sits
          above the rule so the prose appears to run under it rather than stop at it. */}
      <div aria-hidden style={{
        height: 120, marginTop: -120, pointerEvents: 'none',
        background: 'linear-gradient(to bottom, rgba(245,240,232,0) 0%, #f5f0e8 85%)',
      }} />

      <div style={{ borderTop: '1px solid #e0dbd2', paddingTop: '2rem' }}>
        {degraded ? (
          <>
            <p style={{ margin: 0, fontSize: '1.05rem', color: '#4a4a4a', lineHeight: 1.6 }}>
              We could not check your membership just now.
            </p>
            <p style={{ margin: '0.5rem 0 1.4rem', fontSize: '0.95rem', color: '#8a8378', lineHeight: 1.6 }}>
              You are reading the opening. If you are a member, a refresh should bring
              the rest.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={pill}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: '1.15rem', color: '#2a2a2a', lineHeight: 1.5 }}>
              The rest of this story is in the archive.
            </p>
            <p style={{ margin: '0.6rem 0 1.5rem', fontSize: '0.95rem', color: '#8a8378', lineHeight: 1.65 }}>
              Every story is free to read for its first week. This one is older —
              Gold opens it, along with everything else we have published.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/membership" style={{ ...pill, textDecoration: 'none' }}>
                See membership
              </a>
              {/* Only offered to a reader who is not signed in. A signed-in free
                  reader has already been identified and telling them to sign in
                  would be a dead end. */}
              {!signedIn && (
                <button type="button" onClick={onSignIn} style={{ ...pill, borderColor: 'rgba(42,42,42,0.2)', color: '#4a4a4a' }}>
                  I have an account
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const pill = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: SERIF, fontSize: '0.8rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#7a5c1c',
  background: 'transparent', border: '1px solid rgba(201,164,76,0.6)',
  padding: '0.7em 1.5em', borderRadius: 2, cursor: 'pointer',
  lineHeight: 1.4,
};
