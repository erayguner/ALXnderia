# Cloud Account & Identity Intelligence — Architecture Document

## A. Research Summary

### Provider Identity Models

| Provider | Entity | Key Identifiers | Source |
|---|---|---|---|
| AWS | Account | `account_id` (12-digit string), `account_name`, `org_id` (o-prefix) | [IAM Identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html) |
| AWS | IAM User | `user_name`, `user_id` (AIDA prefix), ARN | Same |
| AWS | IDC User | `UserId` (UUID), `UserName`, `IdentityStoreId` (d-prefix) | [Identity Store API](https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/welcome.html) |
| AWS | IDC Group | `GroupId` (UUID), `DisplayName` | Same |
| AWS | Permission Set | ARN, name; assigned as (principal, pset, account) triple | [Permission Sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html) |
| GCP | Project | `project_id` (immutable string), `project_number` (numeric), `project_name` (mutable) | [Resource Manager](https://cloud.google.com/resource-manager/docs/creating-managing-projects) |
| GCP | Workspace User | `id` (Directory API), `primaryEmail`, `customerId`, `suspended` | [Directory API Users](https://developers.google.com/admin-sdk/directory/reference/rest/v1/users) |
| GCP | Workspace Group | `id`, `email`, `name`, `adminCreated` | [Directory API Groups](https://developers.google.com/admin-sdk/directory/reference/rest/v1/groups) |
| GCP | IAM Binding | `(principal, role, resource)`; principal formats: `user:`, `group:`, `serviceAccount:` | [IAM Overview](https://cloud.google.com/iam/docs/overview) |

### Security Standards Referenced

| Standard | Relevance | Source |
|---|---|---|
| **ISO 27001:2022** | ISMS controls: A.5 (policies), A.8 (asset management), A.9 (access control) | ISO/IEC 27001:2022 |
| **SOC 2 TSC** | CC6 (logical/physical access), CC7 (system operations), CC8 (change management) | AICPA Trust Services Criteria |
| **NIST SP 800-53 Rev 5** | AC (access control), AU (audit), IA (identification/auth), SC (comms protection), SI (integrity) | [NIST](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) |
| **CIS PostgreSQL 16 Benchmark 1.1.0** | Auth hardening (SCRAM-SHA-256), logging, connection limits, extension control | [CIS Benchmarks](https://www.cisecurity.org/benchmark/postgresql) |
| **GDPR / UK GDPR** | Data minimisation, right to erasure, lawful basis for processing, DPIAs | GDPR Art. 5, 6, 17, 25, 35 |

### PostgreSQL Features Used

| Feature | Purpose | Docs |
|---|---|---|
| **Row-Level Security** | Tenant data isolation | [PG 16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) |
| **Declarative Partitioning** | Time-based partitioning for history/audit tables | [PG 16 Partitioning](https://www.postgresql.org/docs/16/ddl-partitioning.html) |
| **pgcrypto** | SHA-256 hashing (hash chains), gen_random_uuid(), potential column encryption | [pgcrypto](https://www.postgresql.org/docs/16/pgcrypto.html) |
| **SCRAM-SHA-256** | Password authentication (CIS-compliant) | PG 16 auth docs |

---

## B. Text ERD Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         REFERENCE LAYER                              │
│  ┌──────────────┐   ┌──────────────┐                                │
│  │cloud_provider│   │    tenant    │                                │
│  │  (aws, gcp)  │   │ (multi-org)  │                                │
│  └──────────────┘   └──────┬───────┘                                │
│                            │ 1:N on all tables below                │
├────────────────────────────┼─────────────────────────────────────────┤
│                     OPERATIONAL LAYER                                │
│                            │                                        │
│  ┌─────────────┐  ┌───────┴───────┐  ┌──────────────┐             │
│  │ aws_account  │  │    person    │  │  gcp_project  │             │
│  └──────┬──────┘  └───┬───┬───┬──┘  └──────┬───────┘             │
│         │              │   │   │             │                      │
│  ┌──────┴──────┐  ┌───┘   │   └───┐  ┌─────┴──────────┐          │
│  │aws_iam_user │  │       │       │  │gcp_workspace_   │          │
│  │  + policies │  │       │       │  │  user / group   │          │
│  └─────────────┘  │       │       │  │  + membership   │          │
│                   │       │       │  └─────┬───────────┘          │
│  ┌────────────────┘       │       └─┐      │                      │
│  │aws_idc_user            │         │      │                      │
│  │aws_idc_group           │         │gcp_iam_binding              │
│  │aws_idc_group_membership│         │(principal→role→project)     │
│  │aws_idc_permission_set  │         │                             │
│  │aws_idc_account_assign. │         │                             │
│  └────────────────────────┘         └─────────────────────────────│
│                                                                    │
│  ┌─────────────┐  ┌──────────────────────┐                        │
│  │ person_link │  │ mv_effective_access   │ (materialised view)   │
│  │(cross-prov) │  │ fn_..._as_of()       │ (temporal function)   │
│  └─────────────┘  └──────────────────────┘                        │
├──────────────────────────────────────────────────────────────────────┤
│                  HISTORY / BACKUP / DLP LAYER                       │
│                                                                     │
│  ┌──────────────────┐  ┌────────────────────┐                      │
│  │  entity_history  │  │ snapshot_registry  │                      │
│  │ (partitioned by  │  │ (full-sync records)│                      │
│  │  month, append-  │  └────────────────────┘                      │
│  │  only, hash-     │                                              │
│  │  chained)        │  ┌────────────────────┐                      │
│  └──────────────────┘  │  audit_log         │                      │
│                        │ (partitioned by Q) │                      │
│  ┌──────────────────┐  └────────────────────┘                      │
│  │  legal_hold      │                                              │
│  │  retention_policy│                                              │
│  └──────────────────┘                                              │
├──────────────────────────────────────────────────────────────────────┤
│                     SECURITY LAYER                                   │
│                                                                     │
│  Roles: admin, ingest, analyst, readonly, audit, app                │
│  RLS:   tenant_id isolation via app.current_tenant_id session var   │
│  Views: v_person_redacted, v_*_redacted (PII masking)               │
│  Auth:  SCRAM-SHA-256, pg_hba.conf hardened                         │
└──────────────────────────────────────────────────────────────────────┘
```

**Tenancy model**: Every operational and history table carries `tenant_id`. RLS policies enforce that non-admin roles can only see rows matching `current_setting('app.current_tenant_id')`. This provides logical data isolation within a single database. Physical isolation (separate databases per tenant) is supported by deploying additional instances if required.

---

## C. PostgreSQL DDL

All DDL is in the `schema/` directory, organised by numbered subdirectory:

| Directory | Contents |
|---|---|
| `00-extensions/` | uuid-ossp, pgcrypto |
| `01-reference/` | cloud_provider, tenant |
| `02-aws/` | aws_account, aws_iam_user, aws_iam_user_policy_attachment, aws_idc_user, aws_idc_group, aws_idc_group_membership, aws_idc_permission_set, aws_idc_account_assignment |
| `03-gcp/` | gcp_project, gcp_workspace_user, gcp_workspace_group, gcp_workspace_group_membership, gcp_iam_binding |
| `04-identity/` | person, person_link (+ deferred FKs) |
| `05-views/` | mv_effective_access, fn_effective_access_as_of() |
| `06-queries/` | 7 basic + 12 advanced example queries |
| `07-indexes/` | All secondary btree + GIN indexes |
| `08-security/` | Roles + grants, RLS policies, audit_log (partitioned) |
| `09-history/` | entity_history (partitioned, hash-chained), snapshot_registry, verify_entity_integrity_chain() |
| `10-dlp/` | retention_policy, legal_hold, PII redaction views + functions |

### Extensions and Justification

| Extension | Purpose |
|---|---|
| `uuid-ossp` | Generate v4 UUIDs for primary keys (provider-agnostic, no sequential leakage) |
| `pgcrypto` | `gen_random_uuid()`, `digest()` for SHA-256 hash chains, potential `pgp_sym_encrypt()` for column-level encryption |
| `pgaudit` (server-level) | DDL and role-change auditing to server logs; shipped to SIEM |

---

## D. Effective Access + As-Of Strategy

### Current-State: Materialised View

`mv_effective_access` unions four query branches:
1. AWS IDC direct user → permission_set → account
2. AWS IDC group → membership → user → permission_set → account
3. GCP direct user → role → project
4. GCP group → membership → user → role → project

**Refresh**: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_effective_access;` after each sync cycle. The `CONCURRENTLY` option uses the unique index `idx_mv_ea_unique` to avoid locking readers during refresh.

**Incremental refresh** (for very large deployments): PostgreSQL does not natively support incremental materialised view refresh. Two strategies:
1. **Trigger-based differential table**: Maintain a `effective_access_delta` table populated by triggers on the upstream tables. Periodically merge deltas into the mat view. Adds complexity; recommended only above ~10M rows.
2. **Application-side cache**: Compute effective access in the application layer with Redis/Memcached, invalidated by sync pipeline events. Database remains source of truth.

### Temporal: fn_effective_access_as_of()

For investigations and drift detection, `fn_effective_access_as_of(tenant_id, timestamp)` reconstructs the full effective-access graph at any past point in time by:
1. Querying `entity_history` for the latest state of each entity before the target timestamp.
2. Filtering out entities with `event_action = 'DELETED'`.
3. Joining the reconstructed entities using the same four-branch UNION ALL logic.

**Performance**: This function scans `entity_history` which is partitioned by month. Partition pruning applies when the target timestamp is known at plan time. The index `idx_eh_entity_lookup` supports the DISTINCT ON pattern efficiently.

**Trade-off**: Slower than the mat view (seconds vs milliseconds) but provides arbitrary point-in-time access. Acceptable for audit/investigation use cases that are not latency-sensitive.

### Example Queries

See `schema/06-queries/020_advanced_queries.sql` for all 10 required queries plus 2 bonuses:
1. Effective access for a person (direct + group)
2. Who can access a given AWS account
3. Who can access a given GCP project
4. Dormant users with high privilege (access review)
5. Privilege drift (yesterday vs today)
6. Snapshot generation
7. Reconstruct provider state as-of timestamp
8. List deletions in last N days
9. Legal-hold export scope
10. Verify integrity chain
11. (Bonus) Orphan detection
12. (Bonus) Reconciliation count diffs

---

## E. Security / Control Mapping Table

| # | Control Theme | Standard Reference | Design Feature |
|---|---|---|---|
| 1 | **Least privilege** | ISO A.9.2, NIST AC-6, SOC2 CC6.1 | Six database roles with minimal grants; no shared superuser for applications; RLS enforces tenant boundaries |
| 2 | **Authentication strength** | CIS PG 3.1, NIST IA-5 | SCRAM-SHA-256 only (pg_hba.conf); no md5 or trust auth; connection-level enforcement |
| 3 | **Tenant data isolation** | SOC2 CC6.1-CC6.3, ISO A.8 | RLS on all tenant-scoped tables; `FORCE ROW LEVEL SECURITY` even for table owners; session variable `app.current_tenant_id` |
| 4 | **Encryption in transit** | NIST SC-8, ISO A.10.1, CIS PG 3.2 | TLS required for non-local connections (production pg_hba.conf should enforce `hostssl`); local dev uses `sslmode=disable` with documentation |
| 5 | **Encryption at rest** | NIST SC-28, ISO A.10.1 | Disk-level encryption (LUKS/dm-crypt or cloud-managed EBS/PD encryption); optional column-level via `pgp_sym_encrypt()` for sensitive fields |
| 6 | **Key management** | NIST SC-12, ISO A.10.1 | Assumption: keys managed by cloud KMS (AWS KMS / GCP Cloud KMS) or HashiCorp Vault; rotation schedule: 90 days for data keys, annual for master keys |
| 7 | **Audit logging (DML)** | NIST AU-3, AU-12, SOC2 CC7.2, ISO A.12.4 | `audit_log` table (partitioned, append-only) captures who/what/when/from-where for all mutations; ingest role can INSERT but not UPDATE/DELETE |
| 8 | **Audit logging (DDL)** | CIS PG 4.1, NIST AU-12 | `pgaudit` extension logs all DDL and role changes to server log; shipped to SIEM |
| 9 | **Tamper evidence** | NIST SI-7, SOC2 CC7.2 | SHA-256 hash chain on `entity_history`; `verify_entity_integrity_chain()` function for on-demand verification; Merkle root on snapshots |
| 10 | **Data integrity** | NIST SI-7, ISO A.14.1 | PK/FK constraints, CHECK constraints (format validation), UNIQUE constraints (provider ID deduplication), NOT NULL on required fields |
| 11 | **Immutable history** | SOC2 CC7.2, ISO A.12.4, NIST AU-9 | `entity_history` and `audit_log`: ingest role has INSERT-only; no UPDATE/DELETE/TRUNCATE grants; partitions can be detached to read-only tablespaces |
| 12 | **Data minimisation (PII)** | GDPR Art. 5(1)(c), Art. 25 | PII redaction views (`v_*_redacted`) for analytics; `cloudintel_readonly` role only sees redacted views; `raw_payload` excluded from history snapshots by default |
| 13 | **Right to erasure** | GDPR Art. 17 | `retention_policy` table with configurable PII redaction and hard-delete schedules; respects legal holds; purge function with dry-run |
| 14 | **Legal hold / preservation** | SOC2 CC7.4, NIST AU-11 | `legal_hold` table blocks purge of covered data; holds are released (never deleted); audit trail of hold lifecycle |
| 15 | **Backup / DR** | NIST CP-9, CP-10, ISO A.12.3, SOC2 CC7.5 | See section F below: WAL archiving, PITR, streaming replication, tested restore |
| 16 | **Secrets management** | NIST IA-5, CIS PG 3.1 | No plaintext credentials in code; `terraform.tfvars` in `.gitignore`; production: use Vault/SSM Parameter Store; connection via short-lived IAM auth tokens where supported |
| 17 | **Change management** | SOC2 CC8, ISO A.12.1, NIST CM-3 | Schema migrations via Flyway/Liquibase (see section F); CI pipeline validates migrations; `null_resource.apply_schema` triggers on file hash changes |
| 18 | **Monitoring / alerting** | NIST SI-4, SOC2 CC7.1 | Key metrics below; alerting via Prometheus/Grafana or CloudWatch |
| 19 | **Break-glass access** | NIST AC-2(2), SOC2 CC6.2 | `cloudintel_admin` role with BYPASSRLS; usage logged via pgaudit; requires separate approval workflow (documented, not automated in schema) |
| 20 | **Backup as DLP store** | NIST CP-9, SOC2 CC7.4 | `entity_history` + `snapshot_registry` enable point-in-time reconstruction; export function for provider-compatible restore payloads |

---

## F. Assumptions, Boundaries & Extension Plan

### Assumptions

1. **Single PostgreSQL cluster** for the initial deployment. Horizontal read scaling via streaming replicas; vertical scaling for write throughput.
2. **Application-managed session variable**: The connection pool (e.g., PgBouncer in transaction mode) sets `app.current_tenant_id` at the start of each transaction. RLS depends on this.
3. **Sync pipeline** is a separate service (e.g., Python/Go) that calls provider APIs and upserts into operational tables + inserts into `entity_history`. Hash chain computation happens in the pipeline, not in database triggers (to avoid serialisation bottlenecks).
4. **pgaudit** is available in the Docker image (alpine images include it). For production, use the official `postgres:16` image or a managed service (RDS/Cloud SQL) with pgaudit enabled.
5. **One IAM Identity Center instance per tenant** is the common case. Multiple instances per tenant are disambiguated by `identity_store_id` on relevant tables.

### Scope Boundaries

| In Scope | Out of Scope | Notes |
|---|---|---|
| AWS IDC users/groups/memberships, permission sets, account assignments | AWS IAM Groups (classic per-account) | Can be added as `aws_iam_group` + `aws_iam_group_membership` following the same pattern |
| AWS IAM user attached policies (ARN-level) | AWS IAM policy document analysis (Statement-level actions/resources) | Would require a `policy_statement` child table |
| GCP IAM bindings at project level | GCP IAM bindings at folder/org level | `resource_type` column exists; extend with `folder_id`/`org_id` columns |
| GCP Workspace users/groups | GCP service accounts | Trackable via `gcp_iam_binding.principal_type = 'serviceAccount'`; add a dedicated table for lifecycle tracking |
| Append-only history with hash chains | Blockchain/distributed ledger | Hash chain is single-node; consider external notarisation (RFC 3161) for legal-grade tamper proofing |
| Provider-compatible export payloads | Automated one-click restore to providers | Provider APIs have write limits (SCIM rate limits, IAM API quotas); restore is semi-automated at best |

### Provider API Limitations for Restore

| Provider | Capability | Limitation |
|---|---|---|
| AWS IAM Identity Center | SCIM provisioning, CreateUser/CreateGroup APIs | Rate limits (~10 TPS); cannot restore permission set assignments via SCIM (requires SSO Admin API) |
| AWS IAM | CreateUser, AttachUserPolicy | Cannot restore exact `user_id` (AIDA prefix is assigned by AWS); password/MFA state is not restorable from snapshots |
| Google Workspace | Directory API users.insert, groups.insert | Cannot restore `id` (assigned by Google); password hashes are not exported; 2SV state is not restorable |

**Conclusion**: The database serves as an **evidence-grade backup** from which provider state can be **reconstructed** and used to **guide** manual or scripted recovery. Full automated restore is infeasible due to provider API constraints.

### HA / DR Plan

| Component | Strategy | Target |
|---|---|---|
| **RPO** (Recovery Point Objective) | WAL archiving to object storage (S3/GCS) every 60 seconds | < 1 minute data loss |
| **RTO** (Recovery Time Objective) | Streaming replica promotion; warm standby | < 5 minutes |
| **Backup frequency** | Continuous WAL + daily base backup (pg_basebackup) | 30-day retention |
| **PITR** | `recovery_target_time` in `postgresql.auto.conf` | Arbitrary point within retention window |
| **Replication** | Synchronous streaming to 1 standby (same region); async to DR region | 0 data loss (sync), < 1 min (async) |
| **Tested restore** | Monthly automated restore-and-verify job | Pass/fail reported to monitoring |

### Migration Strategy

- **Tool**: Flyway (or Liquibase). Each SQL file in `schema/` is a versioned migration.
- **CI checks**: `flyway validate` in CI pipeline; `flyway info` for drift detection.
- **Rollback**: Each migration includes a corresponding `undo` script where feasible. Destructive changes (DROP COLUMN) are preceded by a deprecation period.
- **Blue/green**: For major schema changes, deploy to a shadow database, run validation, then swap connection strings.

### Monitoring: Key Metrics

| Metric | Threshold | Source |
|---|---|---|
| Replication lag | > 10 seconds → alert | `pg_stat_replication.replay_lag` |
| Table bloat | > 30% dead tuples → alert | `pg_stat_user_tables.n_dead_tup / n_live_tup` |
| Slow queries | > 5 seconds p99 → alert | `pg_stat_statements` |
| Connection count | > 80% of `max_connections` → alert | `pg_stat_activity` |
| WAL generation rate | > 1 GB/hour sustained → investigate | `pg_stat_wal` |
| Partition count | > 500 per table → review | `pg_partitions` system view |
| entity_history growth | > 10 GB/month → review retention | Custom metric |
| Mat view refresh duration | > 60 seconds → alert | Custom timing in refresh job |
| RLS bypass attempts | Any row in pgaudit log with BYPASSRLS → alert | pgaudit log stream |

### Data Quality & Reconciliation

1. **Count diffs**: After each sync run, compare entity counts from the provider API response against `entity_history` rows for that `sync_run_id` (see query Q12).
2. **Orphan detection**: Scheduled job runs query Q11 to find identities without a linked person.
3. **Stale entity detection**: Scheduled job flags entities where `last_seen_at` exceeds threshold (query Q7 in basic queries).
4. **Hash chain verification**: Scheduled job samples entities and runs `verify_entity_integrity_chain()` (query Q10).

### Incident Response Readiness

1. **Audit evidence**: `audit_log` + `entity_history` provide complete mutation history with actor, timestamp, client address, and correlation ID.
2. **Access review**: Query Q4 (dormant high-privilege) runs on a schedule; results feed into access certification workflows.
3. **Break-glass**: `cloudintel_admin` role exists for emergency access; usage is logged via pgaudit and triggers an alert.
4. **Forensic reconstruction**: `fn_effective_access_as_of()` enables investigators to reconstruct who had access to what at any past point in time.

### Extension Plan: Adding Azure

1. Add `'azure'` to `cloud_provider` seed data.
2. Create `schema/11-azure/`:
   - `azure_subscription` (subscription_id, display_name, tenant_id, state)
   - `azure_ad_user` (object_id, user_principal_name, display_name, account_enabled)
   - `azure_ad_group` (object_id, display_name, mail_nickname)
   - `azure_ad_group_membership` (group_id, user_id)
   - `azure_role_assignment` (principal_id, role_definition_name, scope)
3. Add `'azure_ad_user'` to `person_link.identity_type` CHECK constraint.
4. Add UNION ALL branches to `mv_effective_access` and `fn_effective_access_as_of()`.
5. Add RLS policies to new tables (same pattern).

### Extension Plan: Additional Entity Types

| Entity | Approach |
|---|---|
| **Service accounts** | New table `gcp_service_account` (email, project_id, disabled); reference from `gcp_iam_binding` |
| **Devices** | New table `device` with device_id, user_id FK, provider_code; useful for Workspace/Intune integration |
| **SCIM feeds** | SCIM is an ingestion method, not a data model change. Mark `source_of_truth = 'scim'` on affected rows |
| **Fine-grained resource hierarchy** | Add `gcp_folder`, `gcp_organisation` tables; extend `gcp_iam_binding.resource_type` to 'folder'/'organisation' with corresponding FK columns |
| **AWS IAM Groups (classic)** | Add `aws_iam_group` + `aws_iam_group_membership` tables following the IDC group pattern; add UNION branch to effective access |

### Concurrency & Locking Strategy

- **Ingestion jobs**: Use `INSERT ... ON CONFLICT DO UPDATE` (upsert) on provider-native unique constraints. This avoids explicit locking and handles concurrent syncs gracefully.
- **History inserts**: `entity_history` is append-only with no unique constraint conflicts (each row has a new auto-generated ID). Multiple sync workers can insert concurrently without contention.
- **Mat view refresh**: `REFRESH MATERIALIZED VIEW CONCURRENTLY` takes a `ShareUpdateExclusiveLock` which does not block reads. Only one refresh can run at a time (serialised by PG).
- **Deadlock prevention**: Ingestion pipeline processes entities in a deterministic order (sorted by entity_type, then entity_id) within each transaction to prevent deadlocks when multiple workers target the same tenant.

### Partitioning Strategy Summary

| Table | Partition Key | Strategy | Reasoning |
|---|---|---|---|
| `entity_history` | `event_time` | Monthly RANGE | Enables efficient partition pruning for as-of queries; old partitions can be detached for archival |
| `audit_log` | `event_time` | Quarterly RANGE | Lower volume than history; quarterly is sufficient for retention management |
| Operational tables | None (current) | Consider LIST by `tenant_id` at >100 tenants | Avoids hot partitions; enables per-tenant maintenance |

### Caching Strategy

The database is the **sole source of truth**. Caching is optional and advisory:
- **Mat view** (`mv_effective_access`): Serves as a database-internal cache of the effective-access computation. Refreshed every 5-15 minutes by a scheduled job.
- **Application cache** (Redis/Memcached): Cache the result of "who can access X" and "what can person Y access" queries with a TTL matching the mat view refresh interval. Invalidate on sync completion events.
- **No query-result caching at the PG level**: PostgreSQL does not have a built-in query cache. The `shared_buffers` and OS page cache provide block-level caching which is sufficient.
