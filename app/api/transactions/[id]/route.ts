import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

type DbTransaction = {
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
};

const mapTransaction = (transaction: DbTransaction) => ({
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const amount = Number(body.amount);

  if (!body.date || !body.vendorName || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'invalid transaction payload' }, { status: 400 });
  }

  try {
    const transaction = await prisma.transaction.update({
      where: { id },
      data: {
        type: body.type === '売上' ? 'sales' : 'expense',
        transactionDate: new Date(body.date),
        vendorName: body.vendorName,
        productName: body.productName ?? null,
        amount,
        category: body.category ?? '未分類',
        sourceType: body.sourceType ?? 'manual',
        note: body.note ?? '',
      },
    });

    return NextResponse.json(mapTransaction(transaction));
  } catch {
    return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await prisma.transaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  }
}
