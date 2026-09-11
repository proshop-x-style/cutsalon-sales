import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
  const transactions = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(transactions.map(mapTransaction));
}

export async function POST(request: Request) {
  const body = await request.json();
  const type = body.type === '売上' ? 'sales' : 'expense';
  const amount = Number(body.amount);

  if (!body.date || !body.vendorName || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'invalid transaction payload' }, { status: 400 });
  }

  const transaction = await prisma.transaction.create({
    data: {
      type,
      transactionDate: new Date(body.date),
      vendorName: body.vendorName,
      productName: body.productName ?? null,
      amount,
      category: body.category ?? '未分類',
      sourceType: body.sourceType ?? 'manual',
      note: body.note ?? '',
    },
  });

  return NextResponse.json(mapTransaction(transaction), { status: 201 });
}

export async function DELETE() {
  await prisma.transaction.deleteMany();
  return NextResponse.json({ success: true });
}
