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

// ── THE WORDS (RULED: 296–298, 2 Nov 2026; docs/COPY-RULINGS.md) ──────────────────────
// Every line of every writer email, and every new line in /admin/proofs. Change them here and
// nowhere else, and record the ruling in docs/COPY-RULINGS.md. House style, rule 13, and single
// quotes (ruling 296): a title and a button name are set ‘like this’, never in double quotes.
//
// Each email is a list of BLOCKS. The text part and the designed HTML part are both rendered from
// that one list (mailText / mailHtml), so they can't carry different words, order or links.
//   { t: 'p', lines: [..] }                  a paragraph (lines inside it break, no blank line)
//   { t: 'link', lead?, url }                an optional lead line, then the link on its own line
//   { t: 'stories', label, items: [{ title, when, url }] }
//   { t: 'steps', label, items: [..] }       a numbered list ("1. …")
//   { t: 'signoff', lines: [..] }
export const MAIL_SENDER_NAME = 'Calvary Scribblings';
export const SAMPLE_PREFIX = '[Sample] ';
/** Ruling 298: replies reach the editors. Every writer email, samples included. */
export const MAIL_REPLY_TO = 'admin@calvaryscribblings.co.uk';

const q = (title) => `‘${title}’`;
const BUTTON = q('Report a discrepancy');
const P = (...lines) => ({ t: 'p', lines });
const SIGN_OFF = { t: 'signoff', lines: ['The editors', 'Calvary Scribblings'] };
const HOW_TO = {
  t: 'steps',
  label: 'How to use it:',
  items: [
    `Go to ${PROOFS_URL} and sign in with the account you write under.`,
    'Open a story to read its proof.',
    `If something doesn’t match your story (a word, a line break, the title, the cover), press ${BUTTON} on the proof and tell us what’s wrong and where.`,
  ],
};
const REPORT_LINE = P(`If something doesn’t match your story, press ${BUTTON} on the proof. Your story still goes live on time.`);
const storyItem = (s) => ({ title: q(s.title), when: `Goes live ${londonWhen(s.goLiveMs)}, London time`, url: proofUrl(s.slug) });

const mail = (subject, blocks) => ({ subject, blocks, lines: mailText(blocks).split('\n') });

export const PROOF_MAIL_COPY = Object.freeze({
  opening: (stories) => {
    const has = stories.length > 0;
    return mail(has ? 'Your proofs are ready' : 'Proofs: read your stories before they go live', [
      P('Hello,'),
      ...(has ? [P('Your proofs are ready.')] : []),
      P('Proofs is a new page on Calvary Scribblings for our writers. It shows each of your stories that’s scheduled but not yet live, exactly as it’ll publish: the title, the cover and every line of the text. Only you and the editors can see it.'),
      has
        ? { t: 'stories', label: stories.length === 1 ? 'Your scheduled story:' : 'Your scheduled stories:', items: stories.map(storyItem) }
        : P('You have no stories scheduled just now. When one is scheduled, we’ll email you, and its proof will be there until it goes live.'),
      HOW_TO,
      P('Your story still goes live on time: a report never holds it back, and the editors will look before then if they can. A story leaves Proofs the moment it goes live.'),
      P('We’ll also email you whenever a story of yours is scheduled, when its go-live date changes, and two days before it goes live.'),
      SIGN_OFF,
    ]);
  },
  scheduled: (s) => mail(`${q(s.title)} is scheduled`, [
    P('Hello,'),
    P(`Your story ${q(s.title)} is scheduled. It goes live ${londonWhen(s.goLiveMs)}, London time.`),
    { t: 'link', lead: 'Its proof is ready, exactly as it’ll publish:', url: proofUrl(s.slug) },
    REPORT_LINE,
    SIGN_OFF,
  ]),
  changed: (s, prevMs) => mail(`${q(s.title)} has a new go-live date`, [
    P('Hello,'),
    P(`The go-live date of your story ${q(s.title)} has changed. It now goes live ${londonWhen(s.goLiveMs)}, London time.`,
      ...(Number.isFinite(prevMs) ? [`It was due to go live ${londonWhen(prevMs)}.`] : [])),
    { t: 'link', lead: 'Its proof:', url: proofUrl(s.slug) },
    REPORT_LINE,
    SIGN_OFF,
  ]),
  reminder: (s) => mail(`${q(s.title)} goes live on ${londonWhen(s.goLiveMs).replace(/ at .*$/, '')}`, [
    P('Hello,'),
    P(`Your story ${q(s.title)} goes live ${londonWhen(s.goLiveMs)}, London time.`),
    { t: 'link', lead: 'There’s still time to read its proof:', url: proofUrl(s.slug) },
    REPORT_LINE,
    SIGN_OFF,
  ]),
});

