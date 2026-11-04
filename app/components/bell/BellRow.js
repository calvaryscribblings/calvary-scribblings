'use client';
// NOTIF-B2 — one row of the list, in the panel (compact) or on /notifications.
//
// Avatar 40px (36px in the panel) with an 18px (16px) kind badge at its bottom right, ringed 2px in
// the row's ground. Grouped reactions: two overlapping 30px avatars. New stories: the story's small
// cover at 31×46. Sender-less kinds: a gold tile. Text in Cormorant Garamond 17px (16px), names at
// 600; the second line italic 15.5px, #A39CB2 for quoted words, #D8D0C2 for titles; the time on the
// right in Inter 500 11px. Unread: a darker ground and a 7px violet dot at the left edge.
//
// Every name and picture is drawn live (identityOf); a row with no sender is the house's.

import { BADGES, headline, timeLabel, HOUSE_NAME, NO_PROFILE_NAME } from '../../lib/bell';
import { KindBadge, Tile } from './icons';

const INK = '#EFE8DA';
const INTER = "'Inter', system-ui, -apple-system, sans-serif";
const SERIF = "'Cormorant Garamond', Georgia, serif";

function initialsOf(name) {
  const s = String(name || '').trim();
  if (!s) return 'R';
  return s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function Face({ uid, users, size, ring, house }) {
  const u = uid ? users(uid) : null;
  const name = house ? HOUSE_NAME : ((u && (u.displayName || u.handle || u.username)) || NO_PROFILE_NAME);
  const src = house ? '/cs-logo-512-v3.png' : (u && (u.avatarUrl || u.photoURL)) || null;
  return (
    <span data-face={house ? 'house' : uid || ''} style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: house ? '#14121C' : 'rgba(107,69,200,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C4B5FD', fontFamily: SERIF, fontWeight: 600, fontSize: Math.round(size * 0.36), boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 36/40px face from users/{uid}; the export has no image optimiser */}
      {src ? <img src={src} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: house ? 'contain' : 'cover' }} /> : initialsOf(name)}
    </span>
  );
}

/** What a new story's row shows: title, cover, and for an instalment its series. */
function storyBits(r, details) {
  if (r.slug) {
    const s = details.story(r.slug);
    return { title: (s && s.title) || r.title || null, cover: (s && (s.coverSmall || s.cover)) || null };
  }
  if (r.instalmentId) {
    const d = details.instalment(r.instalmentId);
    const se = r.seriesId ? details.series(r.seriesId) : null;
    const part = d && d.title;
    const title = se?.title && part ? `${se.title} · ${part}` : (part || se?.title || null);
    return { title, cover: (d && d.coverUrl) || (se && se.coverUrl) || null };
  }
  return { title: null, cover: null };
}

/** `now` comes from the caller (a render must not read the clock). */
export default function BellRow({ r, details, compact = false, now, fresh = false, onOpen }) {
  const ground = fresh ? (compact ? '#1A1626' : '#100D1B') : (compact ? '#14121C' : 'transparent');
  const ring = fresh ? ground : (compact ? '#14121C' : '#0A0A0A');
  const avatar = compact ? 36 : 40;
  const badgeSize = compact ? 16 : 18;
  const users = (uid) => details.user(uid);
  const userMap = new Proxy({}, { get: (_, uid) => details.user(uid) });
  const parts = headline(r, userMap);
  const bits = r.kind === 'new_story' ? storyBits(r, details) : null;
  const titled = r.kind === 'response' || r.kind === 'story_reaction';
  const titleOf = titled && r.slug ? (details.story(r.slug)?.title || null) : null;
  const quote = r.quote || (r.needsQuote ? details.quote(r.needsQuote.slug, r.needsQuote.commentId) : null) || null;
  const grouped = (r.actorCount || 0) > 1 && r.actors.length > 1 && r.badge === 'heart';

  let picture;
  if (r.tile) picture = <Tile tile={r.tile} size={avatar} />;
  else if (bits) {
    picture = (
      <span style={{ width: avatar, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ position: 'relative', width: 31, height: 46 }}>
          <span data-cover style={{ width: 31, height: 46, borderRadius: 3, overflow: 'hidden', background: '#2A2338', display: 'block' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a 31×46 cover; the export has no image optimiser */}
            {bits.cover ? <img src={bits.cover} alt="" width={31} height={46} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </span>
          <KindBadge badge="gold" kind="new_story" size={badgeSize} ring={ring} colors={BADGES} />
        </span>
      </span>
    );
  } else if (grouped) {
    picture = (
      <span data-grouped style={{ position: 'relative', width: avatar, height: avatar, flexShrink: 0 }}>
        {/* In the avatar's own square two 30px faces sit 6px apart and their initials collide, so
            each reaches 4px past it (short of the unread dot on the left, into the gap on the right):
            14px apart in the panel, 18px on the page. */}
        <span style={{ position: 'absolute', left: -4, top: -2 }}><Face uid={r.actors[1]} users={users} size={30} /></span>
        <span style={{ position: 'absolute', right: -4, bottom: -2 }}><Face uid={r.actors[0]} users={users} size={30} ring={ring} /></span>
        <KindBadge badge={r.badge} kind={r.kind} size={badgeSize} ring={ring} colors={BADGES} />
      </span>
    );
  } else {
    picture = (
      <span style={{ position: 'relative', width: avatar, height: avatar, flexShrink: 0 }}>
        <Face uid={r.actor} users={users} size={avatar} house={!r.actor} />
        {r.badge ? <KindBadge badge={r.badge} kind={r.kind} size={badgeSize} ring={ring} colors={BADGES} /> : null}
      </span>
    );
  }

  const second = bits ? bits.title : (titleOf || quote);
  const secondIsTitle = !!(bits || titleOf);

  return (
    <a
      href={r.href || '#'}
      onClick={(e) => { if (!r.href) e.preventDefault(); onOpen?.(r); }}
      data-bell-row={r.kind}
      data-notification={r.legacyId || r.key}
      data-fresh={fresh ? 'true' : 'false'}
      style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: compact ? 12 : 14, padding: compact ? '12px 18px 12px 20px' : '14px 20px 14px 24px', background: ground, textDecoration: 'none', color: INK }}
    >
      {fresh ? <span aria-hidden="true" data-dot style={{ position: 'absolute', left: compact ? 7 : 9, top: '50%', marginTop: -3.5, width: 7, height: 7, borderRadius: '50%', background: '#8B63E6' }} /> : null}
      {picture}
      <span style={{ flex: 1, minWidth: 0 }}>
        {r.fromFollowed ? (
          <span style={{ display: 'block', fontFamily: INTER, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: '#C9A84C', marginBottom: 3 }}>FROM A WRITER YOU FOLLOW</span>
        ) : null}
        <span style={{ display: 'block', fontFamily: SERIF, fontSize: compact ? 16 : 17, lineHeight: 1.3, color: INK }}>
          {parts.map((p, i) => (p.name ? <b key={i} style={{ fontWeight: 600 }}>{p.name}</b> : <span key={i}>{p.text}</span>))}
        </span>
        {second ? (
          <span style={{ marginTop: 2, fontFamily: SERIF, fontStyle: 'italic', fontSize: 15.5, lineHeight: 1.35, color: secondIsTitle ? '#D8D0C2' : '#A39CB2', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {secondIsTitle ? second : `“${second}”`}
          </span>
        ) : null}
      </span>
      <span style={{ fontFamily: INTER, fontWeight: 500, fontSize: 11, color: '#8E879D', whiteSpace: 'nowrap', paddingTop: 3 }}>{timeLabel(r.at, now)}</span>
    </a>
  );
}
