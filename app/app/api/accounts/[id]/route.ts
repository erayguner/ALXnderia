import { NextRequest } from 'next/server';
import { handleAccountDetail } from '../../../../src/server/routes/accounts';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleAccountDetail(request, id);
}
