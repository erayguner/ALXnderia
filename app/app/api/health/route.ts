import { NextResponse } from 'next/server';
import { healthCheck } from '@/server/db/pool';

export async function GET() {
  const ok = await healthCheck();

  if (ok) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  return NextResponse.json({ status: 'error', message: 'database unreachable' }, { status: 503 });
}
