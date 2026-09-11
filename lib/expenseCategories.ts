export const DEFAULT_EXPENSE_CATEGORIES = [
  '消耗品費',
  '美容材料費',
  '仕入原価',
  '接待交際費',
  '雑費',
  '通信費',
  '光熱費',
  '地代家賃',
  '旅費交通費',
  'その他',
] as const;

export type ExpenseCategory = (typeof DEFAULT_EXPENSE_CATEGORIES)[number];
