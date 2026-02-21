"""CLI entry point: sync, scheduler, status."""

from __future__ import annotations

import argparse
import logging
import sys

from scripts.ingestion.config import load_config
from scripts.ingestion.db import Database
from scripts.ingestion.logging_config import configure_logging

logger = logging.getLogger("ingestion.cli")

PROVIDER_CHOICES = [
    "all",
    "google_workspace",
    "aws_identity_center",
    "github",
    "aws_organizations",
    "gcp_resource_manager",
    "post-process",
]


PROVIDER_REGISTRY: dict[str, tuple[str, str, str]] = {
    # name -> (config_attr, module_path, class_name)
    "google_workspace": ("google_workspace", "scripts.ingestion.providers.google_workspace", "GoogleWorkspaceProvider"),
    "aws_identity_center": ("aws_identity_center", "scripts.ingestion.providers.aws_identity_center", "AwsIdentityCenterProvider"),
    "github": ("github", "scripts.ingestion.providers.github_org", "GitHubOrgProvider"),
    "aws_organizations": ("aws_organizations", "scripts.ingestion.providers.aws_organizations", "AwsOrganizationsProvider"),
    "gcp_resource_manager": ("gcp", "scripts.ingestion.providers.gcp_resource_manager", "GcpResourceManagerProvider"),
}


def _get_provider(name: str, config, db: Database):
    """Instantiate a provider by name. Returns None if unconfigured."""
    import importlib

    entry = PROVIDER_REGISTRY.get(name)
    if not entry:
        return None

    config_attr, module_path, class_name = entry
    if not getattr(config, config_attr, None):
        logger.warning("%s not configured, skipping", name)
        return None

    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls(config, db)


def _run_post_process(config, db: Database) -> dict[str, int]:
    """Run identity resolution and grants backfill."""
    from scripts.ingestion.identity_resolver import IdentityResolver
    from scripts.ingestion.grants_backfill import GrantsBackfill

    results: dict[str, int] = {}

    resolver = IdentityResolver(config, db)
    resolve_results = resolver.resolve()
    results.update(resolve_results)

    backfill = GrantsBackfill(config, db)
    backfill_results = backfill.rebuild()
    results.update(backfill_results)

    return results


def cmd_sync(args: argparse.Namespace) -> None:
    """Run one-shot sync for specified provider(s)."""
    config = load_config()
    db = Database(config.database)

    try:
        providers_to_sync: list[str] = []
        if args.provider == "all":
            providers_to_sync = [
                "google_workspace",
                "aws_identity_center",
                "github",
                "aws_organizations",
                "gcp_resource_manager",
            ]
        elif args.provider == "post-process":
            results = _run_post_process(config, db)
            logger.info("Post-processing complete: %s", results)
            return
        else:
            providers_to_sync = [args.provider]

        for name in providers_to_sync:
            provider = _get_provider(name, config, db)
            if provider is None:
                continue
            logger.info("Starting sync for %s", name)
            results = provider.sync_with_tracking()
            logger.info("Sync results for %s: %s", name, results)

        # Run post-processing after all providers
        if args.provider == "all":
            logger.info("Running post-processing (identity resolution + grants backfill)")
            pp_results = _run_post_process(config, db)
            logger.info("Post-processing complete: %s", pp_results)

    finally:
        db.close()


def cmd_scheduler(args: argparse.Namespace) -> None:
    """Start the APScheduler-based scheduling loop."""
    from scripts.ingestion.scheduler import start_scheduler

    config = load_config()
    db = Database(config.database)
    try:
        start_scheduler(config, db)
    finally:
        db.close()


def cmd_status(args: argparse.Namespace) -> None:
    """Show recent ingestion runs."""
    config = load_config()
    db = Database(config.database)

    try:
        runs = db.get_recent_runs(
            tenant_id=config.tenant_id,
            provider=args.provider if args.provider != "all" else None,
            limit=args.limit,
        )
        if not runs:
            print("No ingestion runs found.")
            return

        fmt = "{:<36}  {:<22}  {:<10}  {:<8}  {:<20}  {:<20}  {:>8}  {}"
        print(fmt.format(
            "RUN ID", "PROVIDER", "ENTITY", "STATUS",
            "STARTED", "FINISHED", "UPSERTED", "ERROR",
        ))
        print("-" * 160)
        for r in runs:
            started = str(r["started_at"])[:19] if r["started_at"] else ""
            finished = str(r["finished_at"])[:19] if r["finished_at"] else ""
            error = (r.get("error_message") or "")[:40]
            print(fmt.format(
                str(r["id"])[:36],
                r["provider"],
                r.get("entity_type") or "",
                r["status"],
                started,
                finished,
                r.get("records_upserted", 0),
                error,
            ))
    finally:
        db.close()


def main() -> None:
    """Main CLI entry point."""
    configure_logging()

    parser = argparse.ArgumentParser(
        prog="ingestion",
        description="ALXnderia identity data ingestion system",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # sync command
    sync_parser = subparsers.add_parser("sync", help="Run one-shot sync")
    sync_parser.add_argument(
        "--provider", "-p",
        choices=PROVIDER_CHOICES,
        default="all",
        help="Provider to sync (default: all)",
    )
    sync_parser.set_defaults(func=cmd_sync)

    # scheduler command
    sched_parser = subparsers.add_parser("scheduler", help="Start scheduled sync loop")
    sched_parser.set_defaults(func=cmd_scheduler)

    # status command
    status_parser = subparsers.add_parser("status", help="Show recent ingestion runs")
    status_parser.add_argument(
        "--provider", "-p",
        choices=PROVIDER_CHOICES,
        default="all",
        help="Filter by provider",
    )
    status_parser.add_argument(
        "--limit", "-l",
        type=int,
        default=10,
        help="Number of runs to show (default: 10)",
    )
    status_parser.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)
