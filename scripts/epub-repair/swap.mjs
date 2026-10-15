// SWAP A LIVE MASTER FOR ITS VERIFIED REPAIR — dry run by default.
//
//   node scripts/epub-repair/swap.mjs --title <titleId> --dir <private book folder> [--go]
//
// <dir> is the W42 folder: original.json (the generation, size and hashes recorded at download),
// original.epub, repair.epub. It must be outside the repo. Run verify.mjs and open-in-foliate.mjs
// on the pair first; this script does not re-prove the repair, it only moves it into place.
//
// With --go, in this order, stopping at the first failure:
//   1. the live master's generation must equal the one recorded at download (and its size + md5)
//   2. copy that exact generation to gs://calvary-scribblings-storage-backups/
//      epub-replacements/<timestamp>/<titleId>/master.epub (no lifecycle on that prefix)
//   3. upload the repair with ifGenerationMatch = the recorded generation, so a live file that
//      changed since the download refuses the upload; carry contentType, contentDisposition and
//      the custom metadata across unchanged; read the new generation back
//   4. carry-over.mjs --apply: positions and ribbons move to the new generation
//   5. download the new object and require its sha256 to equal the repair's; the carry-over has
//      already re-read every record it wrote
//
// Without --go every step is read-only: it checks 1, reports 2, 3 and 5, and runs 4 as a dry run.
// Prints generations, sizes, hashes, counts. Never a key, a token value, or a record path.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outsideRepo, args } from './paths.mjs';
import { carryOver, describe, prodDeps, masterPath } from './carry-over.mjs';

export const BACKUP_BUCKET = 'calvary-scribblings-storage-backups';
export const backupObject = (stamp, titleId) => `epub-replacements/${stamp}/${titleId}/master.epub`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const md5b64 = (b) => createHash('md5').update(b).digest('base64');

async function main() {
  const a = args(process.argv.slice(2), ['title', 'dir', 'go']);
  if (!a.title) throw new Error('--title is required');
  const dir = outsideRepo(a.dir, '--dir');
  const go = !!a.go;
  const rec = JSON.parse(await readFile(join(dir, 'original.json'), 'utf8'));
  const oldBytes = await readFile(join(dir, 'original.epub'));
  const newBytes = await readFile(join(dir, 'repair.epub'));
  const path = masterPath(a.title);
  if (rec.path !== path) throw new Error(`original.json is for ${rec.path}, not ${path}`);
  if (sha256(oldBytes) !== rec.sha256) throw new Error('original.epub is not the file recorded in original.json');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { db, bucket } = await prodDeps();
  const file = bucket.file(path);
  const say = (s) => console.log(`${go ? '' : '[dry run] '}${s}`);

  // 1. The live object is still the one we repaired.
  const [live] = await file.getMetadata();
  const same = String(live.generation) === rec.generation && Number(live.size) === rec.size && live.md5Hash === rec.md5Hash;
  say(`1. live generation ${live.generation}, recorded ${rec.generation}: ${same ? 'MATCH (size + md5 too)' : 'CHANGED'}`);
  if (!same) throw new Error('the live master changed since it was downloaded: repair the new one, never swap over it');

  // 2. Back up the exact generation.
  const dest = backupObject(stamp, a.title);
  const backupBucket = bucket.storage.bucket(BACKUP_BUCKET);
  say(`2. copy generation ${rec.generation} → gs://${BACKUP_BUCKET}/${dest} (bucket ${(await backupBucket.exists())[0] ? 'reachable' : 'NOT FOUND'})`);
  if (go) {
    await bucket.file(path, { generation: rec.generation }).copy(backupBucket.file(dest));
    const [b] = await backupBucket.file(dest).getMetadata();
    if (b.md5Hash !== rec.md5Hash) throw new Error('the backup copy does not match the original');
    say('   backup copied and its md5 matches');
  }

  // 3. Upload, conditional on the generation we recorded.
  const carried = { contentType: live.contentType, contentDisposition: live.contentDisposition, metadata: live.metadata || {} };
  say(`3. upload repair.epub (${newBytes.length} bytes, sha256 ${sha256(newBytes).slice(0, 12)}…) with ifGenerationMatch ${rec.generation}; carry contentType, contentDisposition and ${Object.keys(carried.metadata).length} custom metadata field(s)`);
  let newGen = null;
  if (go) {
    await file.save(newBytes, { resumable: false, contentType: carried.contentType, metadata: carried, preconditionOpts: { ifGenerationMatch: rec.generation } });
    const [n] = await file.getMetadata();
    newGen = String(n.generation);
    if (n.md5Hash !== md5b64(newBytes)) throw new Error('the uploaded object\'s md5 does not match the repair');
    say(`   uploaded: new generation ${newGen}`);
  }

  // 4. Carry the saved places.
  const slug = (await db.read(`bookstore_titles/${a.title}/slug`)).value || a.title;
  const out = await carryOver({
    db, oldBytes, newBytes, titleId: a.title, slug, oldGen: rec.generation, newGen, apply: go, backupDir: dir,
    liveGeneration: async () => String((await file.getMetadata())[0].generation),
  });
  say(`4. carry-over ${go ? '--apply' : '(dry run)'}: ${out.rows.length} record(s)`);
  for (const r of out.rows) console.log(`   ${describe(r)}`);
  const { backup, ...counts } = out.summary;
  console.log(`   ${JSON.stringify(counts)}`);

  // 5. The object served is the repair, byte for byte.
  say('5. download the new object and compare its sha256 with the repair\'s; records were re-read in step 4');
  if (go) {
    const [bytes] = await file.download();
    if (sha256(bytes) !== sha256(newBytes)) throw new Error('the live object is not the repair');
    say('   live object sha256 equals the repair');
    if (out.summary.conflicts) say(`   ${out.summary.conflicts} reader save(s) won during the carry-over: run carry-over.mjs --apply again`);
    if (out.summary.mismatched) { process.exitCode = 1; say('   a written record re-read differently: see the backup in the private folder'); }
    if (out.summary.refused) { process.exitCode = 1; say(`   ${out.summary.refused} record(s) REFUSED: the planned cfi is not wrapped once; nothing was written to them`); }
  }
  console.log(go ? 'swap done.' : 'dry run: nothing was copied, uploaded or written.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`swap stopped: ${e.message}`); process.exit(2); });
}
