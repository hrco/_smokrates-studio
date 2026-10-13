#!/usr/bin/env bash
# Plays the NoPanicPost end-to-end flow in a visible Terminal window for the TikTok app-review demo:
# app website -> Login Kit sign-in (user.info.basic, video.upload) -> Content Posting API inbox upload.
# The human records the screen (Cmd+Shift+5) and clicks Authorize; nothing here publishes a post.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd -P)"
VIDEO="${1:-out/2026-10-13-golden-hour-groove.mp4}"
SITE_URL="https://nopanicpost.donotpanic.space/"

[ -f "$VIDEO" ] || { echo "video not found: $VIDEO" >&2; exit 1; }
pkill -f 'scripts/tiktok-auth.ts' || true

open -a Safari "$SITE_URL"
sleep 6

# Runs in a new Terminal window so the recording shows every command and its output.
osascript <<EOF
tell application "Terminal"
  activate
  do script "cd '$REPO_DIR' && clear && echo '== NoPanicPost demo: sign in with TikTok (Login Kit) ==' && sleep 2 && TIKTOK_AUTH_BROWSER=Safari npm run -s tiktok:auth && echo && echo '== Send the video to the TikTok inbox as a draft (Content Posting API, video.upload) ==' && sleep 2 && npm run -s tiktok:draft -- '$VIDEO'"
end tell
EOF
