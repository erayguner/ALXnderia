#!/usr/bin/env bash
# ------------------------------------------------------------------
# preflight.sh — Verify local environment is ready for Alxderia
#
# Usage:  bash scripts/preflight.sh
# ------------------------------------------------------------------
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No colour

PASS=0
WARN=0
FAIL=0

pass()  { PASS=$((PASS + 1)); echo -e "  ${GREEN}[OK]${NC}  $1"; }
warn()  { WARN=$((WARN + 1)); echo -e "  ${YELLOW}[WARN]${NC} $1"; }
fail()  { FAIL=$((FAIL + 1)); echo -e "  ${RED}[FAIL]${NC} $1"; }

# Compare semver: returns 0 if $1 >= $2
version_gte() {
  printf '%s\n%s' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n -C
}

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Detect configured PG port (read from Terraform variables, default 5433)
PG_PORT=5433
if [ -f "$PROJECT_ROOT/infra/variables.tf" ]; then
  PARSED_PORT=$(grep -A3 '"pg_port"' "$PROJECT_ROOT/infra/variables.tf" | grep 'default' | grep -oE '[0-9]+' || true)
  if [ -n "$PARSED_PORT" ]; then
    PG_PORT="$PARSED_PORT"
  fi
fi

echo ""
echo "============================================"
echo "  ALXnderia Pre-flight Check"
echo "============================================"
echo ""

# ----- Node.js -----
echo "1. Node.js (>= 22)"
if command -v node &>/dev/null; then
  NODE_V="$(node -v | sed 's/^v//')"
  if version_gte "$NODE_V" "22.0.0"; then
    pass "node $NODE_V"
  else
    fail "node $NODE_V — need >= 22. Install from https://nodejs.org"
  fi
else
  fail "node not found. Install from https://nodejs.org"
fi

# ----- npm -----
echo "2. npm (>= 10)"
if command -v npm &>/dev/null; then
  NPM_V="$(npm -v)"
  if version_gte "$NPM_V" "10.0.0"; then
    pass "npm $NPM_V"
  else
    fail "npm $NPM_V — need >= 10. Run: npm install -g npm@latest"
  fi
else
  fail "npm not found"
fi

# ----- Docker -----
echo "3. Docker (>= 24)"
if command -v docker &>/dev/null; then
  DOCKER_V="$(docker version --format '{{.Client.Version}}' 2>/dev/null || echo "0.0.0")"
  MAJOR="${DOCKER_V%%.*}"
  if [ "$MAJOR" -ge 24 ] 2>/dev/null; then
    pass "docker $DOCKER_V"
  else
    fail "docker $DOCKER_V — need >= 24. Update Docker Desktop"
  fi
else
  fail "docker not found. Install Docker Desktop"
fi

# ----- Docker daemon -----
echo "4. Docker daemon running"
if docker info &>/dev/null; then
  pass "Docker daemon is reachable"
else
  fail "Docker daemon is not running. Start Docker Desktop"
fi

# ----- Terraform -----
echo "5. Terraform (>= 1.14)"
if command -v terraform &>/dev/null; then
  TF_V="$(terraform version -json 2>/dev/null | grep -o '"terraform_version":"[^"]*"' | cut -d'"' -f4)"
  if [ -z "$TF_V" ]; then
    TF_V="$(terraform -v | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
  fi
  if version_gte "$TF_V" "1.14.0"; then
    pass "terraform $TF_V"
  else
    fail "terraform $TF_V — need >= 1.14. See https://developer.hashicorp.com/terraform/install"
  fi
else
  fail "terraform not found. See https://developer.hashicorp.com/terraform/install"
fi

# ----- PostgreSQL port -----
echo "6. Port $PG_PORT (PostgreSQL — Docker target)"
if lsof -iTCP:"$PG_PORT" -sTCP:LISTEN &>/dev/null; then
  # Something is listening — check if it's our Docker container or a conflict
  LISTENER_PID=$(lsof -iTCP:"$PG_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
  LISTENER_NAME=$(ps -p "$LISTENER_PID" -o comm= 2>/dev/null || echo "unknown")

  if echo "$LISTENER_NAME" | grep -qi "docker\|com.docke"; then
    # Docker owns the port — likely our container, that's fine
    pass "Port $PG_PORT is used by Docker (expected if DB is already running)"
  else
    fail "Port $PG_PORT is occupied by $LISTENER_NAME (PID $LISTENER_PID)"
    echo -e "         This will cause the app to connect to $LISTENER_NAME instead of Docker."
    echo -e "         Fix: brew services stop postgresql   OR   use a different port in Terraform"
  fi
else
  pass "Port $PG_PORT is free"
fi

# ----- Port 3000 -----
echo "7. Port 3000 (Next.js dev)"
if lsof -iTCP:3000 -sTCP:LISTEN &>/dev/null; then
  warn "Port 3000 is already in use. You can use: npm run dev -- -p 3001"
else
  pass "Port 3000 is free"
fi

# ----- .env.local -----
echo "8. app/.env.local exists"
if [ -f "$PROJECT_ROOT/app/.env.local" ]; then
  pass "app/.env.local found"

  # Check for LLM key
  if grep -qE '^LLM_API_KEY=.{5,}' "$PROJECT_ROOT/app/.env.local"; then
    pass "LLM_API_KEY is set"
  else
    warn "LLM_API_KEY looks empty or missing in app/.env.local — the chat feature won't work"
  fi

  # Check PG_PORT matches Terraform default
  ENV_PORT=$(grep -E '^PG_PORT=' "$PROJECT_ROOT/app/.env.local" | cut -d= -f2 | tr -d '[:space:]' || true)
  if [ -n "$ENV_PORT" ] && [ "$ENV_PORT" != "$PG_PORT" ]; then
    warn "PG_PORT in .env.local ($ENV_PORT) differs from Terraform default ($PG_PORT)"
  fi
else
  warn "app/.env.local not found — copy from app/.env.example and set your LLM key"
fi

# ----- Terraform state (DB already up?) -----
echo "9. Database container"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "cloud-intel-postgres"; then
  HEALTH="$(docker inspect --format='{{.State.Health.Status}}' cloud-intel-postgres 2>/dev/null || echo "unknown")"
  if [ "$HEALTH" = "healthy" ]; then
    pass "cloud-intel-postgres is running and healthy"
  else
    warn "cloud-intel-postgres exists but status is: $HEALTH"
  fi
else
  warn "cloud-intel-postgres not running — run: cd infra && terraform init && terraform apply -auto-approve"
fi

# ----- node_modules -----
echo "10. app/node_modules installed"
if [ -d "$PROJECT_ROOT/app/node_modules" ]; then
  pass "node_modules present"
else
  warn "node_modules missing — run: cd app && npm install"
fi

# ----- Summary -----
echo ""
echo "============================================"
echo -e "  Results:  ${GREEN}$PASS passed${NC}  ${YELLOW}$WARN warnings${NC}  ${RED}$FAIL failed${NC}"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}Fix the failures above before proceeding.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}Warnings are non-blocking but review them before running the app.${NC}"
  exit 0
else
  echo ""
  echo -e "${GREEN}All checks passed. You're ready to go!${NC}"
  exit 0
fi
