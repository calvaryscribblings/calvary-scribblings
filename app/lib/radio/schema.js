// CALVARY RADIO — the record shapes, shape only (RADIO-B1). The contract is docs/RADIO-CONTRACT.md;
// this file is §2, §3, §5 and §9 of it as data. No imports, so the admin (browser), the Functions
// (bundled), node --test and scripts/radio/write-rules.mjs all load it. The rules for every node here
// are GENERATED from these constants by scripts/radio/write-rules.mjs, never typed into
// database.rules.json by hand: change a number here, run the script, commit both.
//
// ── THE NODES ───────────────────────────────────────────────────────────────────────────────
//
//   radio_collections/c{n}              a fortnight's batch: its number, its release time, and the
//                                       listening order on demand. Readable from releaseAtMs.
//   radio_audio/stories/{slug}          one recorded story
//   radio_audio/instalments/{id}        one recorded Series instalment. Readable from its premiere
//                                       (if it has one) or its release, whichever comes first.
//   radio_live/{stories|instalments}/{id}
//                                       the live room, KEYED BY THE PREMIERE (one per record that
//                                       premieres): listeners/{uid}, hearts/{uid}, and counts, which
//                                       only the server writes.
//   listening_position/{uid}/{stories|instalments}/{id}
//                                       continue-listening, the listener's own, in OWNED_NODES.
//
// ── WHY TIMES ARE EPOCH MILLISECONDS ────────────────────────────────────────────────────────
// The rules compare them to `now` (the RTDB server clock), so nothing has to run at 20:00 and a
// phone's clock can't open anything early. A rules expression can compare numbers; it cannot parse
// a date. Same reasoning as releaseAtMs on series_instalments (app/lib/series/schema.js).

export const SCHEMA_VERSION = 1;

export const COLLECTIONS_PATH = 'radio_collections';
export const AUDIO_PATH = 'radio_audio';
export const LIVE_PATH = 'radio_live';
export const POSITION_PATH = 'listening_position';

/** The two kinds of recorded item, as their node names, and the kind word a running order uses. */
export const AUDIO_KINDS = Object.freeze(['stories', 'instalments']);
export const KIND_WORD = Object.freeze({ stories: 'story', instalments: 'instalment' });
export const STATUSES = Object.freeze(['draft', 'scheduled', 'withdrawn']);

/** A collection: 10–15 recorded stories and exactly two Series instalments (contract §2). */
export const COLLECTION_STORIES = Object.freeze({ min: 10, max: 15 });
export const COLLECTION_INSTALMENTS = 2;
/** Ruling 334: at most two stories by one writer in a collection. A chosen number, here only. */
export const MAX_PER_WRITER = 2;

/** A live room stays open this long after its audio ends, for late hearts and a slow last minute. */
export const LIVE_GRACE_MS = 10 * 60 * 1000;
/** One heart a second per listener, and at most this many from one listener in one room. */
export const HEART_MIN_INTERVAL_MS = 1000;
export const HEARTS_MAX = 6000;
/** No recording is longer than this (a sanity bound for the rules, not an editorial limit). */
export const DURATION_MAX_MS = 4 * 60 * 60 * 1000;
/** Ruling 349 (ruled 5 Nov 2026): a download that hasn't been re-checked for this long stops playing. */
export const DOWNLOAD_RECHECK_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** c1, c2 … never a bare number: RTDB turns keys 1, 2, 3 into an array. */
export const COLLECTION_KEY_RE = /^c[1-9][0-9]{0,5}$/;
export const RUNNING_KEY_RE = /^o[1-9][0-9]?$/;
// Written with [/] rather than \/ so the same pattern reads the same in the rules language.
export const READ_ALONG_RE = /^[/](stories|series[/]instalment)[/][A-Za-z0-9_-]{1,128}$/;
export const NAME_MAX = 120;
export const VERSION_MAX = 64;

export const collectionKey = (n) => {
  if (!Number.isInteger(n) || n < 1) throw new Error('a collection number is a positive integer');
  return `c${n}`;
};
export const runningKey = (position) => `o${position}`;

const isInt = (v) => Number.isInteger(v);
const isPosInt = (v) => isInt(v) && v > 0;
const isBool = (v) => typeof v === 'boolean';
const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const extra = (doc, allowed) => Object.keys(doc).filter((k) => !allowed.includes(k));

// ── THE COLLECTION ──────────────────────────────────────────────────────────────────────────
export const COLLECTION_FIELDS = ['schemaVersion', 'number', 'releaseAtMs', 'running', 'status', 'updatedAt'];

