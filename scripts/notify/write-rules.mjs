// NOTIF-B1 — writes the notification grants into database.rules.json from app/lib/notificationKinds.js,
// so the kinds and switches in the rules are generated, never retyped. Idempotent:
//
//   node scripts/notify/write-rules.mjs          rewrites the file
//   node scripts/notify/write-rules.mjs --check  exits 1 if the file differs from what it would write
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FOUNDER_OR_OWNER_KINDS, legacyKindPattern, PREFS } from '../../app/lib/notificationKinds.js';

const FILE = new URL('../../database.rules.json', import.meta.url);
const F = "auth.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || auth.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'";
/** lastAt and seenAt may be at most this far from the server's clock (10 minutes: a phone's clock drifts). */
const NEAR_NOW_MS = 600000;

const blockedEither = (a, b) =>
  `!root.child('blocked_users').child(${a}).child(${b}).exists() && !root.child('blocked_users').child(${b}).child(${a}).exists()`;
const FROM = "newData.child('fromUid').val()";
const TYPE = "newData.child('type').val()";

function legacyInbox(node) {
  const restricted = FOUNDER_OR_OWNER_KINDS.map((k) => `${TYPE} !== '${k}'`).join(' && ');
  const write = [
    'auth != null && (',
    // P0: the owner may delete a record of their own.
    "($uid === auth.uid && data.exists() && !newData.exists()) || (",
    '!data.exists() && newData.exists() && (',
    `$uid === auth.uid || ${F} || (${FROM} === auth.uid && ${restricted})`,
    ') && (',
    // P0: the block barrier, both ways, on the reader the record names as its sender.
    `$uid === auth.uid || !newData.child('fromUid').isString() || (${blockedEither('$uid', FROM)})`,
    ')))',
  ].join('');
  return { $uid: {
    '.read': 'auth != null && auth.uid == $uid',
    $notifId: {
      '.write': write,
      '.validate': "newData.hasChildren(['type', 'createdAt'])",
      type: { '.validate': `newData.isString() && newData.val().matches(${legacyKindPattern(node)})` },
      createdAt: { '.validate': 'newData.isNumber()' },
      fromUid: { '.validate': 'newData.isString() && newData.val().length <= 128' },
      fromName: { '.validate': 'newData.isString() && newData.val().length <= 128' },
      read: { '.write': 'auth != null && $uid === auth.uid', '.validate': 'newData.isBoolean()' },
      $other: { '.validate': 'newData.isString() ? newData.val().length <= 512 : (newData.isNumber() || newData.isBoolean())' },
    },
  } };
}

const OLD_UNREAD = "(data.child('unread').isNumber() ? data.child('unread').val() : 0)";
const dmConversations = {
  $uid: {
    '.read': 'auth != null && auth.uid == $uid',
    $convId: {
      '.write': [
        'auth != null && (',
        // Your own entry: its id must name you.
        "($uid === auth.uid && ($convId.beginsWith($uid + '_') || $convId.endsWith('_' + $uid)))",
        ' || (',
        // The other participant's entry: its id is exactly the two of you, no block either way,
        // never deleted by you, and its unread count only ever goes up by one.
        "($convId === $uid + '_' + auth.uid || $convId === auth.uid + '_' + $uid)",
        ` && ${blockedEither('auth.uid', '$uid')}`,
        ' && newData.exists()',
        " && ((!newData.child('unread').exists() && !data.child('unread').exists())",
        ` || newData.child('unread').val() === ${OLD_UNREAD}`,
        ` || newData.child('unread').val() === ${OLD_UNREAD} + 1)`,
        '))',
      ].join(''),
      unread: { '.validate': 'newData.isNumber() && newData.val() >= 0' },
      lastAt: { '.validate': `newData.isNumber() && (newData.val() === data.val() || (newData.val() >= now - ${NEAR_NOW_MS} && newData.val() <= now + ${NEAR_NOW_MS}))` },
      $other: { '.validate': false },
    },
  },
};

const followers = {
  '.read': true,
  $uid: {
    $followerUid: {
      '.write': `auth != null && auth.uid === $followerUid && (!newData.exists() || (${blockedEither('$uid', 'auth.uid')}))`,
      '.validate': 'newData.isBoolean()',
    },
  },
};

// P1. inbox: the server writes it (the Admin token passes no rule), its owner reads it.
const inbox = { $uid: { '.read': 'auth != null && auth.uid === $uid' } };
const inboxState = {
  $uid: {
    '.read': 'auth != null && auth.uid === $uid',
    '.write': 'auth != null && auth.uid === $uid',
    seenAt: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= now + ${NEAR_NOW_MS}` },
    $other: { '.validate': false },
  },
};
const notifyPrefs = {
  $uid: {
    '.read': 'auth != null && auth.uid === $uid',
    '.write': 'auth != null && auth.uid === $uid',
    ...Object.fromEntries(Object.keys(PREFS).map((k) => [k, { '.validate': 'newData.isBoolean()' }])),
    $other: { '.validate': false },
  },
};

export function build(rules) {
  const r = rules.rules;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (['inbox', 'inbox_state', 'notify_prefs'].includes(k)) continue;
    if (k === 'library_notifications' || k === 'notifications') out[k] = legacyInbox(k);
    else if (k === 'dm_conversations') out[k] = dmConversations;
    else if (k === 'followers') out[k] = followers;
    else out[k] = v;
    if (k === 'library_notifications') Object.assign(out, { inbox, inbox_state: inboxState, notify_prefs: notifyPrefs });
  }
  return { ...rules, rules: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = readFileSync(FILE, 'utf8');
  const after = JSON.stringify(build(JSON.parse(before)), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (after !== before) { console.error('database.rules.json differs from scripts/notify/write-rules.mjs'); process.exit(1); }
    console.log('notification rules: in step');
  } else {
    writeFileSync(FILE, after);
    console.log(after === before ? 'unchanged' : 'database.rules.json written');
  }
}
