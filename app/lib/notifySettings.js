// NOTIF-B2 — the Push notifications screen's cards (ruling 312), as data, so the page and its tests
// read one list. Each key is a notify_prefs switch (app/lib/notificationKinds.js PREFS).
//
// Ruling 337: the screen shows only switches that do something today. STORIES from the start;
// PEOPLE and YOUR WRITING since personal pushes switched on (P4-S0). THE SQUARE, its switch and its
// notify_prefs field stay in the code behind its flag, off until its own push goes live (P7).
// Turning a card on is one edit here (and the bell suite's ruling-337 expectations with it).

/** One flag per card that isn't live yet. Flip it the day that card's push ships. */
export const CARD_LIVE = Object.freeze({
  PEOPLE: true,           // P4: personal pushes, live at switch-on (P4-S0)
  'YOUR WRITING': true,   // P4: personal pushes, live at switch-on (P4-S0)
  'THE SQUARE': false,    // P7: the Square's push
});

/** The cards, in order: the words are the ruling's (312). */
export const SETTINGS_CARDS = Object.freeze([
  { heading: 'STORIES', rows: [{ key: 'stories', label: 'new stories and instalments', sub: '08:00 at the earliest, two a day at most' }] },
  { heading: 'PEOPLE', rows: [
    { key: 'replies_mentions', label: 'replies and mentions', sub: 'as they happen' },
    { key: 'messages', label: 'messages', sub: 'as they happen' },
    { key: 'followers', label: 'new followers', sub: 'as they happen' },
    { key: 'reactions', label: 'reactions', sub: 'grouped, at most once an hour for each post' },
  ] },
  { heading: 'YOUR WRITING', writersOnly: true, rows: [
    { key: 'responses', label: 'responses on your stories', sub: 'grouped, at most once an hour for each story' },
    { key: 'open_pages', label: 'your Open Pages pieces', sub: 'when one goes live' },
  ] },
  { heading: 'THE SQUARE', rows: [{ key: 'square_opens', label: 'when the Square opens', sub: 'every night at 8pm' }] },
]);

/** Whether a card is shown at all (ruling 337). A card without a flag is live. */
export const isCardLive = (card) => CARD_LIVE[card.heading] !== false;

/** The cards this reader sees: live ones, and YOUR WRITING only for writers. */
export const visibleCards = ({ writer = false } = {}) =>
  SETTINGS_CARDS.filter((c) => isCardLive(c) && (!c.writersOnly || writer));

/** Whether any live card is for writers only, so the page reads users/{uid}/isAuthor only then. */
export const needsWriterFlag = () => SETTINGS_CARDS.some((c) => c.writersOnly && isCardLive(c));
