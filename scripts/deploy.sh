#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "${1:-}" != "--skip-pull" ]]; then
  git pull --ff-only
fi

if [[ ! -f .env.production ]]; then
  cp .env.production.example .env.production
  chmod 600 .env.production
  echo "Created .env.production. AI configuration is currently disabled."
fi

sudo docker compose build
sudo docker compose up -d --remove-orphans

for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3200/api/health >/dev/null; then
    echo "JobTailor is healthy at http://127.0.0.1:3200"
    exit 0
  fi
  sleep 3
done

echo "Deployment finished, but the health check failed." >&2
sudo docker compose logs --tail=100 jobtailor >&2
exit 1
