# Security Policy

## Supported Versions

The `main` branch is the active production branch. Security patches are applied to `main` and released as new container image tags.

## Reporting a Vulnerability

Please report security issues privately. **Do not open a public issue.**

1. Use [GitHub Security Advisories](https://github.com/erayguner/ALXnderia/security/advisories/new) for this repository.
2. Email the security contact for your organisation.

Include a clear description, steps to reproduce, and any known impact. If the vulnerability involves the SQL validation pipeline or tenant isolation, classify it as critical.

## Response Expectations

We aim to acknowledge valid reports within 3 business days and provide status updates until remediation is complete.

## Security Architecture

### SQL Validation (Defence-in-Depth)

All AI-generated SQL passes through a **7-layer validation pipeline** before execution:

1. Comment stripping (prevents obfuscation)
2. Keyword blocklist (rejects DDL, DML, administrative keywords)
3. AST parsing via `libpg-query` WASM (PostgreSQL's actual parser)
4. Statement type enforcement (SELECT only)
5. Table allowlisting (only pre-approved tables)
6. Function blocklisting (blocks dangerous/administrative functions)
7. Automatic LIMIT injection (prevents resource exhaustion)

### Tenant Isolation

- All tables use composite primary keys `(id, tenant_id)`.
- The application sets `SET LOCAL app.current_tenant_id` per transaction.
- Row-Level Security policies are planned; the session variable is set for forward compatibility.

### Data Protection

- PII-containing tables are tracked in `PII_TABLES` configuration.
- Audit entries log metadata only (question, SQL, row count, timing) -- never result data.
- All secrets stored in AWS Secrets Manager / GCP Secret Manager.
- No credentials are committed to the repository.

### CI/CD Security

| Pipeline | Security Function |
|----------|-------------------|
| **CodeQL** | SAST with `security-extended` + `security-and-quality` queries |
| **Checkov** | Terraform IaC scan, secrets scan, GitHub Actions config scan |
| **Security Audit** | npm audit, SQL injection pattern scanner, TruffleHog secret detection, license compliance |

### Infrastructure

- Database deployed in private subnets with no public IP (both AWS and GCP).
- Compute connects to database through VPC-internal networking only.
- Container images scanned on push (ECR scan-on-push, Artifact Registry).
- Terraform state encrypted at rest (S3 with KMS / GCS with default encryption).

## Security Guidelines for Contributors

- Never commit secrets, API keys, `.env` files, or credentials.
- Never add tables to `ALLOWED_TABLES` without considering data exposure.
- Never bypass the SQL validator or `executeWithTenant()` for user-facing queries.
- Never store query result data in audit logs.
- Never expose PII through new API endpoints without redaction.
- Always validate user input at system boundaries.
- Always use parameterised queries -- never string concatenation for SQL.
- Run `npm audit` before submitting PRs that add or update dependencies.
