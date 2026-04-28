export const BADGES = [
  {
    id: 'first_quiz',
    name: 'First Quiz',
    description: 'Completed your first quiz',
    icon: '✦',
    rarity: 'common',
    condition: s => s.totalQuizzes >= 1,
  },
  {
    id: 'bronze_thrice',
    name: 'Bronze Thrice',
    description: '3 Bronze tiers earned',
    icon: '⚜',
    rarity: 'common',
    condition: s => s.bronzeCount >= 3,
  },
  {
    id: 'silver_streak',
    name: 'Silver Streak',
    description: '5 Silver or higher tiers earned',
    icon: '❉',
    rarity: 'uncommon',
    condition: s => s.silverPlusCount >= 5,
  },
  {
    id: 'golden_hand',
    name: 'Golden Hand',
    description: '10 Gold or higher tiers earned',
    icon: '✺',
    rarity: 'rare',
    condition: s => s.goldPlusCount >= 10,
  },
  {
    id: 'platinum_touch',
    name: 'Platinum Touch',
    description: 'Earned a Platinum tier',
    icon: '❖',
    rarity: 'rare',
    condition: s => s.platinumCount >= 1,
  },
  {
    id: 'quintet',
    name: 'Quintet',
    description: '5 Platinum tiers earned',
    icon: '❋',
    rarity: 'legendary',
    condition: s => s.platinumCount >= 5,
  },
  {
    id: 'decadent',
    name: 'Decadent',
    description: '10 quizzes completed',
    icon: '✧',
    rarity: 'uncommon',
    condition: s => s.totalQuizzes >= 10,
  },
  {
    id: 'centurion',
    name: 'Centurion',
    description: '100 quizzes completed',
    icon: '✦✦',
    rarity: 'legendary',
    condition: s => s.totalQuizzes >= 100,
  },
  {
    id: 'streak_7',
    name: 'Steady Reader',
    description: '7-day reading streak',
    icon: '❀',
    rarity: 'uncommon',
    condition: s => s.longestStreak >= 7,
  },
  {
    id: 'streak_30',
    name: 'Dedicated Reader',
    description: '30-day reading streak',
    icon: '✤',
    rarity: 'rare',
    condition: s => s.longestStreak >= 30,
  },
  {
    id: 'streak_100',
    name: 'Calvary Devotee',
    description: '100-day reading streak',
    icon: '❂',
    rarity: 'rare',
    condition: s => s.longestStreak >= 100,
  },
  {
    id: 'streak_365',
    name: 'Year of Stories',
    description: '365-day reading streak',
    icon: '❈',
    rarity: 'legendary',
    condition: s => s.longestStreak >= 365,
  },
];

export const RARITY_STYLES = {
  common:    { border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)' },
  uncommon:  { border: '1px solid rgba(169,113,66,0.45)',  background: 'rgba(169,113,66,0.07)' },
  rare:      { border: '1px solid rgba(192,192,200,0.45)', background: 'rgba(192,192,200,0.07)' },
  legendary: {
    border: '1px solid rgba(167,139,250,0.45)',
    background: 'linear-gradient(135deg, rgba(139,92,246,0.14) 0%, rgba(200,218,234,0.09) 50%, rgba(212,83,126,0.07) 100%)',
  },
};

export function computeStats(submissions, streakData) {
  const subs = submissions ? Object.values(submissions) : [];
  const completed    = subs.filter(s => s?.hardballPassed === true);
  const bronzeCount  = completed.filter(s => s.tier === 'bronze').length;
  const silverCount  = completed.filter(s => s.tier === 'silver').length;
  const goldCount    = completed.filter(s => s.tier === 'gold').length;
  const platinumCount = completed.filter(s => s.tier === 'platinum').length;
  return {
    totalQuizzes:    completed.length,
    bronzeCount,
    silverCount,
    goldCount,
    platinumCount,
    silverPlusCount: silverCount + goldCount + platinumCount,
    goldPlusCount:   goldCount + platinumCount,
    longestStreak:   streakData?.longest ?? 0,
  };
}

const RARITY_RANK = { legendary: 3, rare: 2, uncommon: 1, common: 0 };

export function computeReaderScore(submissions, streakData, storiesReadCount) {
  const stats = computeStats(submissions, streakData);
  return Math.round(
    (stats.platinumCount * 50) +
    (stats.goldCount * 30) +
    (stats.silverCount * 15) +
    (stats.bronzeCount * 5) +
    (storiesReadCount * 1) +
    (stats.longestStreak * 5)
  );
}

export function pickHighestBadge(userBadges) {
  if (!userBadges) return null;
  const entries = Object.entries(userBadges)
    .map(([id, meta]) => {
      const def = BADGES.find(b => b.id === id);
      if (!def) return null;
      return { ...def, earnedAt: meta?.earnedAt ?? 0 };
    })
    .filter(Boolean);
  if (!entries.length) return null;
  entries.sort((a, b) => (RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity]) || (b.earnedAt - a.earnedAt));
  return entries[0];
}

export function getStreakDisplay(streakData) {
  if (!streakData?.lastReadAt) return null;
  const msAgo = Date.now() - streakData.lastReadAt;
  const n = streakData.current ?? 0;
  if (msAgo < 43200000) return { icon: '📚', n, warning: false };
  if (msAgo < 86400000) return { icon: '⏳', n, warning: true };
  return { icon: '📚', n: 0, warning: false };
}
