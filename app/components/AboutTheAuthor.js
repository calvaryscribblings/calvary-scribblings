'use client';
import { useState, useEffect } from 'react';

// Self-contained Firebase access (lazy — nothing initialises at module eval).
const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};
async function getDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  const { getDatabase } = await import('firebase/database');
  return getDatabase(app);
}

// Generic monochrome social icons (not exact brand logos). ~18px, currentColor.
const ATA_ICONS = {
  instagram: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  x: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.967 6.817H1.683l7.73-8.835L1.254 2.25h6.83l4.713 6.231 5.447-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  ),
  tiktok: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="18" r="3" />
      <path d="M11 18V4l2 1.5a5 5 0 0 0 4 2" />
    </svg>
  ),
  website: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  ),
};

// Map a socials object to the rendered links (non-empty platforms only).
function atalSocialLinks(socials) {
  if (!socials || typeof socials !== 'object') return [];
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const bare = (v) => clean(v).replace(/^@+/, '');
  const out = [];
  const ig = bare(socials.instagram);
  if (ig) out.push({ key: 'instagram', label: 'Instagram', href: `https://instagram.com/${ig}` });
  const x = bare(socials.x);
  if (x) out.push({ key: 'x', label: 'X', href: `https://x.com/${x}` });
  const tt = bare(socials.tiktok);
  if (tt) out.push({ key: 'tiktok', label: 'TikTok', href: `https://tiktok.com/@${tt}` });
  const web = clean(socials.website);
  if (web) out.push({ key: 'website', label: 'Website', href: web });
  return out;
}

