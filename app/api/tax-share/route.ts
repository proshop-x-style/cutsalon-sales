import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'tax-share');

async function ensureCacheDir() {
  await mkdir(CACHE_DIR, { recursive: true });
}

function createToken() {
  return randomBytes(6).toString('hex');
}

function getPayloadPath(token: string) {
  return path.join(CACHE_DIR, `${token}.json`);
}

export async function POST(request: Request) {
  const payload = await request.json();
  const token = createToken();

  await ensureCacheDir();
  await writeFile(getPayloadPath(token), JSON.stringify(payload), 'utf8');

  return NextResponse.json({ token });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('id');

  if (!token) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const payload = await readFile(getPayloadPath(token), 'utf8');
    return NextResponse.json(JSON.parse(payload));
  } catch {
    return NextResponse.json({ error: 'payload not found' }, { status: 404 });
  }
}