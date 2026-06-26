// ---------------------------------------------------------------
// Open Pages brand tokens — single source of truth for the video
// ---------------------------------------------------------------
import { loadFont as loadCormorant } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';

const cormorant = loadCormorant();
const cinzel = loadCinzel();

export const FONTS = {
  serif: cormorant.fontFamily, // Cormorant Garamond — prose, quotes
  display: cinzel.fontFamily, // Cinzel — brand marks, labels
};

export const COLORS = {
  ink: '#080610', // near-black canvas
  panel: '#120d1c', // composer / card surface
  purple: '#6b2fad',
  purpleL: '#9a5fd6',
  purpleSoft: 'rgba(107, 47, 173, 0.35)',
  gold: '#c9a84c',
  goldSoft: 'rgba(201, 168, 76, 0.55)',
  cream: '#f5f0e8',
  creamDim: 'rgba(245, 240, 232, 0.62)',
  creamFaint: 'rgba(245, 240, 232, 0.28)',
  line: '#2a2036',
};

export const FPS = 30;

// Scene boundaries in frames (60s total = 1800 frames @ 30fps)
export const SCENES = {
  s1: { from: 0, duration: 240 }, //  0:00–0:08  cursor + typewriter
  s2: { from: 240, duration: 270 }, //  0:08–0:17  invitation + gold rule
  s3: { from: 510, duration: 300 }, //  0:17–0:27  catalogue cascade
  s4: { from: 810, duration: 240 }, //  0:27–0:35  moderation gate
  s5: { from: 1050, duration: 240 }, //  0:35–0:43  feed → reader
  s6: { from: 1290, duration: 240 }, //  0:43–0:51  pocket thresholds → badge
  s7: { from: 1530, duration: 270 }, //  0:51–1:00  manifesto + closing cursor
};

export const TOTAL_FRAMES = 1800;
