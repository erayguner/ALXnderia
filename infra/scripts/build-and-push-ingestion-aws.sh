#!/usr/bin/env bash
# Wrapper — delegates to build-and-push.sh
exec "$(dirname "${BASH_SOURCE[0]}")/build-and-push.sh" --platform aws --target ingestion
