#!/bin/sh
set -e
if [ "$DEVPLANNER_PROCESS" = "worker" ]; then
  exec node /app/apps/api/dist/worker/index.js
fi
node /app/apps/api/scripts/docker-entrypoint.mjs
exec node /app/apps/api/dist/index.js
