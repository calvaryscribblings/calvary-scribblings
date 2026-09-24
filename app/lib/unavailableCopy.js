// W2 — THE WORDS FOR A READ THAT FAILED. DRAFT for Ikenna: every line here is new.
//
// The brief asks for the app's own Unavailable copy where both platforms have the state. The app's
// source is not in this repository (CLAUDE.md), and no copy of that screen's words has ever been
// pasted into a round here, so these are written fresh in the house voice and listed for review.
// When the app's words arrive, they replace these in this one file.
//
// Rule 11 of the premium bar: each message says WHAT HAPPENED and WHAT TO DO NEXT. British English.

export const UNAVAILABLE_COPY = {
  eyebrow: 'CAN’T REACH THE ISLAND',
  retry: 'Try again',
  retrying: 'Trying…',
  kinds: {
    offline: {
      title: 'You’re offline',
      body: 'Check your connection, then try again. Anything you saved for offline reading is still in My Library.',
    },
    slow: {
      title: 'The island is slow to answer',
      body: 'Nothing has come back yet. It’s usually the connection, so try again in a moment.',
    },
    ours: {
      title: 'This part didn’t load',
      body: 'Something went wrong on our side, not yours. Try again in a moment.',
    },
  },
};

/** The lead line for a surface: "We couldn't reach your books." */
export const leadFor = (subject) => (subject ? `We couldn’t reach ${subject}.` : null);

export function copyFor(kind) {
  return UNAVAILABLE_COPY.kinds[kind] || UNAVAILABLE_COPY.kinds.ours;
}