// ── About the Author ──────────────────────────────────────────────────────────
// Shared card used on the story page (variant 'full') and the book-reader cover
// (variant 'condensed'). Three-tier + name-only resolution; identical data reads
// in both variants — only layout density and bio length differ. Never renders a
// broken card — any failed read falls back to the plain author name.
export function AboutTheAuthor({ story, variant = 'full' }) {
  const condensed = variant === 'condensed';
  const [profile, setProfile] = useState(null); // null = still resolving
  const fallbackName = (story?.author || '').trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nameOnly = () => ({ mode: 'name', name: fallbackName });
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');

        const readUser = async (uid) => {
          if (!uid) return null;
          const snap = await get(ref(db, `users/${uid}`));
          if (!snap.exists()) return null;
          const u = snap.val() || {};
          // Prefer the editorial authorBio over the self-authored profile bio.
          const bio = (u.authorBio || '').trim() || (u.bio || '').trim();
          return {
            mode: 'full',
            uid,
            name: (u.displayName || '').trim() || fallbackName,
            // Prefer the editorial authorPhotoUrl over the self-set profile avatar.
            avatarUrl: u.authorPhotoUrl || u.avatarUrl || '',
            bio,
            role: (u.authorRole || '').trim(),
            username: u.username || '',
            socials: (u.authorSocials && typeof u.authorSocials === 'object') ? u.authorSocials : {},
          };
        };

        // Tier 1 — explicit uid.
        const uid = (story?.authorUid || '').toString().trim();
        if (uid) {
          const p = await readUser(uid);
          if (!cancelled) setProfile(p || nameOnly());
          return;
        }

        // Tier 2 — resolve handle → uid → user.
        const handle = (story?.authorHandle || '').toString().trim();
        if (handle) {
          const hSnap = await get(ref(db, `usernames/${handle}`));
          const resolvedUid = hSnap.exists() ? (hSnap.val() || '').toString().trim() : '';
          const p = resolvedUid ? await readUser(resolvedUid) : null;
          if (!cancelled) setProfile(p || nameOnly());
          return;
        }

        // Tier 3 — guest author from cms_authors (public read). Shape written by
        // /admin/authors: { name, role, bio, photoUrl, authorSocials }.
        const guestId = (story?.authorGuestId || '').toString().trim();
        if (guestId) {
          const gSnap = await get(ref(db, `cms_authors/${guestId}`));
          const g = gSnap.exists() ? (gSnap.val() || {}) : null;
          const guestProfile = g ? {
            mode: 'full',
            uid: '',            // no uid/username → no profile-handle link
            username: '',
            name: (g.name || '').trim() || fallbackName,
            avatarUrl: g.photoUrl || '',
            bio: (g.bio || '').trim(),
            role: (g.role || '').trim(),
            socials: (g.authorSocials && typeof g.authorSocials === 'object') ? g.authorSocials : {},
          } : null;
          if (!cancelled) setProfile((guestProfile && guestProfile.name) ? guestProfile : nameOnly());
          return;
        }

        // Tier 4 — name only.
        if (!cancelled) setProfile(nameOnly());
      } catch (e) {
        if (!cancelled) setProfile(nameOnly());
      }
    })();
    return () => { cancelled = true; };
  }, [story?.authorUid, story?.authorHandle, story?.authorGuestId, fallbackName]);

  if (!profile || !profile.name) return null;

  const initial = (profile.name || '?').trim().charAt(0).toUpperCase() || '?';
  // Condensed (reader cover) omits the profile-handle link to stay compact.
  const showHandle = !condensed && profile.mode === 'full' && profile.username && profile.uid;

  return (
    <section className={'ata-section' + (condensed ? ' is-condensed' : '')}>
      <div className="ata-card">
        <div className="ata-eyebrow">About the Author</div>
        <div className="ata-row">
          <div className="ata-avatar" aria-hidden={profile.avatarUrl ? undefined : 'true'}>
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt={profile.name} />
              : <span>{initial}</span>}
          </div>
          <div className="ata-meta">
            <div className="ata-name">{profile.name}</div>
            {profile.mode === 'full' && profile.role && (
              <div className="ata-role">{profile.role}</div>
            )}
            {showHandle && (
              <a className="ata-handle" href={`/user?id=${profile.uid}`}>@{profile.username}</a>
            )}
          </div>
        </div>
        {profile.mode === 'full' && profile.bio && (
          <p className="ata-bio">{profile.bio}</p>
        )}
        {profile.mode === 'full' && (() => {
          const links = atalSocialLinks(profile.socials);
          if (!links.length) return null;
          return (
            <div className="ata-socials">
              {links.map((l) => (
                <a key={l.key} className="ata-social" href={l.href} target="_blank" rel="noopener noreferrer" aria-label={l.label}>
                  {ATA_ICONS[l.key]}
                </a>
              ))}
            </div>
          );
        })()}
      </div>

      <style jsx>{`
        /* ── 'full' variant — byte-identical to the original story-page card ── */
        .ata-section { background: #0a0a0a; padding: 2.25rem 2rem 0; }
        .ata-card { max-width: 680px; margin: 0 auto; background: #f0ead8; border: 1px solid #e0dbd2; border-radius: 14px; padding: 1.4rem 1.6rem; box-shadow: 0 8px 30px -18px rgba(0,0,0,0.45); }
        .ata-eyebrow { font-family: Inter, sans-serif; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #6b2fad; margin-bottom: 0.9rem; }
        .ata-row { display: flex; align-items: center; gap: 0.95rem; }
        .ata-avatar { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; overflow: hidden; background: rgba(107,47,173,0.12); border: 1.5px solid rgba(107,47,173,0.25); display: flex; align-items: center; justify-content: center; }
        .ata-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .ata-avatar span { font-family: Cochin, Georgia, serif; font-size: 1.5rem; color: #6b2fad; line-height: 1; }
        .ata-meta { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
        .ata-name { font-family: Cochin, Georgia, serif; font-size: 1.3rem; color: #1a1a1a; line-height: 1.2; }
        .ata-role { font-family: Inter, sans-serif; font-size: 0.7rem; font-weight: 500; letter-spacing: 0.04em; color: #6b2fad; }
        .ata-handle { font-family: Inter, sans-serif; font-size: 0.74rem; color: #6b2fad; text-decoration: none; transition: color 0.2s; }
        .ata-handle:hover { color: #8b4fd6; text-decoration: underline; }
        .ata-bio { margin: 0.9rem 0 0; font-family: Georgia, serif; font-size: 0.92rem; line-height: 1.6; color: #4a4640; }
        .ata-socials { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.9rem; }
        .ata-social { display: inline-flex; color: #6b2fad; opacity: 0.7; transition: opacity 0.2s; }
        .ata-social:hover { opacity: 1; }

        /* ── 'condensed' variant — compact, sits on the dark reader cover ── */
        .ata-section.is-condensed { background: transparent; padding: 0; }
        .is-condensed .ata-card { max-width: 440px; background: rgba(20,12,8,0.5); border: 1px solid rgba(201,164,76,0.28); border-radius: 12px; padding: 1rem 1.15rem; box-shadow: none; backdrop-filter: blur(4px); }
        .is-condensed .ata-eyebrow { color: #c9a44c; font-size: 0.56rem; letter-spacing: 0.2em; margin-bottom: 0.6rem; }
        .is-condensed .ata-row { gap: 0.7rem; }
        .is-condensed .ata-avatar { width: 44px; height: 44px; background: rgba(201,164,76,0.12); border-color: rgba(201,164,76,0.32); }
        .is-condensed .ata-avatar span { color: #c9a44c; font-size: 1.15rem; }
        .is-condensed .ata-name { color: #f0ead8; font-size: 1.1rem; }
        .is-condensed .ata-role { color: #c9a44c; }
        .is-condensed .ata-bio { margin-top: 0.6rem; font-size: 0.82rem; line-height: 1.5; color: rgba(240,234,216,0.82); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .is-condensed .ata-socials { margin-top: 0.65rem; gap: 0.6rem; }
        .is-condensed .ata-social { color: #c9a44c; }
      `}</style>
    </section>
  );
}

export default AboutTheAuthor;
