#!/usr/bin/env bash
# Copies everything from MongoDB Atlas into the MongoDB on this server: riders, drivers, rides,
# wallets, payments, places, settings, admins and driver document photos.
#   ./scripts/vps-mongo-import.sh 'mongodb+srv://USER:PASSWORD@cluster....mongodb.net/caliphate?...'
# Put the Atlas address in single quotes. It REPLACES what's in the local database with Atlas's copy,
# so run it before switching the API over (or again, if you want a fresh copy).
set -euo pipefail

ATLAS_URI="${1:-}"
[ -n "$ATLAS_URI" ] || { echo "Give the Atlas address: ./scripts/vps-mongo-import.sh 'mongodb+srv://…'"; exit 1; }
CREDS=/root/caliphate-mongo.env
[ -f "$CREDS" ] || { echo "Run ./scripts/vps-mongo-setup.sh first."; exit 1; }
# shellcheck disable=SC1090
. "$CREDS"

# Which database the data is in on Atlas: the name after ".net/" in the address. With nothing there
# (…mongodb.net/ or …mongodb.net/?retryWrites…), the backend has been using the database "test".
rest="${ATLAS_URI#*://}"; rest="${rest#*@}"
path=""; [ "${rest#*/}" != "$rest" ] && path="${rest#*/}"
SRC_DB="${path%%\?*}"
[ -n "$SRC_DB" ] || SRC_DB=test
echo "Atlas database: $SRC_DB  →  this server's database: caliphate"

NAME=caliphate-mongo
NET=caliphate-internal
DIR=/opt/caliphate-backups
FILE="atlas-$(date +%F-%H%M).archive.gz"
mkdir -p "$DIR"

echo "Copying from Atlas…"
docker run --rm --network "$NET" -v "$DIR":/backup mongo:8 \
  mongodump --uri "$ATLAS_URI" --db "$SRC_DB" --archive="/backup/$FILE" --gzip

echo "Loading into this server's MongoDB…"
docker run --rm --network "$NET" -v "$DIR":/backup mongo:8 \
  mongorestore --uri "mongodb://$MONGO_USER:$MONGO_PASSWORD@$NAME:27017/?authSource=admin" \
  --archive="/backup/$FILE" --gzip --drop \
  --nsInclude "$SRC_DB.*" --nsFrom "$SRC_DB.*" --nsTo "caliphate.*"

echo
echo "Done. What's in the database now:"
docker exec "$NAME" mongosh --quiet -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin caliphate --eval '
  db.getCollectionNames().sort().forEach((c) => print("  " + c.padEnd(24) + db.getCollection(c).estimatedDocumentCount()))'
echo
echo "(The Atlas copy is kept in $DIR/$FILE.)"
