#!/bin/bash
# Regression test for bootstrap-db.sh, run against a real, disposable MySQL 5.7.
#
#   docker build -f docker/beta/api.Dockerfile --target tooling -t ctr-beta-tooling .
#   docker/beta/bootstrap-db.test.sh ctr-beta-tooling
#
# It exercises the SHIPPED script inside the tooling image rather than a reimplementation
# of its logic, because the thing under test is the deployment procedure, not an idea of it.
#
# Three runs, because the script has three contracts:
#
#   A. an absent database is created and fully built -- every migration, every seed, and a
#      Mayor Election that is complete and attached to the right place.
#   B. a populated application database is REFUSED. That boundary is the only thing keeping
#      this script from being pointable at production, so it is tested, not assumed, and
#      the refusal is checked to have changed nothing.
#   C. a database that already exists but holds no application tables is built anyway. This
#      is the real beta shape: compose pre-creates MYSQL_DATABASE, and it is the reason
#      this script exists instead of `npm run db:init`.
set -uo pipefail

IMAGE="${1:-ctr-beta-tooling:latest}"
VOTING=20260309032638_add_voting_tables.ts
ELECTION='Mayor Election 2026'
PLAZA_SLUG=enter
CANDIDATES=(EmperorAjay MorningStar phil_00)
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
PRECREATED_SCHEMA=cybertown_precreated
LOG=$(mktemp)
LOG2=$(mktemp)
LOG3=$(mktemp)

