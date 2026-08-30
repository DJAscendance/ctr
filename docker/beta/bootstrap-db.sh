#!/bin/bash
# Deterministic first-run database bootstrap for the CTR beta stack.
#
# Run it against an EMPTY, disposable MySQL 5.7 database. It never runs as part of serving
# traffic and it refuses to touch a database that already has application tables, so it
# cannot be pointed at production by accident.
#
#   docker compose -f docker-compose.beta.yml --profile bootstrap run --rm ct-bootstrap
#
# The migrations and the seeds themselves are ordinary and run in their ordinary order. The
# script exists for one reason: compose asks MySQL to pre-create the schema
# (MYSQL_DATABASE), and `db/scripts/create-db.ts` treats an existing database as fatal --
# `process.exit(1)` -- so a plain `npm run db:init` aborts before it ever reaches the
# migrations. This script creates the database itself, idempotently, and calls the
# migration and seed steps directly.
#
# Migrations and seeds are .ts, so this runs in the `tooling` image target, which keeps
# ts-node. The long-running API image does not have it.
set -euo pipefail

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

echo "== migrating =="
knex migrate:latest

# Seeds run one at a time, in filename order, so a failure names the seed that failed
# instead of only the batch. The order is the filename order `knex seed:run` would use
# anyway; nothing here depends on a seed running out of sequence.
echo "== seeding =="
for seed in $(ls db/seed | sort); do
  echo "-- $seed"
  knex seed:run --specific="$seed"
done

echo "== done =="
knex migrate:list
