"""Database helpers: connection pool, upsert batches, run tracking."""

from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Generator, Optional, Sequence

import psycopg2
import psycopg2.extras
import psycopg2.pool

from scripts.ingestion.config import DatabaseConfig

logger = logging.getLogger("ingestion.db")


class Database:
    """Thin wrapper around a ThreadedConnectionPool with upsert helpers."""

    def __init__(self, config: DatabaseConfig) -> None:
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=config.min_connections,
            maxconn=config.max_connections,
            dsn=config.url,
        )

    def close(self) -> None:
        self._pool.closeall()

    @contextmanager
    def connection(self) -> Generator:
        conn = self._pool.getconn()
        try:
            yield conn
        finally:
            self._pool.putconn(conn)

    @contextmanager
    def transaction(self) -> Generator:
        """Yield a cursor inside an auto-commit/rollback transaction."""
        with self.connection() as conn:
            try:
                with conn.cursor() as cur:
                    yield cur
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def upsert_batch(
        self,
        cur,
        table: str,
        columns: list[str],
        rows: Sequence[tuple],
        conflict_columns: list[str],
        update_columns: list[str],
    ) -> int:
        """Bulk upsert using execute_values with ON CONFLICT DO UPDATE.

        Returns the number of rows affected.
        """
        if not rows:
            return 0

        col_list = ", ".join(columns)
        conflict_list = ", ".join(conflict_columns)
        set_clauses = ", ".join(
            f"{c} = EXCLUDED.{c}" for c in update_columns
        )
        # Always refresh timestamps on update
        set_clauses += ", updated_at = NOW(), last_synced_at = NOW()"

        sql = (
            f"INSERT INTO {table} ({col_list}) VALUES %s "
            f"ON CONFLICT ({conflict_list}) DO UPDATE SET {set_clauses}"
        )

        psycopg2.extras.execute_values(cur, sql, rows, page_size=500)
        return cur.rowcount

    # ------------------------------------------------------------------
    # Ingestion run tracking
    # ------------------------------------------------------------------

    def record_run_start(
        self,
        tenant_id: str,
        provider: str,
        entity_type: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """Insert a new ingestion_runs row with status RUNNING. Returns the run id."""
        run_id = str(uuid.uuid4())
        with self.transaction() as cur:
            cur.execute(
                """INSERT INTO ingestion_runs
                   (id, tenant_id, provider, entity_type, status, run_metadata)
                   VALUES (%s, %s, %s, %s, 'RUNNING', %s)""",
                (
                    run_id,
                    tenant_id,
                    provider,
                    entity_type,
                    psycopg2.extras.Json(metadata or {}),
                ),
            )
        return run_id

    def record_run_end(
        self,
        run_id: str,
        tenant_id: str,
        status: str,
        records_upserted: int = 0,
        records_deleted: int = 0,
        error_message: Optional[str] = None,
        error_detail: Optional[dict] = None,
    ) -> None:
        """Finalise an ingestion_runs row."""
        with self.transaction() as cur:
            cur.execute(
                """UPDATE ingestion_runs
                   SET status = %s,
                       finished_at = NOW(),
                       records_upserted = %s,
                       records_deleted = %s,
                       error_message = %s,
                       error_detail = %s
                   WHERE id = %s AND tenant_id = %s""",
                (
                    status,
                    records_upserted,
                    records_deleted,
                    error_message,
                    psycopg2.extras.Json(error_detail) if error_detail else None,
                    run_id,
                    tenant_id,
                ),
            )

    def get_recent_runs(
        self,
        tenant_id: str,
        provider: Optional[str] = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Fetch recent ingestion runs for status display."""
        with self.transaction() as cur:
            if provider:
                cur.execute(
                    """SELECT id, provider, entity_type, status, started_at,
                              finished_at, records_upserted, records_deleted,
                              error_message
                       FROM ingestion_runs
                       WHERE tenant_id = %s AND provider = %s
                       ORDER BY started_at DESC LIMIT %s""",
                    (tenant_id, provider, limit),
                )
            else:
                cur.execute(
                    """SELECT id, provider, entity_type, status, started_at,
                              finished_at, records_upserted, records_deleted,
                              error_message
                       FROM ingestion_runs
                       WHERE tenant_id = %s
                       ORDER BY started_at DESC LIMIT %s""",
                    (tenant_id, limit),
                )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
