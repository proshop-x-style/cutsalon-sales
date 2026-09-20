import { normalizeTransactionsPayload, type Transaction } from './transactions';

const REQUIRED_HEADERS = [
  'date',
  'type',
  'vendorName',
  'productName',
  'amount',
  'category',
  'sourceType',
  'note',
] as const;

function parseCsvRows(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, '');
  const rows: string[][] = [];

  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.some((value) => value !== '')) {
    rows.push(row);
  }

  return rows;
}

export function parseTransactionsCsv(raw: string): Transaction[] {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) {
    throw new Error('CSVに取引データがありません');
  }

  const headerRow = rows[0] ?? [];
  const missing = REQUIRED_HEADERS.filter((header) => !headerRow.includes(header));
  if (missing.length > 0) {
    throw new Error(`CSVヘッダー不足: ${missing.join(', ')}`);
  }

  const headerIndex = Object.fromEntries(headerRow.map((name, index) => [name, index])) as Record<string, number>;

  const records = rows.slice(1).map((values) => {
    const pick = (key: string) => {
      const index = headerIndex[key];
      return index === undefined ? '' : (values[index] ?? '');
    };

    return {
      date: pick('date'),
      type: pick('type'),
      vendorName: pick('vendorName'),
      productName: pick('productName'),
      amount: Number(pick('amount')),
      category: pick('category'),
      sourceType: pick('sourceType'),
      note: pick('note'),
      createdAt: new Date().toISOString(),
    };
  });

  const normalized = normalizeTransactionsPayload(records);
  if (!normalized) {
    throw new Error('CSV形式は正しいですが、データ内容に不正な行があります');
  }

  return normalized;
}
