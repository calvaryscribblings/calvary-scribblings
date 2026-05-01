'use client';

import { useEffect, useState } from 'react';

// Confirmation page shown after a user soft-deletes their account.
// The redirect from DeleteAccountModal includes ?on=<unix-ms> so we can
// render the exact scheduled-for date. If the param is missing (e.g. the
// user lands here from a bookmark), we fall back to a generic message.
function formatDate(ms) {
  if (!ms || Number.isNaN(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return null; }
}

export default function AccountDeletedPage() {
  const [scheduledFor, setScheduledFor] = useState(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const on = parseInt(params.get('on'), 10);
      if (Number.isFinite(on)) setScheduledFor(on);
    } catch {}
  }, []);

  const dateLabel = formatDate(scheduledFor);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Inter, sans-serif; min-height: 100vh; }

        .ad-wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 1.4rem 4rem; }
        .ad-card { width: 100%; max-width: 520px; text-align: center; }

        .ad-mark { font-family: Cochin, 'Cormorant Garamond', Georgia, serif; font-size: 0.78rem; font-weight: 600; color: rgba(245,240,232,0.7); letter-spacing: 0.04em; margin-bottom: 2.4rem; }
        .ad-mark span { color: #a78bfa; }

        .ad-kicker { font-size: 0.6rem; color: rgba(167,139,250,0.55); letter-spacing: 0.22em; text-transform: uppercase; margin-bottom: 0.95rem; }
        .ad-title { font-family: Cochin, 'Cormorant Garamond', Georgia, serif; font-weight: 400; font-size: clamp(1.85rem, 5vw, 2.3rem); line-height: 1.12; color: #ffffff; letter-spacing: -0.012em; margin-bottom: 1.05rem; }

        .ad-body { font-size: 0.94rem; line-height: 1.7; color: rgba(232,224,212,0.66); margin-bottom: 1.35rem; }
        .ad-body strong { color: #f5f0e8; font-weight: 500; }

        .ad-date { display: inline-block; font-family: Cochin, 'Cormorant Garamond', Georgia, serif; font-size: 1.05rem; color: #c4b5fd; padding: 0.6rem 1rem; border-radius: 9px; background: rgba(107,47,173,0.08); border: 1px solid rgba(107,47,173,0.22); margin-bottom: 1.65rem; }

        .ad-recover { font-size: 0.84rem; color: rgba(232,224,212,0.55); line-height: 1.65; margin-bottom: 2.4rem; }
        .ad-recover strong { color: #f5f0e8; font-weight: 500; }

        .ad-link { display: inline-block; font-size: 0.66rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(167,139,250,0.85); text-decoration: none; padding: 0.78rem 1.4rem; border: 1px solid rgba(167,139,250,0.32); border-radius: 9px; transition: all 0.18s; }
        .ad-link:hover { background: rgba(107,47,173,0.1); color: #d8c8ff; border-color: rgba(167,139,250,0.55); }

        .ad-signoff { font-family: 'Cormorant Garamond', Cochin, Georgia, serif; font-style: italic; font-size: 1rem; color: rgba(232,224,212,0.42); margin-top: 2.6rem; }
      `}</style>

      <div className="ad-wrap">
        <div className="ad-card">
          <div className="ad-mark">Calvary <span>Scribblings</span></div>

          <div className="ad-kicker">Account scheduled for deletion</div>
          <h1 className="ad-title">Your account is on its way out.</h1>

          {dateLabel ? (
            <>
              <p className="ad-body">
                We&rsquo;ll permanently delete your account on
              </p>
              <div className="ad-date">{dateLabel}</div>
            </>
          ) : (
            <p className="ad-body">
              We&rsquo;ll permanently delete your account at the end of the 7-day grace period.
            </p>
          )}

          <p className="ad-body" style={{ marginTop: '0.4rem' }}>
            Your content has been <strong>hidden from the platform</strong>, and your account is
            locked from sign-in.
          </p>

          <p className="ad-recover">
            If this was a mistake, email <strong>Ikennaworksfromhome@gmail.com</strong> within 7 days
            from the address on the account and we&rsquo;ll restore everything.
          </p>

          <a href="/" className="ad-link">Back to the home page</a>

          <div className="ad-signoff">We&rsquo;re sorry to see you go.</div>
        </div>
      </div>
    </>
  );
}
