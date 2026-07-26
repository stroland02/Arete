const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of `d`'s calendar day, in the viewer's timezone. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Midnight at the start of the window's first day.
 *
 * Built by rolling the day-of-month back rather than subtracting milliseconds:
 * `Date` normalises an out-of-range day, and across a DST boundary two local
 * midnights are 23 or 25 hours apart, so millisecond arithmetic would land an
 * hour either side of the day it meant.
 */
function startOfWindow(days: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
}

export function bucketByDay(dates: Date[], days: number): number[] {
  const buckets = Array(days).fill(0);
  const startOfToday = startOfLocalDay(new Date());

  for (const date of dates) {
    // Rounded for the same DST reason: a 23- or 25-hour gap between two local
    // midnights is still one day apart, and truncating would call it zero.
    const diffDays = Math.round((startOfToday.getTime() - startOfLocalDay(date).getTime()) / DAY_MS);
    const index = days - 1 - diffDays;
    if (index >= 0 && index < days) buckets[index] += 1;
  }

  return buckets;
}

export function cumulativeByDay(dates: Date[], days: number): number[] {
  const perDay = bucketByDay(dates, days);

  // Only what happened BEFORE the window seeds the running total. This used to
  // be `dates.length - countedInWindow`, i.e. everything the window did not
  // bucket — which quietly swept FUTURE-dated rows into the baseline, so the
  // chart drew them as already present on day one, indistinguishable from
  // something months old. Clock skew on a writer is enough to produce one.
  const windowStart = startOfWindow(days, new Date()).getTime();
  let running = dates.filter((d) => startOfLocalDay(d).getTime() < windowStart).length;

  return perDay.map((count) => (running += count));
}
