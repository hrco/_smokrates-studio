#!/usr/bin/env bash
# The one command that proves this project works. /task, /ship and the Stop hook run it.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck && npm test
