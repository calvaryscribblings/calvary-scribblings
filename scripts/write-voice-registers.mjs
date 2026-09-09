// R46.1 — write the ten APPROVED editorial registers into cms_voices/{slug}/register,
// and correct ONE stale roster name.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/write-voice-registers.mjs            # plan only, no writes
//   node scripts/write-voice-registers.mjs --apply    # perform the writes
//
// ── THE COPY IS NOT THIS SCRIPT'S TO ADJUST ──────────────────────────────────────────────
//
// The ten lines below are Ikenna's, approved and handed over verbatim. They are the house
// voice. Nothing here trims, sentence-cases, adds a full stop or "fixes" a fragment — if a
// line reads oddly that is an editorial decision, and the place to change it is the CMS,
// not a literal in a script.
//
// ── PROBE DISCIPLINE (CLAUDE.md) ─────────────────────────────────────────────────────────
//
// These are LIVE records that real people's pages read. On 4 Sep 2026 a probe wrote into the
// body of a published letter because it asserted a refusal instead of reading the value
// first. So:
//
//   1. READ EVERY RECORD FIRST and keep it. Done below, before any write.
//   2. WRITE ONE FIELD, NEVER THE RECORD. A PATCH on cms_voices/{slug} touching only
//      `register` — a PUT would replace the whole node and drop the twelve fields it does
//      not mention, which is how a roster loses its portraits.
//   3. VERIFY AFTERWARDS AND SAY SO. Every other field on every record is re-read and
//      compared byte-for-byte against the pre-write read, and the script FAILS LOUDLY if a
//      single one moved.
//
// Not a founder-authored record and not a scratch id — these are the ten roster cards
// themselves, which is what the change is actually about, so rule 1 carries the weight.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');

/** Ikenna's ten, verbatim. Keyed by the slug the ROSTER carries — note `arthor-eze`. */
const REGISTERS = {
  'tricia-ajax': 'Real lives and invented ones, told with the same tenderness.',
  'arthor-eze': 'Cultural criticism with a spine. Then fiction that goes somewhere darker.',
  'kalu-rebecca': 'What women carry in private, and what finally mends it.',
  'chioma-okonkwo': 'Watches film closely and asks what the industry is becoming.',
  'nzubechukwu-okere': 'Explains the machinery behind your phone, without condescension.',
  'ufedo-ojo-adaji': "Funny until she isn't. Satire, essays, and poems about loss.",
  'dera-okaro': 'Builds tension patiently and never lets an ending go quietly.',
  'maurice-bur': 'Short fiction that waits until the last line to hurt.',
  'monica-garcia': 'Author of Beta Princess. Character-driven, funny, steeped in history.',
  'stanley-princewill-mcdaniels': "A poet's ear on stories that hold dread and tenderness together.",
};

// ── THE ONE NAME CORRECTION ──────────────────────────────────────────────────────────────
//
// The roster spells him "Stanley Princewill Mcdaniels"; the record he controls
// (users/JD0bCt77BVSZAlLPnqYVwKSa5of2) says "McDaniels", with the capital D. The index already
// renders the live record, so nothing on screen is wrong today — but a roster copy that is
// quietly incorrect gets copied by the next thing that reads it, which is exactly how this
// platform ended up with three spellings of one man's name in three nodes.
//
// ⚠ THE ROSTER COPY ONLY. The live user record is CORRECT and is not touched here; neither is
// user_search, which holds a third value ("Stanley P. Balogun") that is his to change, not
// ours. Correcting a display copy is not the same as editing somebody's identity.
const NAME_FIXES = {
  'stanley-princewill-mcdaniels': { field: 'displayName', to: 'Stanley Princewill McDaniels' },
};

const before = await (await fetch(`${DB}/cms_voices.json`)).json();
if (!before) { console.error('cms_voices read failed — nothing written'); process.exit(1); }

const slugs = Object.keys(REGISTERS);
const missing = slugs.filter((s) => !before[s]);
if (missing.length) { console.error('slug(s) not on the roster:', missing.join(', ')); process.exit(1); }

console.log(`cms_voices: ${Object.keys(before).length} records, ${slugs.length} to receive a register\n`);
for (const slug of slugs) {
  const rec = before[slug];
  const fix = NAME_FIXES[slug];
  console.log(`  ${slug}`);
  console.log(`    register    : ${JSON.stringify(rec.register ?? null)} -> ${JSON.stringify(REGISTERS[slug])}`);
  if (fix) console.log(`    ${fix.field.padEnd(12)}: ${JSON.stringify(rec[fix.field])} -> ${JSON.stringify(fix.to)}`);
}

if (!APPLY) {
  console.log('\nDRY RUN — no writes. Re-run with --apply.');
  process.exit(0);
}

const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
const token = (await cert(svc).getAccessToken()).access_token;

console.log('\nWriting …');
for (const slug of slugs) {
  const patch = { register: REGISTERS[slug] };
  const fix = NAME_FIXES[slug];
  if (fix) patch[fix.field] = fix.to;
  const res = await fetch(`${DB}/cms_voices/${slug}.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) { console.error(`  ${slug} FAILED ${res.status} ${await res.text()}`); process.exit(1); }
  console.log(`  ${slug} ok`);
}

// ── INTEGRITY, AND IT IS REPORTED WHETHER IT PASSES OR NOT ───────────────────────────────
const after = await (await fetch(`${DB}/cms_voices.json`)).json();
let moved = 0;
const beforeKeys = Object.keys(before).sort();
const afterKeys = Object.keys(after || {}).sort();
if (beforeKeys.join() !== afterKeys.join()) { console.error('\n✗ the set of roster records CHANGED'); process.exit(1); }

for (const slug of beforeKeys) {
  const b = before[slug];
  const a = after[slug];
  const intended = new Set(['register', ...(NAME_FIXES[slug] ? [NAME_FIXES[slug].field] : [])]);
  for (const f of Object.keys(b)) {
    if (intended.has(f)) continue;
    if (JSON.stringify(b[f]) !== JSON.stringify(a[f])) {
      moved += 1;
      console.error(`  ✗ ${slug}.${f} moved: ${JSON.stringify(b[f])} -> ${JSON.stringify(a[f])}`);
    }
  }
  const added = Object.keys(a).filter((f) => !(f in b));
  for (const f of added) if (!intended.has(f)) { moved += 1; console.error(`  ✗ ${slug} gained ${f}`); }
}

const written = slugs.filter((s) => after[s].register === REGISTERS[s]).length;
console.log(`\nregisters live      : ${written}/${slugs.length}`);
for (const [slug, fix] of Object.entries(NAME_FIXES)) {
  console.log(`${fix.field} corrected : ${after[slug][fix.field] === fix.to ? 'yes' : 'NO'} (${JSON.stringify(after[slug][fix.field])})`);
}
console.log(`other fields moved  : ${moved} ${moved === 0 ? '✓ every other value byte-identical' : '✗ INTEGRITY BROKEN'}`);
if (moved) process.exit(1);
