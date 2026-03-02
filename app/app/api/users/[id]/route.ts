import { NextRequest } from 'next/server';
import { handleUserDetail } from '@server/routes/users';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleUserDetail(request, id);
}
