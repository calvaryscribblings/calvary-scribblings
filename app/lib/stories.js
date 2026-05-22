// Stories source of truth: cms_stories/ in Firebase RTDB.
// The hardcoded stories array was migrated to CMS on 2026-05-18.
// This export is intentionally empty and kept ONLY so existing
// imports (across category pages, search, profile, sitemap, etc.)
// don't throw at import time. Each consumer already merges with
// a CMS fetch — the empty baseline now means zero stale data
// before the fetch resolves.
//
// DO NOT reintroduce hardcoded entries here.
export const stories = [];

export function parseDate(str) { return new Date(str); }
export function isNew(s) { return (Date.now() - parseDate(s.date)) / 86400000 <= 7; }

export const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
  flash: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  short: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  poetry: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  inspiring: { background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.4)' },
};

export const categoryMeta = {
  news: { label: 'News & Updates', emoji: '📰', accent: '#ef4444' },
  flash: { label: 'Flash Fiction', emoji: '⚡', accent: '#7c3aed' },
  short: { label: 'Short Stories', emoji: '📖', accent: '#7c3aed' },
  poetry: { label: 'Poetry', emoji: '✍️', accent: '#7c3aed' },
  inspiring: { label: 'Inspiring Stories', emoji: '✨', accent: '#d97706' },
  serial: { label: 'Serial Stories', emoji: '📚', accent: '#7c3aed' },
};
