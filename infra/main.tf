terraform {
  required_version = ">= 1.14.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = ">= 3.6.2"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = ">= 1.26.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Docker provider — talks to the local Docker daemon
# ---------------------------------------------------------------------------
provider "docker" {}

# ---------------------------------------------------------------------------
# PostgreSQL Docker image
# ---------------------------------------------------------------------------
resource "docker_image" "postgres" {
  name         = "postgres:${var.pg_version}-alpine"
  keep_locally = true
}

# ---------------------------------------------------------------------------
# Persistent volume for data (survives container recreation)
# ---------------------------------------------------------------------------
resource "docker_volume" "pg_data" {
  name = "${var.project_name}-pgdata"
}

# ---------------------------------------------------------------------------
# Pre-flight: fail fast if the target port is already occupied
# ---------------------------------------------------------------------------
resource "null_resource" "port_check" {
  triggers = {
    port = var.pg_port
  }

  provisioner "local-exec" {
    command = <<-EOT
      if lsof -iTCP:${var.pg_port} -sTCP:LISTEN >/dev/null 2>&1; then
        PROC=$(lsof -iTCP:${var.pg_port} -sTCP:LISTEN -t 2>/dev/null | head -1)
        PNAME=$(ps -p "$PROC" -o comm= 2>/dev/null || echo "unknown")
        echo ""
        echo "ERROR: Port ${var.pg_port} is already in use by $PNAME (PID $PROC)."
        echo ""
        echo "  Common cause: a local PostgreSQL (Homebrew / Postgres.app) is running."
        echo ""
        echo "  Fix options:"
        echo "    1. Stop the conflicting process:  brew services stop postgresql"
        echo "    2. Use a different port:          terraform apply -var pg_port=5434"
        echo ""
        echo "  Diagnose:  lsof -iTCP:${var.pg_port} -sTCP:LISTEN"
        echo ""
        exit 1
      fi
      echo "Port ${var.pg_port} is free."
    EOT
  }
}

# ---------------------------------------------------------------------------
# PostgreSQL container
# ---------------------------------------------------------------------------
resource "docker_container" "postgres" {
  depends_on = [null_resource.port_check]

  name  = "${var.project_name}-postgres"
  image = docker_image.postgres.image_id

  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=${var.pg_superuser}",
    "POSTGRES_PASSWORD=${var.pg_superuser_password}",
    "POSTGRES_DB=${var.pg_database}",
    "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=scram-sha-256",
  ]

  # Pass hardening and tuning via -c flags so the entrypoint init runs normally
  command = [
    "postgres",
    "-c", "password_encryption=scram-sha-256",
    "-c", "log_connections=on",
    "-c", "log_disconnections=on",
    "-c", "log_statement=ddl",
    "-c", "log_line_prefix=%m [%p] %u@%d ",
    "-c", "shared_buffers=256MB",
    "-c", "effective_cache_size=768MB",
    "-c", "work_mem=16MB",
    "-c", "maintenance_work_mem=128MB",
    "-c", "random_page_cost=1.1",
    "-c", "checkpoint_completion_target=0.9",
    "-c", "wal_buffers=16MB",
    "-c", "max_wal_size=1GB",
  ]

  ports {
    internal = 5432
    external = var.pg_port
  }

  volumes {
    volume_name    = docker_volume.pg_data.name
    container_path = "/var/lib/postgresql/data"
  }

  # Health-check — Terraform waits until PG is ready
  healthcheck {
    test         = ["CMD-SHELL", "pg_isready -U ${var.pg_superuser} -d ${var.pg_database}"]
    interval     = "5s"
    timeout      = "3s"
    retries      = 10
    start_period = "10s"
  }

  # Give the container time to become healthy before the PG provider connects
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for PostgreSQL to accept connections..."
      for i in $(seq 1 30); do
        if docker exec ${var.project_name}-postgres pg_isready -U ${var.pg_superuser} -d ${var.pg_database} >/dev/null 2>&1; then
          echo "PostgreSQL is ready (attempt $i)."
          sleep 2
          exit 0
        fi
        echo "  attempt $i/30..."
        sleep 2
      done
      echo "PostgreSQL did not become ready in time."
      exit 1
    EOT
  }
}

# ---------------------------------------------------------------------------
# PostgreSQL provider — connects to the running container
# ---------------------------------------------------------------------------
provider "postgresql" {
  host     = "localhost"
  port     = var.pg_port
  username = var.pg_superuser
  password = var.pg_superuser_password
  database = var.pg_database
  sslmode  = "disable"

  # Ensure the container is up before any PG resources are planned
  superuser = true
}

# ---------------------------------------------------------------------------
# Database is created by POSTGRES_DB env var during container init.
# Extensions are applied via the schema SQL files (00-extensions/).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Schema application — run all SQL files in numbered order
# ---------------------------------------------------------------------------
resource "null_resource" "apply_schema" {
  depends_on = [docker_container.postgres]

  triggers = {
    # Re-run when any SQL file changes
    schema_hash = sha256(join("", [
      for f in sort(fileset("${path.module}/../schema", "**/*.sql")) :
      filesha256("${path.module}/../schema/${f}")
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      for sqlfile in $(find ${path.module}/../schema -name '*.sql' | sort); do
        echo "▸ Applying $sqlfile"
        docker exec -i -e PGPASSWORD='${var.pg_superuser_password}' \
          ${var.project_name}-postgres \
          psql -U ${var.pg_superuser} -d ${var.pg_database} \
          --set ON_ERROR_STOP=1 < "$sqlfile"
      done
    EOT
  }
}
