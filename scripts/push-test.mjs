// ONE TEST NOTIFICATION, TO ONE ACCOUNT'S DEVICES, THEN THE RECEIPTS.
//
//   EXPO_ACCESS_TOKEN=… node scripts/push-test.mjs <uid>
//   EXPO_ACCESS_TOKEN=… node scripts/push-test.mjs <uid> --slug <story-slug>
//
// This is how push is proved on a founder's own phone before any reader gets one. It sends the
// RULED format built by the same builder the announcer uses — the newest visible story unless
// --slug names another — so what arrives is what a reader would get, and tapping it must open
// that story in the app.
//
// It touches nothing but Expo: it never writes push_announced (a test is not an announcement),
// never deletes a token, and ignores the account's storyNotifications switch (it prints it).
//
// ⚠ FOUNDER ACCOUNTS ONLY unless --any-uid is passed. The round that built this permitted
// exactly one send: a test to Ikenna's own uid. A tool that would push to any reader on a typo
// is a tool that eventually does.

import { openProductionDb } from './push/db.mjs';
import { sendBatch, getReceipts } from './push/expo.mjs';
import { storyMessage, isStoryVisible, planTickets } from './push/lib.mjs';

const FOUNDERS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const RECEIPT_POLL_MS = 15000;
const RECEIPT_GIVE_UP_MS = 5 * 60 * 1000;

const argv = process.argv.slice(2);
const uid = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--slug');
const slugArg = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!uid) throw new Error('usage: node scripts/push-test.mjs <uid> [--slug <slug>]');
  if (!FOUNDERS.includes(uid) && !argv.includes('--any-uid')) {
    throw new Error(`${uid} is not a founder account. Pass --any-uid if you really mean to push to a reader.`);
  }
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (!accessToken) throw new Error('EXPO_ACCESS_TOKEN is not set.');

  const db = await openProductionDb();
  const rows = (await db.ref(`push_tokens/${uid}`).get()).val() || {};
  const pref = (await db.ref(`users/${uid}/storyNotifications`).get()).val();
  const recipients = Object.entries(rows).map(([tokenKey, r]) => ({ uid, tokenKey, token: r.token, ...r }));
  console.log(`\n  ${recipients.length} device(s) registered for ${uid}; storyNotifications = ${pref === null ? 'absent (on)' : pref}`);
  for (const r of recipients) {
    console.log(`    ${r.platform} ${r.appVersion}  updated ${new Date(r.updatedAt).toISOString()}  ${r.token.slice(0, 26)}…`);
  }
  if (!recipients.length) throw new Error('No push_tokens row for this uid. Launch the app signed in, then run this again.');

  const index = (await db.ref('cms_stories_index').get()).val() || {};
  const now = Date.now();
  let slug = slugArg;
  if (!slug) {
    slug = Object.entries(index)
      .filter(([, s]) => isStoryVisible(s, now))
      .sort(([, a], [, b]) => (b.publishedAtMs || 0) - (a.publishedAtMs || 0))[0]?.[0];
  }
  if (!slug || !index[slug] || !isStoryVisible(index[slug], now)) throw new Error(`no visible story "${slug}"`);
  const built = storyMessage(slug, index[slug]);
  if (built.refused) throw new Error(`the builder refused ${slug}: ${built.refused}`);
  const { message } = built;
  console.log(`\n  title  ${message.title}\n  body   ${message.body}\n  url    ${message.data.url}\n`);

  const tickets = await sendBatch(recipients.map((r) => ({ to: r.token, ...message })), { accessToken });
  const t = planTickets(tickets, recipients);
  tickets.forEach((tk, i) => console.log(`  ticket ${recipients[i].tokenKey}: ${tk.status}${tk.id ? ` ${tk.id}` : ''}${tk.details?.error ? ` ${tk.details.error}` : ''}${tk.message ? ` — ${tk.message}` : ''}`));
  if (!t.pending.length) throw new Error('no ticket was accepted — nothing to fetch a receipt for');

  console.log('\n  waiting for receipts (Expo usually has them within a minute; up to 5 minutes here)…');
  const started = Date.now();
  const outstanding = new Map(t.pending.map((p) => [p.ticketId, p]));
  while (outstanding.size && Date.now() - started < RECEIPT_GIVE_UP_MS) {
    await sleep(RECEIPT_POLL_MS);
    const got = await getReceipts([...outstanding.keys()], { accessToken });
    for (const [id, rec] of Object.entries(got)) {
      const p = outstanding.get(id);
      if (!p) continue;
      outstanding.delete(id);
      console.log(`  receipt ${p.tokenKey}: ${rec.status}${rec.details?.error ? ` ${rec.details.error}` : ''}${rec.message ? ` — ${rec.message}` : ''}`);
    }
  }
  for (const [id, p] of outstanding) console.log(`  receipt ${p.tokenKey}: not ready after 5 minutes (ticket ${id}) — re-check later`);
  console.log('');
}

main().then(() => process.exit(0), (err) => { console.error(`\n  ✗ ${err.message}\n`); process.exit(1); });
