import { NextRequest } from 'next/server';
import { handleAccessList } from '../../../src/server/routes/access';

export async function GET(request: NextRequest) {
  return handleAccessList(request);
}
