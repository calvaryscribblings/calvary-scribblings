// WHAT ONE-PER-ITEM WOULD HAVE COST A READER — the number Ikenna rules frequency on.
//
// Every reader with notifications on receives every announcement (there is no per-reader
// targeting), so "per reader per week" is simply items per week. The time an item became
// visible is its publishAt when scheduled, else publishedAtMs (UTC midnight of its display
// date — so same-day publishes pile onto one day here, which OVERSTATES the busiest day).

import { isStoryVisible, isInstalmentVisible, londonDay, DAILY_CAP } from './lib.mjs';

const DAY = 86400000;

export function visibleItemsSince(world, since, now) {
  const items = [];
  for (const [slug, s] of Object.entries(world.stories || {})) {
    if (!isStoryVisible(s, now)) continue;
    const at = (s.publishAt && Date.parse(s.publishAt)) || s.publishedAtMs;
    if (at >= since && at <= now) items.push({ kind: 'story', id: slug, at, category: s.category });
  }
  for (const [id, r] of Object.entries(world.instalments || {})) {
    if (!isInstalmentVisible(r, world.series?.[r.seriesId], now)) continue;
    if (r.releaseAtMs >= since && r.releaseAtMs <= now) items.push({ kind: 'instalment', id, at: r.releaseAtMs, category: 'series' });
  }
  return items.sort((a, b) => a.at - b.at);
}

export function frequencyStats(items, since, now) {
  const weeks = (now - since) / (7 * DAY);
  const byDay = new Map();
  for (const it of items) {
    const d = new Date(it.at).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  // Rolling 7-day windows ending on each day of the period — the honest "worst week".
  let worstWeek = 0;
  for (let end = since + 7 * DAY; end <= now + DAY; end += DAY) {
    worstWeek = Math.max(worstWeek, items.filter((i) => i.at > end - 7 * DAY && i.at <= end).length);
  }
  const byCategory = {};
  for (const it of items) byCategory[it.category] = (byCategory[it.category] || 0) + 1;
  return {
    total: items.length,
    perWeek: items.length / weeks,
    worstWeek,
    busiestDay: Math.max(0, ...byDay.values()),
    daysWithTwoOrMore: [...byDay.values()].filter((n) => n >= 2).length,
    byCategory,
  };
}

/**
 * What the two-a-day cap would have stopped: items past the second on each London day, oldest
 * first. The 08:00 hold never moves an item to another day, so it doesn't change the count.
 */
export function capStats(items) {
  const byDay = new Map();
  for (const it of [...items].sort((a, b) => a.at - b.at)) {
    const d = londonDay(it.at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(it);
  }
  const cappedItems = [];
  for (const list of byDay.values()) cappedItems.push(...list.slice(DAILY_CAP));
  return {
    capped: cappedItems.length,
    daysCapped: [...byDay.values()].filter((l) => l.length > DAILY_CAP).length,
    cappedItems,
  };
}

export function frequencyReport(world, now, log = console.log) {
  const since = now - 30 * DAY;
  const items = visibleItemsSince(world, since, now);
  const st = frequencyStats(items, since, now);
  log(`last 30 days: ${st.total} announcement(s) — ${st.perWeek.toFixed(1)} per reader per week`);
  log(`worst rolling 7 days: ${st.worstWeek}; busiest day: ${st.busiestDay}; days with 2+: ${st.daysWithTwoOrMore}`);
  log(`by category: ${Object.entries(st.byCategory).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const cap = capStats(items);
  log(`two-a-day cap: ${cap.capped} item(s) on ${cap.daysCapped} London day(s) would not have been sent`);
  for (const it of cap.cappedItems) log(`  capped: ${londonDay(it.at)}  ${it.kind}/${it.id}`);
  for (const it of items) log(`  ${new Date(it.at).toISOString().slice(0, 16)}  ${it.kind}/${it.id}`);
  return { ...st, cap };
}
