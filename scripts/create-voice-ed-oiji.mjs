// R46.2 — create Ed Oiji's roster card.
//
// DRY RUN BY DEFAULT.  --apply to write.
//
// ── THE RULING ───────────────────────────────────────────────────────────────────────────
// Ten published pieces is the largest body of work on the island without a card, more than
// five of the ten who have one, and he is a contracted contributor. Ikenna: an omission, not
// a decision. ("Calvary" stays off — it is the house catch-all, not a person. The three
// one-piece authors are a separate question about what earns a card.)
//
// ── WHY IT IS CREATED UNPUBLISHED ────────────────────────────────────────────────────────
// ⚠ THERE IS NO CARD IMAGE YET, AND A CARDLESS CARD IS AN ANONYMOUS HOLE.
// app/voices/voices-client.js renders <img src={v.cardImage}> with NO guard, and the card is
// self-labelled artwork — the name and the blurb are baked INTO the image, so there is no
// caption to fall back to. Measured on the real grid with the real CSS: a record with no
// cardImage paints a 268×335 empty rectangle, house-gold hairline, 14px radius, and a broken-
// image glyph in the corner. Not a missing photograph — a nameless box.
//
// So the record is written complete but `published: false`. Both the grid and the author page
// gate on `published === true`, and so does the search index, so a draft is invisible
// everywhere rather than half-visible somewhere. Ikenna uploads the 1080×1350 portrait through
// Admin → Voices (which generates the w360/w540 derivatives) and the same save flips it live.
//
// ⭑ That also sequences the deploy correctly. /voices/{slug} is statically exported from
// generateStaticParams; the search index reads cms_voices live in the browser. Publishing
// before a build would list him on the index with a link to a 404. Unpublished, there is no
// window in which anything points at a page that does not exist.
//
// ── PROBE DISCIPLINE ─────────────────────────────────────────────────────────────────────
// Read first, PATCH the one new key (never PUT the parent), verify every OTHER record
// byte-identical afterwards. See scripts/write-voice-registers.mjs.
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const SLUG = 'ed-oiji';
const MATCH_UID = 'VbCrNAu3EoZD30zoa30d22xtQZf2';

// HIS OWN WORDS, copied byte-for-byte from users/{uid}/bio. He wrote it himself and it is
// better than anything composed from the work. Not re-punctuated, not shortened.
const BIO = 'A Silicon Scribbler, developer, tech consultant, and humanitarian worker with a passion for ideas that inspire and inform. I write about tech, society, and whatever else captures my curiosity.';

// ⭑ READ OFF HIS OPENINGS, NOT HIS TOPICS — and that distinction is the whole line.
//
// Nzubechukwu Okere also writes about technology, and his register is "Explains the machinery
// behind your phone, without condescension." If Ed's line named his subject it would say the
// same thing twice and the index would stop telling a reader which of them to tap.
//
// It does not, because their OPENINGS are not alike. Nzube starts from the mechanism. Ed
// starts from a place and a person: "An industrial fan roars overhead… inside Bodyline Gym in
// Maitama"; "the glass displays of Kanyi's phone repair kiosk at Ndupet GSM Plaza in High
// Level, Makurdi's business hub". Six of his ten open on a located scene. He is a REPORTER
// who writes about technology; Nzube is an EXPLAINER. The two lines must go on saying
// different things — if either is ever rewritten, check it against the other.
//
// The em dash is spaced, per house style.
const REGISTER = 'Reports technology from where it actually lands — a gym in Maitama, a repair kiosk in Makurdi.';

const record = {
  slug: SLUG,
  displayName: 'Ed Oiji',          // agrees with users/{matchUid} and with all ten bylines
  matchUid: MATCH_UID,             // ⚠ matchUid, NEVER authorUid — no roster record has one
  bio: BIO,
  register: REGISTER,
  order: 11,                       // the ten are 1…10 with no gaps
  published: false,                // ⚠ see above — flips true with the card image
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
// ⚠ DELIBERATELY ABSENT: message, portrait and matchNames are unset on ALL TEN existing
// records. Filling a field for symmetry is how a dead field becomes load-bearing. He needs no
// matchNames either — all ten of his pieces carry authorUid, so the uid match reaches them.
// cardImage/cardSizes are absent because they do not exist yet; the admin writes both.
// genreTag is left to Ikenna: it is on six of ten and is genuinely optional.

const before = await (await fetch(`${DB}/cms_voices.json`)).json();
if (!before) { console.error('read failed — nothing written'); process.exit(1); }
if (before[SLUG]) { console.error(`${SLUG} ALREADY EXISTS — refusing to overwrite a live card`); process.exit(1); }

console.log(`cms_voices holds ${Object.keys(before).length} records; creating ${SLUG}\n`);
for (const [k, v] of Object.entries(record)) console.log(`  ${k.padEnd(12)} ${JSON.stringify(v)}`);
console.log(`\n  absent by design: message, portrait, matchNames, cardImage, cardSizes, genreTag`);

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply.'); process.exit(0); }

const svc = JSON.parse(await readFile(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
const token = (await cert(svc).getAccessToken()).access_token;
const res = await fetch(`${DB}/cms_voices/${SLUG}.json?access_token=${token}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(record),
});
if (!res.ok) { console.error('WRITE FAILED', res.status, await res.text()); process.exit(1); }
console.log(`\n${SLUG} written.`);

const after = await (await fetch(`${DB}/cms_voices.json`)).json();
let moved = 0;
for (const slug of Object.keys(before)) {
  for (const f of Object.keys(before[slug])) {
    if (JSON.stringify(before[slug][f]) !== JSON.stringify(after[slug]?.[f])) {
      moved += 1;
      console.error(`  ✗ ${slug}.${f} moved`);
    }
  }
}
const created = after[SLUG] || {};
const extra = Object.keys(created).filter((f) => !(f in record));
console.log(`records         : ${Object.keys(before).length} -> ${Object.keys(after).length}`);
console.log(`fields written  : ${Object.keys(created).length}/${Object.keys(record).length}${extra.length ? ' + UNEXPECTED ' + extra.join(',') : ''}`);
console.log(`published       : ${created.published} (false until the card image lands)`);
console.log(`existing records: ${moved} field(s) moved ${moved === 0 ? '✓ every one byte-identical' : '✗ INTEGRITY BROKEN'}`);
if (moved || extra.length) process.exit(1);
