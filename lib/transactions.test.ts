import { describe, expect, it } from 'vitest';
import { summarizeTransactions } from './transactions';

describe('summarizeTransactions', () => {
  it('adds sales and expenses correctly and returns net amount', () => {
    const result = summarizeTransactions([
      { id: '1', date: '2026-09-09', type: '売上', vendorName: '券売機日計表', amount: 32500, category: '現金売上', sourceType: 'daily_report', note: '', createdAt: '2026-09-09T00:00:00.000Z' },
      { id: '2', date: '2026-09-09', type: '経費', vendorName: 'Amazon', amount: 1800, category: '消耗品費', sourceType: 'receipt', note: '', createdAt: '2026-09-09T00:00:00.000Z' },
      { id: '3', date: '2026-09-09', type: '売上', vendorName: 'カード売上', amount: 6000, category: 'カード売上', sourceType: 'daily_report', note: '', createdAt: '2026-09-09T00:00:00.000Z' },
    ]);

    expect(result.sales).toBe(38500);
    expect(result.expenses).toBe(1800);
    expect(result.net).toBe(36700);
  });
});
