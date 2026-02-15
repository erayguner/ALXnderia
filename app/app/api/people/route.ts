import { NextRequest } from 'next/server';
import { handlePeopleList } from '../../../src/server/routes/people';

export async function GET(request: NextRequest) {
  return handlePeopleList(request);
}
