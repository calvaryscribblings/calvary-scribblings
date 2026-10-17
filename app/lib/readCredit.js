// A READ CREDITS THE READER — one piece of code for a story and an instalment (W49 §4, ruling 179).
//
// Lifted VERBATIM from the story page (app/stories/[slug]/page-client.js, the auth effect), so the
// story page, the story reader (app/reader/[slug]/page-reader.js) and the Series reader
// (app/series/read/[instalmentId]/page-reader.js) credit a read the same way:
//
//   noteReadingDay   the streak (userStreaks/{uid}), and when it moved, the badge checks
//                    (checkAndAwardBadges → userBadges/{uid}, users/{uid}/readerScore).
//   creditFirstRead  the first time only, keyed by `node`/`key`: the marker, users/{uid}/readCount
//                    + 1 (the island badge's number), and on every tenth read 5 points,
//                    points/{uid}/history and the library notification.
//
// The marker node keeps the two apart. Stories are users/{uid}/readStories/{slug}, which other
// surfaces read as story slugs; instalments are users/{uid}/readInstalments/{inst}, their own node.
// readCount is shared, which is the point of ruling 179.
//
// Every write is the reader's own and client-side, as the story credit always was.
// `fb` (the firebase/database functions) is injectable so the tests can drive the real code.
export const READ_NODES = Object.freeze({ story: 'readStories', instalment: 'readInstalments' });

/** The streak, and the badge checks when the streak moved. Fire-and-forget, never throws. */
export async function noteReadingDay(uid, db) {
  try {
    const [{ updateStreak }, { checkAndAwardBadges }] = await Promise.all([import('./streakEngine.js'), import('./badgeEngine.js')]);
    updateStreak(uid, db)
      .then((changed) => { if (changed) checkAndAwardBadges(uid, db).catch(() => {}); })
      .catch(() => {});
  } catch { /* the credit never blocks a read */ }
}

/**
 * The first-read credit. Returns { credited, readCount }. A marker already set credits nothing.
 * Throws only if the marker or the count cannot be written; the milestone never throws.
 */
export async function creditFirstRead(uid, db, { node = READ_NODES.story, key }, fb = null) {
  const { ref, get, set, runTransaction, push, update } = fb || await import('firebase/database');
  const readRef = ref(db, `users/${uid}/${node}/${key}`);
  const snap = await get(readRef);
  if (snap.exists()) return { credited: false, readCount: null };
  await set(readRef, true);
  await runTransaction(ref(db, `users/${uid}/readCount`), (c) => (c || 0) + 1);

  let newCount = null;
  try {
    const countSnap = await get(ref(db, `users/${uid}/readCount`));
    newCount = countSnap.exists() ? countSnap.val() : 1;
    if (newCount > 0 && newCount % 10 === 0) {
      const pointsSnap = await get(ref(db, `points/${uid}/total`));
      const current = pointsSnap.exists() ? pointsSnap.val() : 0;
      await update(ref(db, `points/${uid}`), { total: current + 5 });
      await push(ref(db, `points/${uid}/history`), {
        type: 'read', amount: 5,
        description: `${newCount} stories read milestone`,
        createdAt: Date.now(),
      });
      await push(ref(db, `library_notifications/${uid}`), {
        type: 'reward', fromName: 'Calvary Scribblings',
        message: `You earned 5 Scribbles — ${newCount} stories read milestone!`,
        read: false, createdAt: Date.now(),
      });
    }
  } catch (e) { /* the milestone is a reward, never a reason to fail the read */ }
  return { credited: true, readCount: newCount };
}
