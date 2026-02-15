import { NextRequest } from 'next/server';
import { handleResourcesList } from '../../../src/server/routes/resources';

export async function GET(request: NextRequest) {
  return handleResourcesList(request);
}
