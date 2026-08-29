#!/bin/bash
# Deterministic first-run database bootstrap for the CTR beta stack.
#
# Run it against an EMPTY, disposable MySQL 5.7 database. It never runs as part of serving
# traffic and it refuses to touch a database that already has application tables, so it
# cannot be pointed at production by accident.
#
#   docker compose -f docker-compose.beta.yml --profile bootstrap run --rm ct-bootstrap
#
# Three things make a naive `npm run db:init` fail on a fresh beta database, all of them
# properties of the existing history rather than bugs to rewrite:
#
#  1. compose asks MySQL to pre-create the schema (MYSQL_DATABASE), and `db/scripts/
#     create-db.ts` treats an existing database as fatal -- `process.exit(1)` -- so
#     `db:init` aborts before it ever reaches the migrations. This script creates the
#     database itself, idempotently, and calls the migration/seed steps directly.
#
#  2. 20260309032638_add_voting_tables inserts a demo poll with `place_id = 1` and a
#     foreign key to `place`. On an empty database no place exists yet, so it dies with
#     ER_NO_REFERENCED_ROW_2. The places seed supplies place 1, but it needs the schema
#     from the 32 migrations that precede the voting one. So the order has to be:
#     migrate up to the pivot -> seed places -> migrate the rest.
#
#  3. MySQL 5.7 DDL is not transactional. When step 2 fails, `vote_list` and `vote_options`
#     already exist while the migration is recorded as not run, so a plain retry then dies
#     with ER_TABLE_EXISTS_ERROR. Reaching 43/43 by way of a failure and a manual cleanup
#     is not a procedure; this script simply never triggers the failure.
#
# Migrations and seeds are .ts, so this runs in the `tooling` image target, which keeps
# ts-node. The long-running API image does not have it.
set -euo pipefail

# The last migration before 20260309032638_add_voting_tables. Everything through this one
# can run against an empty database; the voting migration cannot.
PIVOT_MIGRATION=20250213180535_add_virtual_pet_table.ts
# The first migration that CANNOT run before the places seed. The pivot is defined by the
# pair -- pivot applied, this one not yet -- rather than by a migration count, so inserting
# or reordering earlier migrations cannot silently move the seed point.
VOTING_MIGRATION=20260309032638_add_voting_tables.ts
PLACES_SEED=02-places.seed.ts

cd /usr/src/app

: "${DB_HOST:?DB_HOST must be set}"
: "${DB_DATABASE:?DB_DATABASE must be set}"
: "${NODE_ENV:=production}"
export NODE_ENV

knex() { npx knex --knexfile src/knexfile.ts "$@"; }

echo "== waiting for ${DB_HOST}:${DB_PORT:-3306} =="
node ./db-helpers.js wait

echo "== creating ${DB_DATABASE} if absent =="
node ./db-helpers.js create

echo "== checking the database is empty =="
node ./db-helpers.js assert-empty

# Asks the migrations ledger whether one migration has run. Echoes yes/no and returns the
# helper's exit code; anything other than applied/not-applied is fatal on the spot, because
# a loop that cannot tell "not yet" from "cannot connect" will happily spin 200 times and
# then blame the wrong thing.
applied() {
  local status=0
  node ./db-helpers.js migration-applied "$1" || status=$?
  case "$status" in
    0|1) return "$status" ;;
    *) echo "bootstrap-db: FATAL cannot read the migrations ledger (exit ${status})" >&2
       exit 1 ;;
  esac
}

echo "== migrating up to ${PIVOT_MIGRATION} =="
# `migrate:up` runs one pending migration at a time, so the pivot is a position in the
# history rather than a count -- adding migrations later cannot silently move it.
#
# The check is the ledger, NOT `knex migrate:list`. migrate:list prints the completed and
# the pending migrations, so grepping it for the pivot filename matched on the very first
# iteration and this loop exited after migration #1 -- the places seed then ran ~31
# migrations earlier than the comments here claim. It only ever appeared to work.
for _ in $(seq 1 200); do
  knex migrate:up >/dev/null
  if applied "$PIVOT_MIGRATION"; then
    break
  fi
done

# Assert the position we actually need, not merely that the loop ended. Both halves matter:
# the places seed needs the pivot's schema, and it must land BEFORE the voting migration,
# which inserts a poll referencing place 1.
applied "$PIVOT_MIGRATION" || {
  echo "bootstrap-db: FATAL never reached ${PIVOT_MIGRATION}" >&2; exit 1; }
if applied "$VOTING_MIGRATION"; then
  echo "bootstrap-db: FATAL ${VOTING_MIGRATION} already ran; the places seed is too late" >&2
  exit 1
fi
echo "== pivot proof: ${PIVOT_MIGRATION}=applied ${VOTING_MIGRATION}=not-applied =="

echo "== seeding places so the voting migration has place 1 =="
knex seed:run --specific="$PLACES_SEED"

echo "== migrating the remainder =="
knex migrate:latest

echo "== seeding everything else =="
for seed in $(ls db/seed | sort); do
  if [ "$seed" = "$PLACES_SEED" ]; then
    echo "-- skipping $seed (already run above)"
    continue
  fi
  echo "-- $seed"
  knex seed:run --specific="$seed"
done

echo "== done =="
knex migrate:list
