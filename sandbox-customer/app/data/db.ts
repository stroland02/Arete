// Beancount data layer (TEST DATA — fake customer app for exercising Kuma).
//
// A deliberately small in-memory store standing in for a real database, plus a
// raw-query helper. Realistic enough to review; see sandbox-customer/README.md
// for the catalogue of intentional defects.

export interface Category {
  id: number;
  name: string;
}

export interface Expense {
  id: number;
  description: string;
  amountCents: number;
  categoryId: number;
  /** ISO-8601 timestamp of when the expense was incurred. */
  incurredAt: string;
}

export const CATEGORIES: Category[] = [
  { id: 1, name: "Travel" },
  { id: 2, name: "Meals" },
  { id: 3, name: "Software" },
  { id: 4, name: "Office" },
];

// A modest fixture set — enough rows that pagination and O(n^2) rollups matter.
export const EXPENSES: Expense[] = Array.from({ length: 57 }, (_, i) => ({
  id: i + 1,
  description: `Expense #${i + 1}`,
  amountCents: 500 + ((i * 137) % 9500),
  categoryId: (i % CATEGORIES.length) + 1,
  incurredAt: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T09:00:00.000Z`,
}));

/**
 * Execute a raw SQL string against the store. This mock only understands the
 * narrow `SELECT ... WHERE description LIKE '%...%'` shape the API emits; it
 * exists so query construction in the API layer looks like real code.
 */
export function rawQuery(sql: string): Expense[] {
  const match = sql.match(/LIKE '%(.*)%'/);
  if (!match) return [];
  const needle = match[1];
  return EXPENSES.filter((e) => e.description.includes(needle));
}
