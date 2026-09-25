// GET /api/bookstore/holders?titleId=…   — founders only. W6, 25 Sep 2026.
//
// HOW MANY PEOPLE HOLD THIS BOOK, sales and complimentary copies alike. The admin's title
// Delete asks before it plans which Storage objects may go, because the master EPUB is what
// functions/api/bookstore/stream.js signs for every holder, and stream.js tests one thing:
// bookstore_purchases/{uid}/{titleId}.status === 'active'. A comp passes that test exactly as a
// sale does.
//
// WHY THIS IS AN ENDPOINT AND NOT A BROWSER READ. bookstore_purchases has no node-level read
// rule — only bookstore_purchases/$uid — so even a founder's browser cannot list the node. The
// counter the browser CAN read, bookstore_readership, counts readers who BOUGHT the book
// (countsForReadership), which excludes comps by ruling. Before W6 the delete used that counter,
// so a title held only as a comp read as unowned and its master was deleted.
//
// The response carries COUNTS ONLY — never a uid, never a record. Who holds a book is nobody's
// business on an admin screen; how many is the whole question.
//
// Fails loud: any read failure is a non-200, and the client treats anything but a 200 with two
// integers as "unknown", which refuses the delete.

import {
  json,
  dbBase,
  lookupUser,
  mintAccessToken,
  FIREBASE_TIMEOUT_MS,
  PURCHASES_PATH,
  REF_SAFE_TITLE_ID,
} from './_lib.js';
import { holdersOf } from '../../../app/lib/bookstore/purchaseSource.js';
import { isFounder } from '../../../app/lib/founders.js';

const noStore = (data, status) => {
  const res = json(data, status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
};

export async function onRequestGet({ request, env }) {
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[bookstore/holders] missing Firebase configuration');
    return noStore({ error: 'The holder count is not configured.' }, 500);
  }

  const auth = request.headers.get('authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!idToken) return noStore({ error: 'Sign in first.' }, 401);

  const titleId = new URL(request.url).searchParams.get('titleId');
  if (!titleId || !REF_SAFE_TITLE_ID.test(titleId)) return noStore({ error: 'titleId required.' }, 400);

  let user;
  try {
    user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  } catch (e) {
    console.error('[bookstore/holders] identity lookup failed:', e.message || e);
    return noStore({ error: 'Could not confirm who you are.' }, 502);
  }
  if (!user) return noStore({ error: 'Your session has expired. Sign in again.' }, 401);
  if (!isFounder(user.localId)) return noStore({ error: 'Not authorised.' }, 403);

  let purchases;
  try {
    const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const res = await fetch(`${dbBase(env)}/${PURCHASES_PATH}.json`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RTDB GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    purchases = await res.json();
  } catch (e) {
    console.error('[bookstore/holders] purchases read failed:', e.message || e);
    return noStore({ error: 'Could not read who holds this book.' }, 502);
  }

  // An absent node is null, and null is zero holders — the node's contract, not a guess.
  const { count, comps } = holdersOf(purchases || {}, titleId);
  return noStore({ ok: true, titleId, count, comps }, 200);
}
