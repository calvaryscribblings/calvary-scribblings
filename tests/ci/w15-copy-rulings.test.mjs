// W15 — RULE 13 ACROSS THE OPEN LIST, THE SERIES FALLBACK, RESPONSES. Pinned word for word.
//
//   node --test tests/ci/w15-copy-rulings.test.mjs      (part of npm run test:ci)
//
// Ikenna, 26 Sep 2026 (docs/COPY-RULINGS.md, "rule 13 across the open list"):
//   18. Rule 13 applies to §1, §2, §3, §6 and §8 of docs/RULE-13-OPEN-LIST.md. His own pages,
//       the legal pages and every §5 judgement call stay as written.
//   20. "One last thing." keeps its full stop.
//   38. The signed-out story page says "Sign in to add a response." The two quiz lines W13
//       moved stand as ruled.
//   The Series fallback reads "Couldn’t open this instalment just now. Please try again."
// Changing any line below needs a new ruling. The W10/W11 refusal lines stay pinned in
// tests/ci/w9-lock-bar.test.mjs and the W11 copy in tests/ci/w11-copy-rulings.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REFUSAL_COPY, TIER_GATE_OFF, refusalCopy } from '../../app/lib/series/access.js';
import { COMPLETION_COPY } from '../../app/lib/profileCompletion.js';

const src = (p) => readFileSync(p, 'utf8');
const count = (s, needle) => s.split(needle).length - 1;

