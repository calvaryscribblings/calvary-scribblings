'use client';
// NOTIF-B2, redrawn in BELL-1 to Ikenna's approved canvas ("Web · iPad, bell open" for the panel,
// the canvas's list for /notifications): one row of the list, in the panel (compact) or on the page.
// Every number is in SIZES below; the brief's DESIGN block is the source.
//
// The picture sits in a box (38 in the panel, 44 on the page): one face (36/40, 1/2 in), two faces
// for grouped reactions (26/30, the second ringed in the row's ground), the story's cover for new
// stories and responses (28×42 / 31×46, square corners, centred), or for an item with no sender a
// dark round tile. The kind badge sits at the BOX's bottom right (−4, −4), ringed 2px in the row's
// ground. Text in Cormorant Garamond, names at 600; seen rows dimmed (#DCD5C9), names never.
// New since the last look: a darker ground and a 7px violet dot level with the picture.
//
// Every name and picture is drawn live (identityOf); a row with no sender is the house's.

import { BADGES, WORDS, headline, secondLine, storyBits, timeLabel, HOUSE_NAME, NO_PROFILE_NAME } from '../../lib/bell';
import { KindBadge, Tile } from './icons';

const INK = '#EFE8DA';
const INTER = "'Inter', system-ui, -apple-system, sans-serif";
const SERIF = "'Cormorant Garamond', Georgia, serif";

function initialsOf(name) {
  const s = String(name || '').trim();
  if (!s) return 'R';
  return s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const SIZES = {
  panel: {
    pad: '13px 18px 13px 24px', gap: 13, border: '#1E1B29', fresh: '#1A1626', seen: '#14121C', seenRing: '#14121C', dot: [9, 29],
    box: 38, face: 36, faceAt: 1, pair: 26, pairAt: 11, cover: [28, 42], tileGlyph: 16, badge: 16, badgeGlyph: 9,
    size: 16, size2: 14.5, gap2: 2, timePad: 3, timeSpacing: undefined,
  },
  page: {
    pad: '14px 18px 14px 26px', gap: 14, border: '#16141F', fresh: '#100D1B', seen: 'transparent', seenRing: '#0A0A0A', dot: [10, 32],
    box: 44, face: 40, faceAt: 2, pair: 30, pairAt: 13, cover: [31, 46], tileGlyph: 18, badge: 18, badgeGlyph: 10,
    size: 17, size2: 15.5, gap2: 3, timePad: 4, timeSpacing: '0.04em',
  },
};
const SEEN_INK = '#DCD5C9';

function Face({ uid, users, size, ring, house, at = 0 }) {
  const u = uid ? users(uid) : null;
  const name = house ? HOUSE_NAME : ((u && (u.displayName || u.handle || u.username)) || NO_PROFILE_NAME);
  const src = house ? '/cs-logo-512-v3.png' : (u && (u.avatarUrl || u.photoURL)) || null;
  return (
    <span data-face={house ? 'house' : uid || ''} style={{ position: 'absolute', left: at, top: at, width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: house ? '#14121C' : 'rgba(107,69,200,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C4B5FD', fontFamily: SERIF, fontWeight: 600, fontSize: Math.round(size * 0.36), boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 26–40px face from users/{uid}; the export has no image optimiser */}
      {src ? <img src={src} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: house ? 'contain' : 'cover' }} /> : initialsOf(name)}
    </span>
  );
}

