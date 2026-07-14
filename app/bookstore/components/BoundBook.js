'use client';
// BoundBook — renders a title as a physical book object: front cover, spine hinge,
// fore-edge page block, printed back cover, obi band, optional ribbon, shelf shadow.
// Presentational + a `flipped` prop; all motion lives in CSS (BOUND_BOOK_CSS) so a
// consuming page injects the stylesheet ONCE and every instance shares it — no N copies.
//
// The gesture (tap/hold/scroll) lives in useBookGesture; this component only renders and
// exposes a `bind` spread + a `bookRef` for rect measurement. Reduced motion is handled
// entirely in CSS via prefers-reduced-motion (no resting angle, no transitions).
import Image from 'next/image';
import { formatGbp, resolveOpeningLine, resolveBackBlurb, gradientFor, obiLabel } from './fields';

// Injected once per page (storefront, detail, modal). Keyed classes only — no dynamic values.
export const BOUND_BOOK_CSS = `
  .bb-persp{perspective:1600px;perspective-origin:50% 42%}
  .bb-book{position:relative;transform-style:preserve-3d;transform:rotateY(-9deg);
    transition:transform .95s cubic-bezier(.2,.72,.16,1);will-change:transform}
  .bb-book.bb-flipped{transform:rotateY(-178deg) translateY(-16px) scale(1.045)}
  .bb-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;
    border-radius:2px 5px 5px 2px;overflow:hidden}
  .bb-front{background:#0e0a16;box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(201,164,76,.1),inset -5px 0 12px rgba(0,0,0,.42)}
  .bb-back{transform:rotateY(180deg);background:#ece4cf;color:#2a2318;
    box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.2),inset 5px 0 12px rgba(0,0,0,.14)}
  .bb-spine{position:absolute;top:0;bottom:0;left:0;width:13px;z-index:4;pointer-events:none;
    background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.2) 34%,rgba(255,255,255,.09) 50%,rgba(0,0,0,.22) 66%,rgba(0,0,0,.34) 100%)}
  .bb-back .bb-spine{left:auto;right:0;transform:scaleX(-1)}
  .bb-foreedge{position:absolute;top:2.5%;bottom:2.5%;right:-11px;width:12px;transform:translateZ(-7px);z-index:1;
    border-radius:0 2px 2px 0;background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);
    box-shadow:1px 2px 6px rgba(0,0,0,.5)}
  .bb-foreedge-b{position:absolute;left:2.5%;right:2.5%;bottom:-8px;height:8px;transform:translateZ(-5px);z-index:1;
    background:repeating-linear-gradient(0deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);border-radius:0 0 3px 3px}
  .bb-grain{position:absolute;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;
    background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 2px),
      repeating-linear-gradient(90deg,rgba(255,255,255,.4) 0,rgba(0,0,0,.4) 1px,transparent 1px,transparent 3px)}
  .bb-sheen{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(122deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 26%,transparent 46%)}
  .bb-shadow{position:absolute;left:7%;right:7%;bottom:-16px;height:24px;z-index:0;filter:blur(5px);
    transform:translateZ(-40px);background:radial-gradient(ellipse at center,rgba(0,0,0,.6) 0%,transparent 72%)}
  .bb-obi{position:absolute;left:0;right:0;bottom:9%;z-index:5;pointer-events:none;
    background:linear-gradient(180deg,#ece4cf,#ddd2b4);color:#2a2318;
    border-top:1px solid rgba(0,0,0,.14);border-bottom:1px solid rgba(0,0,0,.14);
    box-shadow:0 3px 10px rgba(0,0,0,.35);padding:.34em .1em;text-align:center;
    font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.14em;font-weight:600}
  .bb-ribbon{position:absolute;top:-4px;right:15%;width:15px;z-index:6;pointer-events:none;
    background:linear-gradient(180deg,#e8c877,#a8842f);box-shadow:0 3px 8px rgba(0,0,0,.5)}
  .bb-ribbon::after{content:'';position:absolute;left:0;right:0;bottom:-7px;height:8px;
    background:linear-gradient(180deg,#c9a44c,#a8842f);clip-path:polygon(0 0,100% 0,100% 100%,50% 55%,0 100%)}
  .bb-foil{background:linear-gradient(135deg,#f4e2a6 0%,#c9a44c 42%,#8f6d24 62%,#e8c877 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
  .bb-hoverable .bb-book{cursor:pointer}
  @media (hover:hover){
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:rotateY(-9deg) translateY(-9px)}
  }
  .bb-barcode{display:flex;gap:1px;align-items:flex-end;height:26px}
  .bb-barcode i{display:block;width:2px;background:#2a2318}
  @media (prefers-reduced-motion: reduce){
    .bb-book,.bb-book.bb-flipped{transition:none}
    .bb-book{transform:none}
    .bb-book.bb-flipped{transform:rotateY(180deg)}
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:none}
  }
`;

