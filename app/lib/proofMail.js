// PROOFS-R3 (rulings 254, 290, 291, 292) — THE WRITER EMAILS. Pure: no I/O.
//
// Shared by the server (functions/api/proofs/_mail.js, which sends), /admin/proofs (which shows the
// opening list and the sample control) and the tests, so the three can never disagree about who is
// emailed, when, or in what words.
//
// ── THE FOUR EMAILS ─────────────────────────────────────────────────────────────────────
//   opening    once per writer, ever: what Proofs is and how to use it. A writer with a scheduled
//              story gets it as "Your proofs are ready", listing those stories and when each goes
//              live (London). Sent when a founder confirms the opening list, or later by the tick
//              to a writer who wasn't on that list at all (see WHO, below).
//   scheduled  a story of theirs is scheduled (first seen as a proof by this writer's ledger).
//   changed    its go-live time is not the one they were last told.
//   reminder   48 hours before it goes live, unless they were told this go-live time less than 48
//              hours before it (the email they got already said when).
//
// ── THE LEDGER (server-only; no client reads or writes it) ─────────────────────────────
//   proofs_mail/writers/{uid}/opening          { at, by, stories, sent, why?, sentAt?, emailId? }
//   proofs_mail/writers/{uid}/excluded         { at, by }   unticked at opening: no emails at all
//   proofs_mail/writers/{uid}/stories/{slug}   { goLiveMs, toldAt, kind, seq, sent, why?,
//                                                remindedFor?, remindedAt?, log: { e<seq>: { kind,
//                                                goLiveMs, at, sent, why? } } }
// Every change to a ledger record is a compare-and-swap (RTDB ETag), made BEFORE the email goes:
// whichever of two runs wins the swap sends, the other sends nothing. A lost email beats a double
// one (the rule _alerts.js already keeps). The record says, per writer and per story, what was sent
// and for which go-live time.
//
// ── WHO IS EMAILED ─────────────────────────────────────────────────────────────────────
//   · Nobody while Proofs is closed. The tick does nothing, and nothing queues up.
//   · A writer unticked at opening ('excluded') gets nothing, ever, until a founder presses "Email
//     them" in /admin/proofs, which sends them the opening email then. Their proofs are still on
//     /proofs for them, because access is the switch, not the email.
//   · A writer with neither an opening nor an exclusion (the badge came after the opening, or the
//     account had no email address then) gets the opening email at their first scheduled story,
//     listing all of them, instead of a bare "scheduled".
//   · A writer with no email address: nothing is claimed and nothing is recorded as sent. They are
//     counted, and shown in /admin/proofs. Once the account has an address, the next tick sends
//     whatever is due then.
import { isProof, goLiveMs, londonWhen, isProofSlug, bySoonest } from './proofs.js';
import { isId } from './ids.js';

export const PROOF_MAIL_PATH = 'proofs_mail/writers';
export const REMINDER_LEAD_MS = 48 * 3_600_000;
export const SITE = 'https://calvaryscribblings.co.uk';
export const proofUrl = (slug) => `${SITE}/proofs?story=${encodeURIComponent(slug)}`;
export const PROOFS_URL = `${SITE}/proofs`;

/** The ledger addresses. Every id is checked first (LIVE-PATHS-1); a bad one throws, nothing is built. */
export function writerPath(uid) {
  if (!isId('uid', uid)) throw new Error('proofMail: refused a uid');
  return `${PROOF_MAIL_PATH}/${uid}`;
}
export function storyLedgerPath(uid, slug) {
  if (!isProofSlug(slug)) throw new Error('proofMail: refused a slug');
  return `${writerPath(uid)}/stories/${slug}`;
}

// ── WHAT IS DUE ────────────────────────────────────────────────────────────────────────
// `story` is a list entry from proofsByWriter ({ slug, title, goLiveMs }) or a cms_stories record.
/** A log entry's key. Not a bare number: RTDB turns 1, 2, 3… keys into an array. */
export const logKey = (seq) => `e${seq}`;
const whenOf = (story) => (Number.isFinite(story?.goLiveMs) ? story.goLiveMs : goLiveMs(story));

/**
 * What one writer's ledger record for one scheduled story says to do now.
 *   → null, or { kind: 'scheduled'|'changed'|'reminder', next: the record to swap in, prevMs? }
 * `story` must already be a proof (the caller checks isProof and the retired list).
 */
