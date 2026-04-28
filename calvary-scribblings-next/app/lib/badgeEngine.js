import { BADGES, computeStats, computeReaderScore } from './badges';

export async function checkAndAwardBadges(uid, db) {
  const { ref, get, update } = await import('firebase/database');
  const [subsSnap, streakSnap, badgesSnap, readStoriesSnap, pointsSnap] = await Promise.all([
    get(ref(db, `quiz_submissions/${uid}`)),
    get(ref(db, `userStreaks/${uid}`)),
    get(ref(db, `userBadges/${uid}`)),
    get(ref(db, `users/${uid}/readStories`)),
    get(ref(db, `points/${uid}/total`)),
  ]);
  const submissions = subsSnap.exists() ? subsSnap.val() : null;
  const streakData  = streakSnap.exists() ? streakSnap.val() : null;
  const earned      = badgesSnap.exists() ? badgesSnap.val() : {};
  const storiesReadCount = readStoriesSnap.exists() ? Object.keys(readStoriesSnap.val()).length : 0;
  const totalScribbles   = pointsSnap.exists() ? pointsSnap.val() : 0;

  const stats = computeStats(submissions, streakData);
  const newBadges = [];
  const updates   = {};
  const now = Date.now();
  for (const badge of BADGES) {
    if (!earned[badge.id] && badge.condition(stats)) {
      updates[`userBadges/${uid}/${badge.id}`] = { earnedAt: now, milestone: getMilestone(badge.id, stats) };
      newBadges.push(badge);
    }
  }

  const readerScore = computeReaderScore(submissions, streakData, storiesReadCount, totalScribbles);
  updates[`users/${uid}/readerScore`] = readerScore;
  updates[`users/${uid}/scoreUpdatedAt`] = now;

  await update(ref(db, '/'), updates);
  return newBadges;
}

function getMilestone(id, stats) {
  switch (id) {
    case 'first_quiz':     return 1;
    case 'bronze_thrice':  return stats.bronzeCount;
    case 'silver_streak':  return stats.silverPlusCount;
    case 'golden_hand':    return stats.goldPlusCount;
    case 'platinum_touch': return stats.platinumCount;
    case 'quintet':        return stats.platinumCount;
    case 'decadent':       return stats.totalQuizzes;
    case 'centurion':      return stats.totalQuizzes;
    default:               return stats.longestStreak;
  }
}
