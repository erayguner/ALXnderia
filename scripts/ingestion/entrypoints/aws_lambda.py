"""AWS Lambda handler for identity ingestion.

Deployed as Lambda functions triggered by EventBridge rules.
Each invocation syncs a single provider or runs post-processing.

Event format:
  {"provider": "aws_identity_center"}
  {"provider": "aws_organizations"}
  {"provider": "post-process"}
"""

from __future__ import annotations

import json
import logging
import os
import sys

# Ensure the project root is on sys.path for Lambda packaging
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from scripts.ingestion.config import load_config
from scripts.ingestion.db import Database
from scripts.ingestion.logging_config import configure_logging

logger = logging.getLogger("ingestion.lambda")


def handler(event: dict, context) -> dict:
    """Lambda entry point."""
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))

    provider = event.get("provider", "")
    if not provider:
        return {"statusCode": 400, "body": "Missing 'provider' in event"}

    logger.info("Lambda invoked for provider=%s", provider)

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
                return {
                    "statusCode": 200,
                    "body": json.dumps({"skipped": True, "reason": f"{provider} not configured"}),
                }
            results = p.sync_with_tracking()

        logger.info("Sync complete for %s: %s", provider, results)
        return {
            "statusCode": 200,
            "body": json.dumps({"provider": provider, "results": results}),
        }
    except Exception as exc:
        logger.error("Sync failed for %s: %s", provider, exc, exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"provider": provider, "error": str(exc)}),
        }
    finally:
        db.close()