export function dueFor(ledger, story, now) {
  const G = whenOf(story);
  if (G === null || G <= now) return null;
  const seq = (Number(ledger?.seq) || 0) + 1;
  const covered = G - now <= REMINDER_LEAD_MS;   // told inside the 48 hours: this email IS the reminder
  const told = (kind, extra = {}) => ({
    kind,
    next: {
      ...(ledger || {}), goLiveMs: G, toldAt: now, kind, seq, sent: false, why: null, sentAt: null, emailId: null,
      remindedFor: covered ? G : (ledger?.remindedFor ?? null),
      log: { ...(ledger?.log || {}), [logKey(seq)]: { kind, goLiveMs: G, at: now, sent: false } },
    },
    ...extra,
  });
  if (!ledger || !Number.isFinite(ledger.goLiveMs)) return told('scheduled');
  if (ledger.goLiveMs !== G) return told('changed', { prevMs: ledger.goLiveMs });
  if (now >= G - REMINDER_LEAD_MS && ledger.remindedFor !== G && Number(ledger.toldAt) < G - REMINDER_LEAD_MS) {
    return {
      kind: 'reminder',
      next: {
        ...ledger, seq, remindedFor: G, remindedAt: now, remindSent: false,
        log: { ...(ledger.log || {}), [logKey(seq)]: { kind: 'reminder', goLiveMs: G, at: now, sent: false } },
      },
    };
  }
  return null;
}

/** The record a story gets when the opening email lists it (the seed): told, at this go-live time. */
export function seedRecord(story, now) {
  const G = whenOf(story);
  return {
    goLiveMs: G, toldAt: now, kind: 'opening', seq: 1, via: 'opening',   // sent with the writer's opening email
    remindedFor: G - now <= REMINDER_LEAD_MS ? G : null,
    log: { [logKey(1)]: { kind: 'opening', goLiveMs: G, at: now, via: 'opening' } },
  };
}

/** A writer's state in the ledger: 'opened' | 'excluded' | 'new'. */
export function writerState(w) {
  if (w?.opening) return 'opened';
  if (w?.excluded) return 'excluded';
  return 'new';
}

/** Scheduled stories by writer: { uid: [{ slug, title, goLiveMs }] }, soonest first. */
export function proofsByWriter(stories, retired, now) {
  const out = {};
  for (const [slug, rec] of Object.entries(stories || {})) {
    if (!isProofSlug(slug) || retired?.[slug] || !isProof(rec, now)) continue;
    const uid = rec.authorUid;
    if (!isId('uid', uid)) continue;
    (out[uid] ||= []).push({ slug, title: typeof rec.title === 'string' && rec.title.trim() ? rec.title.trim() : 'Untitled', goLiveMs: goLiveMs(rec) });
  }
  for (const list of Object.values(out)) list.sort(bySoonest);
  return out;
}

/** An address the emails may go to: verified, and on an account that isn't disabled. */
export const mailable = (account) =>
  !!account && account.disabled !== true && account.emailVerified === true && typeof account.email === 'string' && account.email.includes('@');

// ── THE WORDS (DRAFT, for Ikenna's ruling) ────────────────────────────────────────────
// Every line of every writer email, and every new line in /admin/proofs. Change them here and
// nowhere else, and record the ruling in docs/COPY-RULINGS.md. House style, rule 13.
export const MAIL_SENDER_NAME = 'Calvary Scribblings';
export const SAMPLE_PREFIX = '[Sample] ';

const q = (title) => `“${title}”`;
const SIGN_OFF = ['', 'The editors', 'Calvary Scribblings'];
const HOW_TO = [
  'How to use it:',
  `1. Go to ${PROOFS_URL} and sign in with the account you write under.`,
  '2. Open a story to read its proof.',
  '3. If something doesn’t match your story (a word, a line break, the title, the cover), press “Report a discrepancy” on the proof and tell us what’s wrong and where.',
  '',
  'Your story still goes live on time: a report never holds it back, and the editors will look before then if they can. A story leaves Proofs the moment it goes live.',
];
const REPORT_LINE = 'If something doesn’t match your story, press “Report a discrepancy” on the proof. Your story still goes live on time.';
const storyBlock = (s) => [q(s.title), `Goes live ${londonWhen(s.goLiveMs)}, London time`, proofUrl(s.slug)];

export const PROOF_MAIL_COPY = Object.freeze({
  opening: (stories) => {
    const has = stories.length > 0;
    return {
      subject: has ? 'Your proofs are ready' : 'Proofs: read your stories before they go live',
      lines: [
        'Hello,',
        '',
        ...(has ? ['Your proofs are ready.', ''] : []),
        'Proofs is a new page on Calvary Scribblings for our writers. It shows each of your stories that’s scheduled but not yet live, exactly as it’ll publish: the title, the cover and every line of the text. Only you and the editors can see it.',
        '',
        ...(has
          ? [stories.length === 1 ? 'Your scheduled story:' : 'Your scheduled stories:', '', ...stories.flatMap((s, i) => [...(i ? [''] : []), ...storyBlock(s)]), '']
          : ['You have no stories scheduled just now. When one is scheduled, we’ll email you, and its proof will be there until it goes live.', '']),
        ...HOW_TO,
        '',
        'We’ll also email you whenever a story of yours is scheduled, when its go-live date changes, and two days before it goes live.',
        ...SIGN_OFF,
      ],
    };
  },
  scheduled: (s) => ({
    subject: `${q(s.title)} is scheduled`,
    lines: [
      'Hello,', '',
      `Your story ${q(s.title)} is scheduled. It goes live ${londonWhen(s.goLiveMs)}, London time.`, '',
      'Its proof is ready, exactly as it’ll publish:', proofUrl(s.slug), '',
      REPORT_LINE,
      ...SIGN_OFF,
    ],
  }),
  changed: (s, prevMs) => ({
    subject: `${q(s.title)} has a new go-live date`,
    lines: [
      'Hello,', '',
      `The go-live date of your story ${q(s.title)} has changed. It now goes live ${londonWhen(s.goLiveMs)}, London time.`,
      ...(Number.isFinite(prevMs) ? [`Before, it was ${londonWhen(prevMs)}.`] : []), '',
      'Its proof:', proofUrl(s.slug), '',
      REPORT_LINE,
      ...SIGN_OFF,
    ],
  }),
  reminder: (s) => ({
    subject: `${q(s.title)} goes live on ${londonWhen(s.goLiveMs).replace(/ at .*$/, '')}`,
    lines: [
      'Hello,', '',
      `Your story ${q(s.title)} goes live ${londonWhen(s.goLiveMs)}, London time.`, '',
      'There’s still time to read its proof:', proofUrl(s.slug), '',
      REPORT_LINE,
      ...SIGN_OFF,
    ],
  }),
});

