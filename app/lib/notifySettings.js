// NOTIF-B2 — the Push notifications screen's cards (ruling 312), as data, so the page and its tests
// read one list. Each key is a notify_prefs switch (app/lib/notificationKinds.js PREFS).

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
