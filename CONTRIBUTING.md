# Contributing to ALXnderia

Thank you for your interest in contributing. This guide covers the conventions, workflow, and standards for the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branch Strategy](#branch-strategy)
- [Commit Conventions](#commit-conventions)
- [Code Standards](#code-standards)
- [Schema Changes](#schema-changes)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Security](#security)
- [Code Review Checklist](#code-review-checklist)

---

## Getting Started

1. Clone the repository and follow [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) to provision the local database and start the application.
2. Run `npm test` and `npm run lint` in `app/` to confirm everything passes before making changes.
3. Read [docs/04_Engineering_Implementation.md](docs/04_Engineering_Implementation.md) for code conventions and project structure.

## Development Workflow

```
1. Create a feature branch from main
2. Make changes
3. Run tests and lint locally
4. Commit with conventional commit message
5. Open a pull request
6. Pass all CI checks (5 workflows)
7. Get code review approval
8. Squash and merge
```

### Local validation before pushing

```bash
cd app
npm run lint          # ESLint 9
npx tsc --noEmit     # Type check
npm test             # Vitest (14 suites)
npm run build        # Next.js production build
```

All four must pass. CI will reject PRs that fail any of these gates.

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code. Protected, requires PR + review. |
| `feature/<name>` | New features or enhancements |
| `fix/<name>` | Bug fixes |
| `schema/<name>` | Database schema changes |
| `infra/<name>` | Terraform or CI/CD changes |
| `docs/<name>` | Documentation-only changes |

Keep branches short-lived. Rebase on `main` before opening a PR.

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Use |
|------|-----|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `schema` | Database schema change (DDL, migration, seed data) |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `ci` | CI/CD pipeline changes |
| `infra` | Terraform or infrastructure changes |
| `security` | Security fix or hardening |
| `perf` | Performance improvement |
| `chore` | Tooling, dependencies, housekeeping |

### Scopes

`app`, `schema`, `infra`, `ci`, `docs`, `agent`, `validator`, `db`, `llm`, `github`, `aws`, `gcp`, `accounts`

### Examples

```
feat(github): add github_team table and team membership

schema(identity): open person_link CHECK constraint for extensibility

fix(validator): prevent function calls in subquery expressions

ci(security): add TruffleHog secret detection to security-audit workflow

infra(gcp): enable PITR on Cloud SQL instance
```

## Code Standards

### TypeScript

- Strict mode (`strict: true` in `tsconfig.json`)
- Use path aliases (`@server/*`, `@client/*`, `@shared/*`) -- never relative paths across boundaries
- All public interfaces defined in `src/shared/types/index.ts`
- No `any` types. Use `unknown` and narrow with type guards.
- Prefer `const` and `readonly`. Avoid mutation.

### Server/Client separation

```
src/server/   -- Database access, API logic, security validation
src/client/   -- React components (no direct DB or server imports)
src/shared/   -- Types and constants only (no runtime dependencies)
```

Never import from `@server/*` in client code. This is enforced by the build.

### File size

Keep files under 500 lines. If a file grows beyond this, split it into focused modules.

### Error handling

- API routes: catch errors, return structured JSON responses with appropriate HTTP status codes
- Database: always use `executeWithTenant()` for user-facing queries
- Audit: fire-and-forget pattern (`recordAuditEntry(...).catch(() => {})`)
- Never expose stack traces or internal error details to clients

### Dependencies

- Minimise new dependencies. Justify any addition in the PR description.
- Pin major versions in `package.json`.
- Run `npm audit` after adding dependencies.
- Never add dependencies that execute post-install scripts without review.

## Schema Changes

Database schema changes require extra care. Follow this process:

### Adding a new table

1. Create a `.sql` file in the appropriate numbered directory under `schema/`.
2. Follow the naming convention: `XX-category/NNN_table_name.sql`.
3. Include `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `tenant_id` FK, `created_at`, `updated_at`, and `raw_payload JSONB` columns (matching existing table patterns).
4. Add the table to `ALLOWED_TABLES` in `src/shared/constants/index.ts` if it should be queryable by the NL2SQL agent.
5. If the table contains PII, add it to `PII_TABLES`, create a redacted view, and add the mapping to `REDACTED_VIEW_MAP`.
6. Add synonyms to `SCHEMA_SYNONYMS` if the table has common alternative names.
7. Consider RLS policies, indexes, and role grants. If your table is in a directory that sorts after `08-security/`, include these in a post-setup file (see `11-github/060_github_post_setup.sql` for the pattern).
8. Add seed data in `schema/02_seed_and_queries.sql` (base seed), `schema/99-seed/010_mock_data.sql` (identity mock), or `schema/99-seed/020_cloud_resources_seed.sql` (cloud resource mock).
9. Re-run `terraform apply` in `infra/` to validate.

### Modifying existing tables

- Prefer additive changes (new columns with defaults, new indexes).
- Avoid dropping or renaming columns without a migration plan.
- Update the relevant redacted view if PII columns change.
- Update `ALLOWED_TABLES`, `SCHEMA_SYNONYMS`, and few-shot examples as needed.

### Migration ordering

Files are applied via `find | sort` in lexicographic order. The directory prefix (`00-` through `99-`) controls execution order. If your table depends on another, ensure your directory number is higher. See [docs/06_GitHub_Identity_Integration.md](docs/06_GitHub_Identity_Integration.md) for a detailed example.

## Testing Requirements

### What to test

| Change | Required tests |
|--------|---------------|
| SQL validator changes | Unit tests in `tests/server/sql-validator.test.ts` |
| New API route | Route handler tests in `tests/server/` |
| New table added to allow-list | Validator test confirming the table is accepted |
| Schema changes | CI schema validation job covers table existence, RLS, seed counts |

### Test conventions

- Use Vitest 4.x (`npm test`)
- Test files go in `app/tests/server/` (mirror the source structure)
- Mock external dependencies (LLM providers, database connections)
- Name test files `<module>.test.ts`
- Group related tests with `describe()` blocks
- Prefer explicit assertions over snapshot tests

### Coverage expectations

- SQL validator: every new rule or allow-list change must have a corresponding test
- API routes: test the happy path and primary error paths
- No formal coverage threshold, but PRs that reduce coverage will be flagged

## Pull Request Process

### Before opening a PR

- [ ] All local checks pass (lint, type-check, test, build)
- [ ] Commits follow conventional commit format
- [ ] Branch is rebased on latest `main`
- [ ] No secrets, credentials, or `.env` files included
- [ ] Schema changes include updated seed data and constants

### PR description template

```markdown
## Summary

Brief description of what changed and why.

## Changes

- Bullet list of specific changes

## Schema changes

- [ ] New tables added to `ALLOWED_TABLES`
- [ ] PII tables added to `PII_TABLES` and `REDACTED_VIEW_MAP`
- [ ] RLS policies applied
- [ ] Seed data updated
- [ ] N/A

## Testing

- [ ] New tests added
- [ ] Existing tests pass
- [ ] Manual testing performed (describe)

## Security considerations

- [ ] No new PII exposure
- [ ] SQL validator updated if needed
- [ ] No hardcoded credentials
- [ ] N/A
```

### CI checks (all must pass)

| Workflow | What it checks |
|----------|---------------|
| CI | Lint, type-check, tests, build, schema validation |
| CodeQL | Static analysis (SAST) with security-extended queries |
| Checkov | Terraform IaC scan, secrets scan, Actions config scan |
| Security Audit | npm audit, SQL injection patterns, TruffleHog, license compliance |
| Bundle Analysis | Next.js bundle size within limits |

### Review expectations

- At least one approval required before merge
- Schema changes require careful review of RLS, indexes, and role grants
- Security-related changes require review of the SQL validator impact
- Reviewers should run the branch locally for non-trivial changes

## Security

### Reporting vulnerabilities

Do **not** open a public issue for security vulnerabilities. Contact the maintainers directly.

### Security guidelines for contributors

- Never commit secrets, API keys, or credentials
- Never add tables to `ALLOWED_TABLES` without considering the data exposure
- Never bypass the SQL validator or `executeWithTenant()` for user-facing queries
- Never store query result data in audit logs (data minimisation)
- Never expose PII through new API endpoints without redaction
- Always validate user input at system boundaries
- Always use parameterised queries -- never string concatenation for SQL

### Dependency policy

- Run `npm audit` before submitting PRs that add or update dependencies
- No dependencies with known critical CVEs
- Prefer well-maintained packages with active security response
- Avoid dependencies that require native compilation where possible (exception: `libpg-query`, `pg`)

## Code Review Checklist

For reviewers:

- [ ] Code follows project conventions (path aliases, strict types, server/client separation)
- [ ] No `any` types introduced
- [ ] No secrets or credentials in code
- [ ] SQL changes are reflected in constants, validator, and seed data
- [ ] RLS implications considered for any new data access paths
- [ ] Tests cover the changed behaviour
- [ ] Error handling follows project patterns
- [ ] No unnecessary dependencies added
- [ ] Documentation updated if applicable
- [ ] Commit messages follow conventional commits
