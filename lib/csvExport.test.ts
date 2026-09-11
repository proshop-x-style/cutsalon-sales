import { describe, expect, it } from 'vitest';
import { transactionsToCsv } from './csvExport';
import type { Transaction } from './transactions';

describe('transactionsToCsv', () => {
  it('serializes transaction rows and escapes csv values', () => {
    const transactions: Transaction[] = [
      {
        id: '1',
        date: '2026-09-09',
        type: '売上',
        vendorName: '券売機日計表',
        productName: '',
        amount: 32500,
        category: '現金売上',
        sourceType: 'daily_report',
        note: '大人:12, 中高生:5',
        createdAt: '2026-09-09T00:00:00.000Z',
      },
    ];

    const csv = transactionsToCsv(transactions);

    expect(csv).toContain('"date","type","vendorName","productName","amount","category","sourceType","note"');
    expect(csv).toContain('"2026-09-09"');
    expect(csv).toContain('"券売機日計表"');
    expect(csv).toContain('"大人:12, 中高生:5"');
  });
});
