/**
 * Shared TypeScript type definitions for the NL2SQL application.
 *
 * These types are consumed by both client and server code.
 * Keep this file free of runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

/** Payload sent by the client when submitting a natural-language question. */
export interface ChatRequest {
  question: string;
  conversationId?: string;
}

/** High-level plan describing how a query will be answered. */
export interface QueryPlan {
  description: string;
  tablesUsed: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/** Full response returned to the client after processing a question. */
export interface ChatResponse {
  id: string;
  queryPlan: QueryPlan;
  sql: string;
  results: Record<string, unknown>[];
  narrative: string;
  explanation: string;
  metadata: QueryMetadata;
  followUpSuggestions: string[];
  clarificationNeeded?: ClarificationRequest;
}

/** Returned when the agent cannot unambiguously interpret the question. */
export interface ClarificationRequest {
  message: string;
  options: string[];
}

/** Execution statistics attached to every successful query response. */
export interface QueryMetadata {
  tablesUsed: string[];
  rowCount: number;
  executionTimeMs: number;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

/** Represents the authenticated user session (hydrated from JWT / cookie). */
export interface UserSession {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantSlug: string;
  role: 'admin' | 'analyst' | 'readonly';
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

/** Standard paginated request parameters. */
export interface PaginatedRequest {
  page: number;
  limit: number;
  search?: string;
}

/** Standard paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Database types
// ---------------------------------------------------------------------------

/** Top-level schema metadata retrieved from the database catalogue. */
export interface SchemaMetadata {
  tables: TableMetadata[];
  materializedViews: TableMetadata[];
  functions: FunctionMetadata[];
}

/** Metadata for a single table or materialised view. */
export interface TableMetadata {
  name: string;
  description: string;
  columns: ColumnMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

/** Metadata for a single column within a table. */
export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

/** Metadata for a foreign-key relationship. */
export interface ForeignKeyMetadata {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

/** Metadata for a database function or stored procedure. */
export interface FunctionMetadata {
  name: string;
  args: string;
  returnType: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

/** A single audit-log entry recording a query event. */
export interface AuditEntry {
  id: string;
  userId: string;
  tenantId: string;
  question: string;
  sqlExecuted: string;
  rowCount: number;
  executionTimeMs: number;
  timestamp: Date;
  status: 'success' | 'error' | 'rejected';
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

/** Result of validating a generated SQL statement against security rules. */
export interface SqlValidationResult {
  valid: boolean;
  errors: string[];
  sanitisedSql?: string;
  statementType?: string;
  tablesReferenced?: string[];
  functionsUsed?: string[];
}
