#!/usr/bin/env bash
set -euo pipefail

# Option A vendor bridge for harbor evals.
# Run manually whenever cloudihub's Sally config changes.
# Option C migration will remove this script.

CLOUDIHUB_CONFIG_DIR="${CLOUDIHUB_CONFIG_DIR:-$HOME/code/algodyn/cloudihub/config}"
repo_root="$(git rev-parse --show-toplevel)"
dest_dir="$repo_root/examples/harbor/base/aihub-eval/cloudihub-config"

if [[ ! -d "$CLOUDIHUB_CONFIG_DIR" ]]; then
  echo "error: CLOUDIHUB_CONFIG_DIR not found: $CLOUDIHUB_CONFIG_DIR" >&2
  exit 1
fi

if [[ ! -f "$CLOUDIHUB_CONFIG_DIR/models.json" || ! -f "$CLOUDIHUB_CONFIG_DIR/agents/sally/AGENTS.md" ]]; then
  echo "error: expected $CLOUDIHUB_CONFIG_DIR/models.json and $CLOUDIHUB_CONFIG_DIR/agents/sally/AGENTS.md" >&2
  exit 1
fi

mkdir -p "$dest_dir/agents/sally"
rsync -av --delete "$CLOUDIHUB_CONFIG_DIR/models.json" "$dest_dir/models.json"
rsync -av --delete --exclude=memory/ "$CLOUDIHUB_CONFIG_DIR/agents/sally/" "$dest_dir/agents/sally/"
git -C "$repo_root" status --short examples/harbor/base/aihub-eval/cloudihub-config/
