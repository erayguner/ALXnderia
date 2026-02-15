/**
 * SQL Validator using PostgreSQL's actual parser (libpg-query WASM).
 *
 * This module is the **critical security layer** between the LLM-generated
 * SQL and the database.  It employs a defence-in-depth approach:
 *
 *  1. Strip comments (prevent obfuscation)
 *  2. Pre-parse keyword check (belt-and-braces)
 *  3. Parse SQL into an AST via libpg-query
 *  4. Validate statement type (SELECT only)
 *  5. Validate table references against an allow-list
 *  6. Validate function calls against a block-list
 *  7. Enforce a row limit when none is present
 */

import type { SqlValidationResult } from '../../shared/types';
import {
  ALLOWED_TABLES,
  BLOCKED_FUNCTIONS,
  BLOCKED_TABLE_PREFIXES,
  BLOCKED_KEYWORDS,
  MAX_ROWS,
} from '../../shared/constants';

// ---------------------------------------------------------------------------
// Lazy-load the WASM parser
// ---------------------------------------------------------------------------

let pgQuery: { parse: (sql: string) => Promise<{ stmts: Array<{ stmt: Record<string, unknown> }> }> } | null = null;

async function getParser() {
  if (!pgQuery) {
    pgQuery = await import('libpg-query');
  }
  return pgQuery;
}

// ---------------------------------------------------------------------------
// Pre-parse helpers
// ---------------------------------------------------------------------------

/**
 * Strip both single-line (`--`) and multi-line (`/* ... * /`) SQL comments.
 *
 * Comments are removed before parsing to prevent obfuscation attacks
 * where malicious SQL is hidden inside comments that confuse the
 * pre-parse checks but are still executed by certain drivers.
 */
function stripComments(sql: string): string {
  // Remove single-line comments
  let result = sql.replace(/--[^\n]*/g, '');
  // Remove multi-line comments (non-greedy)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result.trim();
}

/**
 * Pre-parse keyword check.
 *
 * This runs **before** the AST is available and catches obviously
 * dangerous patterns early.  It is deliberately conservative: some
 * of these keywords would also be caught by the AST statement-type
 * check, but having both layers reduces the blast radius if one
 * layer has a bug.
 */
function checkBlockedKeywords(sql: string): string[] {
  const errors: string[] = [];
  const upper = sql.toUpperCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    // Match as a whole word to avoid false positives
    // (e.g. "ANALYZE" inside a column name)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upper)) {
      errors.push(`Blocked keyword detected: ${keyword}`);
    }
  }

  // Reject multiple statements (semicolons not at the very end)
  const trimmed = sql.replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    errors.push('Multiple statements are not permitted');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// AST extraction helpers
// ---------------------------------------------------------------------------

/**
 * Recursively extract all table references (RangeVar nodes) from the AST.
 */
function extractTableRefs(node: unknown, tables: Set<string>): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  // RangeVar represents a table/view reference in the parse tree
  if (obj.RangeVar) {
    const rv = obj.RangeVar as Record<string, unknown>;
    const schema = rv.schemaname as string | undefined;
    const table = rv.relname as string;
    const fullName = schema ? `${schema}.${table}` : table;
    tables.add(fullName.toLowerCase());
  }

  // Recurse into all child properties
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        extractTableRefs(item, tables);
      }
    } else if (typeof value === 'object' && value !== null) {
      extractTableRefs(value, tables);
    }
  }
}

/**
 * Recursively extract all function invocations (FuncCall nodes) from the AST.
 */
function extractFunctionCalls(node: unknown, funcs: Set<string>): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  // FuncCall represents a function invocation
  if (obj.FuncCall) {
    const fc = obj.FuncCall as Record<string, unknown>;
    const funcname = fc.funcname as Array<Record<string, unknown>> | undefined;
    if (funcname) {
      const name = funcname
        .map((f) => {
          const strNode = f.String as Record<string, string> | undefined;
          return strNode?.sval || (f as Record<string, string>).str || '';
        })
        .join('.')
        .toLowerCase();
      if (name) funcs.add(name);
    }
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        extractFunctionCalls(item, funcs);
      }
    } else if (typeof value === 'object' && value !== null) {
      extractFunctionCalls(value, funcs);
    }
  }
}

