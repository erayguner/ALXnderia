# 01 -- Executive Overview: Alxderia Cloud Identity Intelligence

## Table of Contents

1. [Purpose and Vision](#1-purpose-and-vision)
2. [Key Capabilities](#2-key-capabilities)
3. [Business Value and Outcomes](#3-business-value-and-outcomes)
4. [Security and Compliance Posture](#4-security-and-compliance-posture)
5. [Operational Model](#5-operational-model)
6. [Key Risks and Mitigations](#6-key-risks-and-mitigations)
7. [Roadmap and Future Vision](#7-roadmap-and-future-vision)
8. [Assumptions](#8-assumptions)

---

## 1. Purpose and Vision

Modern enterprises operate across multiple cloud providers, each with its own identity model, access control mechanisms, and administrative tooling. The result is a fragmented landscape in which no single team holds a complete picture of who has access to what, where, and why. This fragmentation introduces security blind spots, slows incident response, and makes regulatory compliance unnecessarily expensive.

Alxderia exists to eliminate that fragmentation. It is a Cloud Identity Intelligence platform that ingests identity and access data from AWS, Google Cloud, and GitHub, unifies it into a single person-centric model, and allows authorised analysts to interrogate that model using plain English. Rather than requiring staff to learn provider-specific consoles or write complex queries, Alxderia translates natural-language questions -- such as "Which contractors have write access to our production databases?" -- into validated, secure SQL and returns clear, auditable answers within seconds.

The vision is straightforward: every organisation should be able to answer any identity and access question, across any cloud provider, in the time it takes to ask it.

## 2. Key Capabilities

**Unified Identity Model.** Alxderia consolidates identities from AWS Identity Center, Google Workspace, and GitHub (organisations, users, teams, repositories) into a single, person-centric canonical identity layer. Users, groups, memberships, and repository permissions are linked via `canonical_users` and `canonical_user_provider_links` so that cross-provider identity questions can be answered in one place rather than across multiple provider dashboards.

**Natural-Language Querying.** Analysts interact with the platform through a conversational interface. An AI agent powered by a configurable LLM provider (supporting Anthropic Claude, OpenAI GPT, and Google Gemini) interprets questions expressed in plain English and converts them into precise, validated SQL queries against the unified data model. No specialist query language or cloud-provider expertise is required.

**Seven-Layer Query Validation.** Every AI-generated query passes through a defence-in-depth validation pipeline before it reaches the database, ensuring that only safe, read-only operations against approved tables are ever executed.

**Multi-Tenant Isolation.** The platform enforces tenant boundaries at the database level, guaranteeing that each organisation's identity data is invisible to every other tenant -- even in the event of an application-layer defect.

**Audit Logging.** All queries are logged with metadata (question, SQL, row count, timing, status) for forensic review and compliance. Database-backed, tamper-evident audit logging with hash chaining is planned for a future iteration.

**Multi-Tenant Data Model.** All tables use composite primary keys `(id, tenant_id)` for partition-friendly multi-tenancy. The application sets tenant context per transaction for forward-compatible isolation.

**Continuous Integration and Security Scanning.** Five GitHub Actions pipelines enforce code quality, security, and compliance on every push and pull request: CI (lint, type-check, test, build, schema validation), CodeQL (SAST with security-extended queries), Checkov (Terraform IaC and secrets scanning), Security Audit (npm audit, SQL safety, TruffleHog, license compliance), and Next.js Bundle Analysis.

**Identity Reconciliation.** An `identity_reconciliation_queue` table captures unresolved cross-provider identity matches for manual review, ensuring data quality in the canonical identity layer. PII redaction views, retention policies, and legal-hold capabilities are planned for future iterations.

## 3. Business Value and Outcomes

**Reduced Time to Answer.** Questions that previously required hours of manual investigation across multiple cloud consoles can be answered in seconds. This directly accelerates security reviews, access certifications, and incident response.

**Lower Operational Cost.** By removing the need for specialist cloud-identity expertise in day-to-day access analysis, Alxderia enables leaner security and compliance teams to cover more ground with fewer resources.

**Improved Security Posture.** A unified view of effective access exposes over-provisioned accounts, dormant credentials, and policy conflicts that remain hidden when each provider is examined in isolation.

**Streamlined Compliance.** Tamper-evident audit logs, PII redaction, and configurable retention policies reduce the manual effort required for SOC 2, ISO 27001, and GDPR compliance activities.

**Faster Incident Response.** When a security incident occurs, responders can immediately determine the blast radius -- which accounts, groups, and resources a compromised identity can reach -- without switching between provider-specific tooling.

## 4. Security and Compliance Posture

Security is treated as a structural property of the platform rather than an afterthought. The following measures are built into the architecture:

- **Query Safety.** A seven-layer validation pipeline prevents the AI agent from executing destructive, unauthorised, or malformed SQL. This includes comment stripping, keyword blocking, abstract syntax tree parsing, statement type enforcement, table allowlisting, function blocking, and automatic result-set limiting.
- **Tenant Isolation.** All tables include `tenant_id` with composite primary keys. The application sets `app.current_tenant_id` per transaction. RLS policies can be added without application changes.
- **Audit Logging.** Query metadata is logged (question, SQL, row count, timing, status) for compliance review. Database-backed audit with hash chaining is planned.
- **Data Protection.** PII-containing tables are tracked in the application's `PII_TABLES` configuration. PII redaction views, retention policies, and legal-hold capabilities are planned for future iterations.

## 5. Operational Model

Alxderia is deployed as a containerised web application with infrastructure defined entirely as code. Three deployment targets are supported:

- **Local Development** -- Docker-based, suitable for engineering and demonstration purposes.
- **AWS** -- App Runner with Aurora Serverless v2, providing automatic scaling, managed networking, and secrets management.
- **Google Cloud** -- Cloud Run v2 with Cloud SQL, offering an equivalent fully managed deployment on GCP.

All environments share the same application code and database schema. Infrastructure provisioning, schema migrations, and secrets rotation are automated through Terraform, minimising manual operational burden and configuration drift.

The platform is designed for horizontal scalability. Serverless compute (App Runner, Cloud Run) scales automatically with demand, and Aurora Serverless v2 adjusts database capacity without manual intervention.

## 6. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| AI-generated queries produce incorrect or unsafe SQL | Seven-layer validation pipeline; read-only database role; automatic LIMIT enforcement; human-reviewable query logs |
| Tenant data leakage in a multi-tenant deployment | Database-level row-level security enforced via session variables; no application-layer filtering relied upon for isolation |
| Stale identity data leading to inaccurate access answers | `last_synced_at` timestamps on all provider tables; identity reconciliation queue for unresolved matches |
| Regulatory non-compliance (GDPR, SOC 2) | PII tables tracked in application config; audit logging of all queries; redaction views and retention policies planned |
| Vendor concentration on a single AI provider | Implemented support for multiple LLM providers (Anthropic Claude, OpenAI GPT, Google Gemini) with runtime provider selection via LLM_PROVIDER environment variable |
| Infrastructure misconfiguration | All infrastructure defined as Terraform code; environment parity across local, AWS, and GCP deployments |

## 7. Roadmap and Future Vision

The current platform delivers a solid foundation for cloud identity intelligence across AWS, Google Cloud, and GitHub. Planned evolution includes:

- **Azure and Entra ID Integration.** Extending the unified identity model to cover Microsoft Azure and Entra ID, completing the four major cloud providers.
- **GraphQL API.** A typed GraphQL API (Yoga + Pothos) with cursor-based pagination, field-level authZ, and query complexity scoring (see `docs/07_Target_Architecture_GraphQL_DLP.md`).
- **Export/DLP Service.** Async export jobs with envelope encryption, signed download URLs, and configurable retention.
- **Continuous Ingestion.** Moving from periodic data synchronisation to near-real-time event-driven ingestion, reducing the window of data staleness.
- **Anomaly Detection.** Applying pattern recognition to identify unusual access patterns, privilege escalations, and policy deviations proactively rather than reactively.
- **Automated Remediation Workflows.** Enabling analysts to initiate access revocations or policy changes directly from the query interface, with appropriate approval workflows.
- **Extended Compliance Frameworks.** Pre-built query templates and reporting for additional regulatory frameworks beyond GDPR and SOC 2.

These capabilities will be prioritised based on customer demand and regulatory developments.

## 8. Assumptions

The following assumptions underpin the current design and deployment model:

1. Organisations have existing mechanisms to extract identity and access data from their AWS, GCP, and GitHub environments and make it available for ingestion by Alxderia.
2. Tenant administrators are responsible for the accuracy and completeness of the identity data they provide to the platform.
3. The configured LLM provider API (Anthropic Claude, OpenAI GPT, or Google Gemini) remains available with sufficient capacity and acceptable latency for production query workloads.
4. Organisations deploying Alxderia have the infrastructure and operational capability to manage Terraform-provisioned cloud resources.
5. Database schema migrations will be applied during planned maintenance windows and are backwards-compatible within a given major version.
6. Regulatory requirements (particularly GDPR) will not undergo changes that fundamentally invalidate the current data-protection architecture within the near-term planning horizon.
7. Users of the platform have a basic understanding of their organisation's cloud identity landscape sufficient to frame meaningful natural-language queries.
