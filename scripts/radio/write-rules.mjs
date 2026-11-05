// RADIO-B1 — writes Calvary Radio's nodes into database.rules.json from app/lib/radio/schema.js, so
// the windows, bounds and patterns in the rules are generated, never retyped. Idempotent:
//
//   node scripts/radio/write-rules.mjs          rewrites the file
//   node scripts/radio/write-rules.mjs --check  exits 1 if the file differs from what it would write
//
// The nodes (docs/RADIO-CONTRACT.md §2, §3, §5, §9):
//   radio_collections   founders write; anyone reads a scheduled collection from its releaseAtMs.
//   radio_audio         founders write; anyone reads a scheduled record from its premiere or release
//                       (whichever is first); its writer reads it before then (Proofs).
//   radio_live          the live room, keyed by premiere. A listener writes only their own presence
//                       and hearts, only while the room is open; counts are server-written (the Admin
//                       SDK passes no rule) and every signed-in listener reads them. NOBODY can read
//                       the listeners or hearts of anyone else: counting by reading every child grows
//                       with the square of the audience.
//   listening_position  the listener's own, in OWNED_NODES (functions/api/account/_deletion.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';
import {
  COLLECTIONS_PATH, AUDIO_PATH, LIVE_PATH, POSITION_PATH, STATUSES, ID_RE, COLLECTION_KEY_RE,
  RUNNING_KEY_RE, NAME_MAX, VERSION_MAX, DURATION_MAX_MS, LIVE_GRACE_MS, HEART_MIN_INTERVAL_MS, HEARTS_MAX,
} from '../../app/lib/radio/schema.js';

const FILE = new URL('../../database.rules.json', import.meta.url);
export const RADIO_NODES = [COLLECTIONS_PATH, AUDIO_PATH, LIVE_PATH, POSITION_PATH];

const FOUNDER = `auth != null && (${FOUNDER_UIDS.map((u) => `auth.uid === '${u}'`).join(' || ')})`;
const OWN = 'auth != null && auth.uid === $uid';
const re = (r) => r.toString();
const STATUS_RE = `/^(${STATUSES.join('|')})$/`;
const num = (min = 0) => ({ '.validate': `newData.isNumber() && newData.val() > ${min}` });
const str = (max) => ({ '.validate': `newData.isString() && newData.val().length >= 1 && newData.val().length <= ${max}` });
const closed = { '.validate': false };

const collection = {
  '.write': FOUNDER,
  '.indexOn': ['releaseAtMs'],
  $collection: {
    '.read': `(${FOUNDER}) || (data.child('status').val() === 'scheduled' && data.child('releaseAtMs').val() <= now)`,
    '.validate': `$collection.matches(${re(COLLECTION_KEY_RE)}) && newData.hasChildren(['number', 'releaseAtMs', 'running', 'status', 'updatedAt'])`,
    schemaVersion: num(0),
    number: { '.validate': 'newData.isNumber() && newData.val() >= 1' },
    releaseAtMs: num(0),
    running: {
      $o: {
        '.validate': `$o.matches(${re(RUNNING_KEY_RE)}) && newData.hasChildren(['kind', 'id'])`,
        kind: { '.validate': "newData.isString() && newData.val().matches(/^(story|instalment)$/)" },
        id: { '.validate': `newData.isString() && newData.val().matches(${re(ID_RE)})` },
        $other: closed,
      },
    },
    status: { '.validate': `newData.isString() && newData.val().matches(${STATUS_RE})` },
    updatedAt: num(0),
    $other: closed,
  },
};

const credit = {
  '.validate': "newData.hasChildren(['name'])",
  name: str(NAME_MAX),
  uid: { '.validate': `newData.isString() && newData.val().matches(${re(ID_RE)})` },
  $other: closed,
};

