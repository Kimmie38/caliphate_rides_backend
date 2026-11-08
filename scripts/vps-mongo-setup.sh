#!/usr/bin/env bash
# Starts MongoDB on this server for Caliphate Rides (free, no size limit except your disk).
#   - runs in Docker as "caliphate-mongo", on a private network only the API can reach
#   - never opened to the internet (no ports published)
#   - data kept in the Docker volume "caliphate-mongo-data" (survives restarts and rebuilds)
#   - a password is created once and saved in /root/caliphate-mongo.env
# Run once:  ./scripts/vps-mongo-setup.sh     (safe to run again: it keeps the existing data and password)
set -euo pipefail

NAME=caliphate-mongo
NET=caliphate-internal
CREDS=/root/caliphate-mongo.env
IMAGE="${MONGO_IMAGE:-mongo:8}"
CACHE_GB="${MONGO_CACHE_GB:-0.5}"   # memory MongoDB may use for its cache; keeps room for your other sites

docker network inspect "$NET" >/dev/null 2>&1 || { docker network create "$NET" >/dev/null; echo "Created private network $NET"; }

if [ ! -f "$CREDS" ]; then
  umask 077
  printf 'MONGO_USER=caliphate\nMONGO_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$CREDS"
  echo "Created a database password in $CREDS"
fi
# shellcheck disable=SC1090
. "$CREDS"

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "MongoDB container already exists; making sure it's running."
  docker start "$NAME" >/dev/null
else
  echo "Starting MongoDB ($IMAGE)…"
  docker run -d --name "$NAME" --restart unless-stopped \
    --network "$NET" \
    -v caliphate-mongo-data:/data/db \
    -e MONGO_INITDB_ROOT_USERNAME="$MONGO_USER" \
    -e MONGO_INITDB_ROOT_PASSWORD="$MONGO_PASSWORD" \
    "$IMAGE" --wiredTigerCacheSizeGB "$CACHE_GB" >/dev/null
fi

echo "Waiting for MongoDB to be ready…"
for i in $(seq 1 30); do
  if docker exec "$NAME" mongosh --quiet -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
       --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    echo
    echo "MongoDB is running."
    echo
    echo "Put this line in /opt/caliphate_rides_backend/.env (replacing any MONGODB_URI line):"
    echo
    echo "MONGODB_URI=mongodb://$MONGO_USER:$MONGO_PASSWORD@$NAME:27017/caliphate?authSource=admin"
    echo
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then break; fi
  sleep 2
done

echo
echo "MongoDB didn't start. Its last lines:"
docker logs "$NAME" --tail 20
echo
echo "If you see 'Illegal instruction' or 'AVX', this server's CPU needs an older MongoDB:"
echo "  docker rm -f $NAME && MONGO_IMAGE=mongo:4.4 ./scripts/vps-mongo-setup.sh"
exit 1