// Varying bar widths for the faux barcode — deterministic (index-seeded), no randomness.
const BAR_WIDTHS = [2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2];

function FrontFace({ title, width }) {
  const hasCover = !!title.coverUrl;
  return (
    <div className="bb-face bb-front">
      {hasCover ? (
        <Image src={title.coverUrl} alt={title.title} fill unoptimized sizes={`${width}px`} style={{ objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: gradientFor(title.slug || title.title), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.4rem 1rem', textAlign: 'center' }}>
          <div className="bb-foil" style={{ fontFamily: "'Cinzel',serif", fontWeight: 600, fontSize: `${Math.max(0.62, width / 190)}rem`, lineHeight: 1.2, marginBottom: '.5rem', letterSpacing: '.02em' }}>{title.title}</div>
          <div style={{ width: '30px', height: '1px', background: 'rgba(232,200,119,.5)', margin: '.2rem 0 .5rem' }} />
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.62rem', letterSpacing: '.08em', color: 'rgba(240,234,216,.5)' }}>{title.author}</div>
        </div>
      )}
      <div className="bb-spine" />
      <div className="bb-grain" />
      <div className="bb-sheen" />
    </div>
  );
}

function BackFace({ title }) {
  const opening = resolveOpeningLine(title);
  const blurb = resolveBackBlurb(title);
  const price = formatGbp(title.prices?.gbp);
  const cat = Number.isInteger(title.catalogueNumber) ? title.catalogueNumber : null;
  return (
    <div className="bb-face bb-back">
      <div className="bb-spine" />
      <div style={{ position: 'absolute', inset: 0, padding: '11% 12% 9% 15%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#5a4a2a', marginBottom: '.6rem' }}>{title.title}</div>
        {opening && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.72rem', lineHeight: 1.5, color: '#3a3020', marginBottom: '.55rem' }}>&ldquo;{opening}&rdquo;</div>
        )}
        {blurb && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.66rem', lineHeight: 1.55, color: 'rgba(42,35,24,.72)', flex: 1, overflow: 'hidden' }}>{blurb}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '.5rem', marginTop: 'auto', paddingTop: '.6rem' }}>
          {cat !== null ? (
            <div>
              <div className="bb-barcode" aria-hidden="true">
                {BAR_WIDTHS.map((w, i) => <i key={i} style={{ width: `${w}px`, height: `${16 + ((i * 7) % 10)}px` }} />)}
              </div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.5rem', letterSpacing: '.1em', color: '#2a2318', marginTop: '2px' }}>CS&middot;No.{cat}</div>
            </div>
          ) : <span />}
          {price && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 700, fontSize: '.82rem', color: '#2a2318' }}>{price}</div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.44rem', letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(42,35,24,.6)' }}>ebook</div>
            </div>
          )}
        </div>
      </div>
      <div className="bb-grain" />
    </div>
  );
}

export default function BoundBook({ title, variant = 'shelf', width = 160, flipped = false, ribbon, bind = {}, bookRef, hoverable }) {
  const height = Math.round(width * 1.5);
  const showRibbon = ribbon ?? variant === 'window';
  const obi = obiLabel(title);
  const canHover = hoverable ?? (variant === 'shelf' || variant === 'detail');

  return (
    <div
      className={'bb-persp' + (canHover ? ' bb-hoverable' : '')}
      style={{ width, height, position: 'relative', touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
      {...bind}
    >
      <div className="bb-shadow" />
      <div ref={bookRef} className={'bb-book' + (flipped ? ' bb-flipped' : '')} style={{ width, height }}>
        <div className="bb-foreedge" />
        <div className="bb-foreedge-b" />
        <FrontFace title={title} width={width} />
        <BackFace title={title} />
        {showRibbon && <div className="bb-ribbon" style={{ height: Math.round(height * 0.32) }} />}
        {obi && (
          <div className="bb-obi" style={{ fontSize: `${Math.max(0.42, width / 320)}rem` }}>{obi}</div>
        )}
      </div>
    </div>
  );
}
