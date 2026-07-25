// The web app manifest — Next's file convention. Exporting this from app/ emits
// /manifest.webmanifest AND injects <link rel="manifest"> into every page, so
// app/layout.js needs no edit for it. Under output:'export' it is cut once at build
// and served as a static file.
//
// This is a REINSTATEMENT, not a first draft. The pre-Next static site shipped a
// manifest.json (deleted in e2d6f59); its icon list is carried over verbatim because
// those files still sit in public/ untouched. Two things deliberately DO NOT carry over:
//
//   start_url — was '/'. It is now '/my-library'. The shelf is the reason to install:
//     an installed launch should land on the reader's own saved stories, not on the
//     gateway's front door. The gateway is for arrivals; an installed app is not an
//     arrival. This also makes the iOS add-to-home-screen nudge coherent — the thing
//     we ask readers to install opens on the thing we asked them to install it for.
//
//   theme_color — was '#6b46c1', the retired platform purple. The whole My Library
//     surface is gateway grammar (night canvas, gold and cream); see the tab bar v3
//     notes in app/components/TabBar.js on why that purple register is gone. The colours
//     below are the shelf's own: #0b0716 is the mid-stop of the .ml-page radial, #080610
//     its outer stop, so the OS chrome and the splash screen meet the page seamlessly
//     instead of flashing violet at it.
//
// Installability matters beyond taste: iOS Safari evicts all script-writable storage
// after ~7 days without a visit, and the ONLY exemption is a site added to the Home
// Screen. Without this manifest the offline shelf silently empties itself on iPhone.
// Required by Next 16 under output:'export'. A metadata route is a Route Handler under the
// hood, and the exporter refuses to emit one that has not declared itself static — the
// build fails outright rather than silently shipping a route that cannot exist in a static
// export. Nothing here is dynamic, so this is a declaration, not a constraint.
export const dynamic = 'force-static';

export default function manifest() {
  return {
    name: 'Calvary Scribblings',
    short_name: 'Calvary',
    description:
      'The Story Island — original fiction, poetry and essays. Save stories to read with no signal.',
    start_url: '/my-library',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080610',
    theme_color: '#0b0716',
    icons: [
      { src: '/icon-72x72.png', sizes: '72x72', type: 'image/png' },
      { src: '/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icon-128x128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icon-144x144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-384x384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}
