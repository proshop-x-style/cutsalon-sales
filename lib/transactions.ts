export type TransactionType = '売上' | '経費';
export type SourceType = 'daily_report' | 'receipt' | 'card_statement' | 'manual';

export type Transaction = {
  id: string;
  date: string;
  type: TransactionType;
  vendorName: string;
  productName?: string;
  amount: number;
  category: string;
  sourceType: SourceType;
  note: string;
  createdAt: string;
};

export function summarizeTransactions(transactions: Transaction[]) {
  const sales = transactions
    .filter((transaction) => transaction.type === '売上')
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const expenses = transactions
    .filter((transaction) => transaction.type === '経費')
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    sales,
    expenses,
    net: sales - expenses,
  };
}
