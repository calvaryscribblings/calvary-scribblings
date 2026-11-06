// STORY-W1 — rulings 315 and 316 (Ikenna, 3 Nov 2026), the website's half.
//
//   315  A responses line sits under the story's byline, date and read time, and tapping it
//        goes to the responses.
//   316  With no responses, the line reads "Be the first to respond" and opens the response box.
//
// The words only. The count is the one the Responses section shows in its own header (a
// deleted reader's tombstone is not a response, W17), handed up by that section, so the line
// and the header can never disagree. The page is app/stories/[slug]/page-client.js.

/** The responses line for a count of live responses. */
export function responsesLineText(n) {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (count === 0) return 'Be the first to respond';
  return count === 1 ? '1 response' : `${count} responses`;
}