// ── THE TEXT PART ────────────────────────────────────────────────────────────────────────
function blockText(b) {
  switch (b.t) {
    case 'p': case 'signoff': return b.lines.join('\n');
    case 'link': return [...(b.lead ? [b.lead] : []), b.url].join('\n');
    case 'stories': return [b.label, '', b.items.map((i) => [i.title, i.when, i.url].join('\n')).join('\n\n')].join('\n');
    case 'steps': return [b.label, ...b.items.map((x, i) => `${i + 1}. ${x}`)].join('\n');
    default: return '';
  }
}
export const mailText = (blocks) => blocks.map(blockText).join('\n\n');

// ── THE DESIGNED PART (HTML) ─────────────────────────────────────────────────────────────
// The house mail is the newsletter Worker's (workers-external/calvary-newsletter.worker.js,
// buildEmail / buildNewsletterWelcome): a purple masthead with the serif wordmark, a white card on
// #f8f7fc, Georgia body at 16px / 1.75 in #1a1a2e, Arial for small labels, purple links. These
// numbers are TAKEN from it. The rest is built for mail clients:
//   · tables and inline styles only; the card is 600 wide (the brief's cap; the newsletter is 620)
//     and fluid below that.
//   · CHOSEN: the side padding 40px (the newsletter's) drops to 24px under 600 wide.
//   · CHOSEN: Cormorant Garamond (the site's serif) for the wordmark and story titles, through
//     Google Fonts; clients that don't load web fonts (Gmail, Outlook) fall back to Georgia, which
//     is the newsletter's own face, so the fallback is still the house.
//   · DERIVED: every link on its own line sits in a 44px-tall row (20px line + 12px above and below), the site's
//     touch-target floor.
//   · ONE LEFT EDGE: masthead, paragraphs, lists, links and sign-off all start at the card's inner
//     padding; the step numbers sit in their own 24px column INSIDE that edge (CHOSEN width).
//   · NO IMAGES at all, so nothing is lost when a client blocks them, and no emoji (the
//     newsletter's tagline carries one; it is left out here).
//   · DARK MODE ON PURPOSE: color-scheme / supported-color-schemes declare both, and a
//     prefers-color-scheme block (Apple Mail, iOS, Outlook for Mac) and [data-ogsc]/[data-ogsb]
//     rules (Outlook.com) switch to the admin's own dark ground (#0c0c10 / #141419, text #f0ece4)
//     with house gold #c9a84c for links. The masthead keeps its purple in both (white on #6b2fad
//     reads either way), so an app that inverts colours on its own (Gmail) has nothing light-on-
//     light to break.
//   · The ONE thing in the HTML that isn't in the text part is the masthead wordmark "Calvary
//     Scribblings", as on every house mail; the tests compare the body below it.
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SERIF = "Georgia,'Times New Roman',serif";
const DISPLAY = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';
const INK = '#1a1a2e', PURPLE = '#6b2fad';
// A URL inside a sentence (step 1 of the opening email) is a link too, as in the text part. Its
// 14px vertical padding grows the tap area to 44px or more without moving the line (DERIVED, measured).
const linkify = (escaped) => escaped.replace(/https:\/\/[^\s<]+[^\s<.,;:)]/g, (u) => `<a class="cs-link" href="${u}" style="color:${PURPLE};text-decoration:underline;padding:14px 0;word-break:break-all;">${u}</a>`);
const para = (inner, extra = '') => `<p class="cs-text" style="margin:0 0 16px;color:${INK};font-family:${SERIF};font-size:16px;line-height:1.75;${extra}">${inner}</p>`;
// 4px under the row: with the row's own 12px, the gap below a link is the paragraphs' 16px (DERIVED).
// 14px: the longest proof address fits one line at 600 wide (CHOSEN by measurement; it wraps at 375).
const linkRow = (url) => `<p style="margin:0 0 4px;"><a class="cs-link" href="${esc(url)}" style="display:inline-block;padding:12px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${PURPLE};text-decoration:underline;word-break:break-all;">${esc(url)}</a></p>`;
const label = (text) => `<p class="cs-label" style="margin:0 0 8px;color:${PURPLE};font-family:${SANS};font-size:13px;line-height:20px;font-weight:bold;">${esc(text)}</p>`;

