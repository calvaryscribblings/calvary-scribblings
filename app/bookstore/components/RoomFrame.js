'use client';
// THE FRAME OF THE BOOK STORE'S ROOMS — /bookstore/search and /bookstore/desiderata. W22 §5, §6.
//
// The book page's frame, reused rather than restated: <main> on #070707 with 68px at the top,
// a 920px container padded 3.5rem 2rem 4rem, the book page's breadcrumb (BOOK STORE · <ROOM>),
// the Navbar above and the TabBar below with the Book Store lit.
//
// ⚠ IT SITS BEHIND THE SAME CURTAIN AS THE SHOP, with the same three states and the same
// reasoning as app/bookstore/[slug]/page-detail.js: the export prerenders this component, so
// storage is read after hydration (below), and <LaunchGate /> stays mounted through the unlock
// so its lift has something to reveal. R9's clean-up deletes this curtain along with the other two — see the
// list at the foot of app/lib/bookstore/gate.js.
//
// The rooms set robots noindex THEMSELVES (their page.js metadata), so they stay private after
// launch day takes noindex off app/bookstore/layout.js.

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import TabBar from '../../components/TabBar';
import LaunchGate from './LaunchGate';
import { isStoreUnlocked } from '../../lib/bookstore/gate';

const FONTS = "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&display=swap');";

// The key, read the way React reads anything outside it after hydration: the server snapshot
// ('checking') is what the prerender and the first client render agree on, and the client
// snapshot follows at once. No effect, no setState in one — the shop and the book page run an
// effect for this and carry the lint for it; a new file need not.
const noSubscribe = () => () => {};
const keyState = () => (isStoreUnlocked() ? 'open' : 'shut');
const keyStateOnServer = () => 'checking';

/** Children render only once unlocked, so a room fetches nothing from behind the curtain. */
export default function RoomFrame({ room, css = '', children }) {
  const stored = useSyncExternalStore(noSubscribe, keyState, keyStateOnServer);
  const [keyed, setKeyed] = useState(false);   // unlocked at the gate, this visit
  const [lifted, setLifted] = useState(false); // the gate has finished lifting
  const unlocked = stored === 'open' || keyed;
  const curtain = stored === 'checking' ? 'checking' : (stored === 'open' || lifted ? 'gone' : 'up');

  return (
    <>
      {unlocked && (
        <>
          <Navbar />
          <style>{`
            ${FONTS}
            body{background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
            .room-crumb{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(201,164,76,.5);
              display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:0}
            .room-crumb a{color:rgba(201,164,76,.7);text-decoration:none}
            .room-crumb .here{color:rgba(240,234,216,.55)}
            .room-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
            ${css}
          `}</style>
          <main style={{ background: '#070707', color: '#f0ead8', minHeight: '100vh', paddingTop: '68px', position: 'relative' }}>
            <div className="room-frame" style={{ maxWidth: '920px', margin: '0 auto', padding: '3.5rem 2rem 4rem', position: 'relative', zIndex: 2 }}>
              <nav className="room-crumb" aria-label="Breadcrumb">
                <Link href="/bookstore">Book Store</Link>
                <span style={{ opacity: 0.5 }} aria-hidden="true">&middot;</span>
                <span className="here" aria-current="page">{room}</span>
              </nav>
              {children}
            </div>
          </main>
        </>
      )}
      <TabBar active="store" />
      {curtain === 'up' && (
        <LaunchGate onUnlock={() => setKeyed(true)} onLifted={() => setLifted(true)} />
      )}
    </>
  );
}
