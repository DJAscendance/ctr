#!/bin/bash
# Regression test for bootstrap-db.sh, run against a real, disposable MySQL 5.7.
#
#   docker build -f docker/beta/api.Dockerfile --target tooling -t ctr-beta-tooling .
#   docker/beta/bootstrap-db.test.sh ctr-beta-tooling
#
# It exercises the SHIPPED script inside the tooling image rather than a reimplementation
# of its logic, because the thing under test is the deployment procedure, not an idea of it.
#
# The load-bearing assertion is ORDER, and it is deliberately taken from the migrations
# ledger rather than from the script's own output:
#
#   batch(pivot) < batch(voting)
#
# `knex migrate:up` records each migration in its own batch, while the closing
# `migrate:latest` records everything it applies in ONE batch. So the pivot and the voting
# migration can only land in different batches if the loop really did stop at the pivot --
# which is exactly where the places seed runs. If they share a batch, one `migrate:latest`
# applied both and the seed did not happen between them.
#
# That distinction is the whole point. The previous implementation asked
# `knex migrate:list | grep -q $PIVOT`, and migrate:list prints PENDING migrations too, so
# the grep matched on the first iteration and the loop exited after migration #1. It still
# exited 0 and still produced a working database, purely by luck: migration #1 happens to
# create `place`, so the seed happened to work and the voting migration happened to find
# place 1. Every end-state assertion passes on that build. Only the batch check fails.
set -uo pipefail

IMAGE="${1:-ctr-beta-tooling:latest}"
PIVOT=20250213180535_add_virtual_pet_table.ts
VOTING=20260309032638_add_voting_tables.ts
BANK_MIGRATIONS=(
  20260829120000_add_transaction_memo.ts
  20260829120100_add_first_homestead_reward.ts
  20260829120200_add_transaction_idempotency_key.ts
)

SUFFIX=$$
NET="ctr-bootstrap-test-${SUFFIX}"
DB_CONTAINER="ctr-bootstrap-test-db-${SUFFIX}"
ROOT_PASS=bootstrap-test
SCHEMA=cybertown
LOG=$(mktemp)

failures=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; failures=$((failures + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: expected '$3', got '$2'"; fi; }

cleanup() {
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -f "$LOG"
}
trap cleanup EXIT

sql() { docker exec "$DB_CONTAINER" mysql -uroot -p"$ROOT_PASS" -N -B "$SCHEMA" -e "$1" 2>/dev/null; }

echo "== starting a disposable MySQL 5.7 =="
docker network create "$NET" >/dev/null
docker run -d --name "$DB_CONTAINER" --network "$NET" --network-alias db \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PASS" \
  mysql:5.7 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
for _ in $(seq 1 90); do
  docker exec "$DB_CONTAINER" mysqladmin ping -uroot -p"$ROOT_PASS" --silent 2>/dev/null \
    | grep -q alive && break
  sleep 1
done

echo "== running the bootstrap =="
docker run --rm --network "$NET" \
  -e NODE_ENV=production -e DB_HOST=db -e DB_PORT=3306 \
  -e DB_USER=root -e DB_PASS="$ROOT_PASS" -e DB_DATABASE="$SCHEMA" \
  -e JWT_SECRET=bootstrap-test-not-a-real-secret \
  "$IMAGE" bootstrap-db >"$LOG" 2>&1
bootstrap_status=$?

echo
echo "-- the bootstrap completes --"
check "exit status" "$bootstrap_status" 0
if [ "$bootstrap_status" -ne 0 ]; then
  echo "--- bootstrap output ---"; tail -30 "$LOG"; echo "--- end ---"
fi

echo
echo "-- the places seed runs at the right point in the migration history --"
# Order from the ledger. See the header: this is the assertion the broken grep fails.
pivot_batch=$(sql "SELECT batch FROM migrations WHERE name = '${PIVOT}'")
voting_batch=$(sql "SELECT batch FROM migrations WHERE name = '${VOTING}'")
if [ -z "$pivot_batch" ]; then
  fail "pivot ${PIVOT} is recorded as applied"
elif [ -z "$voting_batch" ]; then
  fail "voting ${VOTING} is recorded as applied"
elif [ "$pivot_batch" -lt "$voting_batch" ]; then
  pass "pivot batch ${pivot_batch} < voting batch ${voting_batch}: the seed ran between them"
else
  fail "pivot batch ${pivot_batch} is not before voting batch ${voting_batch}: one \
migrate:latest applied both, so the places seed did NOT run between them"
fi

# The script states the same pair itself, before it seeds. Cheap to assert, and it keeps
# the human-readable proof honest.
if grep -q "pivot proof: ${PIVOT}=applied ${VOTING}=not-applied" "$LOG"; then
  pass "the script proved the pivot pair before seeding"
else
  fail "the script did not print its pivot proof"
fi
proof_line=$(grep -n 'pivot proof:' "$LOG" | head -1 | cut -d: -f1)
seed_line=$(grep -n 'seeding places' "$LOG" | head -1 | cut -d: -f1)
if [ -n "$proof_line" ] && [ -n "$seed_line" ] && [ "$proof_line" -lt "$seed_line" ]; then
  pass "the proof is printed before the places seed"
else
  fail "the proof does not precede the places seed"
fi

echo
echo "-- the finished database is complete --"
migration_files=$(docker run --rm "$IMAGE" sh -c 'ls db/migrations/*.ts | wc -l' | tr -d ' ')
applied=$(sql "SELECT COUNT(*) FROM migrations")
check "every migration file is applied" "$applied" "$migration_files"

check "place 1 exists for the voting migration's poll" "$(sql "SELECT COUNT(*) FROM place WHERE id = 1")" 1
check "roles are seeded" "$(sql "SELECT COUNT(*) > 100 FROM role")" 1
check "donor roles are seeded" "$(sql "SELECT COUNT(*) FROM role WHERE name IN ('Supporter','Advocate','Devotee','Champion')")" 4
check "colonies and hoods are seeded" "$(sql "SELECT COUNT(*) > 0 FROM map_location")" 1

for migration in "${BANK_MIGRATIONS[@]}"; do
  check "BANK-A1 ${migration} applied" \
    "$(sql "SELECT COUNT(*) FROM migrations WHERE name = '${migration}'")" 1
done

# MySQL 5.7 DDL is not transactional, so a voting migration that died half-way leaves its
# tables behind while the ledger says it never ran. Assert the two agree.
voting_recorded=$(sql "SELECT COUNT(*) FROM migrations WHERE name = '${VOTING}'")
voting_tables=$(sql "SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = '${SCHEMA}' AND table_name IN ('vote_list','vote_options')")
check "voting migration recorded" "$voting_recorded" 1
check "both voting tables exist" "$voting_tables" 2

echo
if [ "$failures" -eq 0 ]; then
  echo "bootstrap-db.test: PASS"
else
  echo "bootstrap-db.test: FAIL (${failures} failed assertion(s))"
fi
exit $((failures == 0 ? 0 : 1))
