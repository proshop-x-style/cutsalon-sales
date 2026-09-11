import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPENSE_CATEGORIES } from './expenseCategories';

describe('DEFAULT_EXPENSE_CATEGORIES', () => {
  it('includes the salon-friendly default categories', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toContain('消耗品費');
    expect(DEFAULT_EXPENSE_CATEGORIES).toContain('美容材料費');
    expect(DEFAULT_EXPENSE_CATEGORIES).toContain('仕入原価');
    expect(DEFAULT_EXPENSE_CATEGORIES).toContain('接待交際費');
    expect(DEFAULT_EXPENSE_CATEGORIES).toContain('その他');
  });
});
