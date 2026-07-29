// READ-ONLY diagnostic: pull a bookstore master EPUB into tests/fixtures/ so the harness
// can resolve real, live CFIs against the real book.
//
//   node scripts/fetch-master-epub.mjs the-fire-in-the-flint
//
// storage.rules keeps `allow read: if false` on these objects; this reads them with the
// service account through the Cloud Storage JSON API, which is evaluated above the rules
// layer — the same grant path functions/api/bookstore/stream.js signs URLs with.
//
// THE OUTPUT IS NEVER COMMITTED. tests/fixtures/*.master.epub is gitignored: it is a
// licensed book, and the repo is not where it lives.
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintToken } from './rules-pull.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

const slug = process.argv[2];
if (!slug) { console.error('usage: node scripts/fetch-master-epub.mjs <slug>'); process.exit(1); }

const token = await mintToken();

const titles = await (await fetch(`${DB}/bookstore_titles.json?access_token=${token}`)).json();
const entry = Object.values(titles || {}).find((t) => t?.slug === slug);
if (!entry) { console.error(`no bookstore title with slug "${slug}"`); process.exit(1); }
if (!entry.epubPath) { console.error(`"${slug}" has no epubPath`); process.exit(1); }

const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(entry.epubPath)}?alt=media`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`download failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`); process.exit(1); }

const bytes = Buffer.from(await res.arrayBuffer());
const out = resolve(ROOT, 'tests/fixtures', `${slug}.master.epub`);
await writeFile(out, bytes);
console.log(`${entry.title} (${entry.epubPath}) → ${out} (${bytes.length} bytes)`);
