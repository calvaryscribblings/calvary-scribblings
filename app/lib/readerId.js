'use client';

// The DEVICE id a signed-out read is counted under (W49).
//
// A random id kept in localStorage, so refreshing (or coming back later) still de-dupes on the same
// browser. It is used ONLY when nobody is signed in: a signed-in read is counted under the uid from
// a verified ID token (app/lib/readHit.js → functions/api/hit.js), never under this. Before W49 this
// returned auth.currentUser's uid when it happened to be restored already, and the device id when
// it had not, so one reader could be counted once under each.
//
// Returns null when there is no storage (private mode, SSR). Callers send nothing then — never the
// string "null", which was a real ledger key.
export function getReaderId() {
  try {
    let id = localStorage.getItem('cs_reader_id');
    if (!id || id === 'null' || id === 'undefined') {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('cs_reader_id', id);
    }
    return id;
  } catch (e) {
    return null;
  }
}
