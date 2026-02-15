import { NextRequest } from 'next/server';
import { handleAuditList } from '../../../src/server/routes/audit';

export async function GET(request: NextRequest) {
  return handleAuditList(request);
}
