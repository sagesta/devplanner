#!/usr/bin/env bash
set -euo pipefail
run_id="devplanner-smoke-$$"
cleanup() {
  docker rm -f "$run_id-api" "$run_id-db" "$run_id-redis" >/dev/null 2>&1 || true
  docker network rm "$run_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$run_id" >/dev/null
docker run -d --rm --network "$run_id" --network-alias db --name "$run_id-db" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=devplanner pgvector/pgvector:pg16 >/dev/null
docker run -d --rm --network "$run_id" --network-alias cache --name "$run_id-redis" redis:7-alpine >/dev/null
docker run -d --network "$run_id" --name "$run_id-api" \
  -e DATABASE_URL=postgresql://postgres@db:5432/devplanner \
  -e REDIS_URL=redis://cache:6379 \
  -e CLERK_SECRET_KEY=sk_test_synthetic_smoke_only \
  -e ALLOWED_EMAILS=synthetic@example.invalid \
  "${DEVPLANNER_TEST_IMAGE:-devplanner-daily:verified}" >/dev/null
ready=0
for attempt in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$run_id-api")" != true ]; then docker logs "$run_id-api"; exit 1; fi
  if docker exec "$run_id-api" node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then docker logs "$run_id-api"; exit 1; fi
docker exec "$run_id-api" node -e "Promise.all([fetch('http://127.0.0.1:3001/health'),fetch('http://127.0.0.1:3001/api/daily/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{title:'Unauthorized synthetic task'}],idempotencyKey:'smoke'})})]).then(async ([health,denied])=>{if(health.status!==200||denied.status!==401)process.exit(1); console.log('PASS: clean-container migration/startup, database/Redis health, unauthenticated write denied');console.log(JSON.stringify(await health.json()));}).catch(()=>process.exit(1))"
# A stopped cache must fail promptly and recover without restarting the API.
docker stop "$run_id-redis" >/dev/null
# Redis was started with --rm; recreate the same network alias for recovery.
docker exec "$run_id-api" node -e "const started=Date.now();fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(15000)}).then(async r=>{const body=await r.json();if(r.status!==503||body.redis.status!=='error')process.exit(1);console.log('PASS: Redis outage returns 503 in '+(Date.now()-started)+'ms');}).catch(e=>{console.error(e);process.exit(1)})"
docker run -d --rm --network "$run_id" --network-alias cache --name "$run_id-redis" redis:7-alpine >/dev/null
for attempt in $(seq 1 15); do
  if docker exec "$run_id-api" node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo 'PASS: API health recovers after Redis restart without API restart'
    exit 0
  fi
  sleep 1
done
echo 'FAIL: Redis recovery did not restore API health'
exit 1
