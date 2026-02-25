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
    console.error('[chat] Error processing question:', message);

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

    // Provide helpful error messages without leaking internals
    let safeMessage: string;
    let suggestions: string[] = [];

    if (message.includes('validation') || message.includes('execution failed')) {
      safeMessage = 'The generated query could not be validated. Please try rephrasing your question.';
      suggestions = [
        'Try being more specific, e.g. "Who has access to demo-data-prod?"',
        'Specify the provider: "Show all AWS accounts" or "List GCP projects"',
        'Ask about a specific person: "What can Alice access?"',
      ];
    } else if (message.includes('parse') || message.includes('JSON')) {
      safeMessage = 'Failed to interpret the response. Please try rephrasing your question.';
      suggestions = ['Try a simpler question first, then drill down'];
    } else if (message.includes('timeout') || message.includes('connect')) {
      safeMessage = 'Database connection issue. Please try again in a moment.';
    } else {
      safeMessage = 'Failed to process your question. Please try rephrasing.';
      suggestions = [
        'Try "Show all AWS accounts"',
        'Try "Who has access to demo-data-prod?"',
        'Try "List GCP projects"',
      ];
    }

    return NextResponse.json(
      { error: safeMessage, suggestions },
      { status: 500 },
    );
  }
}
