# Alxderia - Local Deployment Guide

A Next.js app (NL2SQL) that lets you ask natural-language questions about cloud identity data (AWS, GCP, and GitHub). It uses an LLM to generate SQL, runs it against PostgreSQL, and returns results.

## Prerequisites

Install these before starting:

| Tool          | Version | Check command    |
| ------------- | ------- | ---------------- |
| **Node.js**   | 22+     | `node -v`        |
| **npm**       | 10+     | `npm -v`         |
| **Docker**    | 24+     | `docker -v`      |
| **Terraform** | 1.14+   | `terraform -v`   |

You also need **one** LLM API key (pick one):

- Anthropic: `ANTHROPIC_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Google Gemini: `GOOGLE_API_KEY`

> **Tip:** Run the pre-flight script first to verify everything:
> ```bash
> bash scripts/preflight.sh
> ```

---

## Step 1: Start the PostgreSQL database

```bash
cd infra
terraform init
terraform apply -auto-approve
```

This spins up a PostgreSQL 16 container on **port 5432** with the `cloud_identity_intel` database, applies all 39 SQL files from `schema/` in lexicographic order, and seeds mock data for AWS, GCP, and GitHub providers.

Verify it's running:

```bash
docker ps | grep cloud-intel-postgres
```

---

## Step 2: Create your `.env.local` file

```bash
cd ../app
```

Create `app/.env.local` with this content:

```env
# Database (matches Terraform defaults - no changes needed)
PG_HOST=localhost
PG_PORT=5432
PG_USER=cloudintel
PG_PASSWORD=localdev-change-me
PG_DATABASE=cloud_identity_intel

# LLM provider - pick ONE and set its key
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-your-key-here

# Optional: override the default model
# LLM_MODEL=claude-sonnet-4-5-20250929
```

Change `LLM_PROVIDER` to `openai` or `gemini` if using a different provider, and set the matching key.

---

## Step 3: Install dependencies and run

```bash
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Step 4: Test it works

1. The homepage shows a **chat interface** — type a question like *"Show all AWS accounts"* or *"List GitHub org admins"*
2. The `/access` page shows an access explorer
3. Run the test suite:
   ```bash
   npm test
   ```

---

## Teardown

To stop everything:

```bash
# Stop the Next.js dev server: Ctrl+C

# Destroy the database container
cd infra
terraform destroy -auto-approve
```

---

## Troubleshooting

| Problem                  | Fix                                                                          |
| ------------------------ | ---------------------------------------------------------------------------- |
| `terraform apply` fails  | Make sure Docker Desktop is running                                          |
| App can't connect to DB  | Verify `docker ps` shows the postgres container as `healthy`                 |
| Chat returns errors      | Check your `LLM_API_KEY` is valid and `LLM_PROVIDER` matches                |
| Port 5432 in use         | Change `pg_port` in `infra/terraform.tfvars` and `PG_PORT` in `.env.local`  |
| Port 3000 in use         | Run `npm run dev -- -p 3001`                                                 |

---

## Project Structure

```
alxderia/
├── app/                  # Next.js 15 application
│   ├── app/              # Pages (/, /access)
│   ├── src/
│   │   ├── client/       # React components
│   │   ├── server/       # API routes, LLM clients, DB pool, SQL validator
│   │   └── shared/       # Types and constants
│   └── tests/            # Vitest tests (32 tests)
├── infra/                # Terraform (Docker + PostgreSQL setup + cloud deploy modules)
├── schema/               # 39 SQL files across 12 directories (00-extensions through 11-github, plus 99-seed)
├── scripts/              # Utility scripts (preflight.sh)
├── .github/              # GitHub Actions CI/CD (5 workflows: CI, CodeQL, Checkov, Security Audit, Bundle Analysis)
└── docs/                 # Architecture documentation
```