/** `now` comes from the caller (a render must not read the clock). */
export default function BellRow({ r, details, compact = false, now, fresh = false, onOpen }) {
  const z = compact ? SIZES.panel : SIZES.page;
  const ground = fresh ? z.fresh : z.seen;
  const ring = fresh ? z.fresh : z.seenRing;
  const users = (uid) => details.user(uid);
  const userMap = new Proxy({}, { get: (_, uid) => details.user(uid) });
  const parts = headline(r, userMap, details);
  const covered = r.kind === 'new_story' || (r.kind === 'response' && !!r.slug);
  const bits = covered ? storyBits(r, details) : null;
  const line2 = secondLine(r, details);
  const grouped = !covered && (r.actorCount || 0) > 1 && r.actors.length > 1 && r.badge === 'heart';
  const badge = r.badge ? <KindBadge badge={r.badge} kind={r.kind} size={z.badge} glyph={z.badgeGlyph} ring={ring} colors={BADGES} /> : null;

  let picture;
  if (r.tile) {
    picture = (
      <span data-picture="tile" style={{ position: 'relative', width: z.box, height: z.box, flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: z.faceAt, top: z.faceAt }}><Tile tile={r.tile} size={z.face} glyph={z.tileGlyph} /></span>
      </span>
    );
  } else if (covered) {
    const [w, h] = z.cover;
    picture = (
      <span data-picture="cover" style={{ position: 'relative', width: z.box, height: h, flexShrink: 0 }}>
        <span data-cover style={{ position: 'absolute', left: (z.box - w) / 2, top: 0, width: w, height: h, borderRadius: 0, overflow: 'hidden', background: '#2A2338', display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a 28×42 / 31×46 cover; the export has no image optimiser */}
          {bits.cover ? <img src={bits.cover} alt="" width={w} height={h} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
        </span>
        {badge}
      </span>
    );
  } else if (grouped) {
    picture = (
      <span data-picture="grouped" data-grouped style={{ position: 'relative', width: z.box, height: z.box, flexShrink: 0 }}>
        <Face uid={r.actors[1]} users={users} size={z.pair} at={0} />
        <Face uid={r.actors[0]} users={users} size={z.pair} at={z.pairAt} ring={ring} />
        {badge}
      </span>
    );
  } else {
    picture = (
      <span data-picture="face" style={{ position: 'relative', width: z.box, height: z.box, flexShrink: 0 }}>
        <Face uid={r.actor} users={users} size={z.face} at={z.faceAt} house={!r.actor} />
        {badge}
      </span>
    );
  }

  return (
    <a
      href={r.href || '#'}
      onClick={(e) => { if (!r.href) e.preventDefault(); onOpen?.(r); }}
      data-bell-row={r.kind}
      data-notification={r.legacyId || r.key}
      data-fresh={fresh ? 'true' : 'false'}
      style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: z.gap, padding: z.pad, background: ground, borderBottom: `1px solid ${z.border}`, textDecoration: 'none', color: INK }}
    >
      {fresh ? <span aria-hidden="true" data-dot style={{ position: 'absolute', left: z.dot[0], top: z.dot[1], width: 7, height: 7, borderRadius: '50%', background: '#8B63E6' }} /> : null}
      {picture}
      {/* white-space: normal: the panel sits inside the header, which sets nowrap; without this no
          panel row wrapped and long lines ran under the time (BELL-1, measured). */}
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal' }}>
        <span data-line1 style={{ display: 'block', fontFamily: SERIF, fontSize: z.size, lineHeight: 1.32, color: fresh ? INK : SEEN_INK }}>
          {parts.map((p, i) => (p.name ? <b key={i} style={{ fontWeight: 600, color: INK }}>{p.name}</b> : <span key={i}>{p.text}</span>))}
        </span>
        {line2 ? (
          <span data-line2 style={{ marginTop: z.gap2, fontFamily: SERIF, fontStyle: 'italic', fontSize: z.size2, lineHeight: 1.35, color: line2.quoted ? '#A39CB2' : '#D8D0C2', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {line2.quoted ? `“${line2.text}”` : line2.text}
          </span>
        ) : null}
        {r.fromFollowed ? (
          <span data-followed style={{ display: 'block', fontFamily: INTER, fontWeight: 600, fontSize: 9.5, letterSpacing: '0.2em', color: '#C9A84C', marginTop: 8 }}>{WORDS.from_followed}</span>
        ) : null}
      </span>
      <span data-time style={{ fontFamily: INTER, fontWeight: 500, fontSize: 11, letterSpacing: z.timeSpacing, color: '#8E879D', whiteSpace: 'nowrap', paddingTop: z.timePad }}>{timeLabel(r.at, now)}</span>
    </a>
  );
}
