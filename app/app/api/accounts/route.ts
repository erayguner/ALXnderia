import { NextRequest } from 'next/server';
import { handleAccountList } from '../../../src/server/routes/accounts';

export async function GET(request: NextRequest) {
  return handleAccountList(request);
}
