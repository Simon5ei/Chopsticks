#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -f /opt/chopsticks/package.json
backup="/opt/chopsticks-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
chmod 700 "$backup"
systemctl stop dsh
if pgrep -f '^/opt/node24/bin/node /opt/surfcore/src/(bridge|mcp-snowluma-safe)\.js' >/dev/null; then
  systemctl start dsh
  echo 'Old delivery process remains; cutover aborted.' >&2
  exit 1
fi
cp -a /root/.dsh "$backup/dsh"
cp -a /opt/surfcore/state "$backup/qq-state"
cp -a /etc/systemd/system/dsh.service.d "$backup/unit-dropins"
printf '%s\n' "$backup" > /opt/chopsticks-backups/latest
rollback_on_failure() {
  systemctl stop dsh || true
  cp -a "$backup/dsh/." /root/.dsh/
  rm -f /etc/systemd/system/dsh.service.d/chopsticks.conf
  cp -a "$backup/unit-dropins/." /etc/systemd/system/dsh.service.d/
  systemctl daemon-reload
  systemctl start dsh
  echo "Cutover failed; restored old deployment from $backup" >&2
}
trap rollback_on_failure ERR
/opt/node24/bin/node /opt/chopsticks/deployment/prepare.mjs production
session=$(/opt/node24/bin/node -e 'const c=require("/var/lib/chopsticks/config.json"); process.stdout.write(c.bili.sessionId)')
/opt/node24/bin/node /opt/chopsticks/deployment/adopt-session.mjs /root/.dsh "$session" chopsticks-bili
# Materialize and validate the new composed profile before launching its app.
env HOME=/root DSH_HOME=/root/.dsh /opt/node24/bin/dsh --profile web --dump-config >/dev/null
cat > /etc/systemd/system/dsh.service.d/chopsticks.conf <<'UNIT'
[Service]
Environment=DSH_HOME=/root/.dsh
Environment=DSH_NODE=/opt/node24/bin/node
Environment=CHOPSTICKS_CONFIG=/var/lib/chopsticks/config.json
Environment=TZ=Asia/Shanghai
ExecStart=
ExecStart=/opt/node24/bin/dsh --profile web --host 127.0.0.1 --port 3080 --no-open --trusted-host 192.168.5.234:3080 --trusted-host 127.0.0.1:23080
UNIT
rm /etc/systemd/system/dsh.service.d/surfcore.conf
systemctl daemon-reload
systemctl start dsh
trap - ERR
echo "Cutover started. Backup: $backup"
