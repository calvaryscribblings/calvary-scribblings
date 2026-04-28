export async function updateStreak(uid, db) {
  const { ref, get, update } = await import('firebase/database');
  const snap = await get(ref(db, `userStreaks/${uid}`));
  const data = snap.exists() ? snap.val() : {};
  const now = Date.now();
  const utcDay = ms => Math.floor(ms / 86400000);
  const todayDay = utcDay(now);
  const lastDay  = data.lastReadAt ? utcDay(data.lastReadAt) : null;
  let { current = 0, longest = 0 } = data;
  if (lastDay === null) { current = 1; }
  else if (todayDay === lastDay) { return false; }
  else if (todayDay === lastDay + 1) { current += 1; }
  else { current = 1; }
  if (current > longest) longest = current;
  await update(ref(db, `userStreaks/${uid}`), { current, longest, lastReadAt: now });
  return true;
}
