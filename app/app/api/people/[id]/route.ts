import { NextRequest } from 'next/server';
import { handlePersonDetail } from '@server/routes/people';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handlePersonDetail(request, id);
}
