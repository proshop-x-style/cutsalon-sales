import { describe, expect, it } from 'vitest';
import {
  isResetConfirmationPayload,
  normalizeTransactionsPayload,
  parseTransactionsBackup,
  readLastGoodBackup,
  resolveLoadedTransactions,
  serializeTransactionsBackup,
  summarizeTransactions,
  writeLastGoodBackup,
} from './transactions';

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

describe('transaction payload safety', () => {
  it('accepts a valid transaction array and rejects malformed payloads without clearing the app state', () => {
    const valid = [{
      id: '1',
      date: '2026-09-09',
      type: '売上',
      vendorName: '券売機日計表',
      amount: 32500,
      category: '現金売上',
      sourceType: 'daily_report',
      note: '大人:10,中学:2,小人:1,坊主:0',
      createdAt: '2026-09-09T00:00:00.000Z',
    }];

    expect(normalizeTransactionsPayload(valid)).toEqual(valid);
    expect(normalizeTransactionsPayload({ error: true })).toBeNull();
    expect(normalizeTransactionsPayload([])).toEqual([]);
  });

  it('does not replace a non-empty ledger with a transient empty server response', () => {
    const current = [{
      id: '1',
      date: '2026-09-09',
      type: '売上' as const,
      vendorName: '券売機日計表',
      amount: 32500,
      category: '現金売上',
      sourceType: 'daily_report' as const,
      note: '大人:10',
      createdAt: '2026-09-09T00:00:00.000Z',
    }];
    const fallback = [{
      id: '2',
      date: '2026-09-10',
      type: '売上' as const,
      vendorName: '券売機日計表',
      amount: 40000,
      category: '現金売上',
      sourceType: 'daily_report' as const,
      note: '大人:12',
      createdAt: '2026-09-10T00:00:00.000Z',
    }];

    expect(resolveLoadedTransactions(current, [])).toEqual(current);
    expect(resolveLoadedTransactions([], [], fallback)).toEqual(fallback);
    expect(resolveLoadedTransactions([], [])).toEqual([]);
  });
});

describe('backup serialization', () => {
  it('requires an explicit confirmation payload before a destructive reset is allowed', () => {
    expect(isResetConfirmationPayload({ confirmReset: true })).toBe(true);
    expect(isResetConfirmationPayload({ confirm: 'clear-all-data' })).toBe(true);
    expect(isResetConfirmationPayload({})).toBe(false);
    expect(isResetConfirmationPayload(null)).toBe(false);
  });

  it('serializes and rehydrates transaction backups without dropping valid records', () => {
    const transactions = [
      { id: '1', date: '2026-09-09', type: '売上', vendorName: '券売機日計表', amount: 32500, category: '現金売上', sourceType: 'daily_report', note: '大人:10,中学:2,小人:1,坊主:0', createdAt: '2026-09-09T00:00:00.000Z' },
      { id: '2', date: '2026-09-10', type: '経費', vendorName: 'Amazon', productName: 'ヘアケア用品', amount: 1800, category: '消耗品費', sourceType: 'manual', note: '備品', createdAt: '2026-09-10T00:00:00.000Z' },
    ] as const;

    const backupText = serializeTransactionsBackup(transactions as any);
    const parsed = parseTransactionsBackup(backupText);

    expect(parsed).toEqual(transactions);
  });

  it('rejects malformed backup payloads before restore', () => {
    expect(() => parseTransactionsBackup('{"version": 99}')).toThrow();
    expect(() => parseTransactionsBackup('[]')).not.toThrow();
  });

  it('stores and restores the last good backup for recovery after data loss', () => {
    const transactions = [{
      id: '1',
      date: '2026-09-09',
      type: '売上',
      vendorName: '券売機日計表',
      amount: 32500,
      category: '現金売上',
      sourceType: 'daily_report',
      note: '大人:10',
      createdAt: '2026-09-09T00:00:00.000Z',
    }];

    writeLastGoodBackup(transactions as any, 'last-good-backup-key');
    const restored = readLastGoodBackup('last-good-backup-key');

    expect(restored).toEqual(transactions);
  });
});
