"""APScheduler-based interval scheduling for provider syncs."""

from __future__ import annotations

import logging
import time

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import EVENT_JOB_ERROR

from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.scheduler")


def _sync_provider(provider_name: str, config: IngestionConfig, db: Database) -> None:
    """Run a single provider sync with retry logic."""
    from scripts.ingestion.cli import _get_provider

    max_retries = config.scheduler.max_retries
    backoff_base = 30  # seconds

    for attempt in range(max_retries + 1):
        provider = _get_provider(provider_name, config, db)
        if provider is None:
            return
        try:
            provider.sync_with_tracking()
            return
        except Exception as exc:
            if attempt < max_retries:
                delay = backoff_base * (2 ** attempt)
                logger.warning(
                    "Sync %s failed (attempt %d/%d), retrying in %ds: %s",
                    provider_name, attempt + 1, max_retries, delay, exc,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Sync %s failed after %d retries: %s",
                    provider_name, max_retries, exc,
                )


def _run_post_process(config: IngestionConfig, db: Database) -> None:
    """Run identity resolution and grants backfill."""
    from scripts.ingestion.cli import _run_post_process as pp
    try:
        results = pp(config, db)
        logger.info("Post-processing complete: %s", results)
    except Exception as exc:
        logger.error("Post-processing failed: %s", exc)


def _on_job_error(event) -> None:
    """Log job execution errors."""
    logger.error(
        "Job %s raised an exception: %s",
        event.job_id,
        event.exception,
    )


def start_scheduler(config: IngestionConfig, db: Database) -> None:
    """Start the blocking scheduler with interval jobs for each provider."""
    scheduler = BlockingScheduler()
    scheduler.add_listener(_on_job_error, EVENT_JOB_ERROR)
    sched = config.scheduler

    # Google Workspace
    if config.google_workspace:
        scheduler.add_job(
            _sync_provider,
            "interval",
            minutes=sched.google_workspace_interval_min,
            args=["google_workspace", config, db],
            id="google_workspace",
            max_instances=1,
            misfire_grace_time=sched.misfire_grace_time,
        )

    # AWS Identity Center
    if config.aws_identity_center:
        scheduler.add_job(
            _sync_provider,
            "interval",
            minutes=sched.aws_identity_center_interval_min,
            args=["aws_identity_center", config, db],
            id="aws_identity_center",
            max_instances=1,
            misfire_grace_time=sched.misfire_grace_time,
        )

    # GitHub
    if config.github:
        scheduler.add_job(
            _sync_provider,
            "interval",
            minutes=sched.github_interval_min,
            args=["github", config, db],
            id="github",
            max_instances=1,
            misfire_grace_time=sched.misfire_grace_time,
        )

    # AWS Organizations
    if config.aws_organizations:
        scheduler.add_job(
            _sync_provider,
            "interval",
            hours=sched.aws_organizations_interval_hours,
            args=["aws_organizations", config, db],
            id="aws_organizations",
            max_instances=1,
            misfire_grace_time=sched.misfire_grace_time,
        )

    # GCP Resource Manager
    if config.gcp:
        scheduler.add_job(
            _sync_provider,
            "interval",
            hours=sched.gcp_resource_manager_interval_hours,
            args=["gcp_resource_manager", config, db],
            id="gcp_resource_manager",
            max_instances=1,
            misfire_grace_time=sched.misfire_grace_time,
        )

    # Post-processing (identity resolution + grants backfill)
    scheduler.add_job(
        _run_post_process,
        "interval",
        minutes=sched.post_process_interval_min,
        args=[config, db],
        id="post_process",
        max_instances=1,
        misfire_grace_time=sched.misfire_grace_time,
    )

    logger.info("Starting scheduler with jobs: %s",
                [j.id for j in scheduler.get_jobs()])
    scheduler.start()
