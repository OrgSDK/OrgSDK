#!/usr/bin/env bash
# Run on the runner VM, as root. Does not register an identity or start a service.
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: sudo bash install-service.sh EXECUTOR.tgz INSTANCE [docker|host]" >&2
  exit 1
fi
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
package=$(realpath "$1")
instance=$2
mode=${3:-docker}
[[ $instance =~ ^[a-z][a-z0-9-]{0,23}$ ]] || { echo 'Instance must be 1-24 lowercase letters, digits or hyphens, starting with a letter.' >&2; exit 1; }
[[ $mode == docker || $mode == host ]] || { echo 'Mode must be docker or host.' >&2; exit 1; }
[[ -f $package ]] || { echo 'Package tarball not found.' >&2; exit 1; }
node=$(command -v node)
[[ $node != /root/* && $node != /home/* ]] || { echo 'Install Node outside /root and /home (for example /usr/local/bin/node).' >&2; exit 1; }
command -v npm >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node 22+ is required."); process.exit(1); }'
command -v systemctl >/dev/null
if [[ $mode == docker ]]; then
  command -v docker >/dev/null
  getent group docker >/dev/null || { echo 'Install Docker Engine and its docker group first.' >&2; exit 1; }
fi
account=orgsdk-$instance
if ! id "$account" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "/var/lib/orgsdk-executor/$instance" --shell /usr/sbin/nologin "$account"
fi
account_home=$(getent passwd "$account" | cut -d: -f6)
[[ $account_home == "/var/lib/orgsdk-executor/$instance" ]] || { echo 'Existing service account has an unexpected home; refusing to reuse it.' >&2; exit 1; }
if [[ $mode == docker ]]; then usermod --append --groups docker "$account"; fi
install -d -m 755 /opt/orgsdk-executor
npm install --prefix /opt/orgsdk-executor --omit=dev --ignore-scripts "$package"
package_dir=/opt/orgsdk-executor/node_modules/@orgsdk/executor
install -m 644 "$package_dir/systemd/orgsdk-executor@.service" /etc/systemd/system/orgsdk-executor@.service
cat > /opt/orgsdk-executor/start-service <<WRAPPER
#!/bin/sh
exec "$node" "$package_dir/dist/cli.js" start --data "/var/lib/orgsdk-executor/\$1" --mode "\$EXECUTOR_MODE"
WRAPPER
chmod 755 /opt/orgsdk-executor/start-service
install -d -m 711 /var/lib/orgsdk-executor
install -d -m 700 -o "$account" -g "$account" "/var/lib/orgsdk-executor/$instance"
install -d -m 700 /etc/orgsdk-executor
config=/etc/orgsdk-executor/$instance.env
if [[ ! -e $config ]]; then
  umask 077
  cat > "$config" <<CONFIG
EXECUTOR_MODE=$mode
EXECUTOR_DATA_BIND=1
EXECUTOR_IMAGE=orgsdk-executor:local
EXECUTION_NETWORK=bridge
PATH=$(dirname "$node"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CONFIG
fi
systemctl daemon-reload
cat <<INSTRUCTIONS
Installed orgsdk-executor@$instance (not started).
Edit $config; build or pull EXECUTOR_IMAGE on this VM for Docker mode.
Create the agent's executor identity in the application, then register via stdin:
  read -r -s -p 'Executor token: ' token; echo
  printf '%s' "\$token" | runuser -u $account -- "$node" "$package_dir/dist/cli.js" register --url https://YOUR-SERVER --data /var/lib/orgsdk-executor/$instance
  unset token
Then: systemctl enable --now orgsdk-executor@$instance
INSTRUCTIONS
