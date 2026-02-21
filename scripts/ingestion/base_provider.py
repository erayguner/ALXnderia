"""Abstract base class for all identity providers."""

from __future__ import annotations

import logging
import time
import traceback
from abc import ABC, abstractmethod
from typing import Any

from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.provider")


class BaseProvider(ABC):
    """Each provider overrides sync() and declares PROVIDER_NAME."""

    PROVIDER_NAME: str = ""

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self.tenant_id = config.tenant_id
        self.batch_size = config.batch_size

    @abstractmethod
    def sync(self) -> dict[str, int]:
        """Run the provider sync. Returns {entity_type: records_upserted}."""

    def sync_with_tracking(self) -> dict[str, int]:
        """Wrap sync() with ingestion_runs tracking and retry logic."""
        run_id = self.db.record_run_start(
            tenant_id=self.tenant_id,
            provider=self.PROVIDER_NAME,
        )
        try:
            results = self.sync()
            total = sum(results.values())
            self.db.record_run_end(
                run_id=run_id,
                tenant_id=self.tenant_id,
                status="SUCCESS",
                records_upserted=total,
            )
            logger.info(
                "Sync complete",
                extra={
                    "provider": self.PROVIDER_NAME,
                    "records": total,
                    "run_id": run_id,
                },
            )
            return results
        except Exception as exc:
            self.db.record_run_end(
                run_id=run_id,
                tenant_id=self.tenant_id,
                status="FAILED",
                error_message=str(exc)[:1000],
                error_detail={"traceback": traceback.format_exc()},
            )
            logger.error(
                "Sync failed: %s",
                exc,
                extra={"provider": self.PROVIDER_NAME, "run_id": run_id},
            )
            raise

    # ------------------------------------------------------------------
    # Pagination / rate-limiting helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _rate_limit_sleep(attempt: int, base_seconds: float = 1.0) -> None:
        """Exponential backoff sleep for rate limiting."""
        delay = base_seconds * (2 ** attempt)
        delay = min(delay, 60.0)  # cap at 60s
        logger.warning("Rate limited, sleeping %.1fs (attempt %d)", delay, attempt)
        time.sleep(delay)

    def _batch_rows(self, rows: list[Any], size: int | None = None) -> list[list[Any]]:
        """Split rows into batches of the configured size."""
        size = size or self.batch_size
        return [rows[i : i + size] for i in range(0, len(rows), size)]
