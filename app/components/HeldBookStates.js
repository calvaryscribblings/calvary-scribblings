'use client';
// THE HELD-BOOK DOOR'S TWO GENERIC STATES — W33.
//
// /my-library/book?t=<titleId> must not differ by whether the title exists. So everything a
// reader sees there, short of their own book opening, is one of these two, and neither names
// anything: no title, no author, no cover, no buy button, no sample, no store link. The id in the
// address is never echoed back.
//
//   HeldSignIn       signed out — the ordinary prompt to sign in to your library
//   HeldNotOnShelf   signed in, and no active copy at this address (missing record, revoked
//                    record, malformed id, or a stream refusal) — one page for all of them
//
// The night ground and the type are the book register's pre-reading frame
// (app/reader/[slug]/book-reader.js), so a held book that does open arrives from the same room.
import { useState } from 'react';
import AuthModal from './AuthModal';

export const HELD_SIGN_IN_LINE = 'Sign in to open the books on your shelf.';
export const HELD_NOT_ON_SHELF_LINE = 'This book isn’t on your shelf.';
export const HELD_NOT_ON_SHELF_NOTE = 'The books you hold are in My Library.';

const STYLE = `
  .hb-shell{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(107,47,173,.18) 0%,transparent 68%),#1a0f0a;font-family:'Cormorant Garamond',Georgia,serif}
  .hb-orn{font-size:.9rem;letter-spacing:.4em;color:rgba(201,164,76,.35);margin-bottom:1.5rem}
  .hb-kicker{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.28em;text-transform:uppercase;color:#c9a44c;margin-bottom:1.4rem}
  .hb-h1{font-size:clamp(1.4rem,4vw,2rem);font-weight:300;font-style:italic;color:#f5efe0;line-height:1.25;margin:0 0 .6rem;max-width:520px}
  .hb-p{font-size:1rem;color:rgba(240,234,216,.5);font-style:italic;max-width:440px;line-height:1.7;margin:0 0 2.2rem}
  .hb-btn{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#1a0f0a;background:#c9a44c;border:1px solid #c9a44c;border-radius:3px;padding:.85rem 2rem;cursor:pointer;text-decoration:none}
  .hb-btn:hover{background:#e0bb63;border-color:#e0bb63}
  .hb-link{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;text-decoration:none;border:1px solid rgba(201,164,76,.4);border-radius:3px;padding:.85rem 2rem;background:rgba(201,164,76,.04)}
`;

export function HeldSignIn() {
  const [showAuth, setShowAuth] = useState(false);
  return (
    <div className="hb-shell" data-held-state="signed-out">
      <style>{STYLE}</style>
      <div className="hb-orn" aria-hidden="true">&#10086;</div>
      <div className="hb-kicker">Your Library</div>
      <p className="hb-p">{HELD_SIGN_IN_LINE}</p>
      <button type="button" className="hb-btn" onClick={() => setShowAuth(true)}>Sign in</button>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

export function HeldNotOnShelf() {
  return (
    <div className="hb-shell" data-held-state="not-on-shelf">
      <style>{STYLE}</style>
      <div className="hb-orn" aria-hidden="true">&#10086;</div>
      <div className="hb-kicker">Your Library</div>
      <h1 className="hb-h1">{HELD_NOT_ON_SHELF_LINE}</h1>
      <p className="hb-p">{HELD_NOT_ON_SHELF_NOTE}</p>
      <a className="hb-link" href="/my-library">Back to My Library</a>
    </div>
  );
}
