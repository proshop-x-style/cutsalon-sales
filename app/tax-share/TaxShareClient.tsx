'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type ShareTransaction = {
  date: string;
  type: '売上' | '経費';
  vendorName: string;
  productName: string;
  amount: number;
  category: string;
  note: string;
  sourceType: 'daily_report' | 'receipt' | 'card_statement' | 'manual';
};

type TaxSharePayload = {
  version: 1;
  issuedAt: string;
  year: string;
  annualSummary: { sales: number; expenses: number; net: number; count: number };
  monthlyRows: Array<{ month: string; sales: number; expenses: number; net: number; count: number }>;
  expenseBreakdown: Array<{ category: string; amount: number; ratio: number; count: number }>;
  transactions: ShareTransaction[];
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

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeTaxSharePayload(parsed: unknown): TaxSharePayload | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if ('version' in parsed) {
    const legacy = parsed as TaxSharePayload;
    return legacy.version === 1 ? legacy : null;
  }

  const compact = parsed as CompactTaxSharePayload;
  if (compact.v !== 2) {
    return null;
  }

  return {
    version: 1,
    issuedAt: new Date(compact.i).toISOString(),
    year: compact.y,
    annualSummary: {
      sales: compact.a[0],
      expenses: compact.a[1],
      net: compact.a[2],
      count: compact.a[3],
    },
    monthlyRows: compact.m.map(([month, sales, expenses, net, count]) => ({
      month,
      sales,
      expenses,
      net,
      count,
    })),
    expenseBreakdown: compact.e.map(([category, amount, ratio, count]) => ({
      category,
      amount,
      ratio,
      count,
    })),
    transactions: compact.t.map(([
      date,
      type,
      vendorName,
      productName,
      amount,
      category,
      note,
      sourceType,
    ]) => ({
      date,
      type: type === 's' ? '売上' : '経費',
      vendorName,
      productName,
      amount,
      category,
      note,
      sourceType: sourceType === 'd'
        ? 'daily_report'
        : sourceType === 'r'
          ? 'receipt'
          : sourceType === 'c'
            ? 'card_statement'
            : 'manual',
    })),
  };
}

function groupTransactionsByCategory(transactions: ShareTransaction[]) {
  const grouped = new Map<string, { sales: number; expenses: number; count: number }>();

  transactions.forEach((transaction) => {
    const category = transaction.category || '未分類';
    const current = grouped.get(category) ?? { sales: 0, expenses: 0, count: 0 };

    grouped.set(category, {
      sales: current.sales + (transaction.type === '売上' ? transaction.amount : 0),
      expenses: current.expenses + (transaction.type === '経費' ? transaction.amount : 0),
      count: current.count + 1,
    });
  });

  return Array.from(grouped.entries())
    .map(([category, values]) => ({
      category,
      sales: values.sales,
      expenses: values.expenses,
      net: values.sales - values.expenses,
      count: values.count,
    }))
    .sort((a, b) => b.sales + b.expenses - (a.sales + a.expenses));
}

