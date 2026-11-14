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
    // NOTIF-B2: the bell reads the newest N by createdAt (app/lib/useBell.js), never the whole inbox.
    '.indexOn': ['createdAt'],
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

// HELD BACK (A57, 4 Nov 2026). The dm_conversations tightening below is NOT written into the rules:
// the app's message writes weren't part of A57, and messages must not break. build() leaves the
// node exactly as it is. It ships with the app's next round: wire it back into build() then, and
// re-enable the dm_conversations tests in tests/rules/notif-b1.test.mjs.
const OLD_UNREAD = "(data.child('unread').isNumber() ? data.child('unread').val() : 0)";
export const DM_CONVERSATIONS_HELD = {
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

// P1. inbox: the server writes it (the Admin token passes no rule), its owner reads it. NOTIF-B2:
// indexed on `at`, so the bell reads the newest N and never the whole inbox.
const inbox = { $uid: { '.read': 'auth != null && auth.uid === $uid', '.indexOn': ['at'] } };
// P3 (ruling 308). announcements/{id}: one shared item per new story or instalment, written by the
// announcer (an Admin SDK, which passes no rule) when it claims the item. Every signed-in bell reads
// the newest N by `at`. Ids only: the title and cover are drawn live from the story's own record.
const announcements = { '.read': 'auth != null', '.write': false, '.indexOn': ['at'] };
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

// P4-B1 (docs/PUSH-P4.md). The push queue and the push state are the drain's alone: written and
// read only with the server's token (which passes no rule), never by any client, founders included.
// The queue is indexed on dueAt, the one query the drain makes.
const pushQueue = { '.read': false, '.write': false, '.indexOn': ['dueAt'] };
const pushState = { '.read': false, '.write': false };
// The drain's heartbeat and lease: founders read it (the launch check reads it with the Admin SDK).
const pushDrainOps = { '.read': `auth != null && (${F})`, '.write': false };
// Two new fields on a device's own row (A60): pushCaps, what the app can take (personal pushes from
// 1), and installHash, the SHA-256 of the app's private install id (POST /api/push/release).
const tokenRowFields = {
  pushCaps: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 100' },
  installHash: { '.validate': 'newData.isString() && newData.val().matches(/^[0-9a-f]{64}$/)' },
};

export function build(rules) {
  const r = rules.rules;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (['inbox', 'inbox_state', 'notify_prefs', 'announcements', 'push_queue', 'push_state'].includes(k)) continue;
    if (k === 'library_notifications' || k === 'notifications') out[k] = legacyInbox(k);
    else if (k === 'followers') out[k] = followers;
    else if (k === 'push_tokens') out[k] = withTokenFields(v);
    else if (k === 'ops') out[k] = { ...v, push_drain: pushDrainOps };
    else out[k] = v;
    if (k === 'library_notifications') Object.assign(out, { inbox, inbox_state: inboxState, notify_prefs: notifyPrefs, announcements, push_queue: pushQueue, push_state: pushState });
  }
  return { ...rules, rules: out };
}

/** push_tokens as it stands, with pushCaps and installHash allowed beside the four fields (before $other). */
function withTokenFields(node) {
  const row = node?.$uid?.$tokenKey;
  if (!row) throw new Error('push_tokens/$uid/$tokenKey is not where write-rules expects it');
  const { $other, ...fields } = row;
  return { ...node, $uid: { ...node.$uid, $tokenKey: { ...fields, ...tokenRowFields, ...($other ? { $other } : {}) } } };
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
