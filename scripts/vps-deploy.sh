#!/usr/bin/env bash
# Builds and (re)starts the Caliphate Rides API on your own server (e.g. a Contabo VPS), behind
# Nginx Proxy Manager. Run it from the backend folder:   ./scripts/vps-deploy.sh
# Run it again after every update (it pulls the latest code from GitHub first).
#
# Needs: Docker, a .env file in this folder (see DEPLOY-VPS.md), and Nginx Proxy Manager's Docker
# network (default "proxy"; change with NETWORK=name ./scripts/vps-deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK="${NETWORK:-proxy}"
NAME="${NAME:-caliphate-api}"

[ -f .env ] || { echo "No .env file here. Create it first: see DEPLOY-VPS.md, step 4."; exit 1; }
docker network inspect "$NETWORK" >/dev/null 2>&1 || { echo "Docker network '$NETWORK' not found. Run: docker network ls"; exit 1; }

if [ -d .git ]; then
  echo "Getting the latest code…"
  git pull --ff-only || echo "(couldn't pull; building the code that's here)"
fi

echo "Building…"
docker build -t "$NAME" .

echo "Starting…"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --network "$NETWORK" \
  --env-file .env \
  -v caliphate-uploads:/app/uploads \
  "$NAME" >/dev/null

echo "Waiting for it to start…"
for i in $(seq 1 30); do
  sleep 2
  if docker run --rm --network "$NETWORK" curlimages/curl -sf "http://$NAME:4000/health" >/dev/null 2>&1; then
    echo
    echo "The API is running:"
    docker run --rm --network "$NETWORK" curlimages/curl -s "http://$NAME:4000/health"; echo
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then break; fi
done

echo
echo "It didn't start. The last lines it printed:"
docker logs "$NAME" --tail 25
exit 1