function toExcelHtml(payload: TaxSharePayload) {
  const escapeHtml = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const monthlyRows = payload.monthlyRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.month)}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${row.sales}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${row.expenses}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${row.net}</td>
      <td>${row.count}</td>
    </tr>
  `).join('');

  const categoryRows = groupTransactionsByCategory(payload.transactions).map((item) => `
    <tr>
      <td>${escapeHtml(item.category)}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${item.sales}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${item.expenses}</td>
      <td style="mso-number-format:'\\#\\,\\#\#0'">${item.net}</td>
      <td>${item.count}</td>
    </tr>
  `).join('');

  const rows = payload.transactions.map((transaction) => `
    <tr>
      <td>${escapeHtml(transaction.date)}</td>
      <td>${escapeHtml(transaction.type)}</td>
      <td>${escapeHtml(transaction.vendorName)}</td>
      <td>${escapeHtml(transaction.productName ?? '')}</td>
      <td style="mso-number-format:'\\#\\,\\#\\#0'">${transaction.amount}</td>
      <td>${escapeHtml(transaction.category)}</td>
      <td>${escapeHtml(transaction.sourceType)}</td>
      <td>${escapeHtml(transaction.note ?? '')}</td>
    </tr>
  `).join('');

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Arial, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif; color: #1f2937; }
        h2 { margin: 0 0 10px; font-size: 18px; }
        .section { margin-bottom: 22px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
        .summary-card { border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; background: #fff; }
        .summary-label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
        .summary-value { font-size: 18px; font-weight: 700; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; }
        th { background: #f3f4f6; text-align: left; }
        .right { text-align: right; }
      </style>
    </head>
    <body>
      <div class="section">
        <h2>税理士提出用データ (${escapeHtml(payload.year)}年)</h2>
        <p>発行日時: ${escapeHtml(new Date(payload.issuedAt).toLocaleString('ja-JP'))}</p>
      </div>

      <div class="section">
        <h2>年合計</h2>
        <div class="summary-grid">
          <div class="summary-card"><div class="summary-label">売上</div><div class="summary-value">¥${payload.annualSummary.sales.toLocaleString()}</div></div>
          <div class="summary-card"><div class="summary-label">経費</div><div class="summary-value">¥${payload.annualSummary.expenses.toLocaleString()}</div></div>
          <div class="summary-card"><div class="summary-label">利益</div><div class="summary-value">¥${payload.annualSummary.net.toLocaleString()}</div></div>
          <div class="summary-card"><div class="summary-label">件数</div><div class="summary-value">${payload.annualSummary.count}</div></div>
        </div>
      </div>

      <div class="section">
        <h2>月別集計</h2>
        <table>
          <tr>
            <th>月</th><th class="right">売上</th><th class="right">経費</th><th class="right">利益</th><th class="right">件数</th>
          </tr>
          ${monthlyRows}
        </table>
      </div>

      <div class="section">
        <h2>仕分け別集計</h2>
        <table>
          <tr>
            <th>仕分け</th><th class="right">売上</th><th class="right">経費</th><th class="right">差額</th><th class="right">件数</th>
          </tr>
          ${categoryRows}
        </table>
      </div>

      <div class="section">
        <h2>明細</h2>
        <table>
          <tr>
            <th>日付</th><th>種別</th><th>取引先</th><th>商品名/明細名</th><th class="right">金額</th><th>仕分け</th><th>入力元</th><th>メモ</th>
          </tr>
          ${rows}
        </table>
      </div>
    </body>
    </html>
  `;
}