function blockHtml(b) {
  switch (b.t) {
    case 'p': return para(b.lines.map((l) => linkify(esc(l))).join('<br>'));
    case 'signoff': return para(b.lines.map(esc).join('<br>'), 'margin:8px 0 0;');
    case 'link': return `${b.lead ? para(esc(b.lead), 'margin:0;') : ''}${linkRow(b.url)}`;
    case 'stories': return `${label(b.label)}${b.items.map((i) => `<div class="cs-rule" style="border-top:1px solid #e6e1f0;padding-top:12px;">`
      + `<p class="cs-text" style="margin:0;color:${INK};font-family:${DISPLAY};font-size:22px;line-height:28px;font-weight:600;">${esc(i.title)}</p>`
      + `<p class="cs-muted" style="margin:2px 0 0;color:#55556a;font-family:${SERIF};font-size:15px;line-height:24px;">${esc(i.when)}</p>`
      + `${linkRow(i.url)}</div>`).join('')}`;
    case 'steps': return `${label(b.label)}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">${b.items.map((x, i) =>
      `<tr><td valign="top" width="24" class="cs-text" style="width:24px;color:${INK};font-family:${SERIF};font-size:16px;line-height:1.75;">${i + 1}.</td>`
      + `<td valign="top" class="cs-text" style="color:${INK};font-family:${SERIF};font-size:16px;line-height:1.75;padding:0 0 4px;">${linkify(esc(x))}</td></tr>`).join('')}</table>`;
    default: return '';
  }
}

/** The designed part. `subject` goes in <title> only (the subject line is the client's). */
export function mailHtml({ subject, blocks }) {
  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&amp;display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (max-width:599px){.cs-pad{padding-left:24px !important;padding-right:24px !important;}}
@media (prefers-color-scheme:dark){
.cs-bg{background:#0c0c10 !important;}.cs-card{background:#141419 !important;}
.cs-text{color:#f0ece4 !important;}.cs-muted{color:#b8b3aa !important;}
.cs-link,.cs-label{color:#c9a84c !important;}.cs-rule{border-top-color:#2c2c36 !important;}}
[data-ogsc] .cs-text{color:#f0ece4 !important;}[data-ogsc] .cs-muted{color:#b8b3aa !important;}
[data-ogsc] .cs-link,[data-ogsc] .cs-label{color:#c9a84c !important;}
[data-ogsb] .cs-bg{background:#0c0c10 !important;}[data-ogsb] .cs-card{background:#141419 !important;}
</style>
</head>
<body class="cs-bg" style="margin:0;padding:0;background:#f8f7fc;">
<table role="presentation" class="cs-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f7fc;"><tr><td align="center" style="padding:24px 0;">
<table role="presentation" class="cs-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
<tr><td class="cs-pad" style="background:${PURPLE};padding:28px 40px;"><p style="margin:0;color:#ffffff;font-family:${DISPLAY};font-size:30px;line-height:36px;font-weight:600;">Calvary Scribblings</p></td></tr>
<tr><td class="cs-pad" data-cs-body style="padding:32px 40px 36px;text-align:left;">
${blocks.map(blockHtml).join('\n')}
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** The email as it will be sent. `from` is the site's own FROM_EMAIL, as every site email. */
export function composeWriterMail(fromEmail, to, { subject, blocks }, { sample = false } = {}) {
  const full = `${sample ? SAMPLE_PREFIX : ''}${subject}`;
  return {
    from: `${MAIL_SENDER_NAME} <${fromEmail}>`,
    to: [to],
    reply_to: MAIL_REPLY_TO,
    subject: full,
    text: mailText(blocks),
    html: mailHtml({ subject: full, blocks }),
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
