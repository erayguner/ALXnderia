import { NextRequest, NextResponse } from 'next/server';
import { processQuestion } from '../agents/nl2sql-agent';
import { recordAuditEntry } from '../middleware/audit';
import { MAX_QUESTION_LENGTH } from '../../shared/constants';

// Mock session for MVP (replace with Auth.js in production)
function getSession() {
  return {
    userId: 'demo-user-001',
    email: 'analyst@demo-example.co.uk',
    name: 'Demo Analyst',
    tenantId: '11111111-1111-1111-1111-111111111111',
    tenantSlug: 'demo',
    role: 'analyst' as const,
  };
}

export async function handleChat(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: { question?: string; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: 'Question is required' }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Question exceeds maximum length of ${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const response = await processQuestion(
      { question, conversationId: body.conversationId },
      session.tenantId,
      session.role,
    );

    // Record audit entry (fire-and-forget)
    recordAuditEntry({
      userId: session.userId,
      tenantId: session.tenantId,
      question,
      sqlExecuted: response.sql,
      rowCount: response.metadata.rowCount,
      executionTimeMs: response.metadata.executionTimeMs,
      timestamp: new Date(),
      status: 'success',
    }).catch(() => {});

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    // Audit the failure too
    recordAuditEntry({
      userId: session.userId,
      tenantId: session.tenantId,
      question,
      sqlExecuted: '',
      rowCount: 0,
      executionTimeMs: 0,
      timestamp: new Date(),
      status: 'error',
      rejectionReason: message,
    }).catch(() => {});

    // Don't leak internal errors to client
    const safeMessage = message.includes('validation')
      ? message
      : 'Failed to process your question. Please try rephrasing.';

    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