export function TaxShareClient() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<TaxSharePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const data = searchParams.get('data');
    const id = searchParams.get('id');

    let cancelled = false;

    const loadPayload = async () => {
      setIsLoading(true);

      if (data) {
        try {
          const decoded = decodeBase64Url(data);
          const parsed = JSON.parse(decoded) as unknown;
          const normalized = normalizeTaxSharePayload(parsed);
          if (!cancelled) {
            setPayload(normalized);
          }
        } catch {
          if (!cancelled) {
            setPayload(null);
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
        return;
      }

      if (!id) {
        if (!cancelled) {
          setPayload(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const response = await fetch(`/api/tax-share?id=${encodeURIComponent(id)}`);
        if (!response.ok) {
          throw new Error('payload not found');
        }
        const parsed = (await response.json()) as unknown;
        const normalized = normalizeTaxSharePayload(parsed);
        if (!cancelled) {
          setPayload(normalized);
        }
      } catch {
        if (!cancelled) {
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPayload();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const handleDownloadExcel = () => {
    if (!payload) {
      return;
    }

    const html = toExcelHtml(payload);
    const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tax-ledger-${payload.year}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <main className="page-surface min-h-screen px-4 py-8 text-stone-800">
        <div className="mx-auto max-w-4xl rounded-2xl border border-stone-200 bg-white p-6">
          <p className="text-base font-semibold text-stone-600">税理士が開く提出ページを読み込み中です...</p>
        </div>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="page-surface min-h-screen px-4 py-8 text-stone-800">
        <div className="mx-auto max-w-4xl rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-black text-rose-800">データを読み込めませんでした</h1>
          <p className="mt-2 text-sm text-rose-700">URLが不正か、提出用データが見つかりません。発行元のURLを確認してください。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-surface min-h-screen px-4 py-8 text-stone-800">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="glass-card rounded-2xl p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-cyan-700">税理士がそのまま開ける提出ページ</p>
              <h1 className="text-2xl font-black">{payload.year}年 帳簿</h1>
              <p className="mt-1 text-sm text-stone-600">発行日時: {new Date(payload.issuedAt).toLocaleString('ja-JP')}</p>
              <p className="mt-1 text-sm text-stone-600">このページはログイン不要で開けます。Excel出力か印刷を使って保存してください。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadExcel}
                className="pressable rounded-full border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800"
              >
                Excelを保存
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="pressable rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
              >
                印刷 / PDF
              </button>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h2 className="text-lg font-black">年合計</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-sm text-stone-500">売上</p>
              <p className="text-xl font-black text-emerald-700">¥{payload.annualSummary.sales.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-sm text-stone-500">経費</p>
              <p className="text-xl font-black text-amber-700">¥{payload.annualSummary.expenses.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-sky-50 p-3">
              <p className="text-sm text-stone-500">利益</p>
              <p className="text-xl font-black text-sky-700">¥{payload.annualSummary.net.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-stone-100 p-3">
              <p className="text-sm text-stone-500">件数</p>
              <p className="text-xl font-black text-stone-700">{payload.annualSummary.count}</p>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h2 className="text-lg font-black">経費費目別内訳</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-100 text-stone-700">
                <tr>
                  <th className="px-3 py-2">費目</th>
                  <th className="px-3 py-2">金額</th>
                  <th className="px-3 py-2">比率</th>
                  <th className="px-3 py-2">件数</th>
                </tr>
              </thead>
              <tbody>
                {payload.expenseBreakdown.map((item) => (
                  <tr key={item.category} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-semibold text-stone-700">{item.category}</td>
                    <td className="px-3 py-2 text-amber-700">¥{item.amount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-stone-600">{(item.ratio * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-stone-600">{item.count}</td>
                  </tr>
                ))}
                {payload.expenseBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-5 text-center text-stone-500">経費データはありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h2 className="text-lg font-black">月別集計</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-100 text-stone-700">
                <tr>
                  <th className="px-3 py-2">月</th>
                  <th className="px-3 py-2">売上</th>
                  <th className="px-3 py-2">経費</th>
                  <th className="px-3 py-2">利益</th>
                  <th className="px-3 py-2">件数</th>
                </tr>
              </thead>
              <tbody>
                {payload.monthlyRows.map((row) => (
                  <tr key={row.month} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-semibold text-stone-700">{row.month}</td>
                    <td className="px-3 py-2 text-emerald-700">¥{row.sales.toLocaleString()}</td>
                    <td className="px-3 py-2 text-amber-700">¥{row.expenses.toLocaleString()}</td>
                    <td className={`px-3 py-2 font-semibold ${row.net >= 0 ? 'text-cyan-700' : 'text-rose-700'}`}>
                      ¥{row.net.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{row.count}</td>
                  </tr>
                ))}
                {payload.monthlyRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-stone-500">この年のデータはありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h2 className="text-lg font-black">取引明細</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-100 text-stone-700">
                <tr>
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2">種別</th>
                  <th className="px-3 py-2">取引先</th>
                  <th className="px-3 py-2">商品名/明細名</th>
                  <th className="px-3 py-2">金額</th>
                  <th className="px-3 py-2">仕分け</th>
                  <th className="px-3 py-2">入力元</th>
                  <th className="px-3 py-2">メモ</th>
                </tr>
              </thead>
              <tbody>
                {payload.transactions.map((transaction, index) => (
                  <tr key={`${transaction.date}-${index}`} className="border-t border-stone-200">
                    <td className="px-3 py-2 text-stone-700">{transaction.date}</td>
                    <td className="px-3 py-2 text-stone-700">{transaction.type}</td>
                    <td className="px-3 py-2 text-stone-700">{transaction.vendorName}</td>
                    <td className="px-3 py-2 text-stone-600">{transaction.productName}</td>
                    <td className="px-3 py-2 text-stone-700">¥{transaction.amount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-stone-700">{transaction.category}</td>
                    <td className="px-3 py-2 text-stone-600">{transaction.sourceType}</td>
                    <td className="px-3 py-2 text-stone-600">{transaction.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
