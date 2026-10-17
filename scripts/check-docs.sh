#!/usr/bin/env bash
# Proves the required docs exist and that operation ids match on both sides.
set -euo pipefail
cd "$(dirname "$0")/.."

required=(
  README.md
  CLAUDE.md
  .env.example
  docs/project-guidelines.md
  docs/architecture.md
  docs/workflow.md
  docs/project-status.md
  docs/interactions.md
  docs/accessibility.md
  docs/interfaces.md
  docs/openapi.yaml
  docs/ad-inventory.md
  docs/adr/0001-stack.md
)

missing=0
for f in "${required[@]}"; do
  if [[ ! -s "$f" ]]; then
    echo "missing or empty: $f" >&2
    missing=1
  fi
done

api_ids=$(mktemp)
iface_ids=$(mktemp)
trap 'rm -f "$api_ids" "$iface_ids"' EXIT

grep -oE 'operationId: [A-Za-z0-9._-]+' docs/openapi.yaml | awk '{print $2}' | sort -u > "$api_ids"
grep -oE '`[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+`' docs/interfaces.md | tr -d '`' | sort -u > "$iface_ids"

if ! diff -q "$api_ids" "$iface_ids" >/dev/null; then
  echo "operationId mismatch between docs/openapi.yaml and docs/interfaces.md" >&2
  echo "in openapi only:" >&2
  comm -23 "$api_ids" "$iface_ids" >&2
  echo "in interfaces only:" >&2
  comm -13 "$api_ids" "$iface_ids" >&2
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo "docs ok: ${#required[@]} required files, operation ids match"
