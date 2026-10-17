#!/usr/bin/env bash
# Publishes site/ to https://nopanicpost.donotpanic.space on the Oracle box (public, no login).
#   scripts/deploy-site.sh check                         # DNS A record points at the box
#   scripts/deploy-site.sh deploy                        # rsync site/, write Caddy block, validate, reload
#   scripts/deploy-site.sh verify-file <tiktok*.txt>     # add a TikTok signature file, redeploy
# Deploy PUBLISHES. Run it yourself. Caddy site files live in /etc/caddy/previews/ because the
# box Caddyfile imports /etc/caddy/previews/*.caddy (see oracle-vps/remote/bootstrap.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

SITE_HOST="nopanicpost.donotpanic.space"
SITE_NAME="nopanicpost-public"
REMOTE_ROOT="/srv/sites/nopanicpost"
CADDY_FILE="/etc/caddy/previews/$SITE_NAME.caddy"
HOST="${VPS_HOST:?Set VPS_HOST to the Oracle box address, for example: VPS_HOST=<box ip> scripts/deploy-site.sh deploy}"
USER_="${VPS_SSH_USER:-ubuntu}"
KEY="${VPS_SSH_KEY:-$HOME/.ssh/oracle-vps.key}"; KEY="${KEY/#\~/$HOME}"
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8)
remote() { ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "$@"; }

check_dns() {
  local resolved
  resolved="$(dig +short "$SITE_HOST" | tr '\n' ' ')"
  case " $resolved" in
    *" $HOST "*) echo "dns ok: $SITE_HOST -> $HOST" ;;
    *) echo "add A record nopanicpost -> $HOST at Hostinger" >&2; exit 1 ;;
  esac
}

caddy_block() {
  cat <<BLOCK
$SITE_HOST {
	root * $REMOTE_ROOT
	encode gzip
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Content-Security-Policy "default-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors 'none'"
	}
	try_files {path} {path}/index.html {path}.html
	file_server
	handle_errors 404 {
		rewrite * /404.html
		file_server
	}
}
BLOCK
}

sync_files() {
  [ -f site/index.html ] || { echo "site/index.html missing" >&2; exit 1; }
  remote "sudo mkdir -p $REMOTE_ROOT && sudo chown $USER_ $REMOTE_ROOT"
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" site/ "$USER_@$HOST:$REMOTE_ROOT/"
  remote "chmod -R a+rX $REMOTE_ROOT"
}

# write site file, validate as caddy (so permission errors show up), reload; roll back on either failure
install_caddy_block() {
  caddy_block | remote "sudo tee $CADDY_FILE >/dev/null &&
    if ! sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
      sudo rm -f $CADDY_FILE; echo 'caddy validate failed — site removed' >&2; exit 1
    elif ! sudo systemctl reload caddy; then
      sudo rm -f $CADDY_FILE; sudo systemctl reload caddy
      echo 'caddy reload failed — site removed, previous config kept (journalctl -u caddy)' >&2; exit 1
    fi"
}

print_status() {
  local path code
  for path in / /terms/ /privacy/; do
    code="$(curl -sSf -o /dev/null -w '%{http_code}' "https://$SITE_HOST$path")"
    echo "$code https://$SITE_HOST$path"
  done
}

deploy() {
  check_dns
  sync_files
  install_caddy_block
  echo "live: https://$SITE_HOST (first hit may take ~10s while the certificate is issued)"
  print_status
}

case "${1:-}" in
  check) check_dns ;;
  deploy) deploy ;;
  verify-file)
    file="${2:?path to TikTok verification file}"
    name="$(basename "$file")"
    [[ "$name" =~ ^tiktok[A-Za-z0-9_-]*\.txt$ ]] || { echo "bad name '$name' (expected tiktok<id>.txt)" >&2; exit 1; }
    [ -f "$file" ] || { echo "$file not found" >&2; exit 1; }
    cp "$file" "site/$name"
    echo "copied to site/$name"
    deploy ;;
  *) sed -n '2,5p' "$0"; exit 2 ;;
esac
