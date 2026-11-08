#!/usr/bin/env bash
# Backs up this server's Caliphate Rides database to /opt/caliphate-backups and keeps the last 7 days.
#   ./scripts/vps-mongo-backup.sh                  back up now
#   ./scripts/vps-mongo-backup.sh --install-cron   back up automatically every night at 03:00
# To restore a backup (replaces the current data):
#   docker exec -i caliphate-mongo mongorestore -u caliphate -p PASSWORD --authenticationDatabase admin --archive --gzip --drop < /opt/caliphate-backups/FILE
set -euo pipefail

if [ "${1:-}" = "--install-cron" ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  ( crontab -l 2>/dev/null | grep -v vps-mongo-backup.sh; echo "0 3 * * * $SELF >> /var/log/caliphate-backup.log 2>&1" ) | crontab -
  echo "Nightly backup installed (03:00). Log: /var/log/caliphate-backup.log"
  exit 0
fi

CREDS=/root/caliphate-mongo.env
# shellcheck disable=SC1090
. "$CREDS"
DIR=/opt/caliphate-backups
KEEP_DAYS="${KEEP_DAYS:-7}"
mkdir -p "$DIR"
FILE="$DIR/caliphate-$(date +%F-%H%M).archive.gz"

docker exec caliphate-mongo mongodump -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --db caliphate --archive --gzip > "$FILE"
find "$DIR" -name 'caliphate-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup saved: $FILE ($(du -h "$FILE" | cut -f1))"
