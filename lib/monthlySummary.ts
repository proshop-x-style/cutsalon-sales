import { summarizeTransactions, type Transaction } from './transactions';

export type MonthlySummary = {
  month: string;
  sales: number;
  expenses: number;
  net: number;
  entries: Transaction[];
};

export function summarizeMonthlyTransactions(transactions: Transaction[], month: string): MonthlySummary {
  const monthTransactions = transactions.filter((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return monthKey === month;
  });

  const summary = summarizeTransactions(monthTransactions);

  return {
    month,
    sales: summary.sales,
    expenses: summary.expenses,
    net: summary.net,
    entries: monthTransactions,
  };
}

export function getAvailableMonths(transactions: Transaction[]): string[] {
  const uniqueMonths = new Set(
    transactions.map((transaction) => {
      const date = new Date(`${transaction.date}T00:00:00`);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }),
  );

  return [...uniqueMonths].sort().reverse();
}
