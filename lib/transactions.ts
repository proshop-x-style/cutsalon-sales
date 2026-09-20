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

export type TransactionBackup = {
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
};

const normalizeSourceType = (sourceType: unknown): SourceType => {
  if (sourceType === 'daily_report' || sourceType === 'receipt' || sourceType === 'card_statement' || sourceType === 'manual') {
    return sourceType;
  }
  return 'manual';
};

const normalizeTransaction = (value: unknown): Transaction => {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid transaction record');
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  const normalizedType =
    type === '売上' || type === 'sales'
      ? '売上'
      : type === '経費' || type === 'expense'
        ? '経費'
        : null;

  if (!normalizedType) {
    throw new Error('invalid transaction type');
  }

  const amount = Number(record.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid transaction amount');
  }

  const date = typeof record.date === 'string' && record.date ? record.date : '';
  const rawVendorName = typeof record.vendorName === 'string' ? record.vendorName.trim() : '';
  const vendorName = rawVendorName || (normalizedType === '売上' ? '券売機日計表' : '未分類');

  if (!date || !vendorName.trim()) {
    throw new Error('invalid transaction date or vendor');
  }

  const productName = typeof record.productName === 'string' && record.productName.trim() !== '' ? record.productName : undefined;

  return {
    id: typeof record.id === 'string' && record.id ? record.id : `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date,
    type: normalizedType,
    vendorName,
    productName,
    amount,
    category:
      typeof record.category === 'string' && record.category.trim() !== ''
        ? record.category
        : normalizedType === '売上'
          ? '現金売上'
          : '未分類',
    sourceType: normalizeSourceType(record.sourceType),
    note: typeof record.note === 'string' ? record.note : '',
    createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : new Date().toISOString(),
  };
};

export function serializeTransactionsBackup(transactions: Transaction[]): string {
  const backup: TransactionBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: transactions.map((transaction) => {
      const next: Transaction = {
        ...transaction,
        productName: transaction.productName && transaction.productName.trim() !== '' ? transaction.productName : undefined,
        note: transaction.note ?? '',
      };
      return next;
    }),
  };

  return JSON.stringify(backup, null, 2);
}

export function parseTransactionsBackup(raw: string): Transaction[] {
  const normalizedRaw = raw.replace(/^\uFEFF/, '').trim();

  if (normalizedRaw === '') {
    throw new Error('empty backup payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedRaw);
  } catch {
    throw new Error('invalid backup JSON');
  }

  if (Array.isArray(parsed)) {
    return parsed.map((value) => normalizeTransaction(value));
  }

  if (!parsed || typeof parsed !== 'object' || !('transactions' in parsed)) {
    throw new Error('backup payload is not a recognized ledger backup');
  }

  const payload = parsed as Record<string, unknown>;
  const version = payload.version;
  if (version !== undefined && Number(version) !== 1) {
    throw new Error('unsupported backup version');
  }

  const transactions = payload.transactions;
  if (!Array.isArray(transactions)) {
    throw new Error('backup data is missing transaction rows');
  }

  return transactions.map((value) => normalizeTransaction(value));
}

export function normalizeTransactionsPayload(data: unknown): Transaction[] | null {
  if (!Array.isArray(data)) {
    return null;
  }

  try {
    return data.map((value) => normalizeTransaction(value));
  } catch {
    return null;
  }
}

export function writeLastGoodBackup(transactions: Transaction[], storageKey = 'salon-ledger-last-good-backup'): string | null {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return null;
  }

  try {
    const serialized = serializeTransactionsBackup(transactions);
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      globalThis.localStorage.setItem(storageKey, serialized);
    }
    return serialized;
  } catch {
    return null;
  }
}

export function readLastGoodBackup(storageKey = 'salon-ledger-last-good-backup'): Transaction[] | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null;
  }

  const raw = globalThis.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    return parseTransactionsBackup(raw);
  } catch {
    return null;
  }
}

export function resolveLoadedTransactions(current: Transaction[], incoming: unknown, fallback: Transaction[] | null = null): Transaction[] {
  const normalized = normalizeTransactionsPayload(incoming);

  if (!normalized) {
    return current;
  }

  if (normalized.length === 0) {
    if (fallback && fallback.length > 0) {
      return fallback;
    }

    return [];
  }

  return normalized;
}

export function isResetConfirmationPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.confirmReset === true) {
    return true;
  }

  if (typeof record.confirm === 'string') {
    return ['clear-all-data', 'delete-all-data', 'reset-all-data'].includes(record.confirm);
  }

  return false;
}

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
