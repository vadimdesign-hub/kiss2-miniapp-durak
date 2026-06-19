#!/usr/bin/env bash
set -euo pipefail

# API services to fetch (edit this list as needed)
SERVICES=(
  user
  relationship
  league
  room
  roulette
  task
  collection
  achievement
  club
  battlepass
  notification
  socialnetwork
  vip
  bottle
  gift
  file
  version
  socialnetwork
  clievent
  wallet
  bfr
)

ENV="${1:-stage}"

case "$ENV" in
  stage) BASE_URL="https://api-stage.kisskissplay.com" ;;
  prod)  BASE_URL="https://api-prod.kisskissplay.com" ;;
  *)
    echo "Unknown env: $ENV (use 'stage' or 'prod')" >&2
    exit 1
    ;;
esac
DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/api"

mkdir -p "$DOCS_DIR"

echo "Fetching API docs for env: ${ENV}"

for service in "${SERVICES[@]}"; do
  url="${BASE_URL}/${service}/api/api.yaml"
  out_file="${DOCS_DIR}/${service}.yaml"
  echo "Fetching ${service}: ${url}"
  if curl -fsSL --retry 3 --retry-delay 2 -o "$out_file" "$url"; then
    echo "  -> Saved to ${out_file}"
  else
    echo "  -> FAILED to fetch ${url}" >&2
    rm -f "$out_file"
  fi
done

echo "Done. API docs saved to ${DOCS_DIR}"