/**
 * Determine whether the top-level SELECT statement includes a LIMIT clause.
 */
function hasLimitClause(stmt: Record<string, unknown>): boolean {
  const selectStmt = stmt.SelectStmt as Record<string, unknown> | undefined;
  if (!selectStmt) return false;
  return selectStmt.limitCount !== undefined && selectStmt.limitCount !== null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a SQL string for safety before execution.
 *
 * @param rawSql - The raw SQL generated by the LLM.
 * @returns A validation result indicating whether the SQL is safe,
 *          along with any errors and the sanitised SQL (if valid).
 */
export async function validateSql(rawSql: string): Promise<SqlValidationResult> {
  const errors: string[] = [];

  // Step 1: Strip comments
  const sql = stripComments(rawSql);
  if (!sql) {
    return { valid: false, errors: ['Empty SQL after stripping comments'] };
  }

  // Step 2: Pre-parse keyword check
  const keywordErrors = checkBlockedKeywords(sql);
  if (keywordErrors.length > 0) {
    return { valid: false, errors: keywordErrors };
  }

  // Step 3: Parse SQL into AST via libpg-query
  let ast: { stmts: Array<{ stmt: Record<string, unknown> }> };
  try {
    const parser = await getParser();
    const result = await parser.parse(sql);
    ast = result;
  } catch (parseError: unknown) {
    const msg = parseError instanceof Error ? parseError.message : 'Unknown parse error';
    return { valid: false, errors: [`SQL parse error: ${msg}`] };
  }

  // Step 4: Validate statement count and type
  if (!ast.stmts || ast.stmts.length === 0) {
    return { valid: false, errors: ['No valid SQL statement found'] };
  }
  if (ast.stmts.length > 1) {
    return { valid: false, errors: ['Multiple statements are not permitted'] };
  }

  const stmt = ast.stmts[0].stmt;
  const stmtType = Object.keys(stmt)[0];

  if (stmtType !== 'SelectStmt') {
    return {
      valid: false,
      errors: [`Only SELECT statements are permitted (got ${stmtType})`],
    };
  }

  // Step 5: Extract and validate table references against the allow-list
  const tables = new Set<string>();
  extractTableRefs(stmt, tables);

  // Collect CTE names so they are not rejected as unknown tables
  const cteNames = new Set<string>();
  const selectStmt = stmt.SelectStmt as Record<string, unknown> | undefined;
  if (selectStmt?.withClause) {
    const withClause = selectStmt.withClause as Record<string, unknown>;
    const ctes = withClause.ctes as Array<Record<string, unknown>> | undefined;
    if (ctes) {
      for (const cte of ctes) {
        const cteDef = cte.CommonTableExpr as Record<string, unknown> | undefined;
        if (cteDef?.ctename) {
          cteNames.add((cteDef.ctename as string).toLowerCase());
        }
      }
    }
  }

  const tablesReferenced = Array.from(tables).filter((t) => !cteNames.has(t));
  for (const table of tablesReferenced) {
    // Check blocked prefixes (system catalogues)
    if (BLOCKED_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix))) {
      errors.push(`Access to system table '${table}' is not permitted`);
    }
    // Check allow-list
    if (!ALLOWED_TABLES.has(table)) {
      errors.push(`Table '${table}' is not in the allowed list`);
    }
  }

  // Step 6: Extract and validate function calls against the block-list
  const funcs = new Set<string>();
  extractFunctionCalls(stmt, funcs);

  const functionsUsed = Array.from(funcs);
  for (const func of functionsUsed) {
    if (BLOCKED_FUNCTIONS.has(func)) {
      errors.push(`Function '${func}' is not permitted`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      statementType: stmtType,
      tablesReferenced,
      functionsUsed,
    };
  }

  // Step 7: Enforce row limit when none is specified
  let sanitisedSql = sql;
  if (!hasLimitClause(stmt)) {
    sanitisedSql = `SELECT * FROM (${sql}) AS _inner LIMIT ${MAX_ROWS}`;
  }

  return {
    valid: true,
    errors: [],
    sanitisedSql,
    statementType: stmtType,
    tablesReferenced,
    functionsUsed,
  };
}
