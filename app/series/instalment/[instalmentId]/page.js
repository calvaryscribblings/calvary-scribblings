// Server wrapper for an instalment's detail page. Same static-export pattern as
// app/series/read/[instalmentId]/page.js, and deliberately the same SHAPE as it: one flat
// dynamic segment keyed on the globally-unique instalment id, because ids are
// `<seriesSlug>-i<ordinal>` (app/lib/series/admin-writes.js:instalmentId) and a nested
// /series/{slug}/{ordinal} would static-export as a parameter matrix for no gain.
//
// ── THE ROUTE RESERVES A SLUG, AS /series/read ALREADY DOES ──────────────────────────────
//
// /series/instalment/… sits beside /series/[slug], so "instalment" joins "read" as a word no
// series may be slugged with. That hazard is not new and it is not growing: SLUG_RE would
// happily accept either, and a series called "Read" would have shadowed its own route since
// R12.0. Two reserved words on a site with one series is a note in a header, not a guard.
//
// ── NO generateMetadata, FOR THE REASON THE READER ROUTE GIVES AND ONE MORE ──────────────
//
// The reader route carries no metadata because a share card for a gated file would have to
// read series_instalments_detail at BUILD time and bake an unreleased instalment's title into
// static HTML on a CDN. Every word of that applies here, and this page holds MORE of that
// node than the reader does — the logline and the sponsor credit as well as the title, all
// three of them things nobody has announced yet.
//
// The build's Firebase client is anonymous, so today the rule would simply refuse it. That is
// a reason to be calm, not a reason to ask: scripts/migrate-beta-princess.mjs already shows
// what a build step looks like once someone hands it a service credential, and the fix for
// "we accidentally gave the build a token" should not be "and now the release gate is off".
// THE SERIES PAGE IS THE SHAREABLE SURFACE. It is public at all times, by construction.
import { buildRead } from '../../../lib/build-read.mjs';
import InstalmentDetailClient from './page-instalment';

const SENTINEL_ID = '__no-instalments-yet__';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

export async function generateStaticParams() {
  // ⛔ PL-12 — guarded. The instalment index is a live client query and these pages are
  // static, so an unreadable node shipped a series whose instalments do not open.
    // The PUBLIC row node only — ids are public, titles are not, and a build step has no
    // business holding the second. Verbatim the reader route's rule and for its reason.
    //
    // Published-but-unreleased rows ARE enumerated, and must be: the page has to exist at its
    // URL on the day the clock passes releaseAtMs, and nothing deploys at that moment. What it
    // renders before then is the locked state, which is built from the row alone.
  const ids = await buildRead(
    'series_instalments (status = published)',
    '/series/instalment/[instalmentId] — the page for every instalment a series lists',
    async () => {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getDatabase, ref, query, orderByChild, equalTo, get } = await import('firebase/database');
      const app = getApps().length ? getApps()[0] : initializeApp(FB);
      const db = getDatabase(app);
      const snap = await get(query(ref(db, 'series_instalments'), orderByChild('status'), equalTo('published')));
      const out = [];
      if (snap.exists()) snap.forEach((child) => { out.push(child.key); return false; });
      return out;
    },
  );
  // Empty is a valid answer and keeps the sentinel. Unreachable never reaches here.
  return ids.length ? ids.map((instalmentId) => ({ instalmentId })) : [{ instalmentId: SENTINEL_ID }];
}

export default async function SeriesInstalmentPage({ params }) {
  const { instalmentId } = await params;
  return <InstalmentDetailClient instalmentId={instalmentId} sentinel={SENTINEL_ID} />;
}
