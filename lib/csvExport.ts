import type { Transaction } from './transactions';

export function transactionsToCsv(transactions: Transaction[]) {
  const headers = ['date', 'type', 'vendorName', 'productName', 'amount', 'category', 'sourceType', 'note'];

  const rows = transactions.map((transaction) => [
    transaction.date,
    transaction.type,
    transaction.vendorName,
    transaction.productName ?? '',
    String(transaction.amount),
    transaction.category,
    transaction.sourceType,
    transaction.note,
  ]);

  const escapeCsvValue = (value: string) => {
    const normalized = String(value ?? '').replace(/\r\n/g, '\n');
    return `"${normalized.replace(/"/g, '""')}"`;
  };

  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(cell)).join(','))
    .join('\n');
}
