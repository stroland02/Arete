export function bucketByDay(dates: Date[], days: number): number[] {
  const buckets = Array(days).fill(0);
  const dayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const date of dates) {
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / dayMs);
    const index = days - 1 - diffDays;
    if (index >= 0 && index < days) buckets[index] += 1;
  }

  return buckets;
}

export function cumulativeByDay(dates: Date[], days: number): number[] {
  const perDay = bucketByDay(dates, days);
  const countedInWindow = perDay.reduce((a, b) => a + b, 0);
  let running = dates.length - countedInWindow;
  return perDay.map((count) => (running += count));
}
