// The production database, for the announcer and the test tool. Kept apart from both CLIs so
// importing it runs nothing.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { openGuard } from '../safety/guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

/**
 * PUSH_SERVICE_ACCOUNT (a path) if set, else ./serviceAccountKey.json.
 * SAFETY-1: the handle comes back wrapped in the guard, so every write the announcer makes (claims,
 * marks, token and receipt prunes) is backed up and verified first, and nothing is written at all
 * without --apply on the command line.
 */
export async function openProductionDb(name = 'push-announce') {
  const path = process.env.PUSH_SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccountKey.json');
  initializeApp({ credential: cert(JSON.parse(await readFile(path, 'utf8'))), databaseURL: DB_URL });
  const guard = await openGuard(name);
  return guard.adminDb(getDatabase());
}
