"""GCP Cloud Run Job entry point for identity ingestion.

Deployed as Cloud Run Jobs triggered by Cloud Scheduler.
The INGESTION_PROVIDER env var determines which provider to sync.

Usage:
  INGESTION_PROVIDER=google_workspace python -m scripts.ingestion.entrypoints.gcp_cloudrun
  INGESTION_PROVIDER=gcp_resource_manager python -m scripts.ingestion.entrypoints.gcp_cloudrun
  INGESTION_PROVIDER=github python -m scripts.ingestion.entrypoints.gcp_cloudrun
  INGESTION_PROVIDER=post-process python -m scripts.ingestion.entrypoints.gcp_cloudrun
"""

from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from scripts.ingestion.config import load_config
from scripts.ingestion.db import Database
from scripts.ingestion.logging_config import configure_logging

logger = logging.getLogger("ingestion.cloudrun")


def main() -> None:
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))

    provider = os.environ.get("INGESTION_PROVIDER", "")
    if not provider:
        logger.error("INGESTION_PROVIDER env var is required")
        sys.exit(1)

    logger.info("Cloud Run Job started for provider=%s", provider)

    config = load_config()
    db = Database(config.database)

    try:
        if provider == "post-process":
            from scripts.ingestion.cli import _run_post_process
            results = _run_post_process(config, db)
        else:
            from scripts.ingestion.cli import _get_provider
            p = _get_provider(provider, config, db)
            if p is None:
                logger.warning("Provider %s not configured, exiting", provider)
                return
            results = p.sync_with_tracking()

        logger.info("Sync complete for %s: %s", provider, results)
    except Exception as exc:
        logger.error("Sync failed for %s: %s", provider, exc, exc_info=True)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
