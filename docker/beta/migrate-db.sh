#!/bin/bash
# Schema migration step for the CTR beta stack. This is the ONLY place the beta deployment
# changes the database schema, and it runs on every deployment.
#
# It is the answer to a real incident: a beta release shipped new application code while the
# schema stayed one migration behind, because the deployment path started containers and
# never ran `knex migrate:latest`. The migration was applied by hand, afterwards, against a
# database that had already been serving the new code.
#
# It is NOT docker/beta/bootstrap-db.sh. That script is a first-run tool: it seeds, and it
# refuses a database that already has tables. This one is the opposite in both respects --
# it expects a populated citizen database and it runs migrations ONLY:
#
#   * no seeds. Seed files insert rows; several of them are written for an empty database
#     and re-running them against a live one duplicates or overwrites citizen-visible data.
#     If a release needs new rows, they belong in a migration, which knex records and never
#     applies twice.
#   * no create-db reset, no drop, no truncate.
#
# The only write it performs outside the migrations themselves is CREATE DATABASE IF NOT
# EXISTS, which is a no-op against the existing beta database and lets a fresh disposable
# stack come up without a manual step.
#
# Failure is fatal on purpose (`set -e`, no `|| true`). The compose file makes ct-api depend
# on this container COMPLETING SUCCESSFULLY, so a non-zero exit here stops the release: the
# API and, behind it, nginx never start. New code with an old schema is the failure mode
# this whole arrangement exists to prevent, and a half-started stack is a louder, safer
# outcome than a green deployment serving a schema mismatch.
#
# Migrations and seeds are .ts, so this runs in the `tooling` image target, which keeps
# ts-node. The long-running API image does not have it.
#
# Automatic migration does NOT replace the release backup rule. A migration-bearing release
# still takes a full database backup, verifies it, and rehearses the restore when the
# release risk calls for it. See docs/beta-deployment.md.
set -euo pipefail

cd /usr/src/app

: "${DB_HOST:?DB_HOST must be set}"
: "${DB_DATABASE:?DB_DATABASE must be set}"
: "${NODE_ENV:=production}"
export NODE_ENV

knex() { npx knex --knexfile src/knexfile.ts "$@"; }

# Deterministic readiness, not a fixed sleep: db-helpers.js retries the connection until it
# succeeds and gives up after 120s with the driver's own error, so a database that is merely
# slow to start is waited out and a database that is misconfigured fails loudly.
echo "== waiting for ${DB_HOST}:${DB_PORT:-3306} =="
node ./db-helpers.js wait

echo "== ensuring ${DB_DATABASE} exists =="
node ./db-helpers.js create

# Idempotent by knex's own ledger: migrate:latest applies only the migrations absent from
# the `migrations` table, and takes a row lock in `migrations_lock` for the duration, so a
# second copy of this container cannot apply the same migration concurrently.
echo "== migrating =="
knex migrate:latest

echo "== schema state =="
knex migrate:list
