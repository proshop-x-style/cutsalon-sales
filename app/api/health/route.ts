import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { ok: false, checkedAt: new Date().toISOString(), message: 'database unavailable' },
      { status: 503 },
    );
  }
}
