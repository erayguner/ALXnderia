import { NextRequest } from 'next/server';
import { handleGroupsList } from '../../../src/server/routes/groups';

export async function GET(request: NextRequest) {
  return handleGroupsList(request);
}