/**
 * Errors for a collection record, [] when it is sound. `authorOf(slug)` (optional) returns a story's
 * authorUid, so the per-writer cap can be checked where the stories are at hand (the admin).
 * The full-count rules (10–15 stories, 2 instalments) apply only to a scheduled collection: a draft
 * is built up one item at a time.
 */
export function validateCollection(doc, { key, authorOf } = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['a collection must be an object'];
  for (const k of extra(doc, COLLECTION_FIELDS)) errors.push(`unknown field ${k}`);
  if (!isPosInt(doc.number)) errors.push('number must be a positive integer');
  if (key !== undefined && isPosInt(doc.number) && key !== collectionKey(doc.number)) errors.push(`key ${key} does not match number ${doc.number}`);
  if (!isPosInt(doc.releaseAtMs)) errors.push('releaseAtMs must be a positive integer (epoch ms, UTC)');
  if (!STATUSES.includes(doc.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  if (!isPosInt(doc.updatedAt)) errors.push('updatedAt must be a positive integer');
  const running = doc.running && typeof doc.running === 'object' ? doc.running : null;
  if (!running) { errors.push('running must be an object of o1…oN'); return errors; }
  const items = [];
  for (const [k, v] of Object.entries(running)) {
    if (!RUNNING_KEY_RE.test(k)) { errors.push(`running key ${k} must be o1…o99`); continue; }
    if (!v || !['story', 'instalment'].includes(v.kind) || !ID_RE.test(String(v.id || ''))) { errors.push(`running ${k} must be { kind: story|instalment, id }`); continue; }
    if (extra(v, ['kind', 'id']).length) errors.push(`running ${k} carries unknown fields`);
    items.push({ pos: Number(k.slice(1)), ...v });
  }
  items.sort((a, b) => a.pos - b.pos);
  if (items.some((it, i) => it.pos !== i + 1)) errors.push('running positions must be o1…oN with no gaps');
  const seen = new Set();
  for (const it of items) {
    const id = `${it.kind}:${it.id}`;
    if (seen.has(id)) errors.push(`${it.kind} ${it.id} appears twice`);
    seen.add(id);
  }
  const stories = items.filter((it) => it.kind === 'story');
  const instalments = items.filter((it) => it.kind === 'instalment');
  if (stories.length > COLLECTION_STORIES.max) errors.push(`at most ${COLLECTION_STORIES.max} stories`);
  if (instalments.length > COLLECTION_INSTALMENTS) errors.push(`at most ${COLLECTION_INSTALMENTS} instalments`);
  if (doc.status === 'scheduled') {
    if (stories.length < COLLECTION_STORIES.min) errors.push(`a scheduled collection holds at least ${COLLECTION_STORIES.min} stories`);
    if (instalments.length !== COLLECTION_INSTALMENTS) errors.push(`a scheduled collection holds exactly ${COLLECTION_INSTALMENTS} instalments`);
  }
  if (typeof authorOf === 'function') {
    const per = new Map();
    for (const s of stories) {
      const a = authorOf(s.id);
      if (!a) continue;
      per.set(a, (per.get(a) || 0) + 1);
    }
    if ([...per.values()].some((n) => n > MAX_PER_WRITER)) errors.push(`at most ${MAX_PER_WRITER} stories by one writer (ruling 334)`);
  }
  return errors;
}

// ── A RECORDED STORY OR INSTALMENT ──────────────────────────────────────────────────────────
export const AUDIO_FIELDS = [
  'schemaVersion', 'collection', 'releaseAtMs', 'premiereAtMs', 'durationMs', 'version',
  'narrator', 'engineer', 'access', 'readAlong', 'status', 'updatedAt',
];
export const CREDIT_FIELDS = ['name', 'uid'];
export const ACCESS_FIELDS = ['releaseAtMs', 'freeForGold', 'openToFree'];

function creditErrors(label, c) {
  if (c === undefined) return [];
  if (!c || typeof c !== 'object') return [`${label} must be { name, uid? }`];
  const e = extra(c, CREDIT_FIELDS).map((k) => `${label}.${k} is unknown`);
  if (!isStr(c.name, NAME_MAX)) e.push(`${label}.name must be 1–${NAME_MAX} characters`);
  if (c.uid !== undefined && !ID_RE.test(String(c.uid))) e.push(`${label}.uid must be an account id`);
  return e;
}

/** The live room's window for a record that premieres: [startMs, endMs), or null. */
export function liveWindow(rec) {
  if (!rec || !isPosInt(rec.premiereAtMs) || !isPosInt(rec.durationMs)) return null;
  return { startMs: rec.premiereAtMs, endMs: rec.premiereAtMs + rec.durationMs + LIVE_GRACE_MS };
}

/** When the record first becomes readable: its premiere if it has one, else its release. */
export const visibleFromMs = (rec) => (isPosInt(rec?.premiereAtMs) ? Math.min(rec.premiereAtMs, rec.releaseAtMs) : rec?.releaseAtMs);

/** Errors for radio_audio/{kind}/{id}, [] when sound. */
export function validateAudio(kind, doc, { id } = {}) {
  const errors = [];
  if (!AUDIO_KINDS.includes(kind)) return [`kind must be one of ${AUDIO_KINDS.join(', ')}`];
  if (!doc || typeof doc !== 'object') return ['a recording must be an object'];
  if (id !== undefined && !ID_RE.test(id)) errors.push('the id must be a slug or an instalment id');
  for (const k of extra(doc, AUDIO_FIELDS)) errors.push(`unknown field ${k}`);
  if (doc.collection !== undefined && !COLLECTION_KEY_RE.test(String(doc.collection))) errors.push('collection must be c1, c2 …');
  if (!isPosInt(doc.releaseAtMs)) errors.push('releaseAtMs must be a positive integer (epoch ms, UTC)');
  if (!isPosInt(doc.durationMs) || doc.durationMs > DURATION_MAX_MS) errors.push('durationMs must be measured from the file (a positive integer, at most 4 hours)');
  if (doc.premiereAtMs !== undefined) {
    if (!isPosInt(doc.premiereAtMs)) errors.push('premiereAtMs must be a positive integer when present');
    else if (isPosInt(doc.releaseAtMs) && isPosInt(doc.durationMs) && doc.releaseAtMs < doc.premiereAtMs + doc.durationMs) {
      errors.push('on-demand release (releaseAtMs) cannot come before the premiere has finished');
    }
  }
  if (doc.version !== undefined && !isStr(doc.version, VERSION_MAX)) errors.push(`version must be 1–${VERSION_MAX} characters`);
  errors.push(...creditErrors('narrator', doc.narrator), ...creditErrors('engineer', doc.engineer));
  if (doc.access !== undefined) {
    if (kind !== 'instalments') errors.push("access overrides exist for instalments only (a story's audio follows its text)");
    else if (!doc.access || typeof doc.access !== 'object') errors.push('access must be an object');
    else {
      const a = doc.access;
      for (const k of extra(a, ACCESS_FIELDS)) errors.push(`access.${k} is unknown`);
      if (a.releaseAtMs !== undefined && !isPosInt(a.releaseAtMs)) errors.push('access.releaseAtMs must be a positive integer');
      if (a.freeForGold !== undefined && !isBool(a.freeForGold)) errors.push('access.freeForGold must be a boolean');
      if (a.openToFree !== undefined && !isBool(a.openToFree)) errors.push('access.openToFree must be a boolean');
      if (a.openToFree === true && a.freeForGold !== true) errors.push('access.openToFree requires access.freeForGold: true');
    }
  }
  if (typeof doc.readAlong !== 'string' || !READ_ALONG_RE.test(doc.readAlong)) errors.push('readAlong must be /stories/{slug} or /series/instalment/{id}');
  else if (id !== undefined) {
    const want = kind === 'stories' ? `/stories/${id}` : `/series/instalment/${id}`;
    if (doc.readAlong !== want) errors.push(`readAlong must be ${want}`);
  }
  if (!STATUSES.includes(doc.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  if (!isPosInt(doc.updatedAt)) errors.push('updatedAt must be a positive integer');
  return errors;
}

// ── CONTINUE LISTENING ──────────────────────────────────────────────────────────────────────
export const POSITION_FIELDS = ['positionMs', 'durationMs', 'version', 'updatedAt'];

/** Errors for listening_position/{uid}/{kind}/{id}. updatedAt must be the server's `now` (the rules check). */
export function validatePosition(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['a position must be an object'];
  for (const k of extra(doc, POSITION_FIELDS)) errors.push(`unknown field ${k}`);
  if (!isPosInt(doc.durationMs) || doc.durationMs > DURATION_MAX_MS) errors.push('durationMs must be a positive integer');
  if (!isInt(doc.positionMs) || doc.positionMs < 0 || (isPosInt(doc.durationMs) && doc.positionMs > doc.durationMs)) errors.push('positionMs must be between 0 and durationMs');
  if (!isStr(doc.version, VERSION_MAX)) errors.push('version must be the file version the position was saved against');
  if (!isPosInt(doc.updatedAt)) errors.push('updatedAt must be a positive integer');
  return errors;
}
