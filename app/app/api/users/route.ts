import { NextRequest } from 'next/server';
import { handleUserList } from '../../../src/server/routes/users';

export async function GET(request: NextRequest) {
  return handleUserList(request);
}
