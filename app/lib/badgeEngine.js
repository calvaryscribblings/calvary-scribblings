import { BADGES, computeStats, computeReaderScore } from './badges';
import { USER_COMMENTS_PATH, commentedSlugCountOf } from './userComments';

export async function checkAndAwardBadges(uid, db) {
  const { ref, get, update } = await import('firebase/database');
  const [subsSnap, streakSnap, badgesSnap, userSnap, commentsSnap] = await Promise.all([
    get(ref(db, `quiz_submissions/${uid}`)),
    get(ref(db, `userStreaks/${uid}`)),
    get(ref(db, `userBadges/${uid}`)),
    get(ref(db, `users/${uid}`)),
    // Was `comments` whole — every comment on the site — to count the distinct stories
    // ONE reader had commented on. The index answers it directly and is bounded by that
    // reader's own activity. This runs after every comment posted, so it was one of the
    // hottest whole-node reads on the site.
    get(ref(db, `${USER_COMMENTS_PATH}/${uid}`)),
  ]);
  const submissions = subsSnap.exists() ? subsSnap.val() : null;
  const streakData  = streakSnap.exists() ? streakSnap.val() : null;
  const earned      = badgesSnap.exists() ? badgesSnap.val() : {};
  const userData    = userSnap.exists() ? userSnap.val() : {};
  const storiesReadCount = userData.readStories ? Object.keys(userData.readStories).length : 0;
  // Comment points: count distinct slugs where this user left at least one
  // comment (the practical 1-per-slug cap). Retroactive — all history counts.
  const cappedComments = commentedSlugCountOf(commentsSnap.val());

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

  const readerScore = computeReaderScore(submissions, streakData, storiesReadCount, cappedComments);
  updates[`users/${uid}/readerScore`] = readerScore;
  updates[`users/${uid}/scoreUpdatedAt`] = now;

  updates[`leaderboard/${uid}/readerScore`]        = readerScore;
  updates[`leaderboard/${uid}/scoreUpdatedAt`]     = now;
  updates[`leaderboard/${uid}/displayName`]        = userData.displayName ?? null;
  updates[`leaderboard/${uid}/avatarUrl`]          = userData.avatarUrl ?? null;
  updates[`leaderboard/${uid}/username`]           = userData.username ?? null;
  updates[`leaderboard/${uid}/joinDate`]           = userData.joinDate ?? null;
  updates[`leaderboard/${uid}/leaderboardVisible`] = userData.leaderboardVisible === false ? false : null;

  await update(ref(db, '/'), updates);
  return newBadges;
}

// Count distinct top-level comment threads (one per story slug / post id) where
// this user authored at least one comment. This is the capped comment count fed
// into the reader-score formula (1 point-earning comment per slug).
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
