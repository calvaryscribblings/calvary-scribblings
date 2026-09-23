'use client';

import { COPY } from '../../lib/accountDeletion';

// Shown after DeleteAccountModal's call to POST /api/account/delete has SUCCEEDED and the
// reader has been signed out. Deletion is immediate, so there is no date and no way back —
// this page only says it is done. (It used to render a 7-day schedule from ?on=; that
// soft-delete is gone.)
export default function AccountDeletedPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Cormorant Garamond, Georgia, serif; min-height: 100vh; }

        .ad-wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 1.4rem 4rem; }
        .ad-card { width: 100%; max-width: 520px; text-align: center; }

        .ad-mark { font-family: Cormorant Garamond, Georgia, serif; font-size: 0.78rem; font-weight: 600; color: rgba(245,240,232,0.7); letter-spacing: 0.04em; margin-bottom: 2.4rem; }
        .ad-mark span { color: #a78bfa; }

        .ad-kicker { font-size: 0.6rem; color: rgba(167,139,250,0.55); letter-spacing: 0.22em; text-transform: uppercase; margin-bottom: 0.95rem; }
        .ad-title { font-family: Cormorant Garamond, Georgia, serif; font-weight: 400; font-size: clamp(1.85rem, 5vw, 2.3rem); line-height: 1.12; color: #ffffff; letter-spacing: -0.012em; margin-bottom: 1.05rem; }

        .ad-body { font-size: 0.94rem; line-height: 1.7; color: rgba(232,224,212,0.66); margin-bottom: 1.35rem; }
        .ad-body strong { color: #f5f0e8; font-weight: 500; }



        .ad-link { display: inline-block; font-size: 0.66rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(167,139,250,0.85); text-decoration: none; padding: 0.78rem 1.4rem; border: 1px solid rgba(167,139,250,0.32); border-radius: 9px; transition: all 0.18s; }
        .ad-link:hover { background: rgba(107,47,173,0.1); color: #d8c8ff; border-color: rgba(167,139,250,0.55); }

        .ad-signoff { font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; font-size: 1rem; color: rgba(232,224,212,0.42); margin-top: 2.6rem; }
      `}</style>

      <div className="ad-wrap">
        <div className="ad-card">
          <div className="ad-mark">Calvary <span>Scribblings</span></div>

          <div className="ad-kicker">{COPY.doneKicker}</div>
          <h1 className="ad-title">{COPY.doneTitle}</h1>
          <p className="ad-body">{COPY.doneBody}</p>

          <a href="/" className="ad-link">Back to the home page</a>

          <div className="ad-signoff">{COPY.signoff}</div>
        </div>
      </div>
    </>
  );
}