failures=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; failures=$((failures + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: expected '$3', got '$2'"; fi; }

cleanup() {
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -f "$LOG" "$LOG2" "$LOG3"
}
trap cleanup EXIT

# Queries run against an explicit schema, because run C uses a second one.
sql_on() { docker exec "$DB_CONTAINER" mysql -uroot -p"$ROOT_PASS" -N -B "$1" -e "$2" 2>/dev/null; }
sql() { sql_on "$SCHEMA" "$1"; }

run_bootstrap() {
  docker run --rm --network "$NET" \
    -e NODE_ENV=production -e DB_HOST=db -e DB_PORT=3306 \
    -e DB_USER=root -e DB_PASS="$ROOT_PASS" -e DB_DATABASE="$1" \
    -e JWT_SECRET=bootstrap-test-not-a-real-secret \
    "$IMAGE" bootstrap-db
}

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

# ---------------------------------------------------------------- A. first run
echo "== A. bootstrapping an absent database =="
run_bootstrap "$SCHEMA" >"$LOG" 2>&1
bootstrap_status=$?

echo
echo "-- the bootstrap completes --"
check "exit status" "$bootstrap_status" 0
if [ "$bootstrap_status" -ne 0 ]; then
  echo "--- bootstrap output ---"; tail -30 "$LOG"; echo "--- end ---"
fi

echo
echo "-- the schema is complete --"
# Derived from the image, not hardcoded: a test that pins a migration count fails on the
# next migration added rather than on the defect it is meant to catch.
migration_files=$(docker run --rm "$IMAGE" sh -c 'ls db/migrations/*.ts | wc -l' | tr -d ' ')
check "every migration file is applied" "$(sql "SELECT COUNT(*) FROM migrations")" "$migration_files"

for migration in "${BANK_MIGRATIONS[@]}"; do
  check "BANK-A1 ${migration} applied" \
    "$(sql "SELECT COUNT(*) FROM migrations WHERE name = '${migration}'")" 1
done

check "voting migration recorded" \
  "$(sql "SELECT COUNT(*) FROM migrations WHERE name = '${VOTING}'")" 1
check "vote_list exists" "$(sql "SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = '${SCHEMA}' AND table_name = 'vote_list'")" 1
check "vote_options exists" "$(sql "SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = '${SCHEMA}' AND table_name = 'vote_options'")" 1

echo
echo "-- the seeds ran --"
check "The Plaza exists" "$(sql "SELECT COUNT(*) FROM place WHERE slug = '${PLAZA_SLUG}'")" 1
check "roles are seeded" "$(sql "SELECT COUNT(*) > 100 FROM role")" 1
check "donor roles are seeded" \
  "$(sql "SELECT COUNT(*) FROM role WHERE name IN ('Supporter','Advocate','Devotee','Champion')")" 4
check "colonies and hoods are seeded" "$(sql "SELECT COUNT(*) > 0 FROM map_location")" 1

echo
echo "-- the Mayor Election is complete and in the right place --"
# The election is seeded now, not inserted by the voting migration. These assertions are
# what the removed migrate-up-to-a-pivot dance used to buy, obtained from the end state
# instead of from the order the script happened to run things in.
check "'${ELECTION}' exists exactly once" \
  "$(sql "SELECT COUNT(*) FROM vote_list WHERE title = '${ELECTION}'")" 1
check "'${ELECTION}' is attached to The Plaza" \
  "$(sql "SELECT COUNT(*) FROM vote_list v JOIN place p ON p.id = v.place_id
    WHERE v.title = '${ELECTION}' AND p.slug = '${PLAZA_SLUG}'")" 1
check "'${ELECTION}' has three options" \
  "$(sql "SELECT COUNT(*) FROM vote_options o JOIN vote_list v ON v.id = o.vote_id
    WHERE v.title = '${ELECTION}'")" 3
for candidate in "${CANDIDATES[@]}"; do
  check "candidate ${candidate} is on the ballot" \
    "$(sql "SELECT COUNT(*) FROM vote_options o JOIN vote_list v ON v.id = o.vote_id
      WHERE v.title = '${ELECTION}' AND o.option_text = '${candidate}'")" 1
done
# The old migration inserted options against a hardcoded vote id 1. If anything ever
# reintroduces that assumption, the options point at a poll that does not exist.
check "no orphan vote options" \
  "$(sql "SELECT COUNT(*) FROM vote_options o
    LEFT JOIN vote_list v ON v.id = o.vote_id WHERE v.id IS NULL")" 0

echo
echo "-- the removed pivot workaround has not come back --"
# Asserted against the script as SHIPPED IN THE IMAGE, since that is what deploys.
shipped=$(docker run --rm "$IMAGE" cat /usr/local/bin/bootstrap-db)
if grep -qE 'PIVOT_MIGRATION|pivot proof|migrate:up' <<<"$shipped"; then
  fail "the shipped bootstrap still carries the pivot workaround"
else
  pass "the shipped bootstrap has no pivot, no migrate:up loop, no early places seed"
fi
check "migrations run in one pass" "$(sql "SELECT COUNT(DISTINCT batch) FROM migrations")" 1

# ------------------------------------------------- B. refusing a populated database
echo
echo "== B. re-running against the populated database =="
before=$(sql "SELECT
  (SELECT COUNT(*) FROM migrations),
  (SELECT COUNT(*) FROM place),
  (SELECT COUNT(*) FROM vote_list WHERE title = '${ELECTION}'),
  (SELECT COUNT(*) FROM vote_options)")

run_bootstrap "$SCHEMA" >"$LOG2" 2>&1
second_status=$?

if [ "$second_status" -ne 0 ]; then
  pass "the second run is refused (exit ${second_status})"
else
  fail "the second run succeeded; the populated-database guard is gone"
fi
if grep -q 'Refusing to bootstrap' "$LOG2"; then
  pass "refused by assert-empty, with a reason"
else
  fail "the refusal did not come from assert-empty"
  echo "--- second run output ---"; tail -20 "$LOG2"; echo "--- end ---"
fi

after=$(sql "SELECT
  (SELECT COUNT(*) FROM migrations),
  (SELECT COUNT(*) FROM place),
  (SELECT COUNT(*) FROM vote_list WHERE title = '${ELECTION}'),
  (SELECT COUNT(*) FROM vote_options)")
check "the refused run changed nothing (migrations/places/election/options)" "$after" "$before"

# ------------------------------------------ C. a pre-created but empty database
echo
echo "== C. bootstrapping a pre-created, empty database =="
# The beta shape: compose creates MYSQL_DATABASE, so the schema exists before the
# bootstrap starts and stock create-db.ts would exit 1 on it.
docker exec "$DB_CONTAINER" mysql -uroot -p"$ROOT_PASS" \
  -e "CREATE DATABASE \`${PRECREATED_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" \
  >/dev/null 2>&1
check "the schema exists before the bootstrap runs" \
  "$(sql_on mysql "SELECT COUNT(*) FROM information_schema.schemata
    WHERE schema_name = '${PRECREATED_SCHEMA}'")" 1
check "and holds no application tables" \
  "$(sql_on mysql "SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = '${PRECREATED_SCHEMA}'")" 0

run_bootstrap "$PRECREATED_SCHEMA" >"$LOG3" 2>&1
precreated_status=$?
check "exit status on a pre-created database" "$precreated_status" 0
if [ "$precreated_status" -ne 0 ]; then
  echo "--- pre-created run output ---"; tail -30 "$LOG3"; echo "--- end ---"
fi
check "every migration file is applied" \
  "$(sql_on "$PRECREATED_SCHEMA" "SELECT COUNT(*) FROM migrations")" "$migration_files"
check "'${ELECTION}' exists exactly once" \
  "$(sql_on "$PRECREATED_SCHEMA" "SELECT COUNT(*) FROM vote_list WHERE title = '${ELECTION}'")" 1

echo
if [ "$failures" -eq 0 ]; then
  echo "bootstrap-db.test: PASS"
else
  echo "bootstrap-db.test: FAIL (${failures} failed assertion(s))"
fi
exit $((failures == 0 ? 0 : 1))
