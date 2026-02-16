import { NextRequest } from 'next/server';
import { handleGroupDetails } from '../../../../src/server/routes/groups';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleGroupDetails(request, id);
}
