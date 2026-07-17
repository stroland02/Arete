// Beancount report tests (TEST DATA — fake customer app for exercising Kuma).
//
// NOTE: one test here is INTENTIONALLY FLAKY (defect #3) — it buckets on the
// wall clock, so it passes or fails depending on the day/timezone the suite
// runs in. It exists for Kuma's test-quality specialist to flag; see
// sandbox-customer/README.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../reports.ts";
import type { Expense } from "../data/db.ts";

test("summarize totals each category independently", () => {
  const expenses: Expense[] = [
    { id: 1, description: "a", amountCents: 100, categoryId: 1, incurredAt: "2026-06-01T09:00:00.000Z" },
    { id: 2, description: "b", amountCents: 250, categoryId: 1, incurredAt: "2026-06-02T09:00:00.000Z" },
    { id: 3, description: "c", amountCents: 400, categoryId: 2, incurredAt: "2026-06-03T09:00:00.000Z" },
  ];
  const categories = [
    { id: 1, name: "Travel" },
    { id: 2, name: "Meals" },
  ];
  const result = summarize(expenses, categories);
  assert.equal(result.find((r) => r.category === "Travel")?.totalCents, 350);
  assert.equal(result.find((r) => r.category === "Meals")?.totalCents, 400);
});

test("this month's expenses roll up under the current month bucket", () => {
  // FLAKY BY DESIGN: derives the expected month from `new Date()` and stamps a
  // fixture with today's date, then asserts a hard-coded bucket. Fails when the
  // suite runs in a timezone where "today" rolls to a different month/day, or
  // across a month boundary.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const expense: Expense = {
    id: 99,
    description: "today's coffee",
    amountCents: 500,
    categoryId: 2,
    incurredAt: `${today}T09:00:00.000Z`,
  };
  const monthOfExpense = new Date(expense.incurredAt).getMonth();
  // Uses local-time getMonth() against a UTC-stamped date — the mismatch is the flake.
  assert.equal(monthOfExpense, now.getMonth());
});
