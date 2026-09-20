'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseTransactionsCsv } from '@/lib/csvImport';
import { calculateBreakdownTotal } from '@/lib/dailyReportParser';
import { transactionsToCsv } from '@/lib/csvExport';
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/expenseCategories';
import { getAvailableMonths, summarizeMonthlyTransactions } from '@/lib/monthlySummary';
import {
  DEFAULT_SHARED_PIN,
  PIN_FAILURE_KEY,
  PIN_HASH_KEY,
  PIN_LOCKED_KEY,
  PIN_SESSION_KEY,
  clearPinSession,
  incrementPinFailureCount,
  isPinLocked,
  isPinSessionAlive,
  lockPin,
  resetPinFailureCount,
  saveSharedPin,
  storePinSession,
  verifySharedPin,
} from '@/lib/pinAuth';
import {
  normalizeTransactionsPayload,
  readLastGoodBackup,
  resolveLoadedTransactions,
  summarizeTransactions,
  type Transaction,
  writeLastGoodBackup,
} from '@/lib/transactions';
import { getAvailableYears, summarizeYearlyTransactions } from '@/lib/yearlySummary';

const TEXT_SCALE_KEY = 'salon-ledger-text-scale';
const TRANSACTION_CACHE_KEY = 'salon-ledger-transactions-cache';
const TRANSACTION_CACHE_BACKUP_KEY = 'salon-ledger-transactions-cache-backup';
const LAST_GOOD_BACKUP_KEY = 'salon-ledger-last-good-backup';
let globalLedgerTransactions: Transaction[] = [];

type TextScale = 'normal' | 'large' | 'xlarge';
type AppMenu = 'home' | 'sales' | 'expenses' | 'analysis' | 'submit' | 'settings';

type TransactionForm = {
  date: string;
  type: Transaction['type'];
  vendorName: string;
  productName: string;
  amount: string;
  category: string;
  note: string;
};

type SubmissionIssue = {
  transaction: Transaction;
  reasons: string[];
  fixHints: string[];
};

type DeletedTransactionSnapshot = {
  transaction: Transaction;
  index: number;
};

type TaxSharePayload = {
  version: number;
  issuedAt: string;
  year: string;
  annualSummary: {
    sales: number;
    expenses: number;
    net: number;
    count: number;
  };
  monthlyRows: Array<{
    month: string;
    sales: number;
    expenses: number;
    net: number;
    count: number;
  }>;
  expenseBreakdown: Array<{
    category: string;
    amount: number;
    count: number;
    ratio: number;
  }>;
  transactions: Array<{
    date: string;
    type: Transaction['type'];
    vendorName: string;
    productName: string;
    amount: number;
    category: string;
    note: string;
    sourceType: Transaction['sourceType'];
  }>;
};