// [section, file, before, after, occurrences]. The strings carry their surrounding quotes or
// markup where that is what makes them unique in the file. Section 'fallback' is the Series
// refusal fallback; '38' is ruling 38.
const CHANGED = [
  ["1", "app/components/AuthModal.js", "'Passwords do not match.'", "\"Passwords don't match.\"", 1],
  ["1", "app/components/AuthModal.js", "'We could not finish creating your account, so nothing was saved. Please try again.'", "\"We couldn't finish creating your account, so nothing was saved. Please try again.\"", 1],
  ["1", "app/components/AuthModal.js", "'We could not finish creating your account. Please contact us before trying again.'", "\"We couldn't finish creating your account. Please contact us before trying again.\"", 1],
  ["1", "app/components/AuthModal.js", "but we could not send the verification email", "but we couldn't send the verification email", 1],
  ["1", "app/components/AuthModal.js", "`Could not resend: ${err.message}`", "`Couldn't resend: ${err.message}`", 1],
  ["1", "app/age-verified/page.js", "'We could not complete your verification. Please try again.'", "'We couldn’t complete your verification. Please try again.'", 1],
  ["1", "app/public-library/page.js", "'You are already subscribed.'", "'You’re already subscribed.'", 1],
  ["1", "app/bookstore/components/BuyButton.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 1],
  ["1", "app/lib/bookstore/checkout.js", "This title cannot be purchased yet.", "This title can’t be purchased yet.", 1],
  ["1", "app/lib/bookstore/checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 1],
  ["1", "app/lib/bookstore/stream.js", "This book cannot be opened yet.", "This book can’t be opened yet.", 1],
  ["1", "app/lib/bookstore/stream.js", "Could not open your copy just now. Please try again.", "Couldn’t open your copy just now. Please try again.", 1],
  ["1", "app/reader/[slug]/book-reader.js", "That is as far as the sample goes.", "That’s as far as the sample goes.", 1],
  ["1", "app/reader/[slug]/book-reader.js", "This sample would not open. The book itself is still here — it is waiting on its own page.", "This sample wouldn’t open. The book itself is still here — it’s waiting on its own page.", 1],
  ["1", "app/reader/[slug]/page-reader.js", "This copy would not open. The story itself is still here — it is waiting on its own page.", "This copy wouldn’t open. The story itself is still here — it’s waiting on its own page.", 1],
  ["1", "app/components/SaveForOffline.js", "'Could not save that.'", "'Couldn’t save that.'", 1],
  ["1", "app/lib/shelf.js", "'Could not open the shelf database'", "'Couldn’t open the shelf database.'", 1],
  ["1", "app/components/MembershipSection.js", "Could not open membership management. Please try again.", "Couldn’t open membership management. Please try again.", 1],
  ["1", "app/components/MembershipSection.js", "A pass is a one-off — there is nothing to cancel and it will not renew.", "A pass is a one-off — there’s nothing to cancel and it won’t renew.", 1],
  ["1", "app/lib/membershipCheckout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 1],
  ["1", "app/lib/membershipCheckout.js", "Could not reach the checkout. Check your connection and try again.", "Couldn’t reach the checkout. Check your connection and try again.", 1],
  ["1", "app/lib/membershipCheckout.js", "That is not available in this currency.", "That isn’t available in this currency.", 1],
  ["1", "app/lib/membershipReturn.js", "That is on our side, and we have already been alerted.", "That’s on our side, and we’ve already been alerted.", 1],
  ["1", "app/lib/membershipReturn.js", "so there is nothing to refresh.", "so there’s nothing to refresh.", 1],
  ["1", "app/series/page.js", "When the first instalment has a date, it will appear here with it.", "When the first instalment has a date, it’ll appear here with it.", 1],
  ["1", "app/series/instalment/[instalmentId]/page-instalment.js", "This instalment has not arrived yet.", "This instalment hasn’t arrived yet.", 1],
  ["1", "app/series/read/[instalmentId]/page-reader.js", "That instalment could not be found.", "That instalment couldn’t be found.", 2],
  ["1", "app/series/read/[instalmentId]/page-reader.js", "This instalment has not arrived yet.", "This instalment hasn’t arrived yet.", 1],
  ["1", "app/series/read/[instalmentId]/page-reader.js", "head: 'Could not open this instalment.'", "head: 'Couldn’t open this instalment.'", 1],
  ["1", "app/lib/series/access.js", "not_released: 'This instalment has not arrived yet.'", "not_released: 'This instalment hasn’t arrived yet.'", 1],
  ["1", "app/lib/series/access.js", "The Series is free to read while memberships are not yet on sale.", "The Series is free to read while memberships aren’t yet on sale.", 1],
  ["fallback", "app/lib/series/access.js", "Could not open this instalment just now. Please try again.", "Couldn’t open this instalment just now. Please try again.", 1],
  ["fallback", "app/lib/series/stream.js", "Could not open this instalment just now. Please try again.", "Couldn’t open this instalment just now. Please try again.", 1],
  ["1", "app/lib/series/stream.js", "This instalment cannot be opened yet.", "This instalment can’t be opened yet.", 1],
  ["1", "app/open-pages/new/page.js", "published: 'It is live',", "published: 'It’s live.',", 1],
  ["1", "app/open-pages/new/page.js", "rejected: 'We cannot publish this one',", "rejected: 'We can’t publish this one.',", 1],
  ["1", "app/open-pages/new/page.js", "error: 'That did not go through',", "error: 'That didn’t go through.',", 1],
  ["1", "app/open-pages/new/page.js", "nothing has been lost, and you will see it on Open Pages once they have.", "nothing has been lost, and you’ll see it on Open Pages once they have.", 1],
  ["1", "app/open-pages/drafts/page.js", "Delete this draft? This cannot be undone.", "Delete this draft? This can’t be undone.", 1],
  ["1", "app/lib/openPagesDrafts.js", "characters, so it is saved on this device only until it is shorter.", "characters, so it’s saved on this device only until it’s shorter.", 1],
  ["1", "app/lib/useOpenPagesDraft.js", "This browser is not storing anything,", "This browser isn’t storing anything,", 1],
  ["1", "app/lib/openPagesCopy.js", "we come and ask — that is how most of our contributors were found.", "we come and ask — that’s how most of our contributors were found.", 1],
  ["1", "app/square/page.js", "The author is not told who reported them.", "The author isn&apos;t told who reported them.", 1],
  ["1", "app/square/page.js", "beneath it will stay — they are not yours to delete.", "beneath it will stay — they aren't yours to delete.", 1],
  ["1", "app/square/page.js", "'Withdraw this post? It will be removed from the Square.'", "\"Withdraw this post? It'll be removed from the Square.\"", 1],
  ["1", "app/square/p/page.js", "this one is not among them.", "this one isn’t among them.", 1],
  ["1", "app/square/p/page.js", "nothing is deleted, so it is\n", "nothing is deleted, so it’s\n", 1],
  ["1", "app/lib/squarePostBody.js", "The replies below are not theirs to remove.", "The replies below aren’t theirs to remove.", 1],
  ["1", "app/components/SeasonBoard.js", "The board could not be loaded just now.", "The board couldn’t be loaded just now.", 1],
  ["1", "app/voices/[slug]/page-client.js", "This voice has not been gathered yet.", "This voice hasn’t been gathered yet.", 1],
  ["1", "app/components/QuizGuidelinesModal.js", "comprehension check — and it is strict.", "comprehension check — and it&apos;s strict.", 1],
  ["1", "app/delete-account/page.js", "address and we will process your deletion request.", "address and we&apos;ll process your deletion request.", 1],
  ["2", "app/age-verified/page.js", "'Something Went Wrong'", "'Something went wrong.'", 1],
  ["2", "app/bookstore/not-found.js", "title: 'This book isn’t on the shelf',", "title: 'This book isn’t on the shelf.',", 1],
  ["2", "app/my-library/read/page.js", ">This story isn&rsquo;t on your shelf<", ">This story isn&rsquo;t on your shelf.<", 1],
  ["2", "app/components/SaveForOffline.js", "'More saved than your plan holds' : 'Your shelf is full'", "'More saved than your plan holds.' : 'Your shelf is full.'", 1],
  ["2", "app/square/p/page.js", ">This post is gone</h1>", ">This post is gone.</h1>", 1],
  ["2", "app/user/page.js", ">There’s no reader by that name</h1>", ">There’s no reader by that name.</h1>", 1],
  ["2", "app/open-pages/edit/[id]/page-client.js", "'Couldn’t save these changes'", "'Couldn’t save these changes.'", 1],
  ["2", "app/open-pages/edit/[id]/page-client.js", "'Hmm — that didn’t work'", "'Hmm — that didn’t work.'", 1],
  ["2", "app/stories/[slug]/page-client.js", "Dead End is a collector's read\n", "Dead End is a collector's read.\n", 1],
  ["3", "app/components/AuthModal.js", "setSuccess('Verification email resent.')", "setSuccess('Verification email resent')", 1],
  ["3", "app/age-verified/page.js", "                Just a moment.\n", "                Just a moment\n", 1],
  ["3", "app/open-pages/new/page.js", "return 'No file selected.';", "return 'No file selected';", 1],
  ["3", "app/open-pages/edit/[id]/page-client.js", "return 'No file selected.';", "return 'No file selected';", 1],
  ["3", "app/open-pages/new/page.js", ">Nothing to preview yet.<", ">Nothing to preview yet<", 1],
  ["3", "app/open-pages/edit/[id]/page-client.js", ">Nothing to preview yet.<", ">Nothing to preview yet<", 1],
  ["3", "app/components/OpenPagesProfileSection.jsx", "No stories published yet.\n", "No stories published yet\n", 1],
  ["3", "app/profile/page.js", ">No posts yet.</div>", ">No posts yet</div>", 1],
  ["3", "app/profile/page.js", ">No one here yet.</div>", ">No one here yet</div>", 1],
  ["3", "app/profile/page.js", ">No comments yet.</div>", ">No comments yet</div>", 1],
  ["3", "app/profile/page.js", ">No notifications yet.</div>", ">No notifications yet</div>", 1],
  ["3", "app/user/page.js", ">No posts yet.</div>", ">No posts yet</div>", 1],
  ["3", "app/user/page.js", ">No one here yet.</div>", ">No one here yet</div>", 1],
  ["3", "app/user/page.js", ">No comments yet.</div>", ">No comments yet</div>", 1],
  ["3", "app/square/page.js", ">No notifications yet.</div>", ">No notifications yet</div>", 1],
  ["3", "app/quizzes/page.js", "'No completed quizzes yet.'", "'No completed quizzes yet'", 1],
  ["3", "app/quizzes/page.js", "'All quizzes attempted.'", "'All quizzes attempted'", 1],
  ["3", "app/quizzes/page.js", "'No quizzes available.'", "'No quizzes available'", 1],
  ["3", "app/reader/[slug]/ReadingRoom.js", ">No matches.</div>", ">No matches</div>", 1],
  ["3", "app/rewards/page.js", "No Scribbles history yet.\n", "No Scribbles history yet\n", 1],
  ["3", "app/voices/[slug]/page-client.js", ">No published work yet.</p>", ">No published work yet</p>", 1],
  ["3", "app/series/[slug]/page-detail.js", "No instalments listed yet.\n", "No instalments listed yet\n", 1],
  ["3", "app/series/[slug]/page-detail.js", ">No such series.</h1>", ">No such series</h1>", 1],
  ["3", "app/series/instalment/[instalmentId]/page-instalment.js", ">No such instalment.</h1>", ">No such instalment</h1>", 1],
  ["3", "app/series/instalment/[instalmentId]/page-instalment.js", "          Not yet.\n", "          Not yet\n", 1],
  ["3", "app/series/read/[instalmentId]/page-reader.js", "head: 'Not yet.',", "head: 'Not yet',", 1],
  ["3", "app/series/read/[instalmentId]/page-reader.js", "head: 'Locked.',", "head: 'Locked',", 1],
  ["6", "functions/api/bookstore/checkout.js", "Purchasing is not configured yet.", "Purchasing isn’t configured yet.", 2],
  ["6", "functions/api/bookstore/checkout.js", "Could not reach the catalogue.", "Couldn’t reach the catalogue.", 1],
  ["6", "functions/api/bookstore/checkout.js", "That title is not in the catalogue.", "That title isn’t in the catalogue.", 1],
  ["6", "functions/api/bookstore/checkout.js", "That title is not on sale.", "That title isn’t on sale.", 2],
  ["6", "functions/api/bookstore/checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 3],
  ["6", "functions/api/bookstore/paystack-checkout.js", "This book is not yet priced in naira.", "This book isn’t yet priced in naira.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "Naira payments are not configured yet.", "Naira payments aren’t configured yet.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "Purchasing is not configured yet.", "Purchasing isn’t configured yet.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "Could not reach the catalogue.", "Couldn’t reach the catalogue.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "That title is not in the catalogue.", "That title isn’t in the catalogue.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "That title is not on sale.", "That title isn’t on sale.", 2],
  ["6", "functions/api/bookstore/paystack-checkout.js", "This title cannot be purchased in naira.", "This title can’t be purchased in naira.", 1],
  ["6", "functions/api/bookstore/paystack-checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 4],
  ["6", "functions/api/bookstore/stream.js", "Reading is not configured yet.", "Reading isn’t configured yet.", 2],
  ["6", "functions/api/bookstore/stream.js", "Could not open your copy just now. Please try again.", "Couldn’t open your copy just now. Please try again.", 3],
  ["6", "functions/api/bookstore/stream.js", "You do not own this book yet.", "You don’t own this book yet.", 1],
  ["6", "functions/api/membership/checkout.js", "Memberships are not available yet.", "Memberships aren’t available yet.", 2],
  ["6", "functions/api/membership/checkout.js", "That membership is not available in this currency.", "That membership isn’t available in this currency.", 1],
  ["6", "functions/api/membership/checkout.js", "That membership is not available yet.", "That membership isn’t available yet.", 1],
  ["6", "functions/api/membership/checkout.js", "Your plan could not be changed just now.", "Your plan couldn’t be changed just now.", 1],
  ["6", "functions/api/membership/checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 4],
  ["6", "functions/api/membership/pass-checkout.js", "That pass is not sold in this currency.", "That pass isn’t sold in this currency.", 1],
  ["6", "functions/api/membership/pass-checkout.js", "Passes are not available yet.", "Passes aren’t available yet.", 1],
  ["6", "functions/api/membership/pass-checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 3],
  ["6", "functions/api/membership/paystack-checkout.js", "Naira memberships are not available yet.", "Naira memberships aren’t available yet.", 1],
  ["6", "functions/api/membership/paystack-checkout.js", "That membership is not available in naira.", "That membership isn’t available in naira.", 1],
  ["6", "functions/api/membership/paystack-checkout.js", "This account cannot pay in naira.", "This account can’t pay in naira.", 1],
  ["6", "functions/api/membership/paystack-checkout.js", "Your plan could not be changed just now.", "Your plan couldn’t be changed just now.", 1],
  ["6", "functions/api/membership/paystack-checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 4],
  ["6", "functions/api/membership/paystack-pass-checkout.js", "That pass is not sold in naira.", "That pass isn’t sold in naira.", 1],
  ["6", "functions/api/membership/paystack-pass-checkout.js", "Naira passes are not available yet.", "Naira passes aren’t available yet.", 1],
  ["6", "functions/api/membership/paystack-pass-checkout.js", "Passes could not be opened for this account.", "Passes couldn’t be opened for this account.", 1],
  ["6", "functions/api/membership/paystack-pass-checkout.js", "Checkout could not be opened. Please try again.", "Checkout couldn’t be opened. Please try again.", 3],
  ["6", "functions/api/membership/paystack-cancel.js", "There is no naira membership to cancel.", "There’s no naira membership to cancel.", 1],
  ["6", "functions/api/membership/portal.js", "We are still setting up your membership.", "We’re still setting up your membership.", 1],
  ["6", "functions/api/membership/portal.js", "You do not have a membership to manage yet.", "You don’t have a membership to manage yet.", 1],
  ["6", "functions/api/membership/portal.js", "Membership management is not available yet.", "Membership management isn’t available yet.", 2],
  ["6", "functions/api/membership/portal.js", "Could not reach your membership just now.", "Couldn’t reach your membership just now.", 1],
  ["6", "functions/api/membership/portal.js", "Could not open membership management. Please try again.", "Couldn’t open membership management. Please try again.", 3],
  ["6", "functions/api/series/stream.js", "The Series is not configured yet.", "The Series isn’t configured yet.", 2],
  ["6", "functions/api/series/stream.js", "That instalment could not be found.", "That instalment couldn’t be found.", 1],
  ["6", "functions/api/auth/send-verification.js", "Could not reach the mail service.", "Couldn’t reach the mail service.", 1],
  ["6", "functions/api/auth/send-verification.js", "Verification email could not be sent.", "Verification email couldn’t be sent.", 1],
  ["6", "functions/api/open-pages/moderate.js", "Could not load the post to edit.", "Couldn’t load the post to edit.", 1],
  ["8", "public/sw.js", "'This story isn&rsquo;t on your shelf'", "'This story isn&rsquo;t on your shelf.'", 1],
  ["38", "app/stories/[slug]/page-client.js", "<p>Sign in to join the discussion</p>", "<p>Sign in to add a response.</p>", 1],
  ["38", "app/reader/[slug]/page-reader.js", "<p>Sign in to join the discussion</p>", "<p>Sign in to add a response.</p>", 1],
];

describe('W15 · every changed line, word for word at its source', () => {
  for (const [sec, file, before, after, n] of CHANGED) {
    test(`§${sec} ${file} · ${after.trim().slice(0, 70)}`, () => {
      const s = src(file);
      assert.equal(count(s, after), n, `${file} should carry ${JSON.stringify(after)} ${n}×`);
      assert.equal(count(s, before), 0, `${file} still carries ${JSON.stringify(before)}`);
    });
  }
});

// ── THE OLD WORDS ARE GONE ───────────────────────────────────────────────────────────────
// Every long-form sentence W15 replaced, searched across app/, functions/ and the service
// worker. Out of scope and so exempt: /admin (not reader copy), and the §10 endpoints the web
// never renders (functions/api/story.js, functions/api/auth/welcome.js).
const EXEMPT = [/^app\/admin\//, /^functions\/api\/story\.js$/, /^functions\/api\/auth\/welcome\.js$/];
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(e) ? [p] : [];
});
const SWEPT = [...walk('app'), ...walk('functions'), 'public/sw.js'].filter((p) => !EXEMPT.some((re) => re.test(p)));
const unquote = (s) => s.replace(/^[`'"]|[`'"]$/g, '');
const OLD_SENTENCES = [...new Set(CHANGED
  .filter(([sec]) => sec === '1' || sec === '6' || sec === 'fallback' || sec === '38')
  .map(([, , before]) => unquote(before.replace(/^(\w+: )/, '').replace(/,$/, '').replace(/^<p>|<\/p>$/g, '')).trim())
  .filter((s) => s.includes(' ')))];

describe('W15 · none of the old strings survives', () => {
  test('the sweep covers the surfaces', () => {
    assert.ok(SWEPT.length > 300, `only ${SWEPT.length} files swept`);
    assert.ok(OLD_SENTENCES.length > 60, `only ${OLD_SENTENCES.length} old sentences`);
  });
  test('no replaced long-form sentence, in app/, functions/ or public/sw.js', () => {
    const hits = [];
    for (const p of SWEPT) {
      const s = src(p);
      for (const old of OLD_SENTENCES) if (s.includes(old)) hits.push(`${p}: ${old}`);
    }
    assert.deepEqual(hits, []);
  });
  test('"Checkout could not be opened." is gone from all 24 places it stood', () => {
    for (const p of SWEPT) assert.doesNotMatch(src(p), /Checkout could not be opened/, p);
  });
});

// ── THE RULINGS ──────────────────────────────────────────────────────────────────────────
describe('W15 · the rulings', () => {
  test('ruling 38: the signed-out story page, on /stories and /reader', () => {
    for (const p of ['app/stories/[slug]/page-client.js', 'app/reader/[slug]/page-reader.js']) {
      assert.match(src(p), /<p>Sign in to add a response\.<\/p>/, p);
      assert.doesNotMatch(src(p), /join the discussion/i, p);
    }
  });
  test('ruling 38: the two quiz lines W13 moved stand as ruled', () => {
    assert.match(src('app/components/QuizCard.js'), /Responses below are open\./);
    assert.match(src('app/components/QuizGuidelinesModal.js'), /Fail both and the quiz locks — though Responses\s+remain open\./);
  });
  test('ruling 20: "One last thing." keeps its full stop', () => {
    assert.equal(COMPLETION_COPY.title, 'One last thing.');
  });
  test('the Series refusal copy, whole', () => {
    assert.deepEqual({ ...REFUSAL_COPY }, {
      not_released: 'This instalment hasn’t arrived yet.',
      [TIER_GATE_OFF]: 'The Series is free to read while memberships aren’t yet on sale.',
      signed_out: 'Sign in to read this instalment.',
      needs_platinum: 'The Series is a Platinum membership benefit.',
      needs_gold: 'This instalment is open to Gold and Platinum members.',
      pass_excluded: 'Day and week passes don’t include the Series — it comes with a Gold or Platinum membership.',
      unavailable: 'Couldn’t open this instalment just now. Please try again.',
    });
    assert.equal(refusalCopy({ reason: 'no-such-reason' }), 'Couldn’t open this instalment just now. Please try again.');
  });
  test('the fallback agrees in all three places', () => {
    assert.ok(src('app/lib/series/stream.js').includes(`data?.error || '${REFUSAL_COPY.unavailable}'`));
    // The endpoint has no copy of its own: every unavailable answer is refusalCopy().
    const ep = src('functions/api/series/stream.js');
    assert.match(ep, /refusalCopy\(\{ reason: 'unavailable' \}\)/);
    assert.doesNotMatch(ep, /open this instalment/);
  });
});

// ── RULE 13, CHECKED MECHANICALLY over every changed string ──────────────────────────────
// Same regex as tests/ci/w11-copy-rulings.test.mjs.
const LONG_FORMS = /\b(cannot|can not|could not|do not|does not|did not|will not|we will|you will|you are|we are|it will|it is|is not|are not|was not|were not|has not|have not|had not|would not|should not|that is|there is|you have|we have|let us)\b/i;
// "The replies beneath it will stay": "it" is the object of "beneath", so there's nothing to contract.
const NOT_A_LONG_FORM = ['beneath it will stay'];

const HEADINGS = [
  'Something went wrong.', 'This book isn’t on the shelf.', 'This story isn&rsquo;t on your shelf.',
  'Your shelf is full.', 'More saved than your plan holds.', 'This post is gone.', 'There’s no reader by that name.',
  'It’s live.', 'We can’t publish this one.', 'That didn’t go through.', 'Couldn’t save these changes.',
  'Hmm — that didn’t work.', 'Dead End is a collector\'s read.', 'Couldn’t open this instalment.',
];
const FRAGMENTS = [
  'Verification email resent', 'Just a moment', 'No file selected', 'Nothing to preview yet', 'No stories published yet',
  'No posts yet', 'No one here yet', 'No comments yet', 'No notifications yet', 'No completed quizzes yet',
  'All quizzes attempted', 'No quizzes available', 'No matches', 'No Scribbles history yet', 'No published work yet',
  'No instalments listed yet', 'No such series', 'No such instalment', 'Not yet', 'Locked',
];

describe('W15 · rule 13 holds across every changed line', () => {
  test('short forms throughout', () => {
    for (const [, file, , after] of CHANGED) {
      let s = after;
      for (const ok of NOT_A_LONG_FORM) s = s.replace(ok, '');
      assert.doesNotMatch(s, LONG_FORMS, `${file}: ${after}`);
    }
  });
  test('every full-sentence heading ends with a full stop, and each is in the source', () => {
    const all = CHANGED.map(([, , , after]) => after).join('\n');
    for (const h of HEADINGS) {
      assert.match(h, /\.$/, h);
      assert.ok(all.includes(h), `${h} is not among the changed lines`);
    }
  });
  test('short status fragments take none', () => {
    const all = CHANGED.filter(([sec]) => sec === '3').map(([, , , after]) => after).join('\n');
    for (const f of FRAGMENTS) {
      assert.doesNotMatch(f, /\.$/, f);
      assert.ok(all.includes(f), `${f} is not among the changed lines`);
      assert.ok(!all.includes(`${f}.`), `${f} still carries a stop`);
    }
  });
});