/** The email as it will be sent. `from` is the site's own FROM_EMAIL, as every site email. */
export function composeWriterMail(fromEmail, to, { subject, lines }, { sample = false } = {}) {
  return {
    from: `${MAIL_SENDER_NAME} <${fromEmail}>`,
    to: [to],
    subject: `${sample ? SAMPLE_PREFIX : ''}${subject}`,
    text: lines.join('\n'),
  };
}

// ── THE SAMPLES ("Send me a sample") ─────────────────────────────────────────────────
// Invented stories only. The links point at /proofs?story=<invented slug>, which answers "This
// proof isn't available": nothing real is ever in a sample.
export function sampleMails(now) {
  const day = 86_400_000;
  const at = (days, h, m) => {
    // A round time a few days out (UTC: 06:30 London in winter, 07:30 in summer).
    const d = new Date(now + days * day);
    d.setUTCHours(h, m, 0, 0);
    return d.getTime();
  };
  const a = { slug: 'sample-the-lamplighters-daughter', title: 'The Lamplighter’s Daughter', goLiveMs: at(5, 6, 30) };
  const b = { slug: 'sample-salt-and-ash', title: 'Salt and Ash', goLiveMs: at(9, 18, 0) };
  const c = { ...b, goLiveMs: at(12, 6, 30) };
  return [
    { kind: 'opening', ...PROOF_MAIL_COPY.opening([a, b]) },
    { kind: 'opening-empty', ...PROOF_MAIL_COPY.opening([]) },
    { kind: 'scheduled', ...PROOF_MAIL_COPY.scheduled(a) },
    { kind: 'changed', ...PROOF_MAIL_COPY.changed(c, b.goLiveMs) },
    { kind: 'reminder', ...PROOF_MAIL_COPY.reminder({ ...a, goLiveMs: now + REMINDER_LEAD_MS }) },
  ];
}

// /admin/proofs — the opening list, the sample control, the not-emailed list.
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
export const PROOF_MAIL_ADMIN_COPY = Object.freeze({
  listHeading: 'Who gets the opening email',
  listIntro: 'Opening Proofs emails each writer ticked below once: what Proofs is and how to use it. Writers with a scheduled story also get the list of their stories and when each goes live. Untick anyone who shouldn’t be emailed. They’ll still see their own proofs, but get no emails.',
  scheduledCount: (k) => (k ? n(k, 'scheduled story', 'scheduled stories') : 'No scheduled stories'),
  noAddress: 'No verified email address',
  notDelivered: 'Emailed, but it couldn’t be delivered',
  alreadyEmailed: 'Already emailed',
  confirm: (k) => (k ? `Open Proofs and email ${n(k, 'writer', 'writers')}` : 'Open Proofs without emailing anyone'),
  cancel: 'Cancel',
  opening: 'Opening…',
  opened: (sent, failed) => `Proofs is open. ${n(sent, 'email', 'emails')} sent.${failed ? ` ${n(failed, 'email', 'emails')} couldn’t be sent.` : ''}`,
  openFailed: 'Proofs couldn’t be opened: ',
  sampleButton: 'Send me a sample',
  sampleHelp: 'Sends each writer email, filled in with invented stories, to your own address only.',
  sampleSending: 'Sending…',
  sampleSent: (k) => `Sent ${n(k, 'sample', 'samples')} to your address.`,
  sampleFailed: 'The samples couldn’t be sent: ',
  excludedHeading: 'Not emailed',
  excludedIntro: 'Unticked when Proofs opened. They can see their own proofs, but get no emails.',
  includeButton: 'Email them',
  included: 'Emailed.',
  includeFailed: 'The email couldn’t be sent: ',
  noAddressIntro: 'These writers have no verified email address on their account, so nothing has been sent. Once they have one, they’ll get the opening email with their first scheduled story.',
});
