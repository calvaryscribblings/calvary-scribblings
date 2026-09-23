// The production database, for the announcer and the test tool. Kept apart from both CLIs so
// importing it runs nothing.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

/** PUSH_SERVICE_ACCOUNT (a path) if set, else ./serviceAccountKey.json. */
export async function openProductionDb() {
  const path = process.env.PUSH_SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccountKey.json');
  initializeApp({ credential: cert(JSON.parse(await readFile(path, 'utf8'))), databaseURL: DB_URL });
  return getDatabase();
}
