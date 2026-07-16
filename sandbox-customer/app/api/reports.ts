// Beancount reporting API (TEST DATA — fake customer app for exercising Kuma).

import { CATEGORIES, EXPENSES, type Category, type Expense } from "../data/db.ts";

export interface CategoryTotal {
  category: string;
  totalCents: number;
  count: number;
}

/**
 * Roll up total spend per category across the given expenses.
 */
export function summarize(
  expenses: Expense[] = EXPENSES,
  categories: Category[] = CATEGORIES,
): CategoryTotal[] {
  return categories.map((category) => {
    const forCategory = expenses.filter((e) => e.categoryId === category.id);
    const totalCents = forCategory.reduce((sum, e) => sum + e.amountCents, 0);
    return { category: category.name, totalCents, count: forCategory.length };
  });
}

/** The single largest expense in the current period, or null if none. */
export function topExpense(expenses: Expense[] = EXPENSES): Expense | null {
  if (expenses.length === 0) return null;
  return expenses.reduce((max, e) => (e.amountCents > max.amountCents ? e : max));
}
