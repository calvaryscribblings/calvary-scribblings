// RULING 256 — the /admin half: what a duplicate payment looks like to Ikenna.
//
// The webhooks file a second payment for a copy the reader already owns under
// bookstore_duplicate_payments/{uid}/{titleId}/{rail_ref} (functions/api/bookstore/_duplicates.js,
// which imports the path from here so there is one spelling of it). Only the two founders can read
// the node; nobody writes it from a client. /admin lists the OPEN ones for a hand refund. One that
// the provider's refund event has marked refunded drops out of the list by itself.
import { formatPrice } from '../../bookstore/components/fields.js';

export const DUPLICATES_PATH = 'bookstore_duplicate_payments';

// DRAFT copy, for Ikenna's ruling (house style, rule 13).
export const DUPLICATE_ALERT = {
  heading: 'Paid twice.',
  body: 'These readers paid again for a book already in their library. Their copy stands on the first payment, and the second is waiting for you.',
  action: 'Refund by hand in Stripe or Paystack.',
};

const RAIL = { stripe: 'Stripe', paystack: 'Paystack' };

/** The node as read → the open duplicates, earliest first. Pure. */
export function openDuplicates(node) {
  const out = [];
  for (const [uid, titles] of Object.entries(node || {})) {
    for (const [titleId, entries] of Object.entries(titles || {})) {
      for (const [key, e] of Object.entries(entries || {})) {
        if (e && e.status === 'open') out.push({ key, uid, titleId, ...e });
      }
    }
  }
  return out.sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
}

/** One line of the block: title, rail, amount, date and the reader's internal reference. Pure. */
export function duplicateLine(d) {
  const title = d.title || d.titleId;
  const amount = formatPrice(String(d.currency || '').toLowerCase(), d.amount)
    || (typeof d.amount === 'number' ? `${d.amount} ${d.currency || ''}`.trim() : 'amount unknown');
  const date = typeof d.receivedAt === 'number'
    ? new Date(d.receivedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })
    : 'date unknown';
  return `“${title}” · ${RAIL[d.rail] || d.rail || 'unknown rail'} · ${amount} · ${date} · reader ${d.uid}`;
}

// RULING 261 — the email a new duplicate raises (functions/api/_alerts.js). Internal references
// only: the title, the rail, the amount, the time and the reader's uid. No payment reference, no
// reader's name or email. The last line is the ruling's own.
export function duplicateAlertMessage(d) {
  const title = d.title || d.titleId;
  const amount = formatPrice(String(d.currency || '').toLowerCase(), d.amount)
    || (typeof d.amount === 'number' ? `${d.amount} ${d.currency || ''}`.trim() : 'unknown');
  const time = typeof d.receivedAt === 'number'
    ? new Date(d.receivedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })
    : 'unknown';
  return {
    subject: `Paid twice: “${title}”`,
    lines: [
      'A reader paid again for a book already in their library.',
      '',
      `Title:   ${title} (${d.titleId})`,
      `Rail:    ${RAIL[d.rail] || d.rail || 'unknown'}`,
      `Amount:  ${amount}`,
      `Time:    ${time} London`,
      `Reader:  ${d.uid}`,
      '',
      'Their copy stands on the first payment. The second is listed in /admin until it is refunded.',
      'Refund by hand in Stripe or Paystack.',
    ],
  };
}
