// Open Pages — the invitation copy (R38). Approved by Ikenna; one source, three sites.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// ⚠ IT PROMISES ATTENTION, NOT OUTCOME. DO NOT "IMPROVE" IT INTO A PROMISE.
// ═══════════════════════════════════════════════════════════════════════════════════
// "We read everything" is a commitment the house can actually keep, every week,
// forever, with no luck involved. "We might commission you" is a lottery ticket: it
// reads better on the page and it is a promise the house does not control, because
// whether a piece gets commissioned depends on the piece. A writer who submits on the
// strength of a lottery ticket and hears nothing has been misled; a writer who submits
// because they were told it would be READ has been told the truth, and it was true.
//
// The line "that is how most of our contributors were found" is the only claim about
// outcome, and it is in the PAST TENSE and about other people — a fact about the
// island's history, not an offer. Keep it that way.
//
// ⚠ AND IT SAYS NOTHING ABOUT MONEY. The patronage promise from newsletter Issue #6 is
// unresolved and is deliberately not part of this. If a later round adds a payment
// sentence here, that round owns the promise — this copy does not make one.
//
// The three placements are deliberately different in volume: an invitation on the
// index, a quiet reassurance beside the publish button, and a thank-you in the footer
// of a piece that is already published. Same commitment, three different moments.

/** The index, under the title. The invitation — this is the one doing the recruiting. */
export const INDEX_INVITATION = Object.freeze({
  line1: 'Anyone can write here. We read everything.',
  line2: 'When a piece belongs in the house, we come and ask — that is how most of our contributors were found.',
});

/** The composer, near publish. Quiet: a reassurance, not a pitch. */
export const COMPOSER_NOTE = 'Published pieces are read by the editors.';

/** The footer of a published piece. A thank-you, after the fact. */
export const PUBLISHED_FOOTER = 'Thank you for writing on the island. We read everything published here.';

// Words that would turn a commitment into a lottery ticket. Asserted against the copy
// above in tests/openpages/distribution.test.mjs, so an "improvement" fails there.
export const OUTCOME_WORDS = Object.freeze([
  'might', 'could', 'chance', 'opportunity', 'selected', 'win', 'prize',
  'paid', 'payment', 'money', 'fee', 'earn', 'commission you', 'guarantee',
]);
