# CTR beta deployment — schema migrations

How the beta deployment keeps the database schema in step with the code it ships.

## Why this exists

The 2026-09-11 Outlands release put new application code on beta while the schema stayed one
migration behind. Coolify built and started the containers; nothing in the deployment path
ran `knex migrate:latest`. Migration 49 was applied by hand, afterwards, against a database
that had already been serving the new code. A release must not be able to do that again.

## Migration owner

One service owns migrations: **`ct-migrate`** in `docker-compose.beta.yml`.

It is a one-shot container built from the `tooling` target of `docker/beta/api.Dockerfile`
and runs `docker/beta/migrate-db.sh`. It is in no profile, so every ordinary `up` runs it.

Nothing else migrates. The API and socket images are built from the `runtime` and `socket`
targets, which carry neither ts-node nor `db/migrations`, so they cannot become a second
migration owner even by accident. There is no replica race to reason about.

## Startup order

```
db
  └─ ct-migrate          (waits for db, migrates, exits 0)
       └─ ct-api         (depends_on: condition: service_completed_successfully)
            ├─ ct-socket
            └─ nginx
```

`ct-api` starts only after `ct-migrate` has exited successfully. `ct-socket` and `nginx` sit
behind `ct-api`, so a blocked migration blocks the whole ingress, not just the API.

`restart: "no"` on `ct-migrate` is required, not cosmetic. Under the default restart policy
Docker restarts a container that exits 0, and compose would then wait forever for a
"completed" state the container keeps leaving.

## Migration command

`docker/beta/migrate-db.sh`, in order:

1. `node db-helpers.js wait` — retries the MySQL connection until it succeeds, gives up after
   120 s with the driver's own error. This is the database-readiness step; there is no fixed
   sleep anywhere in the path.
2. `node db-helpers.js create` — `CREATE DATABASE IF NOT EXISTS`. A no-op against the
   existing beta database; it only saves a manual step on a fresh disposable stack.
3. `knex migrate:latest --knexfile src/knexfile.ts`
4. `knex migrate:list` — prints the resulting schema state into the deployment log.

## No seeds. Ever.

The deployment path runs migrations **only**. It never runs `db:seed`, `db:init`,
`bootstrap-db`, a reset, or a drop.

Seed files insert rows, and several are written for an empty database; re-running them
against a live one duplicates or overwrites citizen-visible data. A release that needs new
rows puts them in a migration, which knex records and never applies twice.

`docker/beta/bootstrap-db.sh` is the first-run tool and is a different thing entirely: it
seeds, and it refuses a database that already has tables. It stays behind the `bootstrap`
profile and is never part of a deployment.

## Failure behavior

`migrate-db.sh` runs under `set -euo pipefail`. There is no `|| true`, no `; exit 0`, no
background execution.

A failing migration therefore exits non-zero, and:

* `ct-api`, `ct-socket` and `nginx` are created but never started — no traffic is served;
* `docker compose up -d` exits 1 with
  `service "ct-migrate" didn't complete successfully: exit 1`;
* Coolify runs `docker compose --project-name <uuid> ... up --build -d` through
  `execute_remote_command`, whose `ignore_errors` defaults to `false`, so a non-zero exit
  throws and the deployment is marked **failed**.

A failed migration cannot produce a green deployment.

## Idempotence and locking

`migrate:latest` applies only the migrations absent from the `migrations` table, so a deploy
with nothing pending logs `Already up to date` and exits 0. Redeploys and container restarts
are safe and change no rows.

Knex takes a row lock in `migrations_lock` for the duration of a run. With two migrators
started at once, one applies the batch and the other reports `Already up to date`; the
migration is applied exactly once and the lock is released either way. The stack does not
rely on this — it has a single migration owner — but the protection is there.

## Local verification

Runs the real deployment path against a disposable, populated database.

```shell
# env file with DB_USER, DB_PASS, DB_DATABASE, MYSQL_ROOT_PASSWORD, JWT_SECRET
DC="docker compose -p ctrmig -f docker-compose.beta.yml --env-file /tmp/ctr-mig.env"

$DC --profile bootstrap build
$DC up -d db
$DC --profile bootstrap run --rm ct-bootstrap   # populate a FRESH disposable database

$DC up -d                                       # the deployment path; runs ct-migrate
$DC logs ct-migrate
$DC exec -T nginx curl -sI localhost/

$DC down -v                                     # disposable: -v removes the fixture volume
```

To rehearse a pending migration, put the fixture one migration behind before `up -d` —
delete that migration's row from the `migrations` table and undo its effect by hand. Do not
add a throwaway migration to `api/db/migrations`; migration history is permanent.

## Automatic migration does not replace the backup rule

A migration-bearing beta release still requires, in order:

1. full database backup;
2. backup verification;
3. restore rehearsal, when the release risk calls for it;
4. deployment;
5. post-deploy checks.

Automatic migration removes the "new code, old schema" failure. It does not make a bad
migration recoverable. Only the backup does that.