function audio(kind, v) {
  const writer = kind === 'stories'
    ? `root.child('cms_stories').child(${v}).child('authorUid').val()`
    : `root.child('series_instalments_detail').child(${v}).child('authorUid').val()`;
  const released = "data.child('status').val() === 'scheduled' && (data.child('releaseAtMs').val() <= now || (data.child('premiereAtMs').isNumber() && data.child('premiereAtMs').val() <= now))";
  const rec = {
    '.read': `(${FOUNDER}) || (${released}) || (auth != null && auth.uid === ${writer})`,
    '.validate': `${v}.matches(${re(ID_RE)}) && newData.hasChildren(['releaseAtMs', 'durationMs', 'readAlong', 'status', 'updatedAt'])`,
    schemaVersion: num(0),
    collection: { '.validate': `newData.isString() && newData.val().matches(${re(COLLECTION_KEY_RE)})` },
    releaseAtMs: num(0),
    premiereAtMs: { '.validate': "newData.isNumber() && newData.val() > 0 && newData.parent().child('releaseAtMs').val() >= newData.val() + newData.parent().child('durationMs').val()" },
    durationMs: { '.validate': `newData.isNumber() && newData.val() > 0 && newData.val() <= ${DURATION_MAX_MS}` },
    version: str(VERSION_MAX),
    narrator: credit,
    engineer: credit,
    readAlong: { '.validate': `newData.val() === '${kind === 'stories' ? '/stories/' : '/series/instalment/'}' + ${v}` },
    status: { '.validate': `newData.isString() && newData.val().matches(${STATUS_RE})` },
    updatedAt: num(0),
    $other: closed,
  };
  if (kind === 'instalments') {
    // Contract §3: an instalment's audio access can differ from its text's, per instalment, set in
    // the Series admin. A story's audio has no override.
    rec.access = {
      releaseAtMs: num(0),
      freeForGold: { '.validate': 'newData.isBoolean()' },
      openToFree: { '.validate': "newData.isBoolean() && (newData.val() === false || newData.parent().child('freeForGold').val() === true)" },
      $other: closed,
    };
  }
  return rec;
}

function room(kind, v) {
  const a = `root.child('${AUDIO_PATH}').child('${kind}').child(${v})`;
  const open = `${a}.child('status').val() === 'scheduled' && ${a}.child('premiereAtMs').isNumber() && ${a}.child('premiereAtMs').val() <= now && now < ${a}.child('premiereAtMs').val() + ${a}.child('durationMs').val() + ${LIVE_GRACE_MS}`;
  return {
    listeners: {
      $uid: {
        '.read': OWN,
        // onDisconnect().remove() must always land, so leaving is allowed outside the window too.
        '.write': `${OWN} && (!newData.exists() || (${open}))`,
        '.validate': 'newData.val() === true',
      },
    },
    hearts: {
      $uid: {
        '.read': OWN,
        '.write': `${OWN} && newData.exists() && (${open})`,
        '.validate': `newData.hasChildren(['n', 'at']) && newData.child('at').val() === now && newData.child('n').val() <= ${HEARTS_MAX}`
          + ` && ((!data.exists() && newData.child('n').val() === 1) || (data.exists() && newData.child('n').val() === data.child('n').val() + 1 && now >= data.child('at').val() + ${HEART_MIN_INTERVAL_MS}))`,
        n: { '.validate': 'newData.isNumber()' },
        at: { '.validate': 'newData.isNumber()' },
        $other: closed,
      },
    },
    // One listener count and one hearts total, written by the server job each minute the room is
    // open (contract §5). No client writes it; every signed-in listener reads it.
    counts: { '.read': 'auth != null' },
    $other: closed,
  };
}

function position(v) {
  return {
    '.validate': `${v}.matches(${re(ID_RE)}) && newData.hasChildren(['positionMs', 'durationMs', 'version', 'updatedAt'])`,
    positionMs: { '.validate': "newData.isNumber() && newData.val() >= 0 && newData.val() <= newData.parent().child('durationMs').val()" },
    durationMs: { '.validate': `newData.isNumber() && newData.val() > 0 && newData.val() <= ${DURATION_MAX_MS}` },
    version: str(VERSION_MAX),
    updatedAt: { '.validate': 'newData.val() === now' },
    $other: closed,
  };
}

export const RADIO_RULES = {
  [COLLECTIONS_PATH]: collection,
  [AUDIO_PATH]: {
    '.write': FOUNDER,
    stories: { '.indexOn': ['premiereAtMs', 'releaseAtMs'], $slug: audio('stories', '$slug') },
    instalments: { '.indexOn': ['premiereAtMs', 'releaseAtMs'], $id: audio('instalments', '$id') },
    $other: closed,
  },
  [LIVE_PATH]: {
    stories: { $slug: room('stories', '$slug') },
    instalments: { $id: room('instalments', '$id') },
    $other: closed,
  },
  [POSITION_PATH]: {
    $uid: {
      '.read': OWN,
      '.write': OWN,
      stories: { $slug: position('$slug') },
      instalments: { $id: position('$id') },
      $other: closed,
    },
  },
};

/** The rules file with Radio's nodes (re)written at the end, everything else untouched and in order. */
export function build(rules) {
  const out = {};
  for (const [k, v] of Object.entries(rules.rules)) if (!RADIO_NODES.includes(k)) out[k] = v;
  return { ...rules, rules: { ...out, ...RADIO_RULES } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = readFileSync(FILE, 'utf8');
  const after = JSON.stringify(build(JSON.parse(before)), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (after !== before) { console.error('database.rules.json differs from scripts/radio/write-rules.mjs'); process.exit(1); }
    console.log('radio rules: in step');
  } else {
    writeFileSync(FILE, after);
    console.log(after === before ? 'unchanged' : 'database.rules.json written');
  }
}
