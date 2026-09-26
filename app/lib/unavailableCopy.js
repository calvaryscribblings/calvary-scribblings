// W2 — THE WORDS FOR A READ THAT FAILED. RULED (Ikenna, 26 Sep 2026, 01:53): approved, in house style
// (docs/COPY-RULINGS.md). The offline line about My Library stays because it is TRUE: W11 proved
// it on the live site (tests/offline/offline-shelf-probe.mjs). If the offline shelf ever goes,
// that sentence goes with it.
//
// The brief asks for the app's own Unavailable copy where both platforms have the state. The app's
// source is not in this repository (CLAUDE.md), so these were written fresh in the house voice.
//
// Rule 11 of the premium bar: each message says WHAT HAPPENED and WHAT TO DO NEXT. British English.

export const UNAVAILABLE_COPY = {
  eyebrow: 'CAN’T REACH THE ISLAND',
  retry: 'Try again',
  retrying: 'Trying…',
  kinds: {
    offline: {
      title: 'You’re offline.',
      body: 'Check your connection, then try again. Anything you saved for offline reading is still in My Library.',
    },
    slow: {
      title: 'The island is slow to answer.',
      body: 'Nothing has come back yet. It’s usually the connection, so try again in a moment.',
    },
    ours: {
      title: 'This part didn’t load.',
      body: 'Something went wrong on our side, not yours. Try again in a moment.',
    },
  },
};

/** The lead line for a surface: "We couldn't reach your books." */
export const leadFor = (subject) => (subject ? `We couldn’t reach ${subject}.` : null);

export function copyFor(kind) {
  return UNAVAILABLE_COPY.kinds[kind] || UNAVAILABLE_COPY.kinds.ours;
}
