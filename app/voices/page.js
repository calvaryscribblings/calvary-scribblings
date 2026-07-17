// Server wrapper for the Voices index. Metadata lives in ./layout.js.
//
// The seed exists for the morph: the return leg (author page → grid) needs the chosen
// card to be painted at the incoming document's first frame, or there is no element for
// the portrait to tween back into. bfcache usually restores the grid's DOM and would
// cover this — but only usually, and a morph that works most of the time is a morph that
// looks broken the rest. See app/lib/voices-build.js for the full reasoning.
import { fetchVoicesNode } from '../lib/voices-build';
import VoicesClient from './voices-client';

export default async function VoicesPage() {
  return <VoicesClient initialNode={await fetchVoicesNode()} />;
}