type CompactTaxSharePayload = {
  v: 2;
  i: number;
  y: string;
  a: [number, number, number, number];
  m: Array<[string, number, number, number, number]>;
  e: Array<[string, number, number, number]>;
  t: Array<[
    string,
    's' | 'e',
    string,
    string,
    number,
    string,
    string,
    'd' | 'r' | 'c' | 'm',
  ]>;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const toLocalIsoDate = (date: Date) => {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};

const toCount = (raw: string) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const encodeBase64Url = (raw: string) => {
  if (typeof window === 'undefined') {
    return '';
  }
  const utf8 = encodeURIComponent(raw).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const toCompactTaxSharePayload = (
  year: string,
  issuedAt: string,
  annualSummary: { sales: number; expenses: number; net: number; count: number },
  monthlyRows: Array<{ month: string; sales: number; expenses: number; net: number; count: number }>,
  expenseBreakdown: Array<{ category: string; amount: number; count: number; ratio: number }>,
  transactions: Array<{
    date: string;
    type: Transaction['type'];
    vendorName: string;
    productName: string;
    amount: number;
    category: string;
    note: string;
    sourceType: Transaction['sourceType'];
  }>,
): CompactTaxSharePayload => ({
  v: 2,
  i: Date.parse(issuedAt),
  y: year,
  a: [annualSummary.sales, annualSummary.expenses, annualSummary.net, annualSummary.count],
  m: monthlyRows.map((row) => [row.month, row.sales, row.expenses, row.net, row.count]),
  e: expenseBreakdown.map((item) => [item.category, item.amount, item.ratio, item.count]),
  t: transactions.map((transaction) => [
    transaction.date,
    transaction.type === '売上' ? 's' : 'e',
    transaction.vendorName,
    transaction.productName ?? '',
    transaction.amount,
    transaction.category,
    transaction.note ?? '',
    transaction.sourceType === 'daily_report'
      ? 'd'
      : transaction.sourceType === 'receipt'
        ? 'r'
        : transaction.sourceType === 'card_statement'
          ? 'c'
          : 'm',
  ]),
});

const getMenuHref = (menu: AppMenu) => {
  if (menu === 'home') return '/';
  return `/${menu}`;
};

type SalesBreakdown = {
  adult: string;
  junior: string;
  child: string;
  monk: string;
  fringe: string;
  selfShampoo: string;
  styleChange: string;
  adultSelfShampoo: string;
};

const emptySalesBreakdown: SalesBreakdown = {
  adult: '',
  junior: '',
  child: '',
  monk: '',
  fringe: '',
  selfShampoo: '',
  styleChange: '',
  adultSelfShampoo: '',
};

const extraMenuUnitPrices = {
  fringe: 500,
  selfShampoo: 200,
  styleChange: 2300,
  adultSelfShampoo: 2000,
};

const calculateExtraMenuTotal = (breakdown: SalesBreakdown) => (
  toCount(breakdown.fringe) * extraMenuUnitPrices.fringe
  + toCount(breakdown.selfShampoo) * extraMenuUnitPrices.selfShampoo
  + toCount(breakdown.styleChange) * extraMenuUnitPrices.styleChange
  + toCount(breakdown.adultSelfShampoo) * extraMenuUnitPrices.adultSelfShampoo
);

const formatSalesBreakdownNote = (breakdown: SalesBreakdown) => (
  `大人:${toCount(breakdown.adult)},中学:${toCount(breakdown.junior)},小人:${toCount(breakdown.child)},坊主:${toCount(breakdown.monk)},前髪カット:${toCount(breakdown.fringe)},セルフシャンプー:${toCount(breakdown.selfShampoo)},スタイルチェンジ:${toCount(breakdown.styleChange)},大人セルフ:${toCount(breakdown.adultSelfShampoo)}`
);

const parseSalesBreakdownNote = (note: string): SalesBreakdown => {
  if (!note) {
    return { ...emptySalesBreakdown };
  }

  const pairs = note.split(',').map((entry) => entry.trim());
  const read = (label: string) => {
    const match = pairs.find((entry) => entry.startsWith(`${label}:`));
    if (!match) {
      return '';
    }
    const value = Number(match.split(':')[1] ?? '0');
    return Number.isFinite(value) && value > 0 ? String(value) : '';
  };

  return {
    adult: read('大人'),
    junior: read('中学'),
    child: read('小人'),
    monk: read('坊主'),
    fringe: read('前髪カット'),
    selfShampoo: read('セルフシャンプー'),
    styleChange: read('スタイルチェンジ'),
    adultSelfShampoo: read('大人セルフ'),
  };
};

const expenseCategories = [...DEFAULT_EXPENSE_CATEGORIES];
const quickExpenseCategories = DEFAULT_EXPENSE_CATEGORIES.slice(0, 6);
const issueSectionId = 'submission-issues';
const transactionFormId = 'transaction-form';

const inputClassName =
  'w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg leading-7 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200';

const dateInputClassName =
  'block w-full max-w-full min-w-0 box-border appearance-none rounded-xl border border-stone-300 bg-white px-4 py-3 text-base leading-6 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200';

const primaryButtonClassName =
  'pressable w-full rounded-xl bg-cyan-700 px-4 py-3 text-base font-bold text-white shadow-sm hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-cyan-300';

type LedgerPageProps = {
  initialMenu: AppMenu;
};

export function LedgerPage({ initialMenu }: LedgerPageProps) {
  const currentDate = toLocalIsoDate(new Date());
  const currentMonth = currentDate.slice(0, 7);
  const currentYear = currentDate.slice(0, 4);

  const initialForm: TransactionForm = {
    date: currentDate,
    type: '売上',
    vendorName: '券売機日計表',
    productName: '',
    amount: '',
    category: '現金売上',
    note: '',
  };

  const [transactions, setTransactions] = useState<Transaction[]>(globalLedgerTransactions);

  const persistTransactionCache = (nextTransactions: Transaction[]) => {
    if (nextTransactions.length === 0) {
      globalLedgerTransactions = [];
      window.localStorage.removeItem(TRANSACTION_CACHE_KEY);
      window.localStorage.removeItem(TRANSACTION_CACHE_BACKUP_KEY);
      window.localStorage.removeItem(LAST_GOOD_BACKUP_KEY);
      return;
    }

    globalLedgerTransactions = nextTransactions;

    try {
      const rawCurrent = window.localStorage.getItem(TRANSACTION_CACHE_KEY);
      const parsedCurrent = rawCurrent ? normalizeTransactionsPayload(JSON.parse(rawCurrent)) : null;
      const hasExistingData = !!parsedCurrent && parsedCurrent.length > 0;

      if (nextTransactions.length === 0 && hasExistingData) {
        const rawBackup = window.localStorage.getItem(TRANSACTION_CACHE_BACKUP_KEY);
        if (rawBackup) {
          window.localStorage.setItem(TRANSACTION_CACHE_KEY, rawBackup);
        }
        return;
      }

      const serialized = JSON.stringify(nextTransactions);
      window.localStorage.setItem(TRANSACTION_CACHE_KEY, serialized);

      if (nextTransactions.length > 0) {
        window.localStorage.setItem(TRANSACTION_CACHE_BACKUP_KEY, serialized);
        writeLastGoodBackup(nextTransactions, LAST_GOOD_BACKUP_KEY);
      }
    } catch {
      // ignore storage quota issues; data remains in the database
    }
  };

  const hydrateTransactionsFromCache = () => {
    try {
      if (globalLedgerTransactions.length > 0) {
        setTransactions(globalLedgerTransactions);
        return globalLedgerTransactions;
      }

      const rawCache = window.localStorage.getItem(TRANSACTION_CACHE_KEY);
      const rawBackup = window.localStorage.getItem(TRANSACTION_CACHE_BACKUP_KEY);
      const lastGoodTransactions = readLastGoodBackup(LAST_GOOD_BACKUP_KEY);

      const tryRead = (raw: string | null) => {
        if (!raw) {
          return null;
        }

        try {
          const cachedTransactions = normalizeTransactionsPayload(JSON.parse(raw));
          if (cachedTransactions && cachedTransactions.length > 0) {
            return cachedTransactions;
          }
        } catch {
          // ignore malformed cache entries and continue to the backup value
        }

        return null;
      };

      const primaryTransactions = tryRead(rawCache);
      if (primaryTransactions) {
        globalLedgerTransactions = primaryTransactions;
        setTransactions(primaryTransactions);
        return primaryTransactions;
      }

      const backupTransactions = tryRead(rawBackup) ?? lastGoodTransactions;
      if (backupTransactions) {
        globalLedgerTransactions = backupTransactions;
        setTransactions(backupTransactions);
        persistTransactionCache(backupTransactions);
        return backupTransactions;
      }
    } catch {
      // fallback to server fetch below
    }

    return null;
  };

  const [form, setForm] = useState<TransactionForm>(initialForm);
  const [activeMenu, setActiveMenu] = useState<AppMenu>(initialMenu);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [shareYear, setShareYear] = useState(currentYear);
  const [analysisMetricFilter, setAnalysisMetricFilter] = useState<'all' | 'sales' | 'profit' | 'expenses'>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<TransactionForm | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<DeletedTransactionSnapshot | null>(null);
  const [focusedIssueTransactionId, setFocusedIssueTransactionId] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [taxShareUrl, setTaxShareUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saveResultMessage, setSaveResultMessage] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterType, setFilterType] = useState<'all' | Transaction['type']>('all');
  const [filterUncategorizedOnly, setFilterUncategorizedOnly] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [textScale, setTextScale] = useState<TextScale>('large');
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [isPinUnlocked, setIsPinUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [sharedPinSetting, setSharedPinSetting] = useState('1214');
  const [dailyBreakdown, setDailyBreakdown] = useState<SalesBreakdown>({ ...emptySalesBreakdown });
  const deleteUndoTimerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    setTransactions(globalLedgerTransactions);
    setIsPinUnlocked(isPinSessionAlive());
  }, []);

  useEffect(() => {
    globalLedgerTransactions = transactions;
  }, [transactions]);

  const handlePinSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!pinInput.trim()) {
      setPinError('PINを入力してください。');
      return;
    }

    if (isPinLocked()) {
      setPinError('PINの入力回数が上限に達したため、8時間後に再試行できます。');
      return;
    }

    let isValid = false;
    try {
      isValid = await verifySharedPin(pinInput);
    } catch {
      setPinError('PIN認証に失敗しました。「PINを1214にリセット」を押して再試行してください。');
      return;
    }

    if (!isValid) {
      const failureCount = incrementPinFailureCount();
      if (failureCount >= 10) {
        lockPin();
        setPinError('PIN入力回数が上限に達したため、8時間ロックされました。');
        setPinInput('');
        return;
      }

      setPinError(`PINが違います。残り${10 - failureCount}回まで入力できます。`);
      setPinInput('');
      return;
    }

    resetPinFailureCount();
    storePinSession();
    setIsPinUnlocked(true);
    setPinError('');
    setPinInput('');
    setStatusMessage('PIN認証でアクセスしました。');
  };

  const handlePinSave = async () => {
    const trimmed = sharedPinSetting.trim();
    if (!trimmed || trimmed.length < 4) {
      setStatusMessage('共有PINは4桁以上で設定してください。');
      return;
    }

    await saveSharedPin(trimmed);
    setStatusMessage('共有PINを更新しました。');
    setSharedPinSetting(trimmed);
    clearPinSession();
    setIsPinUnlocked(false);
  };

  const handlePinRecoveryToDefault = () => {
    window.localStorage.removeItem(PIN_HASH_KEY);
    window.localStorage.removeItem(PIN_LOCKED_KEY);
    window.localStorage.removeItem(PIN_FAILURE_KEY);
    window.localStorage.removeItem(PIN_SESSION_KEY);
    setSharedPinSetting(DEFAULT_SHARED_PIN);
    setPinInput('');
    setPinError('PIN状態をリセットしました。デフォルトPIN 1214でログインしてください。');
  };

  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    let isActive = true;

    const loadTransactions = async () => {
      const cachedTransactions = hydrateTransactionsFromCache();
      if (!isActive || requestId !== loadRequestRef.current) {
        return;
      }

      if (cachedTransactions) {
        setStatusMessage('保存済みデータを復元しました。');
      }

      try {
        const response = await fetch('/api/transactions');
        if (!response.ok) {
          throw new Error('request failed');
        }

        const data = await response.json();

        if (!isActive || requestId !== loadRequestRef.current) {
          return;
        }

        setTransactions((current) => {
          const fallbackTransactions = cachedTransactions ?? globalLedgerTransactions ?? current;
          const nextTransactions = resolveLoadedTransactions(current, data, fallbackTransactions);
          if (nextTransactions !== current) {
            persistTransactionCache(nextTransactions);
          }
          return nextTransactions;
        });
        return;
      } catch {
        if (!isActive || requestId !== loadRequestRef.current) {
          return;
        }

        if (cachedTransactions) {
          setStatusMessage('サーバー応答が失敗したため、保存済みデータを復元しました。');
          return;
        }

        setStatusMessage('データの再読込に失敗しました。既存データは保持されています。');
      }
    };

    loadTransactions();

    return () => {
      isActive = false;
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const savedScale = window.localStorage.getItem(TEXT_SCALE_KEY);
    if (savedScale === 'normal' || savedScale === 'large' || savedScale === 'xlarge') {
      setTextScale(savedScale);
    }
  }, []);

  useEffect(() => {
    setActiveMenu(initialMenu);
  }, [initialMenu]);

  useEffect(() => {
    if (activeMenu === 'sales') {
      setForm((current) => ({
        ...current,
        type: '売上',
        category: '現金売上',
        productName: '',
      }));
      return;
    }

    if (activeMenu === 'expenses') {
      setForm((current) => ({
        ...current,
        type: '経費',
        vendorName: current.type === '経費' ? current.vendorName : '',
        productName: current.type === '経費' ? current.productName : '',
        amount: current.type === '経費' ? current.amount : '',
        note: current.type === '経費' ? current.note : '',
        category: current.type === '経費' ? current.category : '',
      }));
    }
  }, [activeMenu]);

  useEffect(() => {
    window.localStorage.setItem(TEXT_SCALE_KEY, textScale);
  }, [textScale]);

  useEffect(() => {
    const savedShareYear = window.localStorage.getItem('salon-ledger-share-year');
    if (savedShareYear) {
      setShareYear(savedShareYear);
    }

    const savedNotifications = window.localStorage.getItem('salon-ledger-notifications');
    setNotificationEnabled(savedNotifications === 'on');

    const savedPin = window.localStorage.getItem('salon-ledger-shared-pin-hash');
    if (savedPin) {
      setSharedPinSetting('1214');
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('salon-ledger-share-year', shareYear);
  }, [shareYear]);

  useEffect(() => {
    window.localStorage.setItem('salon-ledger-notifications', notificationEnabled ? 'on' : 'off');
  }, [notificationEnabled]);

  useEffect(() => {
    document.documentElement.dataset.ledgerReactReady = '1';
    return () => {
      delete document.documentElement.dataset.ledgerReactReady;
    };
  }, []);

  useEffect(() => () => {
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
    }
  }, []);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const profitRate = useMemo(() => (summary.sales > 0 ? (summary.net / summary.sales) * 100 : 0), [summary]);
  const months = useMemo(() => getAvailableMonths(transactions), [transactions]);
  const years = useMemo(() => getAvailableYears(transactions), [transactions]);
  const currentMonthSummary = useMemo(
    () => summarizeMonthlyTransactions(transactions, currentMonth),
    [transactions, currentMonth],
  );
  const currentYearSummary = useMemo(
    () => summarizeYearlyTransactions(transactions, currentYear),
    [transactions, currentYear],
  );
  const previousMonth = useMemo(() => {
    const [yearPart, monthPart] = currentMonth.split('-');
    const nextMonthIndex = Number(monthPart) - 1;
    if (nextMonthIndex > 0) {
      return `${yearPart}-${String(nextMonthIndex).padStart(2, '0')}`;
    }

    return `${Number(yearPart) - 1}-12`;
  }, [currentMonth]);
  const previousMonthSummary = useMemo(
    () => summarizeMonthlyTransactions(transactions, previousMonth),
    [transactions, previousMonth],
  );
  const currentYearToDateSummary = useMemo(
    () => summarizeMonthlyTransactions(transactions, currentMonth).entries.length > 0
      ? Array.from({ length: Number(currentMonth.slice(5, 7)) }, (_, index) => summarizeMonthlyTransactions(transactions, `${currentYear}-${String(index + 1).padStart(2, '0')}`))
          .reduce((total, monthData) => ({
            sales: total.sales + monthData.sales,
            expenses: total.expenses + monthData.expenses,
            net: total.net + monthData.net,
            entries: [],
          }), { sales: 0, expenses: 0, net: 0, entries: [] as Transaction[] })
      : summarizeYearlyTransactions(transactions, currentYear),
    [transactions, currentYear, currentMonth],
  );
  const previousYearToDateSummary = useMemo(
    () => Array.from({ length: Number(currentMonth.slice(5, 7)) }, (_, index) => summarizeMonthlyTransactions(transactions, `${String(Number(currentYear) - 1)}-${String(index + 1).padStart(2, '0')}`))
      .reduce((total, monthData) => ({
        sales: total.sales + monthData.sales,
        expenses: total.expenses + monthData.expenses,
        net: total.net + monthData.net,
      }), { sales: 0, expenses: 0, net: 0 }),
    [transactions, currentMonth, currentYear],
  );
  const currentMonthProfitRate = currentMonthSummary.sales > 0 ? (currentMonthSummary.net / currentMonthSummary.sales) * 100 : 0;
  const currentYearProfitRate = currentYearSummary.sales > 0 ? (currentYearSummary.net / currentYearSummary.sales) * 100 : 0;
  const monthSummary = useMemo(
    () => summarizeMonthlyTransactions(transactions, selectedMonth || months[0] || '2026-09'),
    [transactions, selectedMonth, months],
  );
  const yearSummary = useMemo(
    () => summarizeYearlyTransactions(transactions, selectedYear || years[0] || '2026'),
    [transactions, selectedYear, years],
  );
  const monthExpenseBreakdown = useMemo(() => {
    const entries = monthSummary.entries.filter((transaction) => transaction.type === '経費');
    const expenseTotal = entries.reduce((sum, transaction) => sum + transaction.amount, 0);
    const grouped = new Map<string, { amount: number; count: number }>();

    entries.forEach((transaction) => {
      const category = transaction.category || '未分類';
      const current = grouped.get(category) ?? { amount: 0, count: 0 };
      grouped.set(category, {
        amount: current.amount + transaction.amount,
        count: current.count + 1,
      });
    });

    return Array.from(grouped.entries())
      .map(([category, values]) => ({
        category,
        amount: values.amount,
        count: values.count,
        ratio: expenseTotal > 0 ? values.amount / expenseTotal : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [monthSummary.entries]);
  const ledgerMonth = selectedMonth || months[0] || currentMonth;
  const ledgerTransactions = useMemo(
    () => transactions
      .filter((transaction) => transaction.date.startsWith(`${ledgerMonth}-`))
      .sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [transactions, ledgerMonth],
  );
  const shareYearTransactions = useMemo(
    () => transactions
      .filter((transaction) => transaction.date.startsWith(`${shareYear}-`))
      .sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [transactions, shareYear],
  );
  const dailyLedgerRows = useMemo(() => {
    const rows = new Map<string, { sales: number; expenses: number; count: number }>();

    ledgerTransactions
      .forEach((transaction) => {
        const current = rows.get(transaction.date) ?? { sales: 0, expenses: 0, count: 0 };

        rows.set(transaction.date, {
          sales: current.sales + (transaction.type === '売上' ? transaction.amount : 0),
          expenses: current.expenses + (transaction.type === '経費' ? transaction.amount : 0),
          count: current.count + 1,
        });
      });

    return Array.from(rows.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, summary]) => ({
        date,
        sales: summary.sales,
        expenses: summary.expenses,
        net: summary.sales - summary.expenses,
        count: summary.count,
      }));
  }, [ledgerTransactions]);
  const shareYearSummary = useMemo(
    () => summarizeYearlyTransactions(transactions, shareYear),
    [transactions, shareYear],
  );
  const shareYearMonthlyRows = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${shareYear}-${String(index + 1).padStart(2, '0')}`;
      const monthData = summarizeMonthlyTransactions(transactions, month);
      return {
        month,
        sales: monthData.sales,
        expenses: monthData.expenses,
        net: monthData.net,
        count: monthData.entries.length,
      };
    }).filter((row) => row.count > 0);
  }, [transactions, shareYear]);
  const shareYearExpenseBreakdown = useMemo(() => {
    const entries = shareYearTransactions.filter((transaction) => transaction.type === '経費');
    const expenseTotal = entries.reduce((sum, transaction) => sum + transaction.amount, 0);
    const grouped = new Map<string, { amount: number; count: number }>();

    entries.forEach((transaction) => {
      const category = transaction.category || '未分類';
      const current = grouped.get(category) ?? { amount: 0, count: 0 };
      grouped.set(category, {
        amount: current.amount + transaction.amount,
        count: current.count + 1,
      });
    });

    return Array.from(grouped.entries())
      .map(([category, values]) => ({
        category,
        amount: values.amount,
        count: values.count,
        ratio: expenseTotal > 0 ? values.amount / expenseTotal : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12);
  }, [shareYearTransactions]);
  const preflightChecks = useMemo(() => {
    const expensesInYear = shareYearTransactions.filter((transaction) => transaction.type === '経費');
    const uncategorizedExpenses = expensesInYear.filter((transaction) => {
      const category = transaction.category.trim();
      return !category || category === '未分類';
    });
    const salesAutoNormalizedCount = shareYearTransactions.filter((transaction) =>
      transaction.type === '売上' && transaction.category.trim() !== '現金売上',
    ).length;

    return {
      expenseCount: expensesInYear.length,
      uncategorizedCount: uncategorizedExpenses.length,
      uncategorizedAmount: uncategorizedExpenses.reduce((sum, transaction) => sum + transaction.amount, 0),
      salesAutoNormalizedCount,
    };
  }, [shareYearTransactions]);
  const submissionIssues = useMemo<SubmissionIssue[]>(() => {
    const issues: SubmissionIssue[] = [];

    shareYearTransactions.forEach((transaction) => {
      const reasons: string[] = [];
      const fixHints: string[] = [];
      const category = transaction.category.trim();
      const vendorName = transaction.vendorName.trim();

      if (!transaction.date) {
        reasons.push('日付が未入力です。');
        fixHints.push('日付を入力してください。');
      }

      if (!vendorName) {
        reasons.push('取引先が未入力です。');
        fixHints.push('取引先を入力してください。');
      }

      if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
        reasons.push('金額が不正です（1円以上が必要）。');
        fixHints.push('金額を1円以上で入力してください。');
      }

      if (transaction.type === '経費' && (!category || category === '未分類')) {
        reasons.push('経費の仕分けが未分類です。');
        fixHints.push('仕分けで適切な費目を選択してください。');
      }

      if (reasons.length === 0) {
        return;
      }

      issues.push({
        transaction,
        reasons,
        fixHints,
      });
    });

    return issues.sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) {
        return b.reasons.length - a.reasons.length;
      }
      return b.transaction.amount - a.transaction.amount;
    });
  }, [shareYearTransactions]);
  const hasBlockingIssue = submissionIssues.length > 0;
  const filteredTransactions = useMemo(() => {
    const normalizedKeyword = filterKeyword.trim().toLowerCase();

    return transactions.filter((transaction) => {
      if (filterType !== 'all' && transaction.type !== filterType) {
        return false;
      }

      if (filterUncategorizedOnly) {
        const category = transaction.category.trim();
        if (transaction.type !== '経費' || (category && category !== '未分類')) {
          return false;
        }
      }

      if (filterDateFrom && transaction.date < filterDateFrom) {
        return false;
      }

      if (filterDateTo && transaction.date > filterDateTo) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      const searchable = `${transaction.vendorName} ${transaction.category} ${transaction.note}`.toLowerCase();
      return searchable.includes(normalizedKeyword);
    });
  }, [transactions, filterKeyword, filterType, filterUncategorizedOnly, filterDateFrom, filterDateTo]);
  const visibleTransactions = useMemo(() => filteredTransactions.slice(0, 120), [filteredTransactions]);
  const pageVisibleTransactions = useMemo(() => {
    if (activeMenu === 'sales') {
      return visibleTransactions.filter((transaction) => transaction.type === '売上');
    }

    if (activeMenu === 'expenses') {
      return visibleTransactions.filter((transaction) => transaction.type === '経費');
    }

    return visibleTransactions;
  }, [activeMenu, visibleTransactions]);
  const vendorSuggestions = useMemo(() => {
    const stats = new Map<string, { count: number; lastCreatedAt: string }>();

    transactions
      .filter((transaction) => transaction.type === form.type)
      .forEach((transaction) => {
        const name = transaction.vendorName.trim();
        if (!name) {
          return;
        }

        const current = stats.get(name);
        if (!current) {
          stats.set(name, { count: 1, lastCreatedAt: transaction.createdAt });
          return;
        }

        stats.set(name, {
          count: current.count + 1,
          lastCreatedAt: current.lastCreatedAt > transaction.createdAt ? current.lastCreatedAt : transaction.createdAt,
        });
      });

    const ranked = Array.from(stats.entries())
      .sort((a, b) => {
        if (a[1].count !== b[1].count) {
          return b[1].count - a[1].count;
        }

        if (a[1].lastCreatedAt !== b[1].lastCreatedAt) {
          return b[1].lastCreatedAt.localeCompare(a[1].lastCreatedAt);
        }

        return a[0].localeCompare(b[0], 'ja');
      })
      .map(([name]) => name);

    return ranked.slice(0, 20);
  }, [transactions, form.type]);
  const expenseProductSuggestions = useMemo(() => {
    const stats = new Map<string, { count: number; lastCreatedAt: string }>();

    transactions
      .filter((transaction) => transaction.type === '経費')
      .forEach((transaction) => {
        const name = (transaction.productName ?? '').trim();
        if (!name) {
          return;
        }

        const current = stats.get(name);
        if (!current) {
          stats.set(name, { count: 1, lastCreatedAt: transaction.createdAt });
          return;
        }

        stats.set(name, {
          count: current.count + 1,
          lastCreatedAt: current.lastCreatedAt > transaction.createdAt ? current.lastCreatedAt : transaction.createdAt,
        });
      });

    const ranked = Array.from(stats.entries())
      .sort((a, b) => {
        if (a[1].count !== b[1].count) {
          return b[1].count - a[1].count;
        }

        if (a[1].lastCreatedAt !== b[1].lastCreatedAt) {
          return b[1].lastCreatedAt.localeCompare(a[1].lastCreatedAt);
        }

        return a[0].localeCompare(b[0], 'ja');
      })
      .map(([name]) => name);

    return ranked.slice(0, 20);
  }, [transactions]);
  const parsedAmount = Number(form.amount);
  const amountError = form.amount !== '' && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    ? '金額は1円以上で入力してください。'
    : '';
  const amountPreview = !amountError && Number.isFinite(parsedAmount) && parsedAmount > 0
    ? `¥${parsedAmount.toLocaleString()}`
    : '¥0';
  const computedAmountPreview = useMemo(
    () => calculateBreakdownTotal({
      adult: { count: toCount(dailyBreakdown.adult), unitPrice: 1800, amount: 0 },
      junior: { count: toCount(dailyBreakdown.junior), unitPrice: 1500, amount: 0 },
      child: { count: toCount(dailyBreakdown.child), unitPrice: 1200, amount: 0 },
      monk: { count: toCount(dailyBreakdown.monk), unitPrice: 1500, amount: 0 },
    }) + calculateExtraMenuTotal(dailyBreakdown),
    [dailyBreakdown],
  );
  const changedFields = useMemo(() => {
    const baseline = editingSnapshot;
    if (!baseline) {
      return {
        date: false,
        type: false,
        vendorName: false,
        amount: false,
        category: false,
        productName: false,
        note: false,
      };
    }

    return {
      date: form.date !== baseline.date,
      type: form.type !== baseline.type,
      vendorName: form.vendorName.trim() !== baseline.vendorName.trim(),
      amount: Number(form.amount || 0) !== Number(baseline.amount || 0),
      category: form.category !== baseline.category,
      productName: form.productName.trim() !== baseline.productName.trim(),
      note: form.note.trim() !== baseline.note.trim(),
    };
  }, [form, editingSnapshot]);
  const changedFieldCount = useMemo(
    () => Object.values(changedFields).filter(Boolean).length,
    [changedFields],
  );

  const previousYear = String(Number(selectedYear) - 1);

  const monthlySalesProfitComparisonRows = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const monthNo = String(index + 1).padStart(2, '0');
      const currentMonthKey = `${selectedYear}-${monthNo}`;
      const previousMonthKey = `${previousYear}-${monthNo}`;
      const current = summarizeMonthlyTransactions(transactions, currentMonthKey);
      const previous = summarizeMonthlyTransactions(transactions, previousMonthKey);
      const salesRatio = previous.sales > 0 ? (current.sales / previous.sales) * 100 : null;
      const profitRatio = previous.net !== 0 ? (current.net / previous.net) * 100 : null;

      return {
        monthLabel: `${index + 1}月`,
        currentSales: current.sales,
        previousSales: previous.sales,
        salesRatio,
        salesDiff: current.sales - previous.sales,
        currentProfit: current.net,
        previousProfit: previous.net,
        profitRatio,
        profitDiff: current.net - previous.net,
      };
    }),
    [transactions, selectedYear, previousYear],
  );

  const analysisYearMonthlyRows = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const monthNo = String(index + 1).padStart(2, '0');
      const monthKey = `${selectedYear}-${monthNo}`;
      const monthData = summarizeMonthlyTransactions(transactions, monthKey);
      return {
        monthLabel: `${index + 1}月`,
        sales: monthData.sales,
        expenses: monthData.expenses,
        profit: monthData.net,
      };
    }),
    [transactions, selectedYear],
  );

  const maxAnalysisBarValue = useMemo(() => {
    const values = analysisYearMonthlyRows.flatMap((row) => {
      if (analysisMetricFilter === 'sales') {
        return [row.sales];
      }
      if (analysisMetricFilter === 'profit') {
        return [Math.abs(row.profit)];
      }
      if (analysisMetricFilter === 'expenses') {
        return [row.expenses];
      }
      return [row.sales, row.expenses, Math.abs(row.profit)];
    });

    return Math.max(1, ...values);
  }, [analysisYearMonthlyRows, analysisMetricFilter]);

  const previousYearSummary = useMemo(
    () => summarizeYearlyTransactions(transactions, previousYear),
    [transactions, previousYear],
  );

  const yearlyComparisonRows = useMemo(
    () => [
      {
        label: '売上',
        current: yearSummary.sales,
        previous: previousYearSummary.sales,
      },
      {
        label: '利益',
        current: yearSummary.net,
        previous: previousYearSummary.net,
      },
    ],
    [yearSummary.sales, yearSummary.net, previousYearSummary.sales, previousYearSummary.net],
  );

  const hasPreviousYearData = useMemo(
    () => transactions.some((transaction) => transaction.date.startsWith(`${previousYear}-`) && transaction.type === '売上'),
    [transactions, previousYear],
  );
  const selectedMonthSalesTransactions = useMemo(
    () => ledgerTransactions.filter((transaction) => transaction.type === '売上'),
    [ledgerTransactions],
  );

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timer = window.setTimeout(() => setStatusMessage(''), 2200);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!saveResultMessage) {
      return;
    }

    const timer = window.setTimeout(() => setSaveResultMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [saveResultMessage]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setInstallPromptEvent(promptEvent);
      setCanInstall(true);
    };

    const onAppInstalled = () => {
      setCanInstall(false);
      setInstallPromptEvent(null);
      setStatusMessage('この端末にアプリとしてインストールされました。');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const updateDailyBreakdownField = (field: keyof SalesBreakdown, rawValue: string) => {
    setDailyBreakdown((current) => ({
      ...current,
      [field]: rawValue,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();


    if (isSaving) {
      return;
    }
    const amount = form.type === '売上'
      ? computedAmountPreview
      : Number(form.amount);

    const requiresVendorName = form.type === '経費';
    if (!form.date || (requiresVendorName && !form.vendorName.trim()) || !Number.isFinite(amount) || amount <= 0) {
      setStatusMessage('必須項目と金額を確認してください。');
      return;
    }

    setSaveResultMessage('');
    setIsSaving(true);
    setStatusMessage(editingTransactionId ? '更新中...' : '保存中...');

    const payload = {
      date: form.date,
      type: form.type,
      vendorName: form.type === '売上' ? '券売機日計表' : form.vendorName,
      productName: form.productName || (form.type === '経費' ? form.vendorName : ''),
      amount,
      category: form.type === '売上' ? '現金売上' : form.category,
      sourceType: 'manual',
      note: form.type === '売上' ? formatSalesBreakdownNote(dailyBreakdown) : form.note,
    };

    try {
      const endpoint = editingTransactionId
        ? `/api/transactions/${editingTransactionId}`
        : '/api/transactions';
      const response = await fetch(endpoint, {
        method: editingTransactionId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const saved = (await response.json()) as Transaction;
        let nextTransactions: Transaction[];
        if (editingTransactionId) {
          nextTransactions = transactions.map((transaction) => (transaction.id === editingTransactionId ? saved : transaction));
        } else {
          nextTransactions = [saved, ...transactions];
        }
        setTransactions(nextTransactions);
        persistTransactionCache(nextTransactions);
      } else {
        const next: Transaction = {
          id: editingTransactionId ?? `txn-${Date.now()}`,
          ...payload,
          sourceType: payload.sourceType as Transaction['sourceType'],
          createdAt: new Date().toISOString(),
        };
        let nextTransactions: Transaction[];
        if (editingTransactionId) {
          nextTransactions = transactions.map((transaction) => (transaction.id === editingTransactionId ? next : transaction));
        } else {
          nextTransactions = [next, ...transactions];
        }
        setTransactions(nextTransactions);
        persistTransactionCache(nextTransactions);
      }
    } catch {
      const next: Transaction = {
        id: editingTransactionId ?? `txn-${Date.now()}`,
        ...payload,
        sourceType: payload.sourceType as Transaction['sourceType'],
        createdAt: new Date().toISOString(),
      };
      let nextTransactions: Transaction[];
      if (editingTransactionId) {
        nextTransactions = transactions.map((transaction) => (transaction.id === editingTransactionId ? next : transaction));
      } else {
        nextTransactions = [next, ...transactions];
      }
      setTransactions(nextTransactions);
      persistTransactionCache(nextTransactions);
    } finally {
      setIsSaving(false);
    }

    setForm({
      ...initialForm,
      date: form.date,
      type: form.type,
      category: form.type === '売上' ? '現金売上' : '',
      vendorName: form.type === '売上' ? '券売機日計表' : '',
      productName: '',
    });

    setDailyBreakdown({ ...emptySalesBreakdown });
    setSelectedMonth(form.date.slice(0, 7));
    setEditingTransactionId(null);
    setEditingSnapshot(null);
    setStatusMessage(editingTransactionId ? '更新が完了しました。' : '保存が完了しました。');
    setSaveResultMessage(editingTransactionId ? '更新できました。' : '保存できました。');

    if (window.matchMedia('(max-width: 767px)').matches) {
      setActiveMenu(form.type === '売上' ? 'sales' : 'expenses');
    }
  };

  const cards = [
    {
      label: '今月の売上',
      value: `¥${currentMonthSummary.sales.toLocaleString()}`,
      tone: 'text-emerald-700',
      subText: `昨年同月: ¥${previousMonthSummary.sales.toLocaleString()}`,
    },
    { label: '今月の利益額', value: `¥${currentMonthSummary.net.toLocaleString()}`, tone: 'text-cyan-700' },
    {
      label: '今年の売上',
      value: `¥${currentYearToDateSummary.sales.toLocaleString()}`,
      tone: 'text-emerald-700',
      subText: `昨年同時期累計: ¥${previousYearToDateSummary.sales.toLocaleString()}`,
    },
    { label: '今年の利益額', value: `¥${currentYearSummary.net.toLocaleString()}`, tone: 'text-cyan-700' },
  ];

  const handleCsvExport = () => {
    if (transactions.length === 0) {
      setStatusMessage('出力できる取引がまだありません。');
      return;
    }

    const csv = transactionsToCsv(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `salon-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatusMessage('CSVをダウンロードしました。');
  };

  const restoreTransactionsFromCsvText = async (csvText: string) => {
    const nextTransactions = parseTransactionsCsv(csvText);

    try {
      const deleteResponse = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmReset: true }),
      });

      if (!deleteResponse.ok) {
        throw new Error('restore clear failed');
      }
    } catch {
      setStatusMessage('既存データの初期化に失敗したため、CSV復元を中止しました。');
      return;
    }

    const results = await Promise.all(
      nextTransactions.map(async (transaction) => {
        const payload = {
          date: transaction.date,
          type: transaction.type,
          vendorName: transaction.vendorName,
          productName: transaction.productName ?? '',
          amount: transaction.amount,
          category: transaction.category,
          sourceType: transaction.sourceType,
          note: transaction.note ?? '',
        };

        return fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }),
    );

    const failedCount = results.filter((response) => !response.ok).length;
    if (failedCount > 0) {
      setStatusMessage(`CSV復元で${failedCount}件の保存に失敗しました。`);
      return;
    }

    setTransactions(nextTransactions);
    persistTransactionCache(nextTransactions);
    setRecentlyDeleted(null);
    setEditingTransactionId(null);
    setEditingSnapshot(null);
    setForm((current) => ({
      ...current,
      date: toLocalIsoDate(new Date()),
    }));
    setStatusMessage(`CSVから${nextTransactions.length}件を復元しました。`);
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const confirmed = window.confirm('CSVの内容で現在の全データを置き換えます。続行しますか？');
    if (!confirmed) {
      event.target.value = '';
      return;
    }

    try {
      const csvText = await file.text();
      await restoreTransactionsFromCsvText(csvText);
    } catch {
      setStatusMessage('CSV復元に失敗しました。アプリから保存したCSVを選択してください。');
    } finally {
      event.target.value = '';
    }
  };

  const generateTaxShareUrl = async () => {
    setIsGeneratingShare(true);

    if (shareYearTransactions.length === 0) {
      setStatusMessage(`${shareYear}年 の共有対象データがありません。`);
      setIsGeneratingShare(false);
      return null;
    }

    if (hasBlockingIssue) {
      const firstIssue = submissionIssues[0];
      if (firstIssue) {
        setFocusedIssueTransactionId(firstIssue.transaction.id);
      }
      scrollToSectionById(issueSectionId);
      setStatusMessage(
        `URLを発行できません。未分類経費が${preflightChecks.uncategorizedCount}件あります。要修正取引リストの「この取引を修正」から直してください。`,
      );
      setIsGeneratingShare(false);
      return null;
    }

    const normalizedLedgerTransactions = shareYearTransactions.map((transaction) =>
      transaction.type === '売上'
        ? { ...transaction, category: '現金売上' }
        : transaction,
    );

    const issuedAt = new Date().toISOString();
    const compactPayload = toCompactTaxSharePayload(
      shareYear,
      issuedAt,
      {
        sales: shareYearSummary.sales,
        expenses: shareYearSummary.expenses,
        net: shareYearSummary.net,
        count: normalizedLedgerTransactions.length,
      },
      shareYearMonthlyRows,
      shareYearExpenseBreakdown,
      normalizedLedgerTransactions.map((transaction) => ({
        date: transaction.date,
        type: transaction.type,
        vendorName: transaction.vendorName,
        productName: transaction.productName ?? '',
        amount: transaction.amount,
        category: transaction.category,
        note: transaction.note ?? '',
        sourceType: transaction.sourceType,
      })),
    );

    try {
      const response = await fetch('/api/tax-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compactPayload),
      });

      if (!response.ok) {
        throw new Error('failed to create share token');
      }

      const { token } = (await response.json()) as { token?: string };
      if (!token) {
        throw new Error('missing share token');
      }

      const nextUrl = `${window.location.origin}/tax-share?id=${token}`;

      setTaxShareUrl(nextUrl);

      try {
        await navigator.clipboard.writeText(nextUrl);
        setStatusMessage(
          preflightChecks.salesAutoNormalizedCount > 0
            ? `${shareYear}年の売上${preflightChecks.salesAutoNormalizedCount}件を現金売上として自動調整し、URLを発行してコピーしました。`
            : `${shareYear}年の税理士提出用URLを発行し、クリップボードへコピーしました。`,
        );
      } catch {
        setStatusMessage(`${shareYear}年の税理士提出用URLを発行しました。`);
      }

      setIsGeneratingShare(false);
      return nextUrl;
    } catch {
      const encoded = encodeBase64Url(JSON.stringify(compactPayload));
      const fallbackUrl = `${window.location.origin}/tax-share?data=${encoded}`;

      setTaxShareUrl(fallbackUrl);

      try {
        await navigator.clipboard.writeText(fallbackUrl);
        setStatusMessage(`${shareYear}年の税理士提出用URLを発行し、クリップボードへコピーしました。`);
      } catch {
        setStatusMessage(`${shareYear}年の税理士提出用URLを発行しました。`);
      }

      setIsGeneratingShare(false);
      return fallbackUrl;
    }
  };

  const handleGenerateTaxShareUrl = async () => {
    await generateTaxShareUrl();
  };

  const handleEditIssueTransaction = (transaction: Transaction) => {
    setFocusedIssueTransactionId(transaction.id);
    handleEditTransaction(transaction);
  };

  const handleJumpToFirstIssue = () => {
    if (submissionIssues.length === 0) {
      return;
    }

    const firstIssue = submissionIssues[0];
    setFocusedIssueTransactionId(firstIssue.transaction.id);
    scrollToSectionById(`issue-${firstIssue.transaction.id}`);
  };

  const handleGenerateAndShareToLine = async () => {
    const url = await generateTaxShareUrl();
    if (!url) {
      return;
    }

    const text = `税理士が開く提出ページ（${shareYear}年）\n${url}`;
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
    window.open(lineShareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareToLine = () => {
    if (!taxShareUrl) {
      setStatusMessage('先に税理士提出用URLを発行してください。');
      return;
    }

    const text = `税理士が開く提出ページ（${shareYear}年）\n${taxShareUrl}`;
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
    window.open(lineShareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyTaxShareUrl = async () => {
    if (!taxShareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(taxShareUrl);
      setStatusMessage('税理士が開くURLをコピーしました。');
    } catch {
      setStatusMessage('URLのコピーに失敗しました。長押しでコピーしてください。');
    }
  };

  const handlePrintLedger = () => {
    setStatusMessage('この画面を印刷します。');
    window.print();
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      setStatusMessage('この環境ではインストール表示が利用できません。');
      return;
    }

    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setStatusMessage('インストールを開始しました。');
    }

    setCanInstall(false);
    setInstallPromptEvent(null);
  };
  
  const handleNotificationToggle = async () => {
    if (!('Notification' in window)) {
      setStatusMessage('この端末では通知機能を利用できません。');
      return;
    }

    if (notificationEnabled) {
      setNotificationEnabled(false);
      setStatusMessage('通知をOFFにしました。');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationEnabled(true);
      setStatusMessage('通知をONにしました。');
      return;
    }

    setStatusMessage('通知が許可されていません。端末設定から許可してください。');
  };

  const navigateMenu = (menu: AppMenu) => {
    setActiveMenu(menu);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // jsdom does not implement scrollTo
    }
  };

  const scrollToSectionById = (targetId: string) => {
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openSalesPage = () => {
    navigateMenu('sales');
    setForm((current) => ({
      ...current,
      type: '売上',
      category: '現金売上',
      productName: '',
    }));
  };

  const openExpensePage = () => {
    navigateMenu('expenses');
    setForm((current) => ({
      ...current,
      type: '経費',
      category: current.type === '経費' ? current.category : '消耗品費',
    }));
  };
  const handleEditTransaction = (transaction: Transaction) => {
    const snapshot: TransactionForm = {
      date: transaction.date,
      type: transaction.type,
      vendorName: transaction.vendorName,
      productName: transaction.productName ?? '',
      amount: String(transaction.amount),
      category: transaction.category,
      note: transaction.note,
    };

    setEditingTransactionId(transaction.id);
    setEditingSnapshot(snapshot);
    setForm(snapshot);
    if (transaction.type === '売上') {
      setDailyBreakdown(parseSalesBreakdownNote(transaction.note));
    }
    setStatusMessage('修正モードで開きました。内容を直して保存してください。');
    navigateMenu(transaction.type === '売上' ? 'sales' : 'expenses');
  };

  const cancelEditing = () => {
    setEditingTransactionId(null);
    setEditingSnapshot(null);
    setForm({
      ...initialForm,
      date: toLocalIsoDate(new Date()),
      type: '売上',
      vendorName: '券売機日計表',
      category: '現金売上',
      productName: '',
    });
    setDailyBreakdown({ ...emptySalesBreakdown });
    setStatusMessage('修正モードを終了しました。');
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    if (!window.confirm('この取引を削除しますか？')) {
      return;
    }

    const targetIndex = transactions.findIndex((transaction) => transaction.id === transactionId);
    const targetTransaction = targetIndex >= 0 ? transactions[targetIndex] : null;

    setIsDeletingId(transactionId);

    try {
      const response = await fetch(`/api/transactions/${transactionId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('delete failed');
      }

      try {
        const refreshed = await fetch('/api/transactions');
        if (refreshed.ok) {
          const data = await refreshed.json();
          const nextTransactions = normalizeTransactionsPayload(data);
          if (nextTransactions) {
            setTransactions(nextTransactions);
            persistTransactionCache(nextTransactions);
          }
        }
      } catch {
        // keep the optimistic local update below as the fallback
      }
    } catch {
      // keep local behavior consistent even when API is unavailable
    }

    const nextTransactions = transactions.filter((transaction) => transaction.id !== transactionId);
    setTransactions(nextTransactions);
    persistTransactionCache(nextTransactions);
    if (editingTransactionId === transactionId) {
      cancelEditing();
    }

    if (targetTransaction) {
      setRecentlyDeleted({ transaction: targetTransaction, index: targetIndex });
      if (deleteUndoTimerRef.current !== null) {
        window.clearTimeout(deleteUndoTimerRef.current);
      }
      deleteUndoTimerRef.current = window.setTimeout(() => {
        setRecentlyDeleted(null);
        deleteUndoTimerRef.current = null;
      }, 5000);
    }

    setIsDeletingId(null);
    setStatusMessage('取引を削除しました。5秒以内なら取り消せます。');
  };

  const handleUndoDelete = () => {
    if (!recentlyDeleted) {
      return;
    }

    setTransactions((current) => {
      if (current.some((transaction) => transaction.id === recentlyDeleted.transaction.id)) {
        return current;
      }

      const next = [...current];
      const insertAt = Math.max(0, Math.min(recentlyDeleted.index, next.length));
      next.splice(insertAt, 0, recentlyDeleted.transaction);
      return next;
    });

    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }

    setRecentlyDeleted(null);
    setStatusMessage('削除を取り消しました。');
  };

  if (!isPinUnlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Shared Access</p>
          <h1 className="mt-3 text-2xl font-black text-stone-900">PINでログイン</h1>
          <p className="mt-2 text-sm text-stone-600">共有URLを使う場合は、設定したPINを入力してください。</p>

          <form onSubmit={handlePinSubmit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-stone-700">
              PIN
              <input
                type="password"
                inputMode="numeric"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value.replace(/\D/g, '').slice(0, 8))}
                className="mt-2 w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-center text-xl font-black tracking-[0.3em] text-stone-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200"
                placeholder="123456"
              />
            </label>

            {pinError && <p className="text-sm font-semibold text-rose-600">{pinError}</p>}

            <button type="submit" className="pressable w-full rounded-xl bg-cyan-700 px-4 py-3 text-base font-bold text-white">
              ログイン
            </button>
            <button
              type="button"
              onClick={handlePinRecoveryToDefault}
              className="pressable w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700"
            >
              PINを1214にリセット
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className={`page-surface ui-scale-${textScale} min-h-screen px-3 py-4 pb-8 text-stone-800 md:px-4 md:py-8 md:pb-8`}>
      <div className="mx-auto max-w-6xl space-y-5 md:space-y-8">
        <h1 className="px-1 text-2xl font-black tracking-tight text-stone-900 md:text-4xl">
          <span className="block">Cutsalon Thankyou</span>
          <span className="block">会計管理アプリ</span>
        </h1>

        <section className="sticky top-2 z-30 glass-card rounded-2xl p-2.5 md:top-4 md:p-3">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            <a
              href={getMenuHref('home')}
              onClick={() => navigateMenu('home')}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'home' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              ホーム
            </a>
            <a
              href={getMenuHref('sales')}
              onClick={openSalesPage}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'sales' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              売上入力
            </a>
            <a
              href={getMenuHref('expenses')}
              onClick={openExpensePage}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'expenses' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              経費入力
            </a>
            <a
              href={getMenuHref('analysis')}
              onClick={() => navigateMenu('analysis')}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'analysis' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              売上データ分析
            </a>
            <a
              href={getMenuHref('submit')}
              onClick={() => navigateMenu('submit')}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'submit' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              帳簿提出
            </a>
            <a
              href={getMenuHref('settings')}
              onClick={() => navigateMenu('settings')}
              className={`pressable flex h-10 items-center justify-center rounded-xl px-2 text-xs font-bold md:h-11 md:text-sm ${activeMenu === 'settings' ? 'bg-orange-600 text-white' : 'bg-amber-50 text-stone-700'}`}
            >
              設定
            </a>
          </div>
        </section>

        {statusMessage && (
          <section className="rounded-xl border border-orange-200 bg-amber-50 px-4 py-3 text-base font-semibold text-orange-900 break-words">
            {statusMessage}
          </section>
        )}

        {saveResultMessage && (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
            <p className="rounded-full border border-emerald-300 bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-lg">
              {saveResultMessage}
            </p>
          </div>
        )}

        {recentlyDeleted && (
          <section className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900 break-words">削除した取引を元に戻せます（5秒）</p>
            <button
              type="button"
              onClick={handleUndoDelete}
              className="pressable rounded-full border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800"
            >
              取り消す
            </button>
          </section>
        )}

        {activeMenu === 'home' && (
          <section className="glass-card rounded-2xl p-4 md:p-6">
            <h2 className="text-lg font-black text-stone-900 md:text-2xl">ホーム</h2>
            <div className="mt-4 space-y-4">
              <section className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-100 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-black text-orange-950">今月</h3>
                  <p className="text-sm font-bold text-orange-800">{Number(selectedMonth.split('-')[1] ?? currentMonth.split('-')[1])}月</p>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-orange-700 ring-1 ring-orange-200">月次</span>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-white/85 p-4 ring-1 ring-orange-100">
                    <p className="text-sm text-stone-600">売上</p>
                    <p className="mt-1 text-2xl font-black text-orange-700">¥{currentMonthSummary.sales.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/85 p-4 ring-1 ring-orange-100">
                    <p className="text-sm text-stone-600">経費</p>
                    <p className="mt-1 text-2xl font-black text-amber-700">¥{currentMonthSummary.expenses.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/85 p-4 ring-1 ring-orange-100">
                    <p className="text-sm text-stone-600">利益</p>
                    <p className="mt-1 text-2xl font-black text-orange-900">¥{currentMonthSummary.net.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/85 p-4 ring-1 ring-orange-100">
                    <p className="text-sm text-stone-600">利益率</p>
                    <p className="mt-1 text-2xl font-black text-yellow-700">{currentMonthProfitRate.toFixed(1)}%</p>
                  </div>
                </div>
              </section>
              <section className="rounded-2xl border border-yellow-300 bg-gradient-to-br from-yellow-50 to-orange-100 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-black text-amber-950">今年</h3>
                  <p className="text-sm font-bold text-amber-800">{currentYear}年</p>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-yellow-300">年次</span>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-white/88 p-4 ring-1 ring-yellow-200">
                    <p className="text-sm text-stone-600">累計売上</p>
                    <p className="mt-1 text-2xl font-black text-orange-700">¥{currentYearSummary.sales.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/88 p-4 ring-1 ring-yellow-200">
                    <p className="text-sm text-stone-600">累計経費</p>
                    <p className="mt-1 text-2xl font-black text-amber-700">¥{currentYearSummary.expenses.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/88 p-4 ring-1 ring-yellow-200">
                    <p className="text-sm text-stone-600">累計利益</p>
                    <p className="mt-1 text-2xl font-black text-orange-900">¥{currentYearSummary.net.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/88 p-4 ring-1 ring-yellow-200">
                    <p className="text-sm text-stone-600">累計利益率</p>
                    <p className="mt-1 text-2xl font-black text-yellow-700">{currentYearProfitRate.toFixed(1)}%</p>
                  </div>
                </div>
              </section>
            </div>
          </section>
        )}

        {activeMenu === 'submit' && (
          <section className="glass-card rounded-2xl p-4 md:p-6">
            <h2 className="text-lg font-black text-stone-900">帳簿提出</h2>
            <p className="mt-1 text-sm text-stone-600">提出したい年を選んで、税理士がそのまま開けるURLを発行します。年途中でも途中経過として発行できます。</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
              <label className="space-y-1 text-sm font-semibold text-stone-700">
                出力する年
                <select
                  value={shareYear}
                  onChange={(event) => setShareYear(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>{year}年</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={handleGenerateAndShareToLine}
                  disabled={isGeneratingShare}
                  className="pressable h-11 rounded-xl bg-cyan-700 px-4 text-sm font-bold text-white disabled:bg-cyan-300"
                >
                  {isGeneratingShare ? '発行中...' : `${shareYear}年の提出URLを発行してLINEで送る`}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateTaxShareUrl}
                  disabled={isGeneratingShare}
                  className="pressable h-11 rounded-xl border border-cyan-300 bg-cyan-50 px-4 text-sm font-bold text-cyan-800 disabled:opacity-60"
                >
                  {isGeneratingShare ? '確認中...' : `${shareYear}年の提出URLを発行`}
                </button>
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'submit' && (
        <section id={issueSectionId} className="glass-card rounded-2xl p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-stone-800">要修正取引リスト（自動抽出）</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${submissionIssues.length > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {submissionIssues.length > 0 ? `${submissionIssues.length}件 要修正` : '0件 提出可能'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleJumpToFirstIssue}
                disabled={submissionIssues.length === 0}
                className="pressable rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-sm font-semibold text-cyan-800"
              >
                {submissionIssues.length > 0 ? '先頭の修正項目へ移動' : '修正項目なし'}
              </button>
            </div>
          </div>

          {submissionIssues.length === 0 ? (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              修正が必要な取引はありません。このまま提出URLを発行できます。
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-700">
                上から順に「この取引を修正」を押すと、入力欄へ自動で値が入り、すぐ修正できます。
              </p>
              {submissionIssues.map((issue) => (
                <div
                  key={issue.transaction.id}
                  id={`issue-${issue.transaction.id}`}
                  className={`rounded-xl border p-3 ${focusedIssueTransactionId === issue.transaction.id ? 'border-cyan-400 bg-cyan-50/50' : 'border-rose-200 bg-rose-50/50'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-stone-800">
                      {issue.transaction.date} / {issue.transaction.vendorName || '取引先未入力'} / ¥{issue.transaction.amount.toLocaleString()}
                    </p>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                      修正理由 {issue.reasons.length}件
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-rose-800">
                    {issue.reasons.map((reason, index) => (
                      <p key={`${issue.transaction.id}-reason-${index}`}>- {reason}</p>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-stone-700">
                    {issue.fixHints.map((hint, index) => (
                      <p key={`${issue.transaction.id}-hint-${index}`}>修正方法: {hint}</p>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditIssueTransaction(issue.transaction)}
                      className="pressable rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-sm font-semibold text-cyan-800"
                    >
                      この取引を修正
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {activeMenu === 'analysis' && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {cards.map((card) => (
            <div key={card.label} className="glass-card min-w-0 rounded-2xl p-4 md:p-5">
              <p className="text-base font-semibold text-stone-500">{card.label}</p>
              <p className={`mt-3 break-words text-2xl font-black sm:text-3xl md:text-4xl ${card.tone}`}>{card.value}</p>
              {'subText' in card && card.subText && (
                <p className="mt-2 break-words text-xs font-semibold text-stone-500">{card.subText}</p>
              )}
            </div>
          ))}
        </section>
        )}

        {activeMenu === 'analysis' && (
          <section className="glass-card rounded-2xl p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black">{selectedYear}年 月別棒グラフ</h2>
              <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
                <select
                  value={selectedYear}
                  onChange={(event) => setSelectedYear(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200 md:w-auto"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>{year}年</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-300 bg-white p-1 sm:grid-cols-4 md:inline-grid md:grid-cols-4 md:w-auto">
                  {[
                    { key: 'all', label: '全部' },
                    { key: 'sales', label: '売上' },
                    { key: 'expenses', label: '経費' },
                    { key: 'profit', label: '利益' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setAnalysisMetricFilter(option.key as 'all' | 'sales' | 'profit' | 'expenses')}
                      className={`min-w-0 rounded-lg px-3 py-2 text-center text-xs font-bold transition ${analysisMetricFilter === option.key ? 'bg-cyan-600 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <div className="inline-flex min-w-[920px] items-end gap-2 rounded-2xl border border-stone-200 bg-white p-4">
                {analysisYearMonthlyRows.map((row) => (
                  <div key={row.monthLabel} className="flex w-18 flex-col items-center gap-2">
                    <div className="grid h-56 w-full grid-cols-3 items-end gap-1 rounded-lg bg-stone-50 px-2 py-2">
                      {(analysisMetricFilter === 'all' || analysisMetricFilter === 'sales') ? (
                        <div className="flex h-full flex-col items-center justify-end gap-1">
                          <div
                            className="w-4 rounded-t bg-emerald-500"
                            style={{ height: `${Math.max(4, (row.sales / maxAnalysisBarValue) * 100)}%` }}
                            title={`売上 ¥${row.sales.toLocaleString()}`}
                          />
                          <p className="text-[9px] font-semibold text-emerald-700">¥{row.sales.toLocaleString()}</p>
                        </div>
                      ) : (
                        <div />
                      )}
                      {(analysisMetricFilter === 'all' || analysisMetricFilter === 'expenses') ? (
                        <div className="flex h-full flex-col items-center justify-end gap-1">
                          <div
                            className="w-4 rounded-t bg-amber-500"
                            style={{ height: `${Math.max(4, (row.expenses / maxAnalysisBarValue) * 100)}%` }}
                            title={`経費 ¥${row.expenses.toLocaleString()}`}
                          />
                          <p className="text-[9px] font-semibold text-amber-700">¥{row.expenses.toLocaleString()}</p>
                        </div>
                      ) : (
                        <div />
                      )}
                      {(analysisMetricFilter === 'all' || analysisMetricFilter === 'profit') ? (
                        <div className="flex h-full flex-col items-center justify-end gap-1">
                          <div
                            className={`w-4 rounded-t ${row.profit >= 0 ? 'bg-cyan-500' : 'bg-rose-500'}`}
                            style={{ height: `${Math.max(4, (Math.abs(row.profit) / maxAnalysisBarValue) * 100)}%` }}
                            title={`利益 ¥${row.profit.toLocaleString()}`}
                          />
                          <p className={`text-[9px] font-semibold ${row.profit >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>¥{row.profit.toLocaleString()}</p>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                    <p className="text-xs font-bold text-stone-600">{row.monthLabel}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-stone-700">
              {(analysisMetricFilter === 'all' || analysisMetricFilter === 'sales') && (
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />売上</span>
              )}
              {(analysisMetricFilter === 'all' || analysisMetricFilter === 'expenses') && (
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />経費</span>
              )}
              {(analysisMetricFilter === 'all' || analysisMetricFilter === 'profit') && (
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />利益（赤はマイナス）</span>
              )}
            </div>
          </section>
        )}

        {activeMenu === 'analysis' && (
          <section className="glass-card rounded-2xl p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black">昨年比分析（売上・利益）</h2>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200"
              >
                {years.map((year) => (
                  <option key={year} value={year}>{year}年</option>
                ))}
              </select>
            </div>

            {!hasPreviousYearData ? (
              <p className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-600">
                {previousYear}年の売上データがないため比較できません。売上データを追加すると自動で比較されます。
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
                <table className="min-w-[980px] text-left text-sm">
                  <thead className="bg-stone-100 text-stone-700">
                    <tr>
                      <th className="px-3 py-2 font-semibold">月</th>
                      <th className="px-3 py-2 font-semibold">昨年売上</th>
                      <th className="px-3 py-2 font-semibold">今年売上</th>
                      <th className="px-3 py-2 font-semibold">売上前年差額</th>
                      <th className="px-3 py-2 font-semibold">売上前年比</th>
                      <th className="px-3 py-2 font-semibold">昨年利益</th>
                      <th className="px-3 py-2 font-semibold">今年利益</th>
                      <th className="px-3 py-2 font-semibold">利益前年差額</th>
                      <th className="px-3 py-2 font-semibold">利益前年比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySalesProfitComparisonRows.map((row) => (
                      <tr key={row.monthLabel} className="border-t border-stone-200">
                        <td className="px-3 py-2 font-semibold text-stone-700">{row.monthLabel}</td>
                        <td className="px-3 py-2 text-stone-700">¥{row.previousSales.toLocaleString()}</td>
                        <td className="px-3 py-2 text-stone-900 font-semibold">¥{row.currentSales.toLocaleString()}</td>
                        <td className={`px-3 py-2 font-semibold ${row.salesDiff >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {row.salesDiff >= 0 ? '+' : '-'}¥{Math.abs(row.salesDiff).toLocaleString()}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${row.salesRatio === null ? 'text-stone-500' : row.salesRatio >= 100 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {row.salesRatio === null ? '比較不可' : `${row.salesRatio.toFixed(1)}%`}
                        </td>
                        <td className="px-3 py-2 text-stone-700">¥{row.previousProfit.toLocaleString()}</td>
                        <td className={`px-3 py-2 font-semibold ${row.currentProfit >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>
                          ¥{row.currentProfit.toLocaleString()}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${row.profitDiff >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>
                          {row.profitDiff >= 0 ? '+' : '-'}¥{Math.abs(row.profitDiff).toLocaleString()}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${row.profitRatio === null ? 'text-stone-500' : row.profitRatio >= 100 ? 'text-cyan-700' : 'text-rose-700'}`}>
                          {row.profitRatio === null ? '比較不可' : `${row.profitRatio.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-stone-300 bg-stone-50">
                    <tr>
                      <th className="px-3 py-2 text-stone-800">年合計</th>
                      <th className="px-3 py-2 text-stone-700">¥{previousYearSummary.sales.toLocaleString()}</th>
                      <th className="px-3 py-2 text-stone-900">¥{yearSummary.sales.toLocaleString()}</th>
                      <th className={`px-3 py-2 font-semibold ${yearSummary.sales - previousYearSummary.sales >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {yearSummary.sales - previousYearSummary.sales >= 0 ? '+' : '-'}¥{Math.abs(yearSummary.sales - previousYearSummary.sales).toLocaleString()}
                      </th>
                      <th className={`px-3 py-2 font-semibold ${previousYearSummary.sales === 0 ? 'text-stone-500' : yearSummary.sales >= previousYearSummary.sales ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {previousYearSummary.sales === 0 ? '比較不可' : `${((yearSummary.sales / previousYearSummary.sales) * 100).toFixed(1)}%`}
                      </th>
                      <th className="px-3 py-2 text-stone-700">¥{previousYearSummary.net.toLocaleString()}</th>
                      <th className={`px-3 py-2 font-semibold ${yearSummary.net >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>
                        ¥{yearSummary.net.toLocaleString()}
                      </th>
                      <th className={`px-3 py-2 font-semibold ${yearSummary.net - previousYearSummary.net >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>
                        {yearSummary.net - previousYearSummary.net >= 0 ? '+' : '-'}¥{Math.abs(yearSummary.net - previousYearSummary.net).toLocaleString()}
                      </th>
                      <th className={`px-3 py-2 font-semibold ${previousYearSummary.net === 0 ? 'text-stone-500' : yearSummary.net >= previousYearSummary.net ? 'text-cyan-700' : 'text-rose-700'}`}>
                        {previousYearSummary.net === 0 ? '比較不可' : `${((yearSummary.net / previousYearSummary.net) * 100).toFixed(1)}%`}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}

        {activeMenu === 'sales' && (
        <section className="space-y-5">
          <div className="glass-card rounded-2xl p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">売上入力</h2>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800 ring-1 ring-orange-200">
                日計表
              </span>
            </div>

            <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-lg font-black text-stone-900">人数を入力して売上を保存します。</p>
            </div>

            {editingTransactionId && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm font-semibold text-amber-800">修正モードです</p>
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="pressable rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-semibold text-amber-700"
                >
                  解除
                </button>
              </div>
            )}

            <form
              id={transactionFormId}
              className="space-y-4 rounded-2xl border border-yellow-300 bg-yellow-50/70 p-4"
              onSubmit={handleSubmit}
            >
              <p className="text-base font-black text-amber-900">手入力</p>
              <label className="space-y-2 text-base font-semibold text-stone-700">
                <div className="flex items-center justify-between gap-2">
                  <span>日付</span>
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, date: toLocalIsoDate(new Date()) }))}
                    className="pressable rounded-full border border-orange-300 bg-white px-3 py-1 text-sm font-semibold text-orange-700"
                  >
                    今日
                  </button>
                </div>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                  className={dateInputClassName}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>大人(1800円)</span>
                  <input
                    id="sales-count-adult"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.adult}
                    onChange={(event) => updateDailyBreakdownField('adult', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('adult', (event.target as HTMLInputElement).value)}
                    placeholder="人数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>中高生(1500円)</span>
                  <input
                    id="sales-count-junior"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.junior}
                    onChange={(event) => updateDailyBreakdownField('junior', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('junior', (event.target as HTMLInputElement).value)}
                    placeholder="人数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>小学生以下(1200円)</span>
                  <input
                    id="sales-count-child"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.child}
                    onChange={(event) => updateDailyBreakdownField('child', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('child', (event.target as HTMLInputElement).value)}
                    placeholder="人数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>坊主(1500円)</span>
                  <input
                    id="sales-count-monk"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.monk}
                    onChange={(event) => updateDailyBreakdownField('monk', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('monk', (event.target as HTMLInputElement).value)}
                    placeholder="人数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>前髪カット(500円)</span>
                  <input
                    id="sales-count-fringe"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.fringe}
                    onChange={(event) => updateDailyBreakdownField('fringe', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('fringe', (event.target as HTMLInputElement).value)}
                    placeholder="件数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>セルフシャンプー(200円)</span>
                  <input
                    id="sales-count-self-shampoo"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.selfShampoo}
                    onChange={(event) => updateDailyBreakdownField('selfShampoo', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('selfShampoo', (event.target as HTMLInputElement).value)}
                    placeholder="件数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>スタイルチェンジ(2300円)</span>
                  <input
                    id="sales-count-style-change"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.styleChange}
                    onChange={(event) => updateDailyBreakdownField('styleChange', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('styleChange', (event.target as HTMLInputElement).value)}
                    placeholder="件数"
                    className={inputClassName}
                  />
                </label>
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>大人+セルフシャンプー(2000円)</span>
                  <input
                    id="sales-count-adult-self-shampoo"
                    type="text"
                    inputMode="numeric"
                    value={dailyBreakdown.adultSelfShampoo}
                    onChange={(event) => updateDailyBreakdownField('adultSelfShampoo', event.target.value)}
                    onInput={(event) => updateDailyBreakdownField('adultSelfShampoo', (event.target as HTMLInputElement).value)}
                    placeholder="件数"
                    className={inputClassName}
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50 p-4">
                <p className="text-sm font-semibold text-stone-600">自動計算された1日の売上</p>
                <p id="sales-total-preview" className="mt-2 text-3xl font-black text-orange-700">¥{computedAmountPreview.toLocaleString()}</p>
                <p id="sales-debug-preview" className="mt-2 text-xs font-semibold text-orange-700 break-words">
                  debug: A{dailyBreakdown.adult || '0'} / J{dailyBreakdown.junior || '0'} / C{dailyBreakdown.child || '0'} / M{dailyBreakdown.monk || '0'} / F{dailyBreakdown.fringe || '0'} / SS{dailyBreakdown.selfShampoo || '0'} / SC{dailyBreakdown.styleChange || '0'} / AS{dailyBreakdown.adultSelfShampoo || '0'}
                </p>
              </div>

              <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
                {isSaving ? '保存中...' : editingTransactionId ? '修正を保存' : '売上を保存'}
              </button>
            </form>
          </div>

          <div className="glass-card rounded-2xl p-4 md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="text-xl font-black">{selectedMonth} の売上データ</h3>
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-base font-semibold outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-amber-200"
              >
                {months.map((month) => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-orange-200 bg-white">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-orange-100 bg-orange-50 px-4 py-3 text-sm font-black text-orange-900">
                <p>日付</p>
                <p className="text-right">売上</p>
                <p className="text-right">総人数</p>
                <p className="text-right">操作</p>
              </div>
              {selectedMonthSalesTransactions.map((transaction) => {
                const breakdown = parseSalesBreakdownNote(transaction.note);
                const totalCustomers = [breakdown.adult, breakdown.junior, breakdown.child, breakdown.monk]
                  .map((value) => Number(value || '0'))
                  .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);

                return (
                  <div
                    key={transaction.id}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-orange-100 px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <p className="text-base font-bold text-stone-900">{transaction.date}</p>
                      <p className="text-xs font-semibold text-stone-500">保存データ</p>
                    </div>
                    <p className="text-right text-base font-black text-orange-700">¥{transaction.amount.toLocaleString()}</p>
                    <p className="text-right text-base font-black text-stone-700">{totalCustomers}人</p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditTransaction(transaction)}
                        className="pressable rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800"
                      >
                        修正
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(transaction.id)}
                        disabled={isDeletingId === transaction.id}
                        className="pressable rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                      >
                        {isDeletingId === transaction.id ? '削除中...' : '削除'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {selectedMonthSalesTransactions.length === 0 && (
                <div className="px-4 py-6 text-center text-base font-semibold text-stone-500">
                  この月の売上データはありません。
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {activeMenu === 'expenses' && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="glass-card rounded-2xl p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">経費入力</h2>
            </div>

            {editingTransactionId && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm font-semibold text-amber-800">修正モードです（変更 {changedFieldCount} 項目）</p>
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="pressable rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-semibold text-amber-700"
                >
                  解除
                </button>
              </div>
            )}

            <form id={transactionFormId} className="space-y-4 rounded-2xl border border-yellow-300 bg-yellow-50/70 p-4" onSubmit={handleSubmit}>
              <p className="text-base font-black text-amber-900">手入力</p>

              <label className="space-y-2 text-base font-semibold text-stone-700">
                <div className="flex items-center justify-between gap-2">
                  <span>日付</span>
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, date: toLocalIsoDate(new Date()) }))}
                    className="pressable rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-sm font-semibold text-cyan-700"
                  >
                    今日
                  </button>
                </div>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((current) => ({ ...current, date: event.target.value, type: '経費' }))}
                  className={dateInputClassName}
                />
              </label>

              <label className="space-y-2 text-base font-semibold text-stone-700">
                <span>取引先</span>
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) {
                      return;
                    }
                    setForm((current) => ({ ...current, vendorName: value, type: '経費' }));
                    event.currentTarget.value = '';
                  }}
                  className={inputClassName}
                >
                  <option value="">履歴から選択（使用回数順）</option>
                  {vendorSuggestions.map((vendorName) => (
                    <option key={vendorName} value={vendorName}>{vendorName}</option>
                  ))}
                </select>
                <input
                  value={form.vendorName}
                  onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value, type: '経費' }))}
                  placeholder="例: Amazon / 楽天 / ドラッグストア"
                  className={inputClassName}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>金額</span>
                  <input
                    type="number"
                    value={form.amount}
                    inputMode="numeric"
                    onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value, type: '経費' }))}
                    className={inputClassName}
                  />
                  <p className="text-sm font-semibold text-cyan-700">入力金額: {amountPreview}</p>
                  {amountError && <p className="text-sm font-semibold text-rose-600">{amountError}</p>}
                </label>

                <label className="space-y-2 text-base font-semibold text-stone-700">
                  <span>仕分け</span>
                  <select
                    value={form.category}
                    onChange={(event) => setForm((current) => ({ ...current, category: event.target.value, type: '経費' }))}
                    className={inputClassName}
                  >
                    <option value="">選択してください</option>
                    {expenseCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-stone-600">よく使う費目</p>
                <div className="flex flex-wrap gap-2">
                  {quickExpenseCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, category, type: '経費' }))}
                      className={`pressable rounded-full border px-3 py-1.5 text-sm font-semibold ${form.category === category ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-stone-300 bg-white text-stone-700'}`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <label className="space-y-2 text-base font-semibold text-stone-700">
                <span>商品名 / 明細名</span>
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) {
                      return;
                    }
                    setForm((current) => ({ ...current, productName: value, type: '経費' }));
                    event.currentTarget.value = '';
                  }}
                  className={inputClassName}
                >
                  <option value="">履歴から選択（使用回数順）</option>
                  {expenseProductSuggestions.map((productName) => (
                    <option key={productName} value={productName}>{productName}</option>
                  ))}
                </select>
                <input
                  value={form.productName}
                  onChange={(event) => setForm((current) => ({ ...current, productName: event.target.value, type: '経費' }))}
                  placeholder="例: ヘアケア用品 / カード明細"
                  className={inputClassName}
                />
              </label>

              <label className="space-y-2 text-base font-semibold text-stone-700">
                <span>メモ</span>
                <input
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value, type: '経費' }))}
                  placeholder="例: シャンプー、カード明細、接待費"
                  className={inputClassName}
                />
              </label>

              <button type="submit" disabled={isSaving || !!amountError} className={primaryButtonClassName}>
                {isSaving ? '保存中...' : editingTransactionId ? '修正を保存' : '経費を保存'}
              </button>
            </form>
          </div>

          <div className="glass-card rounded-2xl p-4 md:p-6">
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-stone-100 bg-stone-50 px-4 py-3 text-sm font-black text-stone-800">
                <p>日付</p>
                <p className="text-right">経費</p>
                <p className="text-right">取引先</p>
                <p className="text-right">操作</p>
              </div>
              {pageVisibleTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0 ${focusedIssueTransactionId === transaction.id ? 'bg-cyan-50/60' : ''}`}
                >
                  <div>
                    <p className="text-base font-bold text-stone-900">{transaction.date}</p>
                    <p className="text-xs font-semibold text-stone-500">{transaction.category}</p>
                  </div>
                  <p className="text-right text-base font-black text-amber-700">¥{transaction.amount.toLocaleString()}</p>
                  <p className="max-w-28 truncate text-right text-sm font-semibold text-stone-700" title={transaction.vendorName}>{transaction.vendorName}</p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditTransaction(transaction)}
                      className="pressable rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700"
                    >
                      修正
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTransaction(transaction.id)}
                      disabled={isDeletingId === transaction.id}
                      className="pressable rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                    >
                      {isDeletingId === transaction.id ? '削除中...' : '削除'}
                    </button>
                  </div>
                </div>
              ))}
              {pageVisibleTransactions.length === 0 && (
                <div className="px-4 py-6 text-center text-base font-semibold text-stone-500">
                  表示できる経費データがありません。
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {activeMenu === 'settings' && (
          <section className="glass-card rounded-2xl p-4 md:p-6">
            <h2 className="text-xl font-black text-stone-900">設定</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <p className="text-sm font-semibold text-stone-600">文字サイズ</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTextScale('normal')}
                    className={`pressable rounded-lg px-2 py-2 text-sm font-bold ${textScale === 'normal' ? 'bg-cyan-700 text-white' : 'bg-stone-100 text-stone-700'}`}
                  >
                    標準
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextScale('large')}
                    className={`pressable rounded-lg px-2 py-2 text-sm font-bold ${textScale === 'large' ? 'bg-cyan-700 text-white' : 'bg-stone-100 text-stone-700'}`}
                  >
                    大
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextScale('xlarge')}
                    className={`pressable rounded-lg px-2 py-2 text-sm font-bold ${textScale === 'xlarge' ? 'bg-cyan-700 text-white' : 'bg-stone-100 text-stone-700'}`}
                  >
                    特大
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <p className="text-sm font-semibold text-stone-600">共有PIN</p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    value={sharedPinSetting}
                    onChange={(event) => setSharedPinSetting(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-base font-bold text-stone-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200"
                    placeholder="123456"
                  />
                  <button type="button" onClick={handlePinSave} className="pressable rounded-xl bg-cyan-700 px-3 py-2 text-sm font-bold text-white">
                    保存
                  </button>
                </div>
                <p className="mt-2 text-xs text-stone-500">共有URLで開いた人は、このPINを入力して使います。</p>
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <p className="text-sm font-semibold text-stone-600">データ出力</p>
                <button
                  type="button"
                  onClick={handleCsvExport}
                  className="mt-2 pressable h-11 w-full rounded-xl border border-cyan-300 bg-cyan-50 text-sm font-bold text-cyan-800"
                >
                  CSVを保存する
                </button>
                <label className="mt-2 block">
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                  <span className="pressable flex h-11 w-full items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 text-sm font-bold text-emerald-800">
                    CSVから復元する
                  </span>
                </label>
                {canInstall && (
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="mt-2 pressable h-11 w-full rounded-xl border border-stone-300 bg-white text-sm font-bold text-stone-700"
                  >
                    アプリをインストール
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-3 md:col-span-2">
                <p className="text-sm font-semibold text-stone-600">通知</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleNotificationToggle}
                    className={`pressable h-10 rounded-xl px-4 text-sm font-bold ${notificationEnabled ? 'bg-emerald-600 text-white' : 'border border-stone-300 bg-white text-stone-700'}`}
                  >
                    {notificationEnabled ? '通知 ON' : '通知 OFF'}
                  </button>
                  <span className="text-xs text-stone-500">毎日の入力忘れ防止に使えます。</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return <LedgerPage initialMenu="home" />;
}
