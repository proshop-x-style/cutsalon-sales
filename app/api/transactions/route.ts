import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const TRANSACTIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.transactions (
  id text PRIMARY KEY,
  type text NOT NULL,
  transaction_date timestamptz NOT NULL,
  vendor_name text,
  product_name text,
  amount integer NOT NULL,
  category text NOT NULL,
  source_type text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
`;

const isMissingTransactionsTableError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: string }).code;
  if (code === 'P2021') {
    return true;
  }

  const message = (error as { message?: string }).message;
  return typeof message === 'string' && message.includes('public.transactions');
};

const withTransactionsTableReady = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTransactionsTableError(error)) {
      throw error;
    }

    await prisma.$executeRawUnsafe(TRANSACTIONS_TABLE_SQL);
    return operation();
  }
};

const mapTransaction = (transaction: {
  id: string;
  type: string;
  transactionDate: Date;
  vendorName: string | null;
  productName?: string | null;
  amount: number;
  category: string;
  sourceType: string;
  note: string | null;
  createdAt: Date;
}) => ({
  id: transaction.id,
  date: transaction.transactionDate.toISOString().slice(0, 10),
  type: transaction.type === 'sales' ? '売上' : '経費',
  vendorName: transaction.vendorName ?? '未分類',
  productName: transaction.productName ?? '',
  amount: transaction.amount,
  category: transaction.category,
  sourceType: transaction.sourceType as 'daily_report' | 'receipt' | 'card_statement' | 'manual',
  note: transaction.note ?? '',
  createdAt: transaction.createdAt.toISOString(),
});

export async function GET() {
  const transactions = await withTransactionsTableReady(() =>
    prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json(transactions.map(mapTransaction));
}

export async function POST(request: Request) {
  const body = await request.json();
  const type = body.type === '売上' || body.type === 'sales' ? 'sales' : 'expense';
  const amount = Number(body.amount);
  const normalizedVendorName =
    typeof body.vendorName === 'string' && body.vendorName.trim() !== ''
      ? body.vendorName.trim()
      : type === 'sales'
        ? '券売機日計表'
        : '未分類';
  const normalizedCategory =
    typeof body.category === 'string' && body.category.trim() !== ''
      ? body.category.trim()
      : type === 'sales'
        ? '現金売上'
        : '未分類';

  if (!body.date || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'invalid transaction payload' }, { status: 400 });
  }

  const transaction = await withTransactionsTableReady(() =>
    prisma.transaction.create({
      data: {
        type,
        transactionDate: new Date(body.date),
        vendorName: normalizedVendorName,
        productName: body.productName ?? null,
        amount,
        category: normalizedCategory,
        sourceType: body.sourceType ?? 'manual',
        note: body.note ?? '',
      },
    }),
  );

  return NextResponse.json(mapTransaction(transaction), { status: 201 });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.confirmReset || body.confirmReset !== true) {
    return NextResponse.json({ error: 'confirmation required' }, { status: 400 });
  }

  await withTransactionsTableReady(() => prisma.transaction.deleteMany());
  return NextResponse.json({ success: true });
}
