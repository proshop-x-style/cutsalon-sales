import { summarizeTransactions, type Transaction } from './transactions';

export type YearlySummary = {
  year: string;
  sales: number;
  expenses: number;
  net: number;
  entries: Transaction[];
};

export function summarizeYearlyTransactions(transactions: Transaction[], year: string): YearlySummary {
  const yearTransactions = transactions.filter((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    return `${date.getFullYear()}` === year;
  });

  const summary = summarizeTransactions(yearTransactions);

  return {
    year,
    sales: summary.sales,
    expenses: summary.expenses,
    net: summary.net,
    entries: yearTransactions,
  };
}

export function getAvailableYears(transactions: Transaction[]): string[] {
  const uniqueYears = new Set(
    transactions.map((transaction) => new Date(`${transaction.date}T00:00:00`).getFullYear().toString()),
  );

  return [...uniqueYears].sort((a, b) => Number(b) - Number(a));
}
