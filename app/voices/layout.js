// Metadata for the Voices index, and the fence the island morph runs inside.
//
// The page itself is a client component (it reads cms_voices live), so metadata moves
// here — the same split as app/public-library. A voice's own page overrides this via
// generateMetadata in [slug]/page.js.
//
// This layout wraps BOTH /voices and /voices/{slug}, which is exactly the fence the morph
// needs: a cross-document view transition only fires when both the outgoing and incoming
// document opt in. Declaring it here opts in the two pages of the pair and nothing else,
// so /voices → / (Return to the Island) stays a plain navigation, as does / → /voices.
import { VT_RETURN_KEY } from '../lib/voices';

const BASE_URL = 'https://calvaryscribblings.co.uk';
const OG_IMAGE = `${BASE_URL}/favicon.png`;

// The house curve, and the morph's own duration.
const MORPH_MS = 850;
const MORPH_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
// Exits obey; entrances perform. Going back is a retreat, not a reveal.
const RETURN_MS = 300;

// Directional targeting, and the morph handoff.
//
// Both halves depend on `pagereveal`, which fires on the incoming document before its
// first rendering opportunity — i.e. before React has hydrated, so the flag and the
// promise are always in place by the time an effect reads them.
//
//   1. navigation.activation.navigationType tells us the nav was a 'traverse' (back or
//      forward through history) rather than a fresh push. That is the directional
//      targeting the spec asked about: the API does allow it, so the return runs at
//      300ms while the departure keeps its full 850ms. Note this lives on the Navigation
//      API global, NOT on the pagereveal event — an event property by that name does not
//      exist, and reading one silently yields undefined, which reads as "never a back"
//      and quietly costs you the whole feature.
//   2. viewTransition.finished is parked on window so the author page's arrival can wait
//      for the morph to land before it starts composing. Nothing else may await this —
//      the works query fires on mount regardless. Cinema never delays data.
//
// Everything here is feature-detected by construction: a browser without cross-document
// view transitions never fires pagereveal, the listener never runs, the flag is never
// set, and the arrival falls back to starting on its own readiness. No errors, no morph.
const MORPH_SCRIPT = `(function(){
  var d=document.documentElement,K='${VT_RETURN_KEY}';
  window.__csVoiceMorph=null;
  window.addEventListener('pagereveal',function(e){
    if(!e.viewTransition)return;
    var back=false,a=self.navigation&&self.navigation.activation;
    try{if(sessionStorage.getItem(K))back=true;}catch(_){}
    if(a&&a.navigationType==='traverse')back=true;
    if(back)d.setAttribute('data-cs-vt','back');
    window.__csVoiceMorph=e.viewTransition.finished;
    var clear=function(){d.removeAttribute('data-cs-vt');};
    e.viewTransition.finished.then(clear,clear);
  });
  // The intent flag never outlives the one navigation it was set for, even when no
  // transition ran to consume it (an unsupported browser, a reduced-motion reader).
  window.addEventListener('pageshow',function(){try{sessionStorage.removeItem(K);}catch(_){}});
})();`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Voices of the Island — Calvary Scribblings',
  description:
    'Meet the writers and voices of Calvary Scribblings — the contributors behind the short stories, flash fiction, poetry and essays published on the island.',
  alternates: { canonical: '/voices' },
  openGraph: {
    type: 'website',
    url: `${BASE_URL}/voices`,
    siteName: 'Calvary Scribblings',
    title: 'Voices of the Island — Calvary Scribblings',
    description: 'The writers and voices of Calvary Scribblings.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Voices of the Island — Calvary Scribblings',
    description: 'The writers and voices of Calvary Scribblings.',
    images: [OG_IMAGE],
  },
};

export default function VoicesLayout({ children }) {
  return (
    <>
      {/* Inline and synchronous by necessity: pagereveal fires on the incoming document
          before its first rendering opportunity, so the listener has to be registered
          during parse. next/script would defer it past the event it exists to catch. */}
      <script dangerouslySetInnerHTML={{ __html: MORPH_SCRIPT }} />
      <style>{`
        /* The opt-in itself. Nested in a no-preference query so that a reader who asks
           for reduced motion never enters a transition at all — the navigation is plain
           and the content is simply there. This is the whole of the morph's reduced-motion
           story: not a faster morph, no morph. */
        @media (prefers-reduced-motion: no-preference) {
          @view-transition { navigation: auto; }
        }

        /* The house curve, applied to every captured group. The '*' matches all
           view-transition-names, which here means the voice-{slug} pair plus the root
           snapshot. The pseudo-elements hang off :root, so these selectors attach
           directly to it rather than descending from it. */
        ::view-transition-group(*),
        ::view-transition-old(*),
        ::view-transition-new(*) {
          animation-duration: ${MORPH_MS}ms;
          animation-timing-function: ${MORPH_EASE};
        }

        /* The return. Set by the pagereveal listener above when the navigation was a
           history traverse. */
        :root[data-cs-vt='back']::view-transition-group(*),
        :root[data-cs-vt='back']::view-transition-old(*),
        :root[data-cs-vt='back']::view-transition-new(*) {
          animation-duration: ${RETURN_MS}ms;
        }
      `}</style>
      {children}
    </>
  );
}
