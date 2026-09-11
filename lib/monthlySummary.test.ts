import { describe, expect, it } from 'vitest';
import { getAvailableMonths, summarizeMonthlyTransactions } from './monthlySummary';
import type { Transaction } from './transactions';

describe('monthlySummary', () => {
  const transactions: Transaction[] = [
    { id: '1', date: '2026-09-09', type: '売上', vendorName: '券売機日計表', amount: 32500, category: '現金売上', sourceType: 'daily_report', note: '', createdAt: '2026-09-09T00:00:00.000Z' },
    { id: '2', date: '2026-09-10', type: '経費', vendorName: 'Amazon', amount: 1800, category: '消耗品費', sourceType: 'receipt', note: '', createdAt: '2026-09-10T00:00:00.000Z' },
    { id: '3', date: '2026-08-15', type: '売上', vendorName: '鍵売機', amount: 25000, category: '現金売上', sourceType: 'daily_report', note: '', createdAt: '2026-08-15T00:00:00.000Z' },
  ];

  it('summarizes transactions for the selected month', () => {
    const result = summarizeMonthlyTransactions(transactions, '2026-09');

    expect(result.sales).toBe(32500);
    expect(result.expenses).toBe(1800);
    expect(result.net).toBe(30700);
  });

  it('returns available months in descending order', () => {
    expect(getAvailableMonths(transactions)).toEqual(['2026-09', '2026-08']);
  });
});
