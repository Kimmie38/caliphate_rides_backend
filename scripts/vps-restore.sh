#!/usr/bin/env bash
# Puts a full backup ZIP (from the admin website or vps-full-backup.sh) back into this server's database.
# It REPLACES the current records and driver photos with the backup's.
#   ./scripts/vps-restore.sh /path/to/caliphate-backup-....zip
set -euo pipefail
FILE="${1:-}"
[ -f "$FILE" ] || { echo "Give the backup file: ./scripts/vps-restore.sh /path/to/backup.zip"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx caliphate-api || { echo "The API (caliphate-api) isn't running. Run ./scripts/vps-deploy.sh first."; exit 1; }
echo "This REPLACES everything in the Caliphate Rides database with: $FILE"
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
echo "Safety copy of the current data first…"
"$(dirname "$0")/vps-full-backup.sh" >/dev/null && echo "  saved in /opt/caliphate-backups"
docker exec -i caliphate-api node scripts/backup-restore.js - --yes < "$FILE"
docker restart caliphate-api >/dev/null
echo "Restarted the API. Check the admin website."
