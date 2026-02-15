import { NextRequest } from 'next/server';
import { handleChat } from '../../../src/server/routes/chat';

export async function POST(request: NextRequest) {
  return handleChat(request);
}
