#!/usr/bin/env bash
# Makes a full backup ZIP on the VPS (all records, spreadsheets and driver photos) in /opt/caliphate-backups.
# This is the same file as "Download full backup" on the admin website: readable anywhere, and it can
# be restored on any server with ./scripts/vps-restore.sh.
#   ./scripts/vps-full-backup.sh               everything
#   ./scripts/vps-full-backup.sh --no-photos   records only
set -euo pipefail
DIR=/opt/caliphate-backups
mkdir -p "$DIR"
FILE="$DIR/caliphate-full-$(date +%F-%H%M)${1:+-data-only}.zip"
docker exec caliphate-api node scripts/backup-export.js - "$@" > "$FILE"
echo "Saved: $FILE ($(du -h "$FILE" | cut -f1))"
echo "Copy it to your PC (run this on your PC, not the VPS):"
echo "  scp root@$(hostname -I | awk '{print $1}'):$FILE ."
