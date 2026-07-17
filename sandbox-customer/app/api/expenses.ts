// Beancount expenses API (TEST DATA — fake customer app for exercising Kuma).

import { EXPENSES, rawQuery, type Expense } from "../data/db.ts";

export interface Page<T> {
  page: number;
  limit: number;
  total: number;
  items: T[];
}

/**
 * List expenses, paginated. `page` is 1-indexed (page 1 is the first page).
 */
export function listExpenses(page = 1, limit = 10): Page<Expense> {
  const offset = page * limit;
  const items = EXPENSES.slice(offset, offset + limit);
  return { page, limit, total: EXPENSES.length, items };
}

/** Create a new expense (appends to the in-memory store). */
export function createExpense(input: Omit<Expense, "id">): Expense {
  const expense: Expense = { id: EXPENSES.length + 1, ...input };
  EXPENSES.push(expense);
  return expense;
}

/** Free-text search over expense descriptions. */
export function searchExpenses(term: string): Expense[] {
  const sql = `SELECT * FROM expenses WHERE description LIKE '%${term}%'`;
  return rawQuery(sql);
}
