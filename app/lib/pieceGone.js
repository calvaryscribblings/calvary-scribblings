'use client';
// W19 / ruling 47 — IS THIS OPEN PAGES PIECE GONE?
//
// One live read per piece per page load, shared by every card and post body that asks, so a feed
// with the same announcement drawn twice reads it once. Until the read answers — and on a server
// render, and if the read fails — the answer is "not gone": a surface never claims a deletion it
// has not seen. firebase is imported inside the effect, so app/components/conversation/PostBody.js
// stays importable by a node test.
import { useEffect, useState } from 'react';

const answers = new Map(); // id -> Promise<boolean>
const settled = new Map(); // id -> boolean, once the read has answered

/** Record an answer, so the next surface to draw this piece starts from it (and a test can seed it). */
export function rememberPiece(id, gone) { settled.set(id, gone === true); }

export function pieceGone(id) {
  if (!answers.has(id)) {
    answers.set(id, (async () => {
      const [{ db }, { ref, get }] = await Promise.all([import('./firebaseCore.js'), import('firebase/database')]);
      // authorUid is on every piece and can never change (database.rules.json), so its absence
      // means the piece is absent — without downloading the piece's body to find out.
      const gone = !(await get(ref(db, `open_pages/${id}/authorUid`))).exists();
      rememberPiece(id, gone);
      return gone;
    })().catch(() => false));
  }
  return answers.get(id);
}

/** true once a live read has shown the piece is gone; false until then, or with no id. */
export function usePieceGone(id) {
  const [gone, setGone] = useState(() => (id ? settled.get(id) === true : false));
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    pieceGone(id).then((g) => { if (live) setGone(g); });
    return () => { live = false; };
  }, [id]);
  return gone;
}
