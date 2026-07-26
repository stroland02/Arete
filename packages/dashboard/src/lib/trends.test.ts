import { describe, expect, it } from "vitest";

import { bucketByDay, cumulativeByDay } from "./trends";

/**
 * Every chart in the product goes through these two functions — the Overview
 * tiles, the review-activity preset, the timeseries widget, and the error
 * grouping in `lib/errors.ts` — and neither had a test.
 *
 * Dates are built relative to *now*, in local time, because that is the frame
 * the functions bucket in. A fixed timestamp would pass in one timezone and
 * fail in another, which is the exact class of bug this file exists around.
 */

/** Midday on the local day `n` days ago — far from any boundary. */
function daysAgo(n: number): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12, 0, 0);
}

describe("bucketByDay", () => {
  it("puts today in the last bucket, not the first", () => {
    // The window reads left-to-right as oldest-to-newest; a chart drawn the
    // other way round would be wrong in a way nobody notices until the numbers
    // are checked by hand.
    expect(bucketByDay([daysAgo(0)], 7)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("counts several events on one day into one bucket", () => {
    expect(bucketByDay([daysAgo(2), daysAgo(2), daysAgo(2)], 7)).toEqual([0, 0, 0, 0, 3, 0, 0]);
  });

  it("keeps the oldest day that still fits the window", () => {
    expect(bucketByDay([daysAgo(6)], 7)[0]).toBe(1);
  });

  it("drops anything older than the window rather than clamping it", () => {
    // Clamping would pile every historical row onto day one and draw a spike
    // that never happened.
    expect(bucketByDay([daysAgo(7), daysAgo(400)], 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("drops a future-dated row rather than folding it into today", () => {
    expect(bucketByDay([daysAgo(-1)], 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("buckets the whole local day, from just after midnight to just before", () => {
    const start = new Date(new Date().setHours(0, 0, 0, 1));
    const end = new Date(new Date().setHours(23, 59, 59, 999));
    expect(bucketByDay([start, end], 7)[6]).toBe(2);
  });

  it("returns a full window of zeroes for no dates", () => {
    expect(bucketByDay([], 30)).toEqual(Array(30).fill(0));
    expect(bucketByDay([], 30)).toHaveLength(30);
  });
});

describe("cumulativeByDay", () => {
  it("never decreases", () => {
    const series = cumulativeByDay([daysAgo(5), daysAgo(3), daysAgo(3), daysAgo(0)], 7);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
  });

  it("ends at the total of everything up to and including today", () => {
    expect(cumulativeByDay([daysAgo(400), daysAgo(5), daysAgo(0)], 7).at(-1)).toBe(3);
  });

  it("seeds the line with what already existed before the window opened", () => {
    // A chart starting at zero would say the product had no history, which is a
    // different and more flattering claim than the truth.
    expect(cumulativeByDay([daysAgo(400), daysAgo(300)], 7)).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it("does not sweep a future-dated row into the pre-window baseline", () => {
    // The bug this replaced: the baseline was everything the window did not
    // bucket, so a row dated tomorrow was indistinguishable from one dated last
    // year, and the chart drew it as already present a week ago. Clock skew on
    // a writer is enough to produce one.
    expect(cumulativeByDay([daysAgo(-5)], 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps a real baseline while ignoring a future row in the same set", () => {
    const series = cumulativeByDay([daysAgo(400), daysAgo(-5), daysAgo(0)], 7);
    expect(series[0]).toBe(1); // the old one only
    expect(series.at(-1)).toBe(2); // plus today's, never the future one
  });

  it("is all zeroes for no dates", () => {
    expect(cumulativeByDay([], 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("the DST hazard both functions are written around", () => {
  it("still spans exactly `days` buckets when the window crosses a clock change", () => {
    // Two local midnights can be 23 or 25 hours apart. The day arithmetic rolls
    // the day-of-month rather than subtracting milliseconds, so the window
    // cannot drift an hour either side of the day it meant. Runs in whatever
    // timezone CI uses; the length invariant holds everywhere.
    for (const days of [7, 30, 90]) {
      expect(bucketByDay([daysAgo(1)], days)).toHaveLength(days);
      expect(cumulativeByDay([daysAgo(1)], days)).toHaveLength(days);
    }
  });

  it("places a row from exactly one day ago in the second-to-last bucket", () => {
    const series = bucketByDay([daysAgo(1)], 7);
    expect(series[5]).toBe(1);
    expect(series[6]).toBe(0);
  });
});
