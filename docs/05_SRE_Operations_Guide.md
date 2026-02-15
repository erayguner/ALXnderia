# 05 — SRE and Operations Guide: Alxderia Cloud Identity Intelligence

## Table of Contents

1. [Deployment Architecture](#1-deployment-architecture)
2. [Environments and Promotion Flow](#2-environments-and-promotion-flow)
3. [Scaling Model](#3-scaling-model)
4. [Monitoring and Alerting Strategy](#4-monitoring-and-alerting-strategy)
5. [Logging and Tracing](#5-logging-and-tracing)
6. [Backup and Disaster Recovery](#6-backup-and-disaster-recovery)
7. [Incident Response](#7-incident-response)
8. [SLIs, SLOs, and Error Budgets](#8-slis-slos-and-error-budgets)
9. [Runbooks](#9-runbooks)
10. [Assumptions](#10-assumptions)

---

## 1. Deployment Architecture

Alxderia operates across three environments: local development, AWS production, and GCP production. Each environment is independently provisioned via Terraform with no shared state.

### 1.1 Local Development

A Docker-managed PostgreSQL container provisioned by Terraform using the kreuzwerker/docker provider. State is stored in a local `terraform.tfstate` file. This environment is disposable and intended solely for development and schema validation.

### 1.2 AWS Production

```
                         Internet
                            |
                     [App Runner Service]
                      1 vCPU / 2 GB RAM
                      Auto-scaling enabled
                            |
                     [VPC Connector]
                            |
              +-------------+-------------+
              |        VPC 10.0.0.0/16    |
              |                           |
              |  +-------+   +-------+   |
              |  |Public |   |Public |   |
              |  |Subnet |   |Subnet |   |
              |  | AZ-a  |   | AZ-b  |   |
              |  +-------+   +-------+   |
              |                           |
              |  +-------+   +-------+   |
              |  |Private|   |Private|   |
              |  |Subnet |   |Subnet |   |
              |  | AZ-a  |   | AZ-b  |   |
              |  +---+---+   +---+---+   |
              |      |           |        |
              |  +---+-----------+---+   |
              |  | Aurora Serverless v2 | |
              |  | PostgreSQL 16.4     | |
              |  | 0.5 - 16 ACU        | |
              |  | Encrypted / PI      | |
              |  +---------------------+ |
              +---------------------------+

  ECR (scan on push, KMS, lifecycle: keep 10)
  Secrets Manager (DB creds JSON, LLM API key)
  S3 + DynamoDB (Terraform state locking)
```

Key IAM roles: App Runner instance role (Secrets Manager access), ECR access role, RDS enhanced monitoring role.

### 1.3 GCP Production

```
                         Internet
                            |
                     [Cloud Run v2 Service]
                      2 CPU / 4 Gi RAM
                      0 - 10 instances
                      Health probes on /api/health
                            |
                     [VPC Access Connector]
                            |
              +-------------+-------------+
              |     Custom VPC Network    |
              |                           |
              |  [Private Services Conn.] |
              |            |              |
              |  +---------+-----------+  |
              |  | Cloud SQL            | |
              |  | PostgreSQL 18        | |
              |  | Regional HA          | |
              |  | Private IP only      | |
              |  | Query Insights       | |
              |  | Backup + PITR        | |
              |  +---------------------+ |
              +---------------------------+

  Artifact Registry (Docker, cleanup: keep 10)
  Secret Manager (DB creds, LLM API key)
  GCS (Terraform state)
```

Cloud Run service account holds Secret Manager Accessor role.

---

## 2. Environments and Promotion Flow

```
  Local Dev  ──(git push)──>  CI/CD Pipeline
                                   |
                        +----------+----------+
                        |                     |
                   AWS Production        GCP Production
                   (independent)         (independent)
```

- There is no shared Terraform state between environments. Each cloud has its own backend (S3 + DynamoDB for AWS, GCS for GCP).
- Promotion is code-driven: merge to the deployment branch triggers the build-and-push script for the target cloud, followed by `terraform apply`.
- Schema migrations are applied independently per environment via `migrate-schema.sh`.

---

## 3. Scaling Model

| Component | AWS | GCP |
|---|---|---|
| Compute | App Runner auto-scaling (1 vCPU, 2 GB per instance) | Cloud Run 0-10 instances (2 CPU, 4 Gi per instance) |
| Database | Aurora Serverless v2, 0.5-16 ACU, scales on demand | Cloud SQL regional HA, fixed instance with failover |
| Connection pool | min 2, max 10, idle timeout 30s, connect timeout 5s | Same pool configuration |

Aurora Serverless v2 scales ACUs automatically. Cloud SQL relies on regional high availability with automatic failover rather than elastic scaling. In both cases, the connection pool ceiling of 10 connections per application instance is the practical constraint; monitor pool exhaustion before scaling compute instances.

---

## 4. Monitoring and Alerting Strategy

### 4.1 Health Endpoint

`GET /api/health` executes `SELECT 1` against the connection pool and returns:

- `200 { "status": "ok" }` when the database is reachable.
- `503 { "status": "error", "message": "database unreachable" }` when it is not.

This endpoint is consumed by App Runner (interval 10s, timeout 5s), Cloud Run startup probe (initial delay 10s, period 10s, failure threshold 3), Cloud Run liveness probe (period 30s), and the Dockerfile `HEALTHCHECK` directive.

### 4.2 Recommended Alerts

| Alert | Condition | Severity |
|---|---|---|
| Health check failure | 3 consecutive 503 responses | Critical |
| High response latency | p99 > 2s for 5 minutes | Warning |
| Database connection pool exhaustion | Active connections = max (10) for 2 minutes | Critical |
| Aurora ACU saturation | ACU utilisation > 80% sustained | Warning |
| Cloud Run instance count at ceiling | 10/10 instances for 10 minutes | Warning |
| Secret access failure | Non-200 from Secrets Manager / Secret Manager | Critical |
| ECR / Artifact Registry push failure | Build pipeline image push fails | Critical |
| Disk / storage anomaly | Aurora storage or Cloud SQL storage growing unexpectedly | Warning |

Use CloudWatch Alarms for AWS and Cloud Monitoring alert policies for GCP. Route critical alerts to the on-call channel; route warnings to the operations channel.

---

## 5. Logging and Tracing

### 5.1 Application Logs

The application writes structured logs to stdout/stderr. App Runner forwards these to CloudWatch Logs; Cloud Run forwards them to Cloud Logging. No additional log agent is required.

### 5.2 Database Audit Trail

- **audit_log table**: Append-only (INSERT only for the ingest role; UPDATE, DELETE, and TRUNCATE are denied). Partitioned quarterly (e.g. `audit_log_2026_q1` through `_q4`). Serves as the authoritative record of all mutations.
- **entity_history table**: Hash-chained using SHA-256 for tamper evidence. Partitioned monthly (e.g. `entity_history_2026_01` through `_12`). Provides a verifiable event log for every entity state change.

### 5.3 pgaudit

pgaudit is recommended but not yet enforced. When enabled, configure it to log DDL statements and role changes. This provides an independent audit trail at the database engine level, separate from the application-level audit_log.

### 5.4 SIEM Integration

Ship CloudWatch Logs and Cloud Logging to the organisation's SIEM. At minimum, forward application error logs, audit_log INSERT events, and any pgaudit output. Retain logs for the period required by the organisation's data retention policy.

---

## 6. Backup and Disaster Recovery

### 6.1 Database Backups

| Capability | AWS (Aurora) | GCP (Cloud SQL) |
|---|---|---|
| Automated backups | Yes (continuous) | Yes |
| Point-in-time recovery | Yes | Yes (PITR enabled) |
| Encryption at rest | Yes (KMS) | Yes (default) |
| Cross-region replication | Not configured | Not configured |

### 6.2 Terraform State

- AWS: S3 bucket with DynamoDB locking. Enable versioning on the S3 bucket.
- GCP: GCS bucket. Enable object versioning.

If state is corrupted, restore from the previous S3/GCS object version.

### 6.3 Schema as Code

All 39 SQL migration files reside in the `schema/` directory under version control. The database schema can be rebuilt from scratch by running `migrate-schema.sh` against an empty database.

### 6.4 Entity History as Event Log

Because entity_history is hash-chained and append-only, it functions as an event log. In a disaster recovery scenario, the current state of entities can be reconstructed by replaying entity_history records in order, provided the chain integrity is verified.

### 6.5 Recovery Time Objectives

These are not formally defined. As a starting point, target RTO of 1 hour and RPO of 5 minutes for production databases, leveraging PITR capabilities in both clouds.

---

## 7. Incident Response

### 7.1 Common Failure Modes

| Failure | Likely Cause | Immediate Action |
|---|---|---|
| Health check returns 503 | Database unreachable | Check DB status, security groups / firewall rules, connection pool. See Runbook 9.1. |
| Application not starting | Missing secrets, bad image | Check secret access, review container logs. See Runbook 9.2. |
| Schema migration failure | SQL syntax error, lock contention | Roll back the offending SQL file, fix, re-run. See Runbook 9.3. |
| LLM API errors | LLM provider service outage or invalid key | Check provider status page, verify LLM_API_KEY secret value. See Runbook 9.4. |
| Partition not found | Missing future partition | Create partition immediately. See Runbook 9.5. |
| Stale materialised view | Refresh not triggered after ingest | Run concurrent refresh. See Runbook 9.6. |

### 7.2 Escalation Path

1. On-call engineer investigates using the relevant runbook.
2. If not resolved within 30 minutes, escalate to the platform engineering lead.
3. If a cloud provider issue is suspected, open a support case with AWS or GCP.

---

## 8. SLIs, SLOs, and Error Budgets

These are not yet formally defined. The following are recommended starting points.

### 8.1 Service Level Indicators

| SLI | Measurement |
|---|---|
| Availability | Proportion of health check requests returning 200 over a rolling 28-day window |
| Latency | p50 and p99 response time for `/api/health` and primary API endpoints |
| Error rate | Proportion of non-health HTTP requests returning 5xx over a rolling 28-day window |

### 8.2 Recommended SLOs

| SLO | Target |
|---|---|
| Availability | 99.5% (allows roughly 3.4 hours of downtime per 28 days) |
| Latency (p99) | < 2 seconds |
| Error rate | < 1% of requests |

### 8.3 Error Budget

With a 99.5% availability SLO over 28 days, the error budget is approximately 201 minutes. Track consumption weekly. If more than 50% of the budget is consumed in the first two weeks, freeze non-critical deployments and investigate.

---

## 9. Runbooks

### 9.1 Database Connection Failure

**Symptoms**: Health check returns 503. Application logs show connection timeout or refused errors.

**Steps**:

1. Verify the database instance is running (AWS Console / Aurora dashboard or GCP Console / Cloud SQL instances).
2. Check security groups (AWS) or firewall rules (GCP) permit traffic from the compute layer to the database port (5432).
3. Verify the VPC connector (App Runner) or VPC access connector (Cloud Run) is healthy.
4. Check connection pool metrics. If all 10 connections are in use, the pool is exhausted. Restart the application instance to reset connections. Investigate long-running queries.
5. Verify database credentials in Secrets Manager / Secret Manager have not been rotated without updating the application.

### 9.2 Health Check Failing

**Symptoms**: App Runner or Cloud Run reports the service as unhealthy. Deployment may be blocked.

**Steps**:

1. Check application container logs for startup errors.
2. Verify the container image exists in ECR / Artifact Registry and is not corrupted.
3. Verify all secrets are accessible (IAM role permissions, secret resource policies).
4. Confirm the application listens on port 3000.
5. If the container starts but the health check fails, follow Runbook 9.1 for database connectivity.

### 9.3 Schema Migration Failure

**Symptoms**: `migrate-schema.sh` exits with a non-zero code. Terraform apply fails on the `null_resource` migration step.

**Steps**:

1. Read the error output to identify the failing SQL file. The 39 files in `schema/` are applied in lexicographic order.
2. Connect to the database and check which objects exist to determine how far the migration progressed.
3. Fix the SQL file, commit, and re-run. The migration script is idempotent where possible (uses `IF NOT EXISTS`), but verify manually for DDL that is not idempotent.
4. The Terraform `null_resource` triggers on the SHA-256 hash of all SQL files. Changing any file will trigger a re-run.

### 9.4 LLM API Unavailable

**Symptoms**: API requests to the configured LLM provider fail. Application returns errors for AI-dependent features.

**Steps**:

1. Check the status page for the configured LLM provider (Anthropic: status.anthropic.com, OpenAI: status.openai.com, Google: status.cloud.google.com).
2. Verify the LLM_API_KEY in Secrets Manager / Secret Manager is valid and matches the configured LLM_PROVIDER.
3. Confirm outbound network connectivity from the compute layer (VPC egress rules).
4. If the LLM provider is experiencing a prolonged outage, consider switching to an alternative provider by updating LLM_PROVIDER and LLM_API_KEY in the secrets configuration and redeploying.
5. If the LLM provider is experiencing an outage, the application should degrade gracefully. Non-AI features must remain operational.

### 9.5 Partition Maintenance

**Symptoms**: INSERT operations fail with "no partition of relation" errors.

**Steps**:

1. Identify which table and period is missing. `entity_history` uses monthly partitions; `audit_log` uses quarterly partitions.
2. Create the missing partition:

```sql
-- Monthly partition for entity_history
CREATE TABLE entity_history_2027_01 PARTITION OF entity_history
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

-- Quarterly partition for audit_log
CREATE TABLE audit_log_2027_q1 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
```

3. Schedule partition creation at least one month before the period begins. Add a calendar reminder or automate via a cron job.

### 9.6 Materialised View Refresh

**Symptoms**: `mv_effective_access` returns stale data after a data ingestion.

**Steps**:

1. Run a concurrent refresh (does not lock reads):

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_effective_access;
```

2. Verify the refresh completed by checking row counts or querying recent data.
3. Consider automating this refresh after each ingestion pipeline run.

### 9.7 Secret Rotation

**Steps**:

1. Update the secret value in AWS Secrets Manager or GCP Secret Manager.
2. For database credentials, update the password in the database first, then update the secret.
3. Restart the application instances to pick up the new secret value (App Runner: trigger a new deployment; Cloud Run: deploy a new revision).
4. Verify the health check returns 200 after restart.

### 9.8 Container Image Deployment

**AWS**:

```bash
# Requires AWS_ACCOUNT_ID and AWS_REGION
./build-and-push-aws.sh
cd infra/deploy/aws
terraform plan
terraform apply
```

**GCP**:

```bash
# Requires GCP_PROJECT_ID and GCP_REGION
./build-and-push-gcp.sh
cd infra/deploy/gcp
terraform plan
terraform apply
```

Verify the new image tag in ECR / Artifact Registry before applying Terraform. Confirm health checks pass after deployment.

### 9.9 Rolling Back a Deployment

**Steps**:

1. Identify the last known good image tag in ECR / Artifact Registry (lifecycle policy retains the last 10 images).
2. Update the image tag in the Terraform variables and run `terraform apply` to deploy the previous image.
3. If the rollback is urgent and Terraform is slow, use the cloud console to deploy the previous revision directly (App Runner: select previous revision; Cloud Run: route traffic to previous revision).
4. Verify health checks pass after rollback.
5. Investigate the root cause of the failed deployment before re-attempting.

---

## 10. Assumptions

1. SLIs, SLOs, and error budgets are recommendations and have not been formally adopted by the organisation.
2. Cross-region replication is not configured for either cloud. Both deployments are single-region.
3. pgaudit is recommended but not currently enabled. Enabling it requires a database parameter group change and a restart.
4. Log retention periods and SIEM integration are not yet configured. These should be defined per organisational policy.
5. The CI/CD pipeline is implemented as five GitHub Actions workflows in `.github/workflows/`: CI (lint, type-check, test, build, schema validation), CodeQL (SAST), Checkov (IaC + secrets), Security Audit (npm audit, SQL safety, TruffleHog, license check), and Bundle Analysis.
6. Secret rotation is a manual process. Automated rotation (e.g. via AWS Secrets Manager rotation lambdas) is not yet configured.
7. Partition creation is a manual task. Automation should be implemented before the current partitions expire (end of 2026).
8. The connection pool configuration (min 2, max 10) is shared across all environments. Production may require tuning based on observed load.
9. RTO and RPO targets are indicative. Formal DR testing has not been conducted.
10. The Docker image uses `node:22-alpine` as the base. Security patching of the base image is the responsibility of the team maintaining the Dockerfile.
